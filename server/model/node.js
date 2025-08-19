const { BeanModel } = require("redbean-node/dist/bean-model");
const { R } = require("redbean-node");
const { log } = require("../../src/util");

class Node extends BeanModel {
    /**
     * Get all nodes
     * @returns {Promise<Node[]>} Array of nodes
     */
    static async getAll() {
        return await R.findAll("node", "ORDER BY node_name");
    }

    /**
     * Get node by node_id
     * @param {string} nodeId Node ID to find
     * @returns {Promise<Node|null>} Node or null if not found
     */
    static async getByNodeId(nodeId) {
        return await R.findOne("node", "node_id = ?", [nodeId]);
    }

    /**
     * Create or update node if it exists
     * @param {string} nodeId Node ID
     * @param {string} nodeName Node name
     * @param {string} ip IP address
     * @param {boolean} isPrimary Whether this is the primary node
     * @returns {Promise<Node>} Created or updated node
     */
    static async createOrUpdate(nodeId, nodeName, ip = null, isPrimary = false) {
        try {
            // 先檢查節點是否已存在
            let node = await Node.getByNodeId(nodeId);
            
            if (node) {
                // Update existing node (avoid R.store when primary key is node_id)
                log.debug("node", `Updating existing node: ${nodeId} (${nodeName})`);
                const now = R.isoDateTime();
                await R.exec(
                    "UPDATE node SET node_name = ?, ip = ?, modified_date = ?, status = ?, last_seen = ? WHERE node_id = ?",
                    [ nodeName, ip, now, "online", now, nodeId ]
                );

                // Handle primary node setting
                const currentlyPrimary = !!(node.is_primary || node.is_primary === 1);
                if (isPrimary && !currentlyPrimary) {
                    await Node.setPrimaryNode(nodeId);
                } else if (!isPrimary && currentlyPrimary) {
                    await R.exec("UPDATE node SET is_primary = 0, modified_date = ? WHERE node_id = ?", [ now, nodeId ]);
                }
                log.info("node", `Updated node: ${nodeId} (${nodeName})`);
            } else {
                // Create new node
                log.debug("node", `Creating new node: ${nodeId} (${nodeName})`);
                node = R.dispense("node");
                node.node_id = nodeId;
                node.node_name = nodeName;
                node.ip = ip;
                node.is_primary = isPrimary ? 1 : 0; // Use 1/0 for MariaDB TINYINT
                node.status = "online"; // 新節點預設為在線
                node.created_date = R.isoDateTime();
                node.modified_date = R.isoDateTime();
                node.last_seen = R.isoDateTime();
                
                // If this is set as primary, ensure no other nodes are primary
                if (isPrimary) {
                    await Node.clearAllPrimaryFlags();
                    node.is_primary = 1; // Use 1 for MariaDB TINYINT
                }
                
                await R.store(node);
                log.info("node", `Created node: ${nodeId} (${nodeName})`);
            }
            
            return node;
        } catch (error) {
            log.error("node", `Error in createOrUpdate for node ${nodeId}: ${error.message}`);
            
            // 如果是主鍵重複錯誤，嘗試獲取現有節點
            if (error.code === 'ER_DUP_ENTRY' || error.message.includes('Duplicate entry')) {
                log.warn("node", `Duplicate entry detected for node ${nodeId}, attempting to retrieve existing node`);
                try {
                    const existingNode = await Node.getByNodeId(nodeId);
                    if (existingNode) {
                        log.info("node", `Successfully retrieved existing node: ${nodeId}`);
                        return existingNode;
                    }
                } catch (retrieveError) {
                    log.error("node", `Failed to retrieve existing node ${nodeId}: ${retrieveError.message}`);
                }
            }
            
            throw error; // 重新拋出錯誤
        }
    }

    /**
     * Delete node by ID
     * @param {number} id Node database ID
     * @returns {Promise<void>}
     */
    static async deleteById(id) {
        const node = await R.load("node", id);
        if (node.id) {
            await R.trash(node);
            log.info("node", `Deleted node: ${node.node_id} (${node.node_name})`);
        }
    }

    /**
     * Get current node from environment or default
     * @returns {Promise<Node|null>} Current node or null
     */
    static async getCurrentNode() {
        const currentNodeId = process.env.UPTIME_KUMA_NODE_ID || process.env.NODE_ID || null;
        if (currentNodeId) {
            return await Node.getByNodeId(currentNodeId);
        }
        return null;
    }

