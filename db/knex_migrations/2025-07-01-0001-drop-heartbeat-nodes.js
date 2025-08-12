exports.up = async function (knex) {
    const hasTable = await knex.schema.hasTable("heartbeat_nodes");
    if (hasTable) {
        await knex.schema.dropTable("heartbeat_nodes");
    }
};

exports.down = async function (knex) {
    // No-op: deprecated table will not be recreated
    return Promise.resolve();
};


