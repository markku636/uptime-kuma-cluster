local _M = {}

-- 資料庫連接配置
local DB_CONFIG = {
    host = os.getenv("DB_HOST") or "mariadb",
    port = tonumber(os.getenv("DB_PORT")) or 3306,
    user = os.getenv("DB_USER") or "kuma",
    password = os.getenv("DB_PASSWORD") or "kuma_pass",
    database = os.getenv("DB_NAME") or "kuma"
}

-- 調試配置
local DEBUG_CONFIG = {
    enabled = os.getenv("EMMY_DEBUG_ENABLED") == "true",
    host = os.getenv("EMMY_DEBUG_HOST") or "0.0.0.0",
    port = tonumber(os.getenv("EMMY_DEBUG_PORT")) or 9966,
    log_level = os.getenv("DEBUG_LOG_LEVEL") or "INFO"
}

-- 調試日誌分類函數
local function debug_log(category, level, message, ...)
    if not DEBUG_CONFIG.enabled then
        return
    end
    
    local formatted_message = string.format(message, ...)
    local timestamp = os.date("%Y-%m-%d %H:%M:%S")
    
    -- 根據類別選擇不同的日誌格式
    if category == "HEALTH_CHECK" then
        ngx.log(ngx.DEBUG, "🔍 [HEALTH_CHECK] ", formatted_message)
    elseif category == "DATABASE" then
        ngx.log(ngx.DEBUG, "🗄️ [DATABASE] ", formatted_message)
    elseif category == "NETWORK" then
        ngx.log(ngx.DEBUG, "🌐 [NETWORK] ", formatted_message)
    elseif category == "SYSTEM" then
        ngx.log(ngx.DEBUG, "⚙️ [SYSTEM] ", formatted_message)
    else
        ngx.log(ngx.DEBUG, "🔍 [DEBUG] ", formatted_message)
    end
end

-- 健康檢查調試日誌
local function health_check_debug_log(message, ...)
    debug_log("HEALTH_CHECK", "DEBUG", message, ...)
end

-- 資料庫調試日誌
local function database_debug_log(message, ...)
    debug_log("DATABASE", "DEBUG", message, ...)
end

-- 網路調試日誌
local function network_debug_log(message, ...)
    debug_log("NETWORK", "DEBUG", message, ...)
end

-- 系統調試日誌
local function system_debug_log(message, ...)
    debug_log("SYSTEM", "DEBUG", message, ...)
end

-- 共享記憶體區域
local health_checker = ngx.shared.health_checker

--[[
  啟動Emmy調試器
  @param conf table - 調試配置對象
]]
local function start_emmy_debugger(conf)
    ngx.log(ngx.NOTICE, "🔧 Debug模式已啟用，嘗試啟動Emmy debugger...")
    
    local success, dbg = pcall(require, "emmy_core")
    if not success then
        ngx.log(ngx.ERR, "❌ Emmy debugger載入失敗: ", dbg)
        ngx.log(ngx.ERR, "請確認emmy_core模組是否已正確安裝")
        return false
    end
    
    ngx.log(ngx.NOTICE, "✅ Emmy debugger模組載入成功")
    
    -- 嘗試啟動TCP監聽
    local listen_success, listen_err = pcall(function()
        dbg.tcpListen(conf.host, conf.port)
        ngx.log(ngx.NOTICE, "🔗 Emmy debugger TCP監聽已啟動 (", conf.host, ":", conf.port, ")")
    end)
    
    if not listen_success then
        ngx.log(ngx.ERR, "❌ TCP監聽啟動失敗: ", listen_err)
        return false
    end
    
    -- 等待IDE連接（設置超時避免無限等待）
    ngx.log(ngx.NOTICE, "⏳ 等待IDE連接... (請在你的IDE中連接到debugger)")
    
    local wait_success, wait_err = pcall(function()
        dbg.waitIDE()
        ngx.log(ngx.NOTICE, "🎯 IDE已連接，設置斷點")
        dbg.breakHere()
        ngx.log(ngx.NOTICE, "🚀 已執行breakHere()，debugging開始")
    end)
    
    if not wait_success then
        ngx.log(ngx.ERR, "❌ IDE等待或斷點設置失敗: ", wait_err)
        return false
    end
    
    return true
end

