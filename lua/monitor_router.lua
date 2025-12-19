local _M = {}
local cjson = require "cjson"

-- 配置
local MONITOR_LIMIT_PER_NODE = 1000
local DB_CONFIG = {
    host = os.getenv("DB_HOST") or "mariadb",
    port = tonumber(os.getenv("DB_PORT")) or 3306,
    user = os.getenv("DB_USER") or "kuma",
    password = os.getenv("DB_PASSWORD") or "kuma_pass",
    database = os.getenv("DB_NAME") or "kuma"
}

-- 共享記憶體
local routing_cache = ngx.shared.monitor_routing

-- 資料庫連接
local function db_connect()
    local mysql = require "resty.mysql"
    local db, err = mysql:new()
    if not db then
        ngx.log(ngx.ERR, "Failed to create MySQL connection: ", err)
        return nil, err
    end
    db:set_timeout(3000)
    local ok, err = db:connect(DB_CONFIG)
    if not ok then
        ngx.log(ngx.ERR, "Failed to connect to database: ", err)
        return nil, err
    end
    return db
end

-- 根據 Monitor ID 路由
function _M.route_by_monitor_id(monitor_id)
    if not monitor_id then 
        return "node1" 
    end

    -- 先從緩存查找
    local cache_key = "monitor:" .. monitor_id
    local cached_node = routing_cache:get(cache_key)
    
    if cached_node then
        ngx.log(ngx.DEBUG, "Cache hit for monitor ", monitor_id, " -> ", cached_node)
        return cached_node
    end
    
    -- 從資料庫查詢
    local db, err = db_connect()
    if not db then
        -- 降級到哈希路由
        ngx.log(ngx.ERR, "DB connect failed in route_by_monitor_id, using hash fallback")
        return _M.hash_route(monitor_id)
    end
    
    local sql = string.format([[
        SELECT COALESCE(assigned_node, node_id) as effective_node
        FROM monitor
        WHERE id = %d
        LIMIT 1
    ]], tonumber(monitor_id))
    
    local res, err = db:query(sql)
    db:close()
    
    if not res or #res == 0 then
        ngx.log(ngx.WARN, "Monitor ", monitor_id, " not found, using hash routing")
        return _M.hash_route(monitor_id)
    end
    
    local node_id = res[1].effective_node
    
    -- 如果 node_id 為空，則使用默認或哈希
    if not node_id or node_id == ngx.null then
        return _M.hash_route(monitor_id)
    end

    -- 緩存結果（5分鐘）
    routing_cache:set(cache_key, node_id, 300)
    
    ngx.log(ngx.INFO, "Routed monitor ", monitor_id, " to node ", node_id)
    return node_id
end

-- 哈希路由（降級方案）
function _M.hash_route(monitor_id)
    local node_count = 3  -- 假設有3個節點
    local node_index = (tonumber(monitor_id) % node_count) + 1
    return "node" .. node_index
end

-- 為新 Monitor 選擇節點（基於容量）
function _M.route_new_monitor()
    local db, err = db_connect()
    if not db then
        ngx.log(ngx.ERR, "Cannot connect to DB for new monitor routing")
        return "node1"  -- 默認
    end
    
    -- 查詢每個節點的 Monitor 數量
    local sql = [[
        SELECT 
            node_id,
            COUNT(*) as monitor_count
        FROM monitor
        WHERE active = 1
        GROUP BY node_id
        ORDER BY monitor_count ASC
        LIMIT 1
    ]]
    
    local res, err = db:query(sql)
    
    if not res or #res == 0 then
        db:close()
        return "node1"  -- 默認第一個節點
    end
    
    local selected_node = res[1].node_id
    local current_count = res[1].monitor_count
    
    -- 檢查是否超過限制
    if current_count >= MONITOR_LIMIT_PER_NODE then
        ngx.log(ngx.WARN, "Node ", selected_node, " is at capacity (", current_count, " monitors)")
        
        -- 嘗試找下一個可用節點
        selected_node = _M.find_available_node(db) or "node1"
    end
    
    db:close()
    ngx.log(ngx.INFO, "Assigned new monitor to ", selected_node)
    return selected_node
end

