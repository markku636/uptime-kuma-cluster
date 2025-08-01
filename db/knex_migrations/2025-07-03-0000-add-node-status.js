/* SQL:
ALTER TABLE node ADD status VARCHAR(20) DEFAULT 'unknown';
ALTER TABLE node ADD last_heartbeat DATETIME;
ALTER TABLE node ADD last_error_message TEXT;
*/
exports.up = async function (knex) {
    const hasStatusColumn = await knex.schema.hasColumn("node", "status");
    const hasHeartbeatColumn = await knex.schema.hasColumn("node", "last_heartbeat");
    const hasErrorMessageColumn = await knex.schema.hasColumn("node", "last_error_message");
    
    return knex.schema.alterTable("node", function (table) {
        if (!hasStatusColumn) {
            table.string("status", 20).defaultTo("unknown");
        }
        if (!hasHeartbeatColumn) {
            table.dateTime("last_heartbeat").nullable();
        }
        if (!hasErrorMessageColumn) {
            table.text("last_error_message").nullable();
        }
    });
};

exports.down = async function (knex) {
    const hasStatusColumn = await knex.schema.hasColumn("node", "status");
    const hasHeartbeatColumn = await knex.schema.hasColumn("node", "last_heartbeat");
    const hasErrorMessageColumn = await knex.schema.hasColumn("node", "last_error_message");
    
    return knex.schema.alterTable("node", function (table) {
        if (hasStatusColumn) {
            table.dropColumn("status");
        }
        if (hasHeartbeatColumn) {
            table.dropColumn("last_heartbeat");
        }
        if (hasErrorMessageColumn) {
            table.dropColumn("last_error_message");
        }
    });
}; 