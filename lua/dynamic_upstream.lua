--[[
  動態上游節點發現模組
  支援從資料庫動態發現在線節點，配合 K8s 自動擴縮容
]]

local _M = {}
local config = require "config"
local db = require "db"

-- 節點快取
local node_cache = ngx.shared.monitor_routing
local CACHE_KEY = "online_nodes"
local CACHE_TTL = 10  -- 10 秒快取

-- 離線閾值（90 秒）
local OFFLINE_THRESHOLD_SECONDS = 90

--- 從資料庫獲取在線節點
--- @return table 節點列表
function _M.get_online_nodes()
    -- 檢查快取
    local cached = node_cache:get(CACHE_KEY)
    if cached then
        local ok, nodes = pcall(require("cjson").decode, cached)
        if ok and nodes and #nodes > 0 then
            return nodes
        end
    end

    -- 從資料庫查詢
    local db_conn, err = db.connect()
    if not db_conn then
        ngx.log(ngx.ERR, "dynamic_upstream: failed to connect to DB: ", err)
        return {}
    end

    -- 查詢在線節點（90秒內有心跳或狀態為 online）
    local sql = string.format([[
        SELECT node_id, node_name, host, is_primary, status 
        FROM node 
        WHERE status = 'online' 
           OR last_seen > DATE_SUB(NOW(), INTERVAL %d SECOND)
        ORDER BY is_primary DESC, node_id ASC
    ]], OFFLINE_THRESHOLD_SECONDS)

    local res, query_err = db_conn:query(sql)
    db.close(db_conn)

    if not res then
        ngx.log(ngx.ERR, "dynamic_upstream: query failed: ", query_err)
        return {}
    end

    -- 處理結果
    local nodes = {}
    for _, row in ipairs(res) do
        local host, port = config.get_node_host_port(row)
        table.insert(nodes, {
            node_id = row.node_id,
            node_name = row.node_name,
            host = host,
            port = port,
            is_primary = (row.is_primary == 1 or row.is_primary == "1"),
            status = row.status
        })
    end

    -- 更新快取
    if #nodes > 0 then
        local ok, json = pcall(require("cjson").encode, nodes)
        if ok then
            node_cache:set(CACHE_KEY, json, CACHE_TTL)
        end
    end

    ngx.log(ngx.DEBUG, "dynamic_upstream: discovered ", #nodes, " online nodes")
    return nodes
end

--- 獲取主節點
--- @return table|nil 主節點資訊
function _M.get_primary_node()
    local nodes = _M.get_online_nodes()
    
    for _, node in ipairs(nodes) do
        if node.is_primary then
            return node
        end
    end
    
    -- 如果沒有明確的主節點，返回第一個
    if #nodes > 0 then
        return nodes[1]
    end
    
    return nil
end

--- 輪詢選擇節點
local round_robin_counter = 0
function _M.select_node_round_robin()
    local nodes = _M.get_online_nodes()
    
    if #nodes == 0 then
        return nil, "No available nodes"
    end

    round_robin_counter = round_robin_counter + 1
    local idx = ((round_robin_counter - 1) % #nodes) + 1
    
    return nodes[idx]
end

--- 根據負載選擇節點（基於 monitor 數量）
function _M.select_node_least_load()
    local db_conn, err = db.connect()
    if not db_conn then
        -- Fallback 到輪詢
        return _M.select_node_round_robin()
    end

    local sql = [[
        SELECT n.node_id, n.host, n.is_primary,
               COALESCE(m.monitor_count, 0) as monitor_count
        FROM node n
        LEFT JOIN (
            SELECT node_id, COUNT(*) as monitor_count
            FROM monitor
            WHERE active = 1
            GROUP BY node_id
        ) m ON n.node_id = m.node_id
        WHERE n.status = 'online'
        ORDER BY monitor_count ASC, n.node_id ASC
        LIMIT 1
    ]]

    local res, query_err = db_conn:query(sql)
    db.close(db_conn)

    if not res or #res == 0 then
        return _M.select_node_round_robin()
    end

    local row = res[1]
    local host, port = config.get_node_host_port(row)
    
    return {
        node_id = row.node_id,
        host = host,
        port = port,
        is_primary = (row.is_primary == 1),
        monitor_count = row.monitor_count
    }
end

--- 刷新節點快取
function _M.refresh_cache()
    node_cache:delete(CACHE_KEY)
    return _M.get_online_nodes()
end

--- 獲取節點統計
function _M.get_stats()
    local nodes = _M.get_online_nodes()
    local stats = {
        total = #nodes,
        primary = 0,
        secondary = 0
    }
    
    for _, node in ipairs(nodes) do
        if node.is_primary then
            stats.primary = stats.primary + 1
        else
            stats.secondary = stats.secondary + 1
        end
    end
    
    return stats
end

return _M
