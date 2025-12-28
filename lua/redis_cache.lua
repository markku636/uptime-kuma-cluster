--[[
  Redis 快取模組
  用於高效能路由快取，減少資料庫查詢負載
  
  Redis Cache Module
  For high-performance routing cache, reducing database query load
]]
local _M = {}
local config = require "config"
local cjson = require "cjson"

-- Redis 連線物件快取
local redis_connection = nil

-- 檢查 Redis 是否啟用
function _M.is_enabled()
    return config.redis.enabled
end

-- 建立 Redis 連線
-- Create Redis connection
function _M.connect()
    if not config.redis.enabled then
        return nil, "Redis is disabled"
    end
    
    local redis = require "resty.redis"
    local red = redis:new()
    
    red:set_timeout(config.redis.timeout)
    
    local ok, err = red:connect(config.redis.host, config.redis.port)
    if not ok then
        ngx.log(ngx.ERR, "Redis connect failed: ", err)
        return nil, err
    end
    
    -- 認證 (如果設定了密碼)
    if config.redis.password and config.redis.password ~= "" then
        local res, err = red:auth(config.redis.password)
        if not res then
            ngx.log(ngx.ERR, "Redis auth failed: ", err)
            return nil, err
        end
    end
    
    -- 選擇資料庫
    if config.redis.database > 0 then
        local res, err = red:select(config.redis.database)
        if not res then
            ngx.log(ngx.ERR, "Redis select database failed: ", err)
            return nil, err
        end
    end
    
    return red
end

-- 關閉連線 (放回連線池)
-- Close connection (return to pool)
function _M.close(red)
    if not red then return end
    
    local ok, err = red:set_keepalive(10000, config.redis.pool_size)
    if not ok then
        ngx.log(ngx.WARN, "Redis set_keepalive failed: ", err)
    end
end

-- ============================================================
-- 監控路由快取 (Monitor Routing Cache)
-- ============================================================

-- 取得監控的路由節點
-- Get routing node for monitor
function _M.get_monitor_route(monitor_id)
    if not config.redis.enabled then
        return nil
    end
    
    local red, err = _M.connect()
    if not red then
        return nil
    end
    
    local key = "kuma:route:monitor:" .. monitor_id
    local res, err = red:get(key)
    
    _M.close(red)
    
    if not res or res == ngx.null then
        return nil
    end
    
    return res
end

-- 設定監控的路由節點
-- Set routing node for monitor
function _M.set_monitor_route(monitor_id, node_id, ttl)
    if not config.redis.enabled then
        return false
    end
    
    local red, err = _M.connect()
    if not red then
        return false
    end
    
    local key = "kuma:route:monitor:" .. monitor_id
    ttl = ttl or config.redis.routing_ttl
    
    local ok, err = red:setex(key, ttl, node_id)
    
    _M.close(red)
    
    if not ok then
        ngx.log(ngx.ERR, "Redis setex failed: ", err)
        return false
    end
    
    return true
end

-- 刪除監控的路由快取
-- Delete monitor routing cache
function _M.delete_monitor_route(monitor_id)
    if not config.redis.enabled then
        return false
    end
    
    local red, err = _M.connect()
    if not red then
        return false
    end
    
    local key = "kuma:route:monitor:" .. monitor_id
    local ok, err = red:del(key)
    
    _M.close(red)
    
    return ok ~= nil
end

-- 批次刪除監控路由快取
-- Batch delete monitor routing cache
function _M.delete_monitor_routes(monitor_ids)
    if not config.redis.enabled or not monitor_ids or #monitor_ids == 0 then
        return false
    end
    
    local red, err = _M.connect()
    if not red then
        return false
    end
    
    local keys = {}
    for _, id in ipairs(monitor_ids) do
        table.insert(keys, "kuma:route:monitor:" .. id)
    end
    
    local ok, err = red:del(unpack(keys))
    
    _M.close(red)
    
    return ok ~= nil
end

-- ============================================================
-- 節點狀態快取 (Node Status Cache)
-- ============================================================

-- 取得節點狀態
-- Get node status
function _M.get_node_status(node_id)
    if not config.redis.enabled then
        return nil
    end
    
    local red, err = _M.connect()
    if not red then
        return nil
    end
    
    local key = "kuma:node:status:" .. node_id
    local res, err = red:hgetall(key)
    
    _M.close(red)
    
    if not res or res == ngx.null or #res == 0 then
        return nil
    end
    
    -- 轉換為 table
    local status = {}
    for i = 1, #res, 2 do
        status[res[i]] = res[i + 1]
    end
    
    return status
end

-- 設定節點狀態
-- Set node status
function _M.set_node_status(node_id, status_data, ttl)
    if not config.redis.enabled then
        return false
    end
    
    local red, err = _M.connect()
    if not red then
        return false
    end
    
    local key = "kuma:node:status:" .. node_id
    ttl = ttl or config.redis.node_status_ttl
    
    -- 使用 HMSET 設定多個欄位
    local args = {}
    for k, v in pairs(status_data) do
        table.insert(args, k)
        table.insert(args, tostring(v))
    end
    
    red:init_pipeline()
    red:hmset(key, unpack(args))
    red:expire(key, ttl)
    local results, err = red:commit_pipeline()
    
    _M.close(red)
    
    if not results then
        ngx.log(ngx.ERR, "Redis pipeline failed: ", err)
        return false
    end
    
    return true
