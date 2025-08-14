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
            // 主鍵
            table.string('node_id', 50).primary();
            
            // 基本資訊
            table.string('node_name', 100).notNullable();
            table.string('location', 200);
            table.string('ip', 45);
            table.string('hostname', 100);
            
            // 狀態相關
            table.string('status', 20).defaultTo('online');
            table.boolean('active').defaultTo(true);
            table.boolean('is_primary').defaultTo(false);
            
            // 時間戳記
            table.timestamp('created_date').defaultTo(knex.fn.now());
            table.timestamp('modified_date').defaultTo(knex.fn.now());
            table.timestamp('last_seen').defaultTo(knex.fn.now());
            
            // 索引
            table.index(['node_name'], 'idx_node_name');
            table.index(['status'], 'idx_node_status');
            table.index(['active'], 'idx_node_active');
            table.index(['is_primary'], 'idx_node_is_primary');
        });
    }
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
