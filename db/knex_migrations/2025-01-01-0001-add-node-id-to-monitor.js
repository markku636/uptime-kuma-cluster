exports.up = function (knex) {
    return knex.schema.alterTable("monitor", function (table) {
        table.string("node_id", 50).nullable();
        table.index("node_id", "idx_node_id");
    });
};

exports.down = function (knex) {
    return knex.schema.alterTable("monitor", function (table) {
        table.dropIndex("node_id", "idx_node_id");
        table.dropColumn("node_id");
    });
};
