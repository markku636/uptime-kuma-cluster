/* SQL:
CREATE TABLE node (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    node_id VARCHAR(255) NOT NULL UNIQUE,
    node_name VARCHAR(255) NOT NULL,
    ip VARCHAR(255),
    is_primary BOOLEAN DEFAULT FALSE,
    status VARCHAR(20) DEFAULT 'unknown',
    last_heartbeat DATETIME,
    last_error_message TEXT,
    created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    modified_date DATETIME DEFAULT CURRENT_TIMESTAMP
);
*/
exports.up = async function (knex) {
    const hasTable = await knex.schema.hasTable("node");
    if (!hasTable) {
        return knex.schema.createTable("node", function (table) {
            table.increments("id").primary();
            table.string("node_id", 255).notNullable().unique();
            table.string("node_name", 255).notNullable();
            table.string("ip", 255).nullable();
            table.boolean("is_primary").defaultTo(false);
            table.string("status", 20).defaultTo("unknown");
            table.dateTime("last_heartbeat").nullable();
            table.text("last_error_message").nullable();

            table.dateTime("created_date").defaultTo(knex.fn.now());
            table.dateTime("modified_date").defaultTo(knex.fn.now());
        });
    }
    // Table already exists, do nothing
    return Promise.resolve();
};

exports.down = async function (knex) {
    const hasTable = await knex.schema.hasTable("node");
    if (hasTable) {
        return knex.schema.dropTable("node");
    }
    // Table doesn't exist, do nothing
    return Promise.resolve();
};
