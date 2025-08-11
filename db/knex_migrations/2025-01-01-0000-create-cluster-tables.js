exports.up = function (knex) {
    return knex.schema
        .createTable("heartbeat_nodes", function (table) {
            table.increments("id");
            table.comment("This table contains the cluster node information");
            table.string("node_id", 50).unique().notNullable();
            table.string("host", 255).notNullable();
            table.integer("port").defaultTo(3001);
            table.enum("status", ["active", "dead", "recovering", "recovery_failed"]).defaultTo("active");
            table.integer("cpu_cores").defaultTo(1);
            table.integer("memory_gb").defaultTo(1);
            table.integer("disk_gb").defaultTo(10);
            table.integer("weight").defaultTo(1);
            // last_seen: CURRENT_TIMESTAMP 並在更新時自動更新
            table.timestamp("last_seen").defaultTo(knex.raw("CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP"));
            table.timestamp("failure_time").nullable();
            table.integer("recovery_attempts").defaultTo(0);
            table.timestamp("last_recovery_attempt").nullable();
            table.timestamp("recovery_completed_at").nullable();
            table.timestamp("created_at").defaultTo(knex.fn.now());
            // updated_at: CURRENT_TIMESTAMP 並在更新時自動更新
            table.timestamp("updated_at").defaultTo(knex.raw("CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP"));
        })
        .then(() => {
            // 插入預設節點
            return knex("heartbeat_nodes").insert([
                {
                    node_id: "node1",
                    host: "node1",
                    port: 3001,
                    status: "active",
                    cpu_cores: 2,
                    memory_gb: 2,
                    disk_gb: 20
                },
                {
                    node_id: "node2",
                    host: "node2",
                    port: 3001,
                    status: "active",
                    cpu_cores: 2,
                    memory_gb: 2,
                    disk_gb: 20
                },
                {
                    node_id: "node3",
                    host: "node3",
                    port: 3001,
                    status: "active",
                    cpu_cores: 2,
                    memory_gb: 2,
                    disk_gb: 20
                }
            ]);
        });
};

exports.down = function (knex) {
    return knex.schema.dropTable("heartbeat_nodes");
};
