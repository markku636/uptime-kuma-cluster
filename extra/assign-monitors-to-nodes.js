// Script to distribute existing monitors across multiple nodes
// Usage: node extra/assign-monitors-to-nodes.js --nodes=node1,node2,node3

const Database = require("../server/database");
const { R } = require("redbean-node");
const { log } = require("../src/util");

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
        
        // Get all monitors that don't have assigned_node set
        const monitors = await R.find("monitor", "assigned_node IS NULL");
        console.log(`📊 Found ${monitors.length} monitors without assigned node`);
        
        if (monitors.length === 0) {
            console.log("✅ All monitors are already assigned to nodes");
            await Database.close();
            return;
        }
        
        // Distribute monitors in round-robin fashion
        const assignments = [];
        let nodeIndex = 0;
        
        for (const monitor of monitors) {
            const assignedNode = nodes[nodeIndex];
            assignments.push({
                monitor: monitor,
                node: assignedNode
            });
            
            console.log(`📍 Monitor "${monitor.name}" (ID: ${monitor.id}) -> Node: ${assignedNode}`);
            
            nodeIndex = (nodeIndex + 1) % nodes.length;
        }
        
        // Apply changes
        if (!dryRun) {
            console.log("\n💾 Applying changes...");
            
            for (const assignment of assignments) {
                await R.exec("UPDATE monitor SET assigned_node = ? WHERE id = ?", [
                    assignment.node,
                    assignment.monitor.id
                ]);
            }
            
            console.log("✅ Successfully assigned monitors to nodes");
            
            // Show summary
            const summary = {};
            for (const assignment of assignments) {
                if (!summary[assignment.node]) {
                    summary[assignment.node] = 0;
                }
                summary[assignment.node]++;
            }
            
            console.log("\n📈 Assignment Summary:");
            for (const [node, count] of Object.entries(summary)) {
                console.log(`  ${node}: ${count} monitors`);
            }
        } else {
            console.log("\n⚠️  DRY RUN: No changes were made. Remove --dry-run to apply changes.");
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