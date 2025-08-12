const { R } = require("redbean-node");
const { log } = require("../src/util");
const Node = require("./model/node");

class NodeManager {
    constructor() {
        this.heartbeatInterval = null;
        this.checkInterval = null;
        this.isRunning = false;
    }

    /**
     * Start the node manager
     * @param {number} heartbeatIntervalMs Heartbeat interval in milliseconds (default: 30s)
     * @param {number} checkIntervalMs Check interval in milliseconds (default: 60s)
     */
    start(heartbeatIntervalMs = 30000, checkIntervalMs = 60000) {
        if (this.isRunning) {
            log.warn("node-manager", "NodeManager is already running");
            return;
        }

        this.isRunning = true;
        log.info("node-manager", "Starting NodeManager");

        // Send heartbeat for current node
        this.heartbeatInterval = setInterval(async () => {
            await this.sendHeartbeat();
        }, heartbeatIntervalMs);

        // Check node status and handle failovers
        this.checkInterval = setInterval(async () => {
            await this.checkNodesAndHandleFailover();
        }, checkIntervalMs);

        // Send initial heartbeat
        this.sendHeartbeat();
    }

    /**
     * Stop the node manager
     */
    stop() {
        if (!this.isRunning) {
            return;
        }

        this.isRunning = false;
        log.info("node-manager", "Stopping NodeManager");

        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }

