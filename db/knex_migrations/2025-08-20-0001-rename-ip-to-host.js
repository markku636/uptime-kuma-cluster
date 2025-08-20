/**
 * Migration to rename 'ip' column to 'host' in node table
 * This migration handles the field name change from 'ip' to 'host'
 */
exports.up = async function (knex) {
    const hasTable = await knex.schema.hasTable("node");
    if (hasTable) {
        // Check if ip column exists and host column doesn't exist
        const hasIpColumn = await knex.schema.hasColumn("node", "ip");
        const hasHostColumn = await knex.schema.hasColumn("node", "host");
        
        if (hasIpColumn && !hasHostColumn) {
            // Rename ip column to host
            await knex.schema.alterTable("node", (table) => {
                table.renameColumn("ip", "host");
            });
            console.log("Renamed 'ip' column to 'host' in node table");
        } else if (!hasIpColumn && !hasHostColumn) {
            // Add host column if neither exists
            await knex.schema.alterTable("node", (table) => {
                table.string("host", 45);
            });
            console.log("Added 'host' column to node table");
        } else if (hasHostColumn) {
            console.log("'host' column already exists in node table");
        }
    }
    return Promise.resolve();
};

exports.down = async function (knex) {
    const hasTable = await knex.schema.hasTable("node");
    if (hasTable) {
        const hasHostColumn = await knex.schema.hasColumn("node", "host");
        const hasIpColumn = await knex.schema.hasColumn("node", "ip");
        
        if (hasHostColumn && !hasIpColumn) {
            // Rename host column back to ip
            await knex.schema.alterTable("node", (table) => {
                table.renameColumn("host", "ip");
            });
            console.log("Renamed 'host' column back to 'ip' in node table");
        }
    }
    return Promise.resolve();
};
