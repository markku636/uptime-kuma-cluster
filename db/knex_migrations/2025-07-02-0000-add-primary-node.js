/* SQL:
ALTER TABLE node ADD is_primary BOOLEAN DEFAULT FALSE;
*/
exports.up = async function (knex) {
    const hasColumn = await knex.schema.hasColumn("node", "is_primary");
    if (!hasColumn) {
        return knex.schema.alterTable("node", function (table) {
            table.boolean("is_primary").defaultTo(false);
        });
    }
    // Column already exists, do nothing
    return Promise.resolve();
};

exports.down = async function (knex) {
    const hasColumn = await knex.schema.hasColumn("node", "is_primary");
    if (hasColumn) {
        return knex.schema.alterTable("node", function (table) {
            table.dropColumn("is_primary");
        });
    }
    // Column doesn't exist, do nothing
    return Promise.resolve();
}; 