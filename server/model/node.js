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
        let node = await Node.getByNodeId(nodeId);
        
        if (node) {
            // Update existing node
            node.node_name = nodeName;
            node.ip = ip;
            node.modified_date = R.isoDateTime();
            // Handle primary node setting
            const currentlyPrimary = !!(node.is_primary || node.is_primary === 1);
            if (isPrimary && !currentlyPrimary) {
                await Node.setPrimaryNode(nodeId);
                return await Node.getByNodeId(nodeId); // Reload to get updated data
            } else if (!isPrimary) {
                node.is_primary = 0; // Use 0 for MariaDB TINYINT
            }
            await R.store(node);
            log.info("node", `Updated node: ${nodeId} (${nodeName})`);
        } else {
            // Create new node
            node = R.dispense("node");
            node.node_id = nodeId;
            node.node_name = nodeName;
            node.ip = ip;
            node.is_primary = isPrimary ? 1 : 0; // Use 1/0 for MariaDB TINYINT
            node.created_date = R.isoDateTime();
            node.modified_date = R.isoDateTime();
            
            // If this is set as primary, ensure no other nodes are primary
            if (isPrimary) {
                await Node.clearAllPrimaryFlags();
                node.is_primary = 1; // Use 1 for MariaDB TINYINT
            }
            
            await R.store(node);
            log.info("node", `Created node: ${nodeId} (${nodeName})`);
        }
        
        return node;
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
            // Try to get IP from environment or use localhost
            const nodeIp = process.env.UPTIME_KUMA_NODE_HOST || process.env.NODE_HOST || "127.0.0.1";
            // Use node ID as default name if no name is provided
            const nodeName = process.env.UPTIME_KUMA_NODE_NAME || process.env.NODE_NAME || currentNodeId;
            
            await Node.createOrUpdate(currentNodeId, nodeName, nodeIp, false);
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
            node.is_primary = 1; // Use 1 for MariaDB TINYINT
            node.modified_date = R.isoDateTime();
            await R.store(node);
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
     * @param {string} status Node status ('online', 'offline', 'unknown'\
     * @param {string} errorMessage Error message if any
     * @returns {Promise<void>}
     */
    static async updateHeartbeat(nodeId, status = "online", errorMessage = null) {
        try {
            log.debug("node", `Attempting to update heartbeat for node: ${nodeId} with status: ${status}`);
            
            // Check if R object is available
            if (typeof R === 'undefined') {
                throw new Error("Database connection (R) is not available");
            }
            
            const node = await Node.getByNodeId(nodeId);
            if (node) {
                node.status = status;
                node.last_heartbeat = R.isoDateTime();
                node.last_error_message = errorMessage;
                node.modified_date = R.isoDateTime();
                await R.store(node);
                log.debug("node", `Updated heartbeat for node: ${nodeId} - status: ${status}`);
            } else {
                log.warn("node", `Node not found for heartbeat update: ${nodeId}`);
            }
        } catch (error) {
            log.error("node", `Failed to update heartbeat for node ${nodeId}: ${error.message}`);
            log.error("node", `Error stack: ${error.stack}`);
            throw error; // Re-throw to let caller handle it
        }
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
     */
    static async markStaleNodesOffline(timeoutMinutes = 5) {
        const staleNodes = await Node.getStaleNodes(timeoutMinutes);
        const markedOffline = [];
        
        for (const node of staleNodes) {
            await Node.updateHeartbeat(node.node_id, "offline", "Node heartbeat timeout");
            markedOffline.push(node);
            log.warn("node", `Marked node as offline due to heartbeat timeout: ${node.node_id} (${node.node_name})`);
        }
        
        return markedOffline;
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