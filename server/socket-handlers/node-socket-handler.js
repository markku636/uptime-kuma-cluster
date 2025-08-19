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

            const { nodeId, nodeName, ip, isPrimary } = nodeData;

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
            const node = await Node.createOrUpdate(nodeId, nodeName, ip, isPrimary);

            log.info("node", `Added node: ${nodeId} (${nodeName})${isPrimary ? " as primary node" : ""} by user ${socket.userID}`);

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

            const { id, nodeId, nodeName, ip, isPrimary } = nodeData;

            // Validate required fields
            // Historically this endpoint expected a numeric `id`, but the
            // database uses `node_id` as the primary key. Use `nodeId` as the
            // source of truth and only require `nodeId` and `nodeName`.
            if (!nodeId || !nodeName) {
                throw new Error("Node ID and Node Name are required");
            }

            // Load existing node
            // Use model method to handle update consistently (and avoid duplicate inserts)
            await Node.createOrUpdate(nodeId, nodeName, ip, !!isPrimary);

            log.info("node", `Updated node: ${nodeId} (${nodeName})${isPrimary ? " as primary node" : ""} by user ${socket.userID}`);

            // Send updated list to all clients
            await sendNodeList(socket);

            callback({
                ok: true,
                msg: "Node updated successfully",
                node: (await Node.getByNodeId(nodeId)).toJSON(),
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

            // Check if any monitors are assigned to this node (either assigned_node or default node_id)
            const assignedMonitors = await R.find("monitor", "assigned_node = ? OR node_id = ?", [node.node_id, node.node_id]);
            if (assignedMonitors.length > 0) {
                throw new Error(`Cannot delete node. ${assignedMonitors.length} monitor(s) are assigned or default to this node.`);
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

            // NodeManager has been migrated to OpenResty/nginx
            // Manual rebalancing is now handled by nginx with Lua scripts
            // You can trigger rebalancing by calling: POST /api/trigger-rebalancing
            
            // Call nginx API for rebalancing
            const axios = require('axios');
            try {
                const response = await axios.post('http://localhost/api/trigger-rebalancing');
                if (response.status === 200) {
                    log.info("node", `Manual monitor rebalancing triggered by user ${socket.userID} via nginx`);
                    
                    callback({
                        ok: true,
                        msg: "Monitor rebalancing completed successfully via nginx",
                    });
                } else {
                    throw new Error("Nginx rebalancing API returned non-200 status");
                }
            } catch (apiError) {
                log.error("node", `Failed to call nginx rebalancing API: ${apiError.message}`);
                throw new Error("Failed to trigger monitor rebalancing via nginx");
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