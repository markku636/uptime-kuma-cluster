/**
 * Node Lifecycle Manager for K8s Auto-scaling
 * 負責節點的自動註冊、心跳更新和離線清理
 * 
 * @module server/util/node-lifecycle
 */

const { R } = require("redbean-node");
const { log } = require("../../src/util");

const NODE_HEARTBEAT_INTERVAL = 30000; // 30 秒
const NODE_OFFLINE_THRESHOLD = 90000;  // 90 秒未更新視為離線
const CLEANUP_INTERVAL = 60000;        // 60 秒清理一次
const STALE_NODE_THRESHOLD = 3600000;  // 1 小時後清理離線節點記錄

class NodeLifecycleManager {
    constructor() {
        this.heartbeatTimer = null;
        this.cleanupTimer = null;
        this.nodeId = null;
        this.isPrimary = false;
        this.started = false;
    }

    /**
     * 初始化
     * @param {string} nodeId 
     * @param {boolean} isPrimary 
     */
    init(nodeId, isPrimary = false) {
        this.nodeId = nodeId;
        this.isPrimary = isPrimary;
    }

    /**
     * 啟動生命週期管理
     */
    async start() {
        if (this.started || !this.nodeId) {
            return;
        }

        log.info("node-lifecycle", `Starting lifecycle manager for node: ${this.nodeId}`);
        this.started = true;
        
        // 啟動心跳
        await this.sendHeartbeat();
        this.heartbeatTimer = setInterval(() => this.sendHeartbeat(), NODE_HEARTBEAT_INTERVAL);
        
        // 只有主節點負責清理
        if (this.isPrimary) {
            log.info("node-lifecycle", "Primary node: starting cleanup scheduler");
            this.cleanupTimer = setInterval(() => this.cleanupOfflineNodes(), CLEANUP_INTERVAL);
        }
    }

    /**
     * 停止生命週期管理
     */
    async stop() {
        log.info("node-lifecycle", `Stopping lifecycle manager for node: ${this.nodeId}`);
        
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }
        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer);
            this.cleanupTimer = null;
        }

        // 標記節點為離線
        if (this.nodeId) {
            try {
                await R.exec(
                    "UPDATE node SET status = ? WHERE node_id = ?",
                    ["offline", this.nodeId]
                );
                log.info("node-lifecycle", `Node ${this.nodeId} marked as offline`);
            } catch (err) {
                log.error("node-lifecycle", `Failed to mark node offline: ${err.message}`);
            }
        }

        this.started = false;
    }

    /**
     * 發送心跳更新
     */
    async sendHeartbeat() {
        if (!this.nodeId) return;

        try {
            const now = R.isoDateTime();
            await R.exec(
                "UPDATE node SET last_seen = ?, status = ? WHERE node_id = ?",
                [now, "online", this.nodeId]
            );
            log.debug("node-lifecycle", `Heartbeat sent for ${this.nodeId}`);
        } catch (err) {
            log.error("node-lifecycle", `Heartbeat failed: ${err.message}`);
        }
    }

    /**
     * 清理離線節點（僅主節點執行）
     */
    async cleanupOfflineNodes() {
        if (!this.isPrimary) return;

        try {
            const now = Date.now();
            const offlineThreshold = new Date(now - NODE_OFFLINE_THRESHOLD).toISOString();
            
            // 標記離線節點
            const offlineNodes = await R.getAll(
                "SELECT node_id FROM node WHERE last_seen < ? AND status = ?",
                [offlineThreshold, "online"]
            );

            for (const node of offlineNodes) {
                log.warn("node-lifecycle", `Node ${node.node_id} marked as offline (no heartbeat)`);
                await R.exec(
                    "UPDATE node SET status = ? WHERE node_id = ?",
                    ["offline", node.node_id]
                );

                // 重新分配該節點的 monitors
                await this.reassignMonitors(node.node_id);
            }

            // 清理長期離線的節點記錄
            const staleThreshold = new Date(now - STALE_NODE_THRESHOLD).toISOString();
            const result = await R.exec(
                "DELETE FROM node WHERE last_seen < ? AND status = ?",
                [staleThreshold, "offline"]
            );
            
            if (result && result.changes > 0) {
                log.info("node-lifecycle", `Cleaned up ${result.changes} stale node records`);
            }
        } catch (err) {
            log.error("node-lifecycle", `Cleanup failed: ${err.message}`);
        }
    }

    /**
     * 重新分配離線節點的 monitors
     * @param {string} offlineNodeId 
     */
    async reassignMonitors(offlineNodeId) {
        try {
            // 獲取所有在線節點
            const onlineNodes = await R.getAll(
                "SELECT node_id FROM node WHERE status = ? AND node_id != ?",
                ["online", offlineNodeId]
            );

            if (onlineNodes.length === 0) {
                log.warn("node-lifecycle", "No online nodes available for reassignment");
                return;
            }

            // 獲取需要重新分配的 monitors
            const monitors = await R.getAll(
                "SELECT id FROM monitor WHERE node_id = ?",
                [offlineNodeId]
            );

            if (monitors.length === 0) {
                return;
            }

            log.info("node-lifecycle", `Reassigning ${monitors.length} monitors from ${offlineNodeId}`);

            // 平均分配到在線節點
            for (let i = 0; i < monitors.length; i++) {
                const targetNode = onlineNodes[i % onlineNodes.length];
                await R.exec(
                    "UPDATE monitor SET node_id = ? WHERE id = ?",
                    [targetNode.node_id, monitors[i].id]
                );
                log.info("node-lifecycle", `Reassigned monitor ${monitors[i].id} to ${targetNode.node_id}`);
            }
        } catch (err) {
            log.error("node-lifecycle", `Monitor reassignment failed: ${err.message}`);
        }
    }

    /**
     * 獲取所有在線節點
     * @returns {Promise<Array>}
     */
    async getOnlineNodes() {
        const threshold = new Date(Date.now() - NODE_OFFLINE_THRESHOLD).toISOString();
        return await R.getAll(
            "SELECT * FROM node WHERE last_seen > ? OR status = ?",
            [threshold, "online"]
        );
    }

    /**
     * 獲取節點統計
     * @returns {Promise<Object>}
     */
    async getNodeStats() {
        const total = await R.getCell("SELECT COUNT(*) FROM node");
        const online = await R.getCell("SELECT COUNT(*) FROM node WHERE status = ?", ["online"]);
        const offline = await R.getCell("SELECT COUNT(*) FROM node WHERE status = ?", ["offline"]);
        
        return {
            total: parseInt(total) || 0,
            online: parseInt(online) || 0,
            offline: parseInt(offline) || 0
        };
    }
}

// 單例
module.exports = new NodeLifecycleManager();
