/* SQL:
ALTER TABLE monitor ADD assigned_node VARCHAR(255);
*/
exports.up = async function (knex) {
    const hasColumn = await knex.schema.hasColumn("monitor", "assigned_node");
    if (!hasColumn) {
        return knex.schema.alterTable("monitor", function (table) {
            table.string("assigned_node", 255).nullable();
        });
    }
    // Column already exists, do nothing
    return Promise.resolve();
};

exports.down = async function (knex) {
    const hasColumn = await knex.schema.hasColumn("monitor", "assigned_node");
    if (hasColumn) {
        return knex.schema.alterTable("monitor", function (table) {
            table.dropColumn("assigned_node");
        });
    }
    // Column doesn't exist, do nothing
    return Promise.resolve();
}; 