-- lua/load_balancer.lua - OpenResty 智能負載平衡器
local cjson = require "cjson"
local mysql = require "resty.mysql"

-- 共享記憶體區域
local balancer = ngx.shared.load_balancer

-- 資料庫連接配置
local db_config = {
    host = os.getenv("DB_HOST") or "mariadb",
    port = os.getenv("DB_PORT") or 3306,
    user = os.getenv("DB_USER") or "kuma",
    password = os.getenv("DB_PASSWORD") or "kuma_pass",
    database = os.getenv("DB_NAME") or "kuma"
}

-- 獲取節點負載資訊
local function get_node_loads()
    local db, err = mysql:new()
    if not db then
        ngx.log(ngx.ERR, "創建 MySQL 連接失敗: ", err)
        return nil
    end
    
    -- 設置連接超時
    db:set_timeout(5000)
    
    -- 連接到資料庫
    local ok, err = db:connect(db_config)
    if not ok then
        ngx.log(ngx.ERR, "連接資料庫失敗: ", err)
        return nil
    end
    
    -- 查詢各節點的 monitor 數量（改用 node 表，且不需要硬體規格欄位）
    local sql = [[
        SELECT 
            n.node_id,
            n.ip AS host,            
            n.status,
            COUNT(m.id) AS monitor_count
        FROM node n
        LEFT JOIN monitor m ON n.node_id = m.node_id        
        GROUP BY n.node_id, n.ip, n.status
        ORDER BY monitor_count ASC
    ]]
    
    local res, err = db:query(sql)
    if not res then
        ngx.log(ngx.ERR, "查詢失敗: ", err)
        db:close()
        return nil
    end
    
    -- 關閉資料庫連接
    db:close()
    
    -- 計算負載分數（僅依據監控數量）
    for i, node in ipairs(res) do
        local monitor_weight = 1 / (node.monitor_count + 1)
        node.load_score = monitor_weight
    end
    
    return res
end

-- 更新負載資訊
local function update_load_info()
    local node_loads = get_node_loads()
    if node_loads then
        balancer:set("node_loads", cjson.encode(node_loads))
        balancer:set("last_update", ngx.time())
        ngx.log(ngx.INFO, "負載資訊已更新")
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
    
    local node_loads = cjson.decode(node_loads_json)
    if not node_loads or #node_loads == 0 then
        return nil
    end
    
    -- 按負載分數排序，選擇分數最高的節點
    table.sort(node_loads, function(a, b)
        return a.load_score > b.load_score
    end)
    
    local best_node = node_loads[1]
    ngx.log(ngx.INFO, string.format("最佳節點: %s, 負載分數: %.3f, 監控數量: %d", 
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
        ngx.var.backend = string.format("http://%s:%s", best_node.host, best_node.port)
        return true
    end
    
    return false
end

-- 導出函數
return {
    balance_load = balance_load,
    get_best_node = get_best_node,
    update_load_info = update_load_info
}
