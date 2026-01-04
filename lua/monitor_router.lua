local _M = {}
local cjson = require "cjson"
local config = require "config"
local db = require "db"

-- 使用集中配置
local MONITOR_LIMIT_PER_NODE = config.cluster.monitor_limit_per_node
local FIXED_NODE_COOKIE = config.cookie.fixed_node_name

-- 共享記憶體
local routing_cache = ngx.shared.monitor_routing

-- Setup 狀態快取 key
local SETUP_COMPLETE_CACHE_KEY = "setup_complete"
local SETUP_CHECK_TTL = 5  -- 每 5 秒檢查一次

-- 使用共用資料庫模組
local function db_connect()
    return db.connect()
end

-- ============================================================
-- Setup 狀態檢查 (Setup Status Check)
-- 在 setup 未完成前，所有請求只路由到主節點 (node1)
-- ============================================================

-- 檢查 setup 是否已完成（資料庫中是否有使用者）
-- Check if setup is complete (if there are users in the database)
function _M.is_setup_complete()
    -- 先從快取檢查
    local cached = routing_cache:get(SETUP_COMPLETE_CACHE_KEY)
    if cached ~= nil then
        return cached == "true"
    end
    
    -- 從資料庫查詢
    local db_conn, err = db_connect()
    if not db_conn then
        ngx.log(ngx.ERR, "is_setup_complete: cannot connect to DB, assuming setup incomplete")
        return false
    end
    
    local sql = "SELECT COUNT(*) as user_count FROM user LIMIT 1"
    local res, qerr = db_conn:query(sql)
    db_conn:close()
    
    if not res or #res == 0 then
        ngx.log(ngx.WARN, "is_setup_complete: failed to query user count, assuming setup incomplete")
        routing_cache:set(SETUP_COMPLETE_CACHE_KEY, "false", SETUP_CHECK_TTL)
        return false
    end
    
    local user_count = tonumber(res[1].user_count) or 0
    local is_complete = user_count > 0
    
    -- 快取結果
    routing_cache:set(SETUP_COMPLETE_CACHE_KEY, is_complete and "true" or "false", SETUP_CHECK_TTL)
    
    ngx.log(ngx.INFO, "is_setup_complete: user_count=", user_count, ", setup_complete=", tostring(is_complete))
    return is_complete
end

-- 強制路由到主節點
-- Force route to primary node
-- 支援 Docker Compose 和 K8s 雙環境
function _M.route_to_primary_node()
    -- 使用 config 輔助函數構建 host
    local full_host = config.build_node_host(config.cluster.default_node)
    local host, port
    
    if full_host then
        host, port = full_host:match("^([^:]+):(%d+)$")
        port = tonumber(port) or config.cluster.default_port
    else
        -- Fallback
        host = config.cluster.node_host_prefix .. config.cluster.default_node
        port = config.cluster.default_port
    end
    
    ngx.log(ngx.INFO, "route_to_primary_node: setup not complete, routing to primary node ", host, ":", port, " (env: ", config.environment, ")")
    return host, port
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

    -- 緩存結果（使用配置的 TTL）
    routing_cache:set(cache_key, node_id, config.cache.monitor_routing_ttl)
    
    ngx.log(ngx.INFO, "Routed monitor ", monitor_id, " to node ", node_id)
    return node_id
end

-- 哈希路由（降級方案）
function _M.hash_route(monitor_id)
    local node_count = config.cluster.node_count
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
    local node_count = config.cluster.node_count
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

-- ============================================================
-- 固定節點路由功能 (Fixed Node Routing)
-- ============================================================

-- 檢查並解析固定節點 Cookie
-- Check and parse fixed node Cookie
function _M.get_fixed_node_from_cookie()
    local cookie_value = ngx.var.cookie_KUMA_FIXED_NODE
    
    if not cookie_value or cookie_value == "" then
        return nil
    end
    
    -- 驗證格式 (node1, node2, node3...)
    -- Validate format
    if not string.match(cookie_value, "^node%d+$") then
        ngx.log(ngx.WARN, "Invalid fixed node cookie value: ", cookie_value)
        return nil
    end
    
    return cookie_value
end