    /**
     * Initialize node from environment variable if set
     * @returns {Promise<void>}
     */
    static async initializeFromEnv() {
        const currentNodeId = process.env.UPTIME_KUMA_NODE_ID || process.env.NODE_ID || null;
        if (currentNodeId) {
            try {
                // 先檢查節點是否已存在
                const existingNode = await Node.getByNodeId(currentNodeId);
                if (existingNode) {
                    log.info("node", `Node ${currentNodeId} already exists, skipping creation. Current status: ${existingNode.status || 'unknown'}`);
                    
                    // 更新現有節點的基本信息（IP、名稱等）
                    const nodeIp = process.env.UPTIME_KUMA_NODE_HOST || process.env.NODE_HOST || "127.0.0.1";
                    const nodeName = process.env.UPTIME_KUMA_NODE_NAME || process.env.NODE_NAME || currentNodeId;
                    
                    // 只更新必要的信息，不改變主節點狀態（避免 R.store 可能觸發 INSERT）
                    const now = R.isoDateTime();
                    await R.exec(
                        "UPDATE node SET node_name = ?, ip = ?, modified_date = ?, status = ?, last_seen = ? WHERE node_id = ?",
                        [ nodeName, nodeIp, now, "online", now, currentNodeId ]
                    );
                    log.info("node", `Updated existing node from env: ${currentNodeId} (${nodeName}) - IP: ${nodeIp}`);
                    return;
                }
                
                // 節點不存在，創建新節點
                const nodeIp = process.env.UPTIME_KUMA_NODE_HOST || process.env.NODE_HOST || "127.0.0.1";
                const nodeName = process.env.UPTIME_KUMA_NODE_NAME || process.env.NODE_NAME || currentNodeId;
                const isPrimary = (process.env.UPTIME_KUMA_PRIMARY === "1" || process.env.UPTIME_KUMA_PRIMARY === "true");
                
                log.info("node", `Creating new node: ${currentNodeId} (${nodeName}) - IP: ${nodeIp}${isPrimary ? " [primary]" : ""}`);
                await Node.createOrUpdate(currentNodeId, nodeName, nodeIp, isPrimary);
                
            } catch (error) {
                log.error("node", `Failed to initialize node ${currentNodeId}: ${error.message}`);
                // 不要讓節點初始化失敗阻止整個應用啟動
                // 可以考慮重試或使用預設值
            }
        } else {
            // No environment variables set, ensure we have at least one default node
            const existingNodes = await Node.getAll();
            if (existingNodes.length === 0) {
                // Create a default local node
                const defaultNodeId = "local-node";
                const defaultNodeName = "Local Node";
                const defaultNodeIp = "127.0.0.1";
                
                log.info("node", "No nodes found and no environment variables set. Creating default local node.");
                await Node.createOrUpdate(defaultNodeId, defaultNodeName, defaultNodeIp, true); // Make it primary
            }
        }
    }

    /**
     * Set a node as primary (and clear others)
     * @param {string} nodeId Node ID to set as primary
     * @returns {Promise<void>}
     */
    static async setPrimaryNode(nodeId) {
        // Clear all primary flags first
        await Node.clearAllPrimaryFlags();
        
        // Set the specified node as primary
        const node = await Node.getByNodeId(nodeId);
        if (node) {
            await R.exec("UPDATE node SET is_primary = 1, modified_date = ? WHERE node_id = ?", [ R.isoDateTime(), nodeId ]);
            log.info("node", `Set node as primary: ${nodeId} (${node.node_name})`);
        }
    }

    /**
     * Clear primary flag from all nodes
     * @returns {Promise<void>}
     */
    static async clearAllPrimaryFlags() {
        await R.exec("UPDATE node SET is_primary = 0, modified_date = ? WHERE is_primary = 1 OR is_primary = true", [R.isoDateTime()]);
        log.info("node", "Cleared all primary node flags");
    }

    /**
     * Get the primary node
     * @returns {Promise<Node|null>} Primary node or null if not found
     */
    static async getPrimaryNode() {
        return await R.findOne("node", "is_primary = 1");
    }

    /**
     * Update node heartbeat
     * @param {string} nodeId Node ID
     * @param {string} status Node status ('online', 'offline', 'unknown')
     * @param {string} errorMessage Error message if any
     * @returns {Promise<void>}
     * @deprecated This method is deprecated. Heartbeat updates are now handled by OpenResty/nginx
     */
    static async updateHeartbeat(nodeId, status = "online", errorMessage = null) {
        log.warn("node", `updateHeartbeat is deprecated. Heartbeat updates are now handled by OpenResty/nginx for node: ${nodeId}`);
        // This method is kept for backward compatibility but does nothing
        // Actual heartbeat updates are now handled by the nginx health check Lua scripts
    }

    /**
     * Get all online nodes
     * @returns {Promise<Node[]>} Array of online nodes
     */
    static async getOnlineNodes() {
        return await R.find("node", "status = ? ORDER BY node_name", ["online"]);
    }

    /**
     * Get all offline nodes
     * @returns {Promise<Node[]>} Array of offline nodes
     */
    static async getOfflineNodes() {
        return await R.find("node", "status = ? ORDER BY node_name", ["offline"]);
    }

    /**
     * Check if node is considered offline based on last heartbeat
     * @param {number} timeoutMinutes Timeout in minutes (default: 5)
     * @returns {Promise<Node[]>} Array of nodes that should be marked as offline
     */
    static async getStaleNodes(timeoutMinutes = 5) {
        const cutoffTime = new Date(Date.now() - timeoutMinutes * 60 * 1000);
        const cutoffTimeStr = R.isoDateTime(cutoffTime);
        
        return await R.find("node", 
            "(last_heartbeat IS NULL OR last_heartbeat < ?) AND status != ?", 
            [cutoffTimeStr, "offline"]
        );
    }

    /**
     * Mark nodes as offline if they haven't sent heartbeat recently
     * @param {number} timeoutMinutes Timeout in minutes (default: 5)
     * @returns {Promise<Node[]>} Array of nodes that were marked offline
     * @deprecated This method is deprecated. Node status management is now handled by OpenResty/nginx
     */
    static async markStaleNodesOffline(timeoutMinutes = 5) {
        log.warn("node", `markStaleNodesOffline is deprecated. Node status management is now handled by OpenResty/nginx`);
        // This method is kept for backward compatibility but does nothing
        // Actual node status management is now handled by the nginx health check Lua scripts
        return [];
    }

    /**
     * Convert to JSON
     * @returns {object} JSON representation
     */
    toJSON() {
        return {
            id: this.id,
            nodeId: this.node_id,
            nodeName: this.node_name,
            ip: this.ip,
            isPrimary: !!(this.is_primary || this.is_primary === 1), // Handle both boolean and tinyint from MariaDB
            status: this.status || "unknown",
            lastHeartbeat: this.last_heartbeat,
            lastErrorMessage: this.last_error_message,
            createdDate: this.created_date,
            modifiedDate: this.modified_date,
        };
    }
}

module.exports = Node; 