-- 查找可用節點
function _M.find_available_node(db)
    local sql = string.format([[
        SELECT 
            n.node_id,
            COUNT(m.id) as monitor_count
        FROM node n
        LEFT JOIN monitor m ON m.node_id = n.node_id AND m.active = 1
        WHERE n.status = 'online'
        GROUP BY n.node_id
        HAVING monitor_count < %d
        ORDER BY monitor_count ASC
        LIMIT 1
    ]], MONITOR_LIMIT_PER_NODE)
    
    local res, err = db:query(sql)
    
    if not res or #res == 0 then
        ngx.log(ngx.ERR, "No available node found! All nodes at capacity!")
        return nil
    end
    
    return res[1].node_id
end

-- 基於用戶路由（WebSocket 親和性）
function _M.route_by_user(user_id)
    if not user_id then
        return nil
    end
    
    -- 使用一致性哈希
    local node_count = 3
    local hash = ngx.crc32_short(user_id)
    local node_index = (hash % node_count) + 1
    return "node" .. node_index
end

-- 獲取集群狀態
function _M.get_cluster_status()
    local db, err = db_connect()
    if not db then
        return {error = "database_unavailable"}
    end
    
    local sql = [[
        SELECT 
            node_id,
            status,
            last_seen,
            (SELECT COUNT(*) FROM monitor WHERE monitor.node_id = node.node_id AND active = 1) as monitor_count
        FROM node
        ORDER BY node_id
    ]]
    
    local res, err = db:query(sql)
    db:close()
    
    if not res then
        return {error = err}
    end
    
    return {
        timestamp = os.time(),
        nodes = res
    }
end

-- 獲取節點容量
function _M.get_node_capacity()
    local db, err = db_connect()
    if not db then
        return {error = "database_unavailable"}
    end
    
    local sql = string.format([[
        SELECT 
            node_id,
            COUNT(*) as current_count,
            %d as limit_per_node,
            ROUND(COUNT(*) * 100.0 / %d, 2) as usage_percent
        FROM monitor
        WHERE active = 1
        GROUP BY node_id
        ORDER BY node_id
    ]], MONITOR_LIMIT_PER_NODE, MONITOR_LIMIT_PER_NODE)
    
    local res, err = db:query(sql)
    db:close()
    
    if not res then
        return {error = err}
    end
    
    return {
        limit_per_node = MONITOR_LIMIT_PER_NODE,
        nodes = res
    }
end

-- 動態為當前請求選擇節點（提供給 balancer_by_lua_block 使用）
-- 邏輯：依據各節點目前的 monitor 數量（active=1），優先選擇「監控數量最少」且 online 的節點
-- 回傳值：host, port
function _M.pick_node_for_request()
    local db, err = db_connect()
    if not db then
        ngx.log(ngx.ERR, "pick_node_for_request: cannot connect to DB, fallback to node1")
        return "uptime-kuma-node1", 3001
    end

    -- 依據目前 active monitor 數量選擇最空閒的 online 節點
    -- 說明：
    --   - 僅考慮 status = 'online' 的節點
    --   - 使用 LEFT JOIN + COUNT(m.id) 統計各節點 active=1 的監控數量
    --   - ORDER BY monitor_count ASC, node_id ASC：優先選擇監控最少的節點；數量相同時依 node_id 穩定排序
    local sql = [[
        SELECT
            n.node_id,
            COUNT(m.id) AS monitor_count
        FROM node n
        LEFT JOIN monitor m
            ON m.node_id = n.node_id
           AND m.active = 1
        WHERE n.status = 'online'
        GROUP BY n.node_id
        ORDER BY monitor_count ASC, n.node_id ASC
        LIMIT 1
    ]]

    local res, qerr = db:query(sql)
    db:close()

    if not res or #res == 0 then
        ngx.log(ngx.ERR, "pick_node_for_request: no online nodes with capacity found, fallback to node1")
        return "uptime-kuma-node1", 3001
    end

    local row = res[1]
    local node_id = row.node_id or "node1"
    local monitor_count = tonumber(row.monitor_count) or 0

    -- node_id 例如 "node2" -> 映射到 Docker 服務名稱 "uptime-kuma-node2"
    local host = "uptime-kuma-" .. node_id
    local port = 3001

    ngx.log(ngx.INFO,
        "pick_node_for_request: routed to ", host, ":", port,
        " with current monitor_count=", monitor_count
    )
    return host, port
end

return _M