-- 驗證節點是否有效且在線
-- Validate if node is valid and online
function _M.validate_fixed_node(node_id)
    local db, err = db_connect()
    if not db then
        return false, "database_unavailable"
    end
    
    local sql = string.format([[
        SELECT node_id, status 
        FROM node 
        WHERE node_id = '%s' AND status = 'online'
        LIMIT 1
    ]], node_id)
    
    local res, err = db:query(sql)
    db:close()
    
    if not res or #res == 0 then
        return false, "node_not_found_or_offline"
    end
    
    return true, nil
end

-- 動態為當前請求選擇節點（提供給 balancer_by_lua_block 使用）
-- 邏輯：依據各節點目前的 monitor 數量（active=1），優先選擇「監控數量最少」且 online 的節點
-- 支援 Docker Compose 和 K8s 雙環境
-- 回傳值：host, port
function _M.pick_node_for_request()
    local db_conn, err = db_connect()
    if not db_conn then
        ngx.log(ngx.ERR, "pick_node_for_request: cannot connect to DB, fallback to default node")
        -- 使用 config 輔助函數 fallback
        local fallback_host = config.build_node_host(config.cluster.default_node)
        if fallback_host then
            local host, port = fallback_host:match("^([^:]+):(%d+)$")
            return host, tonumber(port) or config.cluster.default_port
        end
        return config.cluster.node_host_prefix .. config.cluster.default_node, config.cluster.default_port
    end

    -- 依據目前 active monitor 數量選擇最空閒的 online 節點
    -- 同時查詢 node.host 欄位，以支援 K8s 環境
    local sql = [[
        SELECT
            n.node_id,
            n.host,
            COUNT(m.id) AS monitor_count
        FROM node n
        LEFT JOIN monitor m
            ON m.node_id = n.node_id
           AND m.active = 1
        WHERE n.status = 'online'
        GROUP BY n.node_id, n.host
        ORDER BY monitor_count ASC, n.node_id ASC
        LIMIT 1
    ]]

    local res, qerr = db_conn:query(sql)
    db_conn:close()

    if not res or #res == 0 then
        ngx.log(ngx.ERR, "pick_node_for_request: no online nodes found, fallback to default")
        local fallback_host = config.build_node_host(config.cluster.default_node)
        if fallback_host then
            local host, port = fallback_host:match("^([^:]+):(%d+)$")
            return host, tonumber(port) or config.cluster.default_port
        end
        return config.cluster.node_host_prefix .. config.cluster.default_node, config.cluster.default_port
    end

    local row = res[1]
    local monitor_count = tonumber(row.monitor_count) or 0
    
    -- 使用 config 輔助函數取得 host 和 port
    -- 優先使用資料庫中儲存的 host
    local host, port = config.get_node_host_port(row)

    ngx.log(ngx.INFO,
        "pick_node_for_request: routed to ", host, ":", port,
        " (node_id=", row.node_id, ", monitors=", monitor_count, ", env=", config.environment, ")"
    )
    return host, port
end

-- DNS 解析函數（在 access 階段使用）
-- balancer_by_lua* 階段需要 IP 地址，不能使用 hostname
-- 支援 Docker Compose 和 K8s 雙環境 DNS
local function resolve_host(hostname)
    local resolver = require "resty.dns.resolver"
    
    -- 使用 config 中配置的 DNS 伺服器
    local r, err = resolver:new{
        nameservers = config.dns.servers,
        retrans = config.dns.retrans,
        timeout = config.dns.timeout,
    }
    
    if not r then
        ngx.log(ngx.ERR, "failed to create resolver: ", err)
        return nil, err
    end
    
    local answers, err = r:query(hostname, { qtype = r.TYPE_A })
    if not answers then
        ngx.log(ngx.ERR, "failed to query DNS for ", hostname, ": ", err)
        return nil, err
    end
    
    if answers.errcode then
        ngx.log(ngx.ERR, "DNS error for ", hostname, ": ", answers.errstr)
        return nil, answers.errstr
    end
    
    for _, ans in ipairs(answers) do
        if ans.type == r.TYPE_A then
            ngx.log(ngx.DEBUG, "resolved ", hostname, " to ", ans.address)
            return ans.address
        end
    end
    
    return nil, "no A record found"