-- 初始化健康檢查器
function _M.init()
    if not health_checker then
        ngx.log(ngx.ERR, "health_checker shared dict not found")
        return false
    end
    
    -- 初始化計數器
    health_checker:set("check_count", 0)
    health_checker:set("last_check", 0)
    health_checker:set("success_count", 0)
    health_checker:set("fail_count", 0)
    
    ngx.log(ngx.INFO, "Health checker initialized")
    
    -- 注意：調試器啟動已移到 init_worker_by_lua 階段
    if DEBUG_CONFIG.enabled then
        ngx.log(ngx.INFO, "🔧 調試模式已啟用，調試器將在工作器階段啟動")
    end
    
    return true
end

-- 檢查單個節點的健康狀態
function _M.check_node_health(ip, port)
    -- 調試斷點
    if DEBUG_CONFIG.enabled then
        network_debug_log("開始檢查節點 %s:%s", ip, (port or 3001))
    end
    
    local http = require "resty.http"
    local httpc = http.new()
    
    -- 設定超時
    httpc:set_timeout(5000)
    
    -- 嘗試連接
    local ok, err = httpc:connect(ip, port or 3001)
    if not ok then
        ngx.log(ngx.WARN, "Failed to connect to ", ip, ":", (port or 3001), ": ", err)
        if DEBUG_CONFIG.enabled then
            network_debug_log("連接失敗，錯誤: %s", err)
        end
        return false, "connection_failed"
    end
    
    -- 發送 HTTP 請求
    local res, err = httpc:request({
        path = "/health",
        method = "GET"
    })
    
    if not res then
        ngx.log(ngx.WARN, "Failed to request from ", ip, ":", (port or 3001), ": ", err)
        if DEBUG_CONFIG.enabled then
            network_debug_log("請求失敗，錯誤: %s", err)
        end
        return false, "request_failed"
    end
    
    -- 檢查狀態碼
    if res.status == 200 then
        ngx.log(ngx.INFO, "Node ", ip, ":", (port or 3001), " is healthy")
        if DEBUG_CONFIG.enabled then
            network_debug_log("節點健康，狀態碼: %s", res.status)
        end
        return true, "healthy"
    else
        ngx.log(ngx.WARN, "Node ", ip, ":", (port or 3001), " returned status: ", res.status)
        if DEBUG_CONFIG.enabled then
            network_debug_log("節點不健康，狀態碼: %s", res.status)
        end
        return false, "unhealthy"
    end
end

