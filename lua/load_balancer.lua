-- lua/load_balancer.lua - OpenResty 智能負載平衡器和重新平衡模組
local cjson = require "cjson"
local mysql = require "resty.mysql"

-- 共享記憶體區域
local balancer = ngx.shared.load_balancer
local rebalancer = ngx.shared.health_checker

-- 資料庫連接配置
local db_config = {
    host = os.getenv("DB_HOST") or "mariadb",
    port = os.getenv("DB_PORT") or 3306,
    user = os.getenv("DB_USER") or "kuma",
    password = os.getenv("DB_PASSWORD") or "kuma_pass",
    database = os.getenv("DB_NAME") or "kuma"
}

-- 獲取資料庫連接
local function get_db_connection()
    local db, err = mysql:new()
    if not db then
        ngx.log(ngx.ERR, "創建 MySQL 連接失敗: ", err)
        return nil
    end
    
    db:set_timeout(5000)
    
    local ok, err = db:connect(db_config)
    if not ok then
        ngx.log(ngx.ERR, "連接資料庫失敗: ", err)
        return nil
    end
    
    return db
end

-- 獲取節點負載資訊
local function get_node_loads()
    local db = get_db_connection()
    if not db then
        return nil
    end
    
    -- 查詢各節點的監控器數量
    local sql = [[
        SELECT 
            n.node_id,
            n.ip,
            n.status,
            COUNT(m.id) AS monitor_count
        FROM node n
        LEFT JOIN monitor m ON n.node_id = m.assigned_node OR (m.assigned_node IS NULL AND m.node_id = n.node_id)
        WHERE n.status = 'online'
        GROUP BY n.node_id, n.ip, n.status
        ORDER BY monitor_count ASC
    ]]
    
    local res, err = db:query(sql)
    if not res then
        ngx.log(ngx.ERR, "查詢節點負載失敗: ", err)
        db:close()
        return nil
    end
    
    db:close()
    
    -- 計算負載分數（監控器數量越少，分數越高）
    for i, node in ipairs(res) do
        node.load_score = 1 / (node.monitor_count + 1)
    end
    
    return res
end

-- 更新負載資訊
local function update_load_info()
    local node_loads = get_node_loads()
    if node_loads then
        balancer:set("node_loads", cjson.encode(node_loads))
        balancer:set("last_update", ngx.time())
        balancer:set("update_count", (balancer:get("update_count") or 0) + 1)
        ngx.log(ngx.INFO, "負載資訊已更新，節點數量: ", #node_loads)
        return true
    end
    return false
end

-- 獲取最佳節點
local function get_best_node()
    local node_loads_json = balancer:get("node_loads")
    if not node_loads_json then
        return nil
    end
    
    local ok, node_loads = pcall(cjson.decode, node_loads_json)
    if not ok or not node_loads or #node_loads == 0 then
        return nil
    end
    
    -- 按負載分數排序，選擇分數最高的節點
    table.sort(node_loads, function(a, b)
        return a.load_score > b.load_score
    end)
    
    local best_node = node_loads[1]
    ngx.log(ngx.INFO, string.format("選擇最佳節點: %s, 負載分數: %.3f, 監控數量: %d", 
        best_node.node_id, best_node.load_score, best_node.monitor_count))
    
    return best_node
end

-- 負載平衡決策
local function balance_load()
    local current_time = ngx.time()
    local last_update = balancer:get("last_update") or 0
    
    -- 每30秒更新一次負載資訊
    if current_time - last_update > 30 then
        update_load_info()
    end
    
    -- 獲取最佳節點
    local best_node = get_best_node()
    if best_node then
        -- 設置路由到最佳節點
        ngx.var.backend = string.format("http://%s:3001", best_node.ip)
        return true
    end
    
    return false
end

-- 手動觸發監控器重新平衡
local function trigger_manual_rebalancing()
    ngx.log(ngx.INFO, "手動觸發重新平衡")
    
    local db = get_db_connection()
    if not db then
        return false
    end
    
    local online_nodes_sql = "SELECT node_id FROM node WHERE status = 'online'"
    local online_nodes, err = db:query(online_nodes_sql)
    
    if not online_nodes then
        db:close()
        return false
    end
    
    if #online_nodes == 0 then
        ngx.log(ngx.WARN, "沒有可用的在線節點進行重新平衡")
        db:close()
        return false
    end
    
    rebalance_monitors(db, online_nodes)
    db:close()
    
    -- 更新重新平衡統計
    rebalancer:set("last_rebalance", os.time())
    rebalancer:set("rebalance_count", (rebalancer:get("rebalance_count") or 0) + 1)
    rebalancer:set("manual_rebalance_count", (rebalancer:get("manual_rebalance_count") or 0) + 1)
    
    return true
end

-- 重新平衡監控器
local function rebalance_monitors(db, online_nodes)
    if #online_nodes == 0 then
        ngx.log(ngx.WARN, "沒有可用的在線節點進行重新平衡")
        return
    end
    
    ngx.log(ngx.INFO, "開始在 ", #online_nodes, " 個節點間重新平衡監控器")
    
    -- 獲取所有監控器
    local all_monitors_sql = "SELECT id, name, assigned_node, node_id FROM monitor ORDER BY id"
    local all_monitors, err = db:query(all_monitors_sql)
    
    if not all_monitors or #all_monitors == 0 then
        ngx.log(ngx.INFO, "沒有需要重新平衡的監控器")
        return
    end
    
    -- 使用輪詢分配策略
    local node_index = 1
    local reassignments = 0
    
    for _, monitor in ipairs(all_monitors) do
        local target_node = online_nodes[node_index].node_id
        local effective_node = monitor.assigned_node or monitor.node_id or nil
        
        -- 只有當分配與有效節點不同時才更新
        if effective_node ~= target_node then
            local update_sql = "UPDATE monitor SET assigned_node = ? WHERE id = ?"
            db:query(update_sql, {target_node, monitor.id})
            reassignments = reassignments + 1
            
            ngx.log(ngx.DEBUG, "重新分配監控器 \"", monitor.name, "\" (ID: ", monitor.id, ") 從 ", (effective_node or "unassigned"), " 到 ", target_node)
        end
        
        -- 輪詢到下一個節點
        node_index = (node_index % #online_nodes) + 1
    end
    
    if reassignments > 0 then
        ngx.log(ngx.INFO, "重新平衡完成，重新分配了 ", reassignments, " 個監控器")
    else
        ngx.log(ngx.INFO, "不需要重新分配監控器 - 分佈已經最優")
    end
end

-- 獲取重新平衡統計資訊
local function get_rebalancing_statistics()
    return {
        last_rebalance = rebalancer:get("last_rebalance") or 0,
        rebalance_count = rebalancer:get("rebalance_count") or 0,
        manual_rebalance_count = rebalancer:get("manual_rebalance_count") or 0,
        timestamp = os.time()
    }
end

-- 導出函數
return {
    -- 負載平衡功能
    balance_load = balance_load,
    get_best_node = get_best_node,
    update_load_info = update_load_info,
    
    -- 重新平衡功能
    trigger_manual_rebalancing = trigger_manual_rebalancing,
    get_rebalancing_statistics = get_rebalancing_statistics
}