end

-- 預選節點（用於 access_by_lua* 階段，將結果存入 ngx.ctx）
-- 這個函數必須在 access 階段調用，因為 balancer 階段不能使用 socket API
-- Preselect node (for access_by_lua* phase, stores result in ngx.ctx)
-- This function must be called in access phase because balancer phase cannot use socket API
function _M.preselect_node()
    local host, port
    local use_fixed_node = false
    
    -- 0. 首先檢查 setup 是否完成
    -- First check if setup is complete
    -- 如果 setup 未完成，強制路由到主節點 (node1)
    -- If setup is not complete, force route to primary node (node1)
    if not _M.is_setup_complete() then
        host, port = _M.route_to_primary_node()
        ngx.ctx.setup_pending = true  -- 標記 setup 尚未完成
        
        -- 解析 hostname 為 IP
        local ip, err = resolve_host(host)
        if not ip then
            ngx.log(ngx.ERR, "preselect_node: failed to resolve primary node ", host, ": ", err)
            ngx.ctx.upstream_host = nil
            ngx.ctx.upstream_port = port
            ngx.ctx.upstream_hostname = host
            return
        end
        
        ngx.ctx.upstream_host = ip
        ngx.ctx.upstream_port = port
        ngx.ctx.upstream_hostname = host
        ngx.ctx.use_fixed_node = false
        ngx.log(ngx.INFO, "preselect_node: setup pending, routed to primary node ", host, " (IP: ", ip, "):", port)
        return
    end
    
    -- 1. 先檢查是否有固定節點 Cookie
    -- First check if there's a fixed node Cookie
    local fixed_node = _M.get_fixed_node_from_cookie()
    
    if fixed_node then
        -- 驗證節點有效性
        -- Validate node
        local valid, reason = _M.validate_fixed_node(fixed_node)
        
        if valid then
            host = config.cluster.node_host_prefix .. fixed_node
            port = config.cluster.default_port
            use_fixed_node = true
            ngx.log(ngx.INFO, "Using fixed node from cookie: ", fixed_node)
        else
            ngx.log(ngx.WARN, "Fixed node ", fixed_node, " is invalid (", tostring(reason), "), will clear cookie")
            -- 標記需要清除 Cookie
            -- Mark cookie for clearing
            ngx.ctx.clear_fixed_node_cookie = true
        end
    end
    
    -- 2. 如果沒有有效的固定節點，使用原本邏輯
    -- If no valid fixed node, use original logic
    if not use_fixed_node then
        host, port = _M.pick_node_for_request()
    end
    
    -- 解析 hostname 為 IP 地址（balancer 階段需要）
    -- Resolve hostname to IP (required by balancer phase)
    local ip, err = resolve_host(host)
    if not ip then
        ngx.log(ngx.WARN, "preselect_node: failed to resolve ", host, ", using fallback: ", err)
        -- fallback: 嘗試解析默認節點
        local fallback_host = config.cluster.node_host_prefix .. config.cluster.default_node
        ip, err = resolve_host(fallback_host)
        if not ip then
            ngx.log(ngx.ERR, "preselect_node: failed to resolve fallback node1: ", err)
            -- 最後手段：使用硬編碼的容器 IP（不推薦）
            ip = nil
        end
    end
    
    ngx.ctx.upstream_host = ip
    ngx.ctx.upstream_port = port
    ngx.ctx.upstream_hostname = host  -- 保留原始 hostname 用於日誌
    ngx.ctx.use_fixed_node = use_fixed_node  -- 標記是否使用固定節點
    ngx.log(ngx.INFO, "preselect_node: selected ", host, " (IP: ", tostring(ip), "):", port, 
            ", fixed_node=", tostring(use_fixed_node))
end

-- 獲取預選的節點（用於 balancer_by_lua* 階段）
-- 如果沒有預選，則使用默認節點
function _M.get_preselected_node()
    local host = ngx.ctx.upstream_host
    local port = ngx.ctx.upstream_port
    
    if not host then
        ngx.log(ngx.WARN, "get_preselected_node: no preselected node IP available")
        return nil, nil
    end
    
    return host, port
end

return _M
