const { checkLogin } = require("../util-server");
const { log } = require("../../src/util");
const { R } = require("redbean-node");
const Node = require("../model/node");
const { sendNodeList } = require("../client");

/**
 * Handlers for node management
 * @param {Socket} socket Socket.io instance
 * @returns {void}
 */
module.exports.nodeSocketHandler = (socket) => {
    // Get list of all nodes
    socket.on("getNodeList", async (callback) => {
        try {
            checkLogin(socket);
            
            const nodes = await Node.getAll();
            callback({
                ok: true,
                nodes: nodes.map(node => node.toJSON()),
            });
            
        } catch (e) {
            log.error("node", e.message);
            callback({
                ok: false,
                msg: e.message,
            });
        }
    });

    // Add a new node
    socket.on("addNode", async (nodeData, callback) => {
        try {
            checkLogin(socket);

            const { nodeId, nodeName, ip, isPrimary, version } = nodeData;

            // Validate required fields
            if (!nodeId || !nodeName) {
                throw new Error("Node ID and Node Name are required");
            }

            // Check if node ID already exists
            const existingNode = await Node.getByNodeId(nodeId);
            if (existingNode) {
                throw new Error("Node ID already exists");
            }

            // Create new node
            const node = await Node.createOrUpdate(nodeId, nodeName, ip, isPrimary, version);

            log.info("node", `Added node: ${nodeId} (${nodeName})${isPrimary ? " as primary node" : ""} version: ${version || 'N/A'} by user ${socket.userID}`);

            // Send updated list to all clients
            await sendNodeList(socket);

            callback({
                ok: true,
                msg: "Node added successfully",
                node: node.toJSON(),
            });

        } catch (e) {
            log.error("node", e.message);
            callback({
                ok: false,
                msg: e.message,
            });
        }
    });

    // Update an existing node
    socket.on("updateNode", async (nodeData, callback) => {
        try {
            checkLogin(socket);

            const { id, nodeId, nodeName, ip, isPrimary, version } = nodeData;

            // Validate required fields
            if (!id || !nodeId || !nodeName) {
                throw new Error("ID, Node ID and Node Name are required");
            }

            // Load existing node
            const node = await R.load("node", id);
            if (!node.id) {
                throw new Error("Node not found");
            }

            // Check if new node ID conflicts with another node
            if (node.node_id !== nodeId) {
                const existingNode = await Node.getByNodeId(nodeId);
                if (existingNode && existingNode.id !== id) {
                    throw new Error("Node ID already exists");
                }
            }

            // Update node basic info
            node.node_id = nodeId;
            node.node_name = nodeName;
            node.ip = ip;
            node.version = version;
            node.modified_date = R.isoDateTime();

            // Handle primary node setting
            // Convert is_primary to boolean for comparison (MariaDB stores as tinyint)
            const currentlyPrimary = !!(node.is_primary || node.is_primary === 1);
            
            if (isPrimary && !currentlyPrimary) {
                // Setting this node as primary, clear others first
                await Node.clearAllPrimaryFlags();
                node.is_primary = 1; // Use 1 for MariaDB TINYINT
            } else if (!isPrimary && currentlyPrimary) {
                // Removing primary status from this node
                node.is_primary = 0; // Use 0 for MariaDB TINYINT
            } else if (isPrimary && currentlyPrimary) {
                // Already primary, just ensure this is the only primary
                await Node.clearAllPrimaryFlags();
                node.is_primary = 1; // Use 1 for MariaDB TINYINT
            }

            await R.store(node);

            log.info("node", `Updated node: ${nodeId} (${nodeName})${isPrimary ? " as primary node" : ""} version: ${version || 'N/A'} by user ${socket.userID}`);

            // Send updated list to all clients
            await sendNodeList(socket);

            callback({
                ok: true,
                msg: "Node updated successfully",
                node: node.toJSON(),
            });

        } catch (e) {
            log.error("node", e.message);
            callback({
                ok: false,
                msg: e.message,
            });
        }
    });

    // Delete a node
    socket.on("deleteNode", async (nodeId, callback) => {
        try {
            checkLogin(socket);

            const node = await R.load("node", nodeId);
            if (!node.id) {
                throw new Error("Node not found");
            }

            // Check if any monitors are assigned to this node
            const assignedMonitors = await R.find("monitor", "assigned_node = ?", [node.node_id]);
            if (assignedMonitors.length > 0) {
                throw new Error(`Cannot delete node. ${assignedMonitors.length} monitor(s) are assigned to this node.`);
            }

            await Node.deleteById(nodeId);

            log.info("node", `Deleted node: ${node.node_id} (${node.node_name}) by user ${socket.userID}`);

            // Send updated list to all clients
            await sendNodeList(socket);

            callback({
                ok: true,
                msg: "Node deleted successfully",
            });

        } catch (e) {
            log.error("node", e.message);
            callback({
                ok: false,
                msg: e.message,
            });
        }
    });

    // Manually trigger monitor rebalancing
    socket.on("rebalanceMonitors", async (callback) => {
        try {
            checkLogin(socket);

            const { getNodeManager } = require("../node-manager");
            const nodeManager = getNodeManager();
            const success = await nodeManager.triggerManualRebalancing();

            if (success) {
                log.info("node", `Manual monitor rebalancing triggered by user ${socket.userID}`);
                
                callback({
                    ok: true,
                    msg: "Monitor rebalancing completed successfully",
                });
            } else {
                throw new Error("Failed to trigger monitor rebalancing");
            }

        } catch (e) {
            log.error("node", e.message);
            callback({
                ok: false,
                msg: e.message,
            });
        }
    });
}; 