        if (this.checkInterval) {
            clearInterval(this.checkInterval);
            this.checkInterval = null;
        }
    }

    /**
     * Send heartbeat for current node
     */
    async sendHeartbeat() {
        try {
            const currentNodeId = process.env.UPTIME_KUMA_NODE_ID || process.env.NODE_ID;
            if (currentNodeId) {
                await Node.updateHeartbeat(currentNodeId, "online");
                log.debug("node-manager", `Sent heartbeat for node: ${currentNodeId}`);
            }
        } catch (error) {
            log.error("node-manager", `Failed to send heartbeat: ${error.message}`);
        }
    }

    /**
     * Check node status and handle failovers
     */
    async checkNodesAndHandleFailover() {
        try {
            // Mark stale nodes as offline
            const offlineNodes = await Node.markStaleNodesOffline(5); // 5 minutes timeout
            
            // Handle failover for each offline node
            for (const offlineNode of offlineNodes) {
                await this.handleNodeFailover(offlineNode.node_id);
            }

            // Check for nodes that came back online and trigger rebalancing
            await this.checkForNodeRecovery();

        } catch (error) {
            log.error("node-manager", `Error in checkNodesAndHandleFailover: ${error.message}`);
        }
    }

    /**
     * Handle failover when a node goes offline
     * @param {string} failedNodeId ID of the failed node
     */
    async handleNodeFailover(failedNodeId) {
        try {
            log.info("node-manager", `Handling failover for node: ${failedNodeId}`);

            // Get all monitors assigned to the failed node (assigned_node) or whose default node_id equals failed node
            const affectedMonitors = await R.find("monitor", "assigned_node = ? OR (assigned_node IS NULL AND node_id = ?)", [failedNodeId, failedNodeId]);
            
            if (affectedMonitors.length === 0) {
                log.info("node-manager", `No monitors to transfer from failed node: ${failedNodeId}`);
                return;
            }

            // Get all online nodes (excluding the failed one)
            const onlineNodes = await Node.getOnlineNodes();
            const availableNodes = onlineNodes.filter(node => node.node_id !== failedNodeId);

            if (availableNodes.length === 0) {
                log.error("node-manager", `No online nodes available for failover! Monitors from ${failedNodeId} will remain unassigned.`);
                // Unassign monitors so they can be picked up by any node that comes online
                for (const monitor of affectedMonitors) {
                    await R.exec("UPDATE monitor SET assigned_node = NULL WHERE id = ?", [monitor.id]);
                }
                return;
            }

            log.info("node-manager", `Transferring ${affectedMonitors.length} monitors from ${failedNodeId} to ${availableNodes.length} available nodes`);

            // Distribute monitors among available nodes in round-robin fashion
            let nodeIndex = 0;
            for (const monitor of affectedMonitors) {
                const targetNode = availableNodes[nodeIndex];
                await R.exec("UPDATE monitor SET assigned_node = ? WHERE id = ?", [targetNode.node_id, monitor.id]);
                
                log.info("node-manager", `Transferred monitor "${monitor.name}" (ID: ${monitor.id}) from ${failedNodeId} to ${targetNode.node_id}`);
                
                nodeIndex = (nodeIndex + 1) % availableNodes.length;
            }

            log.info("node-manager", `Successfully completed failover for node: ${failedNodeId}`);

        } catch (error) {
            log.error("node-manager", `Error handling failover for node ${failedNodeId}: ${error.message}`);
        }
    }

    /**
     * Check for nodes that have recovered and trigger rebalancing
     */
    async checkForNodeRecovery() {
        try {
            const allNodes = await Node.getAll();
            const onlineNodes = allNodes.filter(node => node.status === "online");
            
            if (onlineNodes.length <= 1) {
                // No need to rebalance with only one or no nodes
                return;
            }

            // Check if we should trigger rebalancing
            // This could be based on monitor distribution imbalance or other criteria
            const shouldRebalance = await this.shouldTriggerRebalancing(onlineNodes);
            
            if (shouldRebalance) {
                log.info("node-manager", "Triggering monitor rebalancing due to node changes");
                await this.rebalanceMonitors(onlineNodes);
            }

        } catch (error) {
            log.error("node-manager", `Error checking for node recovery: ${error.message}`);
        }
    }

    /**
     * Check if rebalancing should be triggered
     * @param {Node[]} onlineNodes Array of online nodes
     * @returns {Promise<boolean>} Whether rebalancing should be triggered
     */
    async shouldTriggerRebalancing(onlineNodes) {
        try {
            // Get monitor counts per node based on effective node
            const monitorCounts = {};
            for (const node of onlineNodes) {
                const count = await R.getCell("SELECT COUNT(*) FROM monitor WHERE assigned_node = ? OR (assigned_node IS NULL AND node_id = ?)", [node.node_id, node.node_id]);
                monitorCounts[node.node_id] = parseInt(count) || 0;
            }

            // Also count unassigned monitors
            const unassignedCount = await R.getCell("SELECT COUNT(*) FROM monitor WHERE assigned_node IS NULL AND (node_id IS NULL OR node_id = '')");
            
            // Trigger rebalancing if there are unassigned monitors
            if (unassignedCount > 0) {
                log.info("node-manager", `Found ${unassignedCount} unassigned monitors, triggering rebalancing`);
                return true;
            }

            // Check for significant imbalance
            const counts = Object.values(monitorCounts);
            const maxCount = Math.max(...counts);
            const minCount = Math.min(...counts);
            const avgCount = counts.reduce((a, b) => a + b, 0) / counts.length;
            
            // Trigger rebalancing if difference between max and min is > 50% of average
            const imbalanceThreshold = avgCount * 0.5;
            if (maxCount - minCount > imbalanceThreshold && avgCount > 2) {
                log.info("node-manager", `Monitor distribution imbalance detected (max: ${maxCount}, min: ${minCount}, avg: ${avgCount.toFixed(1)}), triggering rebalancing`);
                return true;
            }

            return false;

        } catch (error) {
            log.error("node-manager", `Error checking rebalancing criteria: ${error.message}`);
            return false;
        }
    }

    /**
     * Rebalance monitors across online nodes
     * @param {Node[]} onlineNodes Array of online nodes
     */
    async rebalanceMonitors(onlineNodes) {
        try {
            if (onlineNodes.length === 0) {
                log.warn("node-manager", "No online nodes available for rebalancing");
                return;
            }

            log.info("node-manager", `Starting monitor rebalancing across ${onlineNodes.length} nodes`);

            // Get all monitors (including unassigned ones)
            const allMonitors = await R.find("monitor", "ORDER BY id");
            
            if (allMonitors.length === 0) {
                log.info("node-manager", "No monitors to rebalance");
                return;
            }

            // Distribute monitors evenly in round-robin fashion
            let nodeIndex = 0;
            const reassignments = [];
            
            for (const monitor of allMonitors) {
                const targetNode = onlineNodes[nodeIndex];
                const effectiveNode = monitor.assigned_node || monitor.node_id || null;

                // Only update if assignment is different from effective node
                if (effectiveNode !== targetNode.node_id) {
                    reassignments.push({
                        monitorId: monitor.id,
                        monitorName: monitor.name,
                        oldNode: effectiveNode || "unassigned",
                        newNode: targetNode.node_id
                    });
                }
                
                nodeIndex = (nodeIndex + 1) % onlineNodes.length;
            }

            // Apply reassignments
            if (reassignments.length > 0) {
                log.info("node-manager", `Reassigning ${reassignments.length} monitors for rebalancing`);
                
                for (const reassignment of reassignments) {
                    await R.exec("UPDATE monitor SET assigned_node = ? WHERE id = ?", 
                        [reassignment.newNode, reassignment.monitorId]);
                    
                    log.debug("node-manager", 
                        `Reassigned monitor "${reassignment.monitorName}" (ID: ${reassignment.monitorId}) from ${reassignment.oldNode} to ${reassignment.newNode}`);
                }

                // Log summary
                const summary = {};
                for (const reassignment of reassignments) {
                    if (!summary[reassignment.newNode]) {
                        summary[reassignment.newNode] = 0;
                    }
                    summary[reassignment.newNode]++;
                }

                log.info("node-manager", "Rebalancing summary:");
                for (const [nodeId, count] of Object.entries(summary)) {
                    const node = onlineNodes.find(n => n.node_id === nodeId);
                    log.info("node-manager", `  ${nodeId} (${node?.node_name}): ${count} monitors reassigned`);
                }
                
                log.info("node-manager", "Monitor rebalancing completed successfully");
            } else {
                log.info("node-manager", "No monitor reassignments needed - distribution is already optimal");
            }

        } catch (error) {
            log.error("node-manager", `Error rebalancing monitors: ${error.message}`);
        }
    }

    /**
     * Manually trigger monitor rebalancing
     * @returns {Promise<boolean>} Success status
     */
    async triggerManualRebalancing() {
        try {
            log.info("node-manager", "Manual rebalancing triggered");
            const onlineNodes = await Node.getOnlineNodes();
            await this.rebalanceMonitors(onlineNodes);
            return true;
        } catch (error) {
            log.error("node-manager", `Manual rebalancing failed: ${error.message}`);
            return false;
        }
    }
}

// Singleton instance
let nodeManager = null;

/**
 * Get or create the NodeManager instance
 * @returns {NodeManager} NodeManager instance
 */
function getNodeManager() {
    if (!nodeManager) {
        nodeManager = new NodeManager();
    }
    return nodeManager;
}

module.exports = {
    NodeManager,
    getNodeManager
}; 