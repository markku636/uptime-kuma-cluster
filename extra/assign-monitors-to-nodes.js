// Script to distribute existing monitors across multiple nodes
// Usage: node extra/assign-monitors-to-nodes.js --nodes=node1,node2,node3

const Database = require("../server/database");
const { R } = require("redbean-node");
const { log } = require("../src/util");

const MONITOR_LIMIT_PER_NODE = 1000;

async function main() {
    const args = process.argv.slice(2);

    // Parse command line arguments
    let nodes = [];
    let dryRun = false;

    for (const arg of args) {
        if (arg.startsWith("--nodes=")) {
            nodes = arg.replace("--nodes=", "").split(",").map(n => n.trim()).filter(n => n);
        } else if (arg === "--dry-run") {
            dryRun = true;
        } else if (arg === "--help") {
            console.log("Usage: node extra/assign-monitors-to-nodes.js --nodes=node1,node2,node3 [--dry-run]");
            console.log("");
            console.log("Options:");
            console.log("  --nodes=node1,node2,node3  Comma-separated list of node IDs");
            console.log("  --dry-run                  Preview changes without applying them");
            console.log("  --help                     Show this help message");
            process.exit(0);
        }
    }

    if (nodes.length === 0) {
        console.error("Error: No nodes specified. Use --nodes=node1,node2,node3");
        console.error("Run with --help for usage information.");
        process.exit(1);
    }

    console.log(`🚀 Distributing monitors across ${nodes.length} nodes: ${nodes.join(", ")}`);
    if (dryRun) {
        console.log("⚠️  DRY RUN mode - no changes will be made");
    }

    try {
        // Connect to database
        log.info("db", "Connecting to database...");
        await Database.connect();

        // 1. Get current capacity for specified nodes
        console.log("📊 Checking current node capacity...");
        let nodeStats = {};
        for (const node of nodes) {
            const count = await R.count("monitor", " (assigned_node = ? OR (assigned_node IS NULL AND node_id = ?)) AND active = 1 ", [node, node]);
            nodeStats[node] = count;
            console.log(`   - ${node}: ${count} monitors`);
        }

        // 2. Get all monitors that don't have assigned_node set OR don't have a valid node_id
        // We focus on monitors that have NO assigned_node first.
        const monitors = await R.find("monitor", "assigned_node IS NULL");
        console.log(`📦 Found ${monitors.length} monitors without assigned node`);

        if (monitors.length === 0) {
            console.log("✅ All monitors are already assigned to nodes");
            await Database.close();
            return;
        }

        // 3. Distribute monitors (Capacity Aware & Weighted)
        const assignments = [];
        let skippedCount = 0;

        for (const monitor of monitors) {
            // Find the best node (lowest count < limit)
            let bestNode = null;
            let minCount = Infinity;

            for (const node of nodes) {
                const currentCount = nodeStats[node];

                if (currentCount < MONITOR_LIMIT_PER_NODE) {
                    if (currentCount < minCount) {
                        minCount = currentCount;
                        bestNode = node;
                    }
                }
            }

            if (!bestNode) {
                console.warn(`⚠️  Skipping monitor "${monitor.name}" (ID: ${monitor.id}): All nodes are at capacity!`);
                skippedCount++;
                continue;
            }

            assignments.push({
                monitor: monitor,
                node: bestNode
            });

            // Validate logic: if monitor has node_id set, we prefer it if capacity allows? 
            // Current requirement says assign based on load balancing. 
            // But if monitor already has a node_id, maybe we should respect it?
            // The user asked for "how to adjust load balancing", so we assume Re-balancing or Filling gaps.
            // This script handles "unassigned" primarily.

            console.log(`📍 Assign "${monitor.name}" -> ${bestNode} (Node Load: ${nodeStats[bestNode]} -> ${nodeStats[bestNode] + 1})`);

            // Update stats
            nodeStats[bestNode]++;
        }

        // 4. Apply changes
        if (assignments.length > 0) {
            if (!dryRun) {
                console.log("\n💾 Applying changes...");

                for (const assignment of assignments) {
                    await R.exec("UPDATE monitor SET assigned_node = ? WHERE id = ?", [
                        assignment.node,
                        assignment.monitor.id
                    ]);

                    // Also update node_id if it was null? 
                    // Usually assigned_node takes precedence in our new router, but updating node_id is good practice for compatibility.
                    // But let's stick to assigned_node as the dynamic allocation field.
                }

                console.log(`✅ Successfully assigned ${assignments.length} monitors.`);
            } else {
                console.log(`\n⚠️  DRY RUN: Would assign ${assignments.length} monitors.`);
            }
        }

        if (skippedCount > 0) {
            console.error(`❌ Skipped ${skippedCount} monitors due to capacity limits.`);
        }

        // Show final summary
        console.log("\n📈 Final Capacity Projection:");
        for (const [node, count] of Object.entries(nodeStats)) {
            const percent = ((count / MONITOR_LIMIT_PER_NODE) * 100).toFixed(1);
            console.log(`  ${node}: ${count}/${MONITOR_LIMIT_PER_NODE} (${percent}%)`);
        }

        await Database.close();

    } catch (error) {
        console.error("❌ Error:", error.message);
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}

module.exports = { main };