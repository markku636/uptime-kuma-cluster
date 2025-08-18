exports.up = function (knex) {
    return knex.schema.alterTable("monitor", function (table) {
        table.string("node_id", 50).nullable();
    }).then(() => {
        return knex.schema.raw("CREATE INDEX idx_node_id ON monitor (node_id)");
    });
};

exports.down = function (knex) {
    return knex.schema.raw("DROP INDEX idx_node_id ON monitor").then(() => {
        return knex.schema.alterTable("monitor", function (table) {
            table.dropColumn("node_id");
        });
    });
};
