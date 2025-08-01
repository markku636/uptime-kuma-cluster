/* SQL:
ALTER TABLE node ADD version VARCHAR(50);
*/
exports.up = async function (knex) {
    const hasVersionColumn = await knex.schema.hasColumn("node", "version");
    
    if (!hasVersionColumn) {
        return knex.schema.alterTable("node", function (table) {
            table.string("version", 50).nullable();
        });
    }
    // Column already exists, do nothing
    return Promise.resolve();
};

exports.down = async function (knex) {
    const hasVersionColumn = await knex.schema.hasColumn("node", "version");
    
    if (hasVersionColumn) {
        return knex.schema.alterTable("node", function (table) {
            table.dropColumn("version");
        });
    }
    // Column doesn't exist, do nothing
    return Promise.resolve();
}; 