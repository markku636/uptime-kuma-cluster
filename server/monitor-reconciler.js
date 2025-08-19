const { R } = require("redbean-node");
const { sleep, getRandomInt, log } = require("../src/util");
const { UptimeKumaServer } = require("./uptime-kuma-server");

/**
 * Reconcile running monitors with DB assignments for the current node.
 * - Starts monitors newly assigned to this node
 * - Stops monitors that are no longer assigned to this node
 */
async function reconcileMonitors() {
    const server = UptimeKumaServer.getInstance();
    const io = server.io;
    const currentNodeId = process.env.UPTIME_KUMA_NODE_ID || process.env.NODE_ID || null;

    try {
        let whereClause = " active = 1 ";
        let params = [];

        if (currentNodeId) {
            whereClause += " AND (assigned_node = ? OR (assigned_node IS NULL AND node_id = ?) OR (assigned_node IS NULL AND node_id IS NULL)) ";
            params.push(currentNodeId, currentNodeId);
        }

        const desiredList = await R.find("monitor", whereClause, params);

        const desiredIds = new Set(desiredList.map((m) => m.id));
        const runningIds = new Set(Object.keys(server.monitorList).map((k) => parseInt(k)));

        // Start newly assigned monitors
        for (const monitor of desiredList) {
            if (!runningIds.has(monitor.id)) {
                try {
                    log.info("server", `Reconciling: starting monitor ${monitor.name} (ID: ${monitor.id})`);
                    server.monitorList[monitor.id] = monitor;
                    await monitor.start(io);
                    await sleep(getRandomInt(100, 300));
                } catch (e) {
                    log.error("monitor", e);
                }
            }
        }

        // Stop monitors that no longer belong to this node
        for (const idStr of Object.keys(server.monitorList)) {
            const id = parseInt(idStr);
            if (!desiredIds.has(id)) {
                try {
                    const monitor = server.monitorList[id];
                    log.info("server", `Reconciling: stopping monitor ${monitor.name} (ID: ${id})`);
                    await monitor.stop();
                    delete server.monitorList[id];
                    await sleep(getRandomInt(50, 150));
                } catch (e) {
                    log.error("monitor", e);
                }
            }
        }
    } catch (e) {
        log.error("server", `Reconcile monitors failed: ${e.message}`);
    }
}

module.exports = { reconcileMonitors };