end

-- 取得所有節點狀態
-- Get all node statuses
function _M.get_all_node_statuses()
    if not config.redis.enabled then
        return nil
    end
    
    local red, err = _M.connect()
    if not red then
        return nil
    end
    
    local statuses = {}
    
    for i = 1, config.cluster.node_count do
        local node_id = "node" .. i
        local key = "kuma:node:status:" .. node_id
        local res, err = red:hgetall(key)
        
        if res and res ~= ngx.null and #res > 0 then
            local status = {}
            for j = 1, #res, 2 do
                status[res[j]] = res[j + 1]
            end
            statuses[node_id] = status
        end
    end
    
    _M.close(red)
    
    return statuses
end

-- ============================================================
-- Setup 狀態快取 (Setup Status Cache)
-- ============================================================

local SETUP_COMPLETE_KEY = "kuma:setup:complete"

-- 取得 Setup 狀態
-- Get setup status
function _M.get_setup_status()
    if not config.redis.enabled then
        return nil
    end
    
    local red, err = _M.connect()
    if not red then
        return nil
    end
    
    local res, err = red:get(SETUP_COMPLETE_KEY)
    
    _M.close(red)
    
    if not res or res == ngx.null then
        return nil
    end
    
    return res == "true"
end

-- 設定 Setup 狀態
-- Set setup status
function _M.set_setup_status(is_complete, ttl)
    if not config.redis.enabled then
        return false
    end
    
    local red, err = _M.connect()
    if not red then
        return false
    end
    
    ttl = ttl or config.redis.setup_status_ttl
    local value = is_complete and "true" or "false"
    
    local ok, err = red:setex(SETUP_COMPLETE_KEY, ttl, value)
    
    _M.close(red)
    
    if not ok then
        ngx.log(ngx.ERR, "Redis setex setup status failed: ", err)
        return false
    end
    
    return true
end

-- ============================================================
-- 節點容量快取 (Node Capacity Cache)
-- ============================================================

-- 取得節點容量資訊
-- Get node capacity info
function _M.get_node_capacity(node_id)
    if not config.redis.enabled then
        return nil
    end
    
    local red, err = _M.connect()
    if not red then
        return nil
    end
    
    local key = "kuma:node:capacity:" .. node_id
    local res, err = red:get(key)
    
    _M.close(red)
    
    if not res or res == ngx.null then
        return nil
    end
    
    return tonumber(res)
end

-- 設定節點容量資訊
-- Set node capacity info
function _M.set_node_capacity(node_id, monitor_count, ttl)
    if not config.redis.enabled then
        return false
    end
    
    local red, err = _M.connect()
    if not red then
        return false
    end
    
    local key = "kuma:node:capacity:" .. node_id
    ttl = ttl or config.cache.node_capacity_ttl
    
    local ok, err = red:setex(key, ttl, tostring(monitor_count))
    
    _M.close(red)
    
    if not ok then
        ngx.log(ngx.ERR, "Redis setex capacity failed: ", err)
        return false
    end
    
    return true
end

-- 取得所有節點容量
-- Get all node capacities
function _M.get_all_node_capacities()
    if not config.redis.enabled then
        return nil
    end
    
    local red, err = _M.connect()
    if not red then
        return nil
    end
    
    local capacities = {}
    
    red:init_pipeline()
    for i = 1, config.cluster.node_count do
        local key = "kuma:node:capacity:node" .. i
        red:get(key)
    end
    
    local results, err = red:commit_pipeline()
    
    _M.close(red)
    
    if not results then
        return nil
    end
    
    for i, res in ipairs(results) do
        local node_id = "node" .. i
        if res and res ~= ngx.null then
            capacities[node_id] = tonumber(res)
        end
    end
    
    return capacities
end

-- ============================================================
-- 工具函數 (Utility Functions)
-- ============================================================

-- 清除所有快取
-- Clear all cache
function _M.flush_all()
    if not config.redis.enabled then
        return false
    end
    
    local red, err = _M.connect()
    if not red then
        return false
    end
    
    -- 只刪除 kuma: 前綴的 key，不影響其他應用
    local cursor = "0"
    repeat
        local res, err = red:scan(cursor, "MATCH", "kuma:*", "COUNT", 100)
        if res then
            cursor = res[1]
            local keys = res[2]
            if #keys > 0 then
                red:del(unpack(keys))
            end
        else
            break
        end
    until cursor == "0"
    
    _M.close(red)
    
    ngx.log(ngx.INFO, "Redis cache flushed")
    return true
end

-- 健康檢查
-- Health check
function _M.ping()
    if not config.redis.enabled then
        return false, "Redis is disabled"
    end
    
    local red, err = _M.connect()
    if not red then
        return false, err
    end
    
    local res, err = red:ping()
    
    _M.close(red)
    
    if not res or res ~= "PONG" then
        return false, err or "ping failed"
    end
    
    return true, "PONG"
end

-- 取得 Redis 統計資訊
-- Get Redis statistics
function _M.get_stats()
    if not config.redis.enabled then
        return nil, "Redis is disabled"
    end
    
    local red, err = _M.connect()
    if not red then
        return nil, err
    end
    
    local info, err = red:info("stats")
    
    _M.close(red)
    
    if not info then
        return nil, err
    end
    
    return info
end

return _M