-- 從資料庫獲取所有節點
function _M.get_all_nodes()
    if DEBUG_CONFIG.enabled then
        database_debug_log("開始從資料庫獲取節點列表")
    end
    
    local mysql = require "resty.mysql"
    local db, err = mysql:new()
    
    if not db then
        ngx.log(ngx.ERR, "Failed to create MySQL connection: ", err)
        if DEBUG_CONFIG.enabled then
            ngx.log(ngx.DEBUG, "🔍 調試: MySQL連接創建失敗: ", err)
        end
        return nil, err
    end
    
    -- 設定超時
    db:set_timeout(5000)
    
    -- 連接到資料庫
    local ok, err = db:connect(DB_CONFIG)
    if not ok then
        ngx.log(ngx.ERR, "Failed to connect to database: ", err)
        if DEBUG_CONFIG.enabled then
            database_debug_log("資料庫連接失敗: %s", err)
        end
        return nil, err
    end
    
    -- 查詢所有節點
    local sql = "SELECT node_id, node_name, ip, status, last_seen FROM node"
    local res, err = db:query(sql)
    
    if not res then
        ngx.log(ngx.ERR, "Failed to query nodes: ", err)
        if DEBUG_CONFIG.enabled then
            database_debug_log("節點查詢失敗: %s", err)
        end
        db:close()
        return nil, err
    end
    
    db:close()
    
    if DEBUG_CONFIG.enabled then
        database_debug_log("成功獲取 %d 個節點", #res)
    end
    
    return res
end

-- 更新節點狀態
function _M.update_node_status(node_id, status, is_online)
    if DEBUG_CONFIG.enabled then
        database_debug_log("更新節點 %s 狀態為 %s", node_id, status)
    end
    
    local mysql = require "resty.mysql"
    local db, err = mysql:new()
    
    if not db then
        ngx.log(ngx.ERR, "Failed to create MySQL connection: ", err)
        if DEBUG_CONFIG.enabled then
            database_debug_log("MySQL連接創建失敗: %s", err)
        end
        return false, err
    end
    
    -- 設定超時
    db:set_timeout(5000)
    
    -- 連接到資料庫
    local ok, err = db:connect(DB_CONFIG)
    if not ok then
        ngx.log(ngx.ERR, "Failed to connect to database: ", err)
        if DEBUG_CONFIG.enabled then
            database_debug_log("資料庫連接失敗: %s", err)
        end
        return false, err
    end
    
    -- 更新節點狀態
    local current_time = os.date("%Y-%m-%d %H:%M:%S")
    local sql = string.format([[
        UPDATE node 
        SET status = '%s', 
            last_seen = '%s',
            modified_date = NOW()
        WHERE node_id = '%s'
    ]], status, current_time, node_id)
    
    local res, err = db:query(sql)
    
    if not res then
        ngx.log(ngx.ERR, "Failed to update node status: ", err)
        if DEBUG_CONFIG.enabled then
            database_debug_log("狀態更新失敗: %s", err)
        end
        db:close()
        return false, err
    end
    
    db:close()
    ngx.log(ngx.INFO, "Updated node ", node_id, " status to ", status)
    
    if DEBUG_CONFIG.enabled then
        database_debug_log("節點狀態更新成功")
    end
    
    return true
end

-- 執行健康檢查
function _M.run_health_check()
    local check_count = health_checker:incr("check_count", 1)
    local current_time = os.time()
    
    ngx.log(ngx.INFO, "Starting health check #", check_count)
    
    if DEBUG_CONFIG.enabled then
        health_check_debug_log("開始執行健康檢查 #%d", check_count)
    end
    
    -- 獲取所有節點
    local nodes, err = _M.get_all_nodes()
    if not nodes then
        ngx.log(ngx.ERR, "Failed to get nodes: ", err)
        if DEBUG_CONFIG.enabled then
            health_check_debug_log("獲取節點失敗，錯誤: %s", err)
        end
        return false
    end
    
    local success_count = 0
    local fail_count = 0
    
    -- 檢查每個節點
    for _, node in ipairs(nodes) do
        local node_id = node.node_id
        local ip = node.ip
        local port = nil
        local current_status = node.status
        
        if DEBUG_CONFIG.enabled then
            health_check_debug_log("檢查節點 %s (%s:%s) 當前狀態: %s", node_id, ip, (port or 3001), current_status)
        end
        
        if ip then
            local is_healthy, reason = _M.check_node_health(ip, port)
            
            if is_healthy then
                -- 節點健康，更新為 online
                if current_status ~= "online" then
                    _M.update_node_status(node_id, "online", true)
                end
                success_count = success_count + 1
                if DEBUG_CONFIG.enabled then
                    health_check_debug_log("節點 %s 健康檢查成功", node_id)
                end
            else
                -- 節點不健康，更新為 offline
                if current_status ~= "offline" then
                    _M.update_node_status(node_id, "offline", false)
                end
                fail_count = fail_count + 1
                if DEBUG_CONFIG.enabled then
                    health_check_debug_log("節點 %s 健康檢查失敗，原因: %s", node_id, reason)
                end
            end
        else
            ngx.log(ngx.WARN, "Node ", node_id, " has no IP address")
            if DEBUG_CONFIG.enabled then
                health_check_debug_log("節點 %s 沒有IP地址", node_id)
            end
        end
    end
    
    -- 更新統計資訊
    health_checker:set("last_check", current_time)
    health_checker:set("success_count", success_count)
    health_checker:set("fail_count", fail_count)
    
    ngx.log(ngx.INFO, "Health check completed. Online: ", success_count, ", Offline: ", fail_count)
    
    if DEBUG_CONFIG.enabled then
        health_check_debug_log("健康檢查完成，成功: %d, 失敗: %d", success_count, fail_count)
    end
    
    return true
end

-- 獲取健康檢查統計
function _M.get_statistics()
    if not health_checker then
        return {}
    end
    
    local stats = {
        check_count = health_checker:get("check_count") or 0,
        last_check = health_checker:get("last_check") or 0,
        success_count = health_checker:get("success_count") or 0,
        fail_count = health_checker:get("fail_count") or 0,
        debug_enabled = DEBUG_CONFIG.enabled,
        debug_host = DEBUG_CONFIG.host,
        debug_port = DEBUG_CONFIG.port
    }
    
    if DEBUG_CONFIG.enabled then
        system_debug_log("獲取統計資訊: %s", require('cjson').encode(stats))
    end
    
    return stats
end

-- 健康檢查工作器
function _M.health_check_worker()
    ngx.log(ngx.INFO, "🚀 健康檢查工作器開始啟動...")
    
    if DEBUG_CONFIG.enabled then
        system_debug_log("健康檢查工作器已啟動")
        system_debug_log("調試模式已啟用，主機: %s 端口: %d", DEBUG_CONFIG.host, DEBUG_CONFIG.port)
    end
    
    -- 記錄工作器啟動時間
    local start_time = os.time()
    local worker_id = ngx.worker.pid()
    ngx.log(ngx.INFO, "📅 工作器啟動時間: ", os.date("%Y-%m-%d %H:%M:%S", start_time), " (Worker PID: ", worker_id, ")")
    
    -- 初始化循環計數器
    local loop_count = 0
    local last_success_time = 0
    
    ngx.log(ngx.INFO, "🔄 開始健康檢查循環...")
    
    while true do
        loop_count = loop_count + 1
        local current_time = os.time()
        local loop_start_time = os.time()
        
        ngx.log(ngx.INFO, "🔄 健康檢查循環 #", loop_count, " 開始 (", os.date("%H:%M:%S", current_time), ")")
        
        if DEBUG_CONFIG.enabled then
            health_check_debug_log("循環 #%d 開始，當前時間: %d", loop_count, current_time)
            health_check_debug_log("距離上次成功檢查: %d 秒", (current_time - last_success_time))
        end
        
        -- 執行健康檢查
        local ok, err = pcall(_M.run_health_check)
        local check_duration = os.time() - loop_start_time
        
        if ok then
            ngx.log(ngx.INFO, "✅ 健康檢查循環 #", loop_count, " 執行成功，耗時: ", check_duration, " 秒")
            last_success_time = current_time
            
            if DEBUG_CONFIG.enabled then
                ngx.log(ngx.DEBUG, "🔍 調試: 健康檢查執行成功，循環 #", loop_count)
                ngx.log(ngx.DEBUG, "🔍 調試: 執行耗時: ", check_duration, " 秒")
            end
        else
            ngx.log(ngx.ERR, "❌ 健康檢查循環 #", loop_count, " 執行失敗，錯誤: ", err)
            ngx.log(ngx.ERR, "❌ 執行耗時: ", check_duration, " 秒")
            
            if DEBUG_CONFIG.enabled then
                ngx.log(ngx.DEBUG, "🔍 調試: 健康檢查執行失敗，循環 #", loop_count)
                ngx.log(ngx.DEBUG, "🔍 調試: 錯誤詳情: ", err)
                ngx.log(ngx.DEBUG, "🔍 調試: 執行耗時: ", check_duration, " 秒")
            end
        end
        
        -- 記錄循環統計
        if loop_count % 10 == 0 then
            local uptime = current_time - start_time
            local avg_duration = uptime / loop_count
            ngx.log(ngx.INFO, "📊 循環統計 - 總循環: ", loop_count, ", 運行時間: ", uptime, " 秒, 平均耗時: ", avg_duration, " 秒")
            
            if DEBUG_CONFIG.enabled then
                ngx.log(ngx.DEBUG, "🔍 調試: 統計資訊 - 循環: ", loop_count, ", 運行時間: ", uptime, ", 平均耗時: ", avg_duration)
            end
        end
        
        -- 等待30秒
        ngx.log(ngx.INFO, "⏳ 等待30秒後進行下一次檢查... (循環 #", loop_count, ")")
        
        if DEBUG_CONFIG.enabled then
            ngx.log(ngx.DEBUG, "🔍 調試: 等待30秒後進行下一次檢查...")
            ngx.log(ngx.DEBUG, "🔍 調試: 當前循環: ", loop_count, ", 下次檢查時間: ", os.date("%H:%M:%S", current_time + 30))
        end
        
        -- 使用 ngx.sleep 等待
        local sleep_start = os.time()
        ngx.sleep(30)
        local actual_sleep_time = os.time() - sleep_start
        
        if DEBUG_CONFIG.enabled then
            ngx.log(ngx.DEBUG, "🔍 調試: 睡眠完成，實際睡眠時間: ", actual_sleep_time, " 秒")
        end
        
        -- 檢查睡眠時間是否異常
        if actual_sleep_time < 25 or actual_sleep_time > 35 then
            ngx.log(ngx.WARN, "⚠️ 睡眠時間異常: 預期30秒，實際 ", actual_sleep_time, " 秒")
        end
        
        ngx.log(ngx.INFO, "⏰ 睡眠完成，準備開始下一次循環...")
    end
end

-- 獲取調試配置
function _M.get_debug_config()
    return DEBUG_CONFIG
end

-- 手動啟動調試器
function _M.start_debugger()
    if DEBUG_CONFIG.enabled then
        return start_emmy_debugger(DEBUG_CONFIG)
    else
        ngx.log(ngx.WARN, "Debug mode is not enabled")
        return false
    end
end

return _M
