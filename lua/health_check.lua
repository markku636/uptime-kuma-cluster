-- lua/health_check.lua - OpenResty 健康檢查、故障檢測和故障轉移模組
local cjson = require "cjson"
local mysql = require "resty.mysql"
local http = require "resty.http"

-- 共享記憶體區域
local health_checker = ngx.shared.health_checker
local fault_detector = ngx.shared.fault_detector

-- 配置參數
local CONFIG = {
    heartbeat_interval = 60,        -- 心跳間隔（秒）
    health_check_interval = 60,     -- 健康檢查間隔（秒）
    fault_scan_interval = 10,       -- 故障掃描間隔（秒）
    failure_threshold = 3,          -- 失敗閾值（次數）
    failure_timeout = 120,          -- 失敗超時（秒）
    recovery_timeout = 300          -- 恢復超時（秒）
}

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

-- 發送節點心跳
local function send_heartbeat(node_id)
    local db = get_db_connection()
    if not db then
        return false
    end
    
    local current_time = os.time()
    local ip = os.getenv("UPTIME_KUMA_NODE_IP") or "127.0.0.1"
    
    -- 更新或插入節點狀態
    local upsert_sql = [[
        INSERT INTO node (node_id, ip, status, last_heartbeat, created_at, updated_at) 
        VALUES (?, ?, 'online', ?, NOW(), NOW())
        ON DUPLICATE KEY UPDATE 
            ip = VALUES(ip),
            status = 'online',
            last_heartbeat = VALUES(last_heartbeat),
            updated_at = NOW()
    ]]
    
    local ok, err = db:query(upsert_sql, {node_id, ip, current_time})
    if not ok then
        ngx.log(ngx.ERR, "更新節點心跳失敗: ", err)
        db:close()
        return false
    end
    
    -- 更新共享記憶體中的最後心跳時間
    health_checker:set("last_heartbeat", current_time)
    health_checker:set("heartbeat_count", (health_checker:get("heartbeat_count") or 0) + 1)
    
    ngx.log(ngx.DEBUG, "節點心跳已發送: ", node_id, " (", current_time, ")")
    
    db:close()
    return true
end

-- 主動健康檢查節點
local function perform_health_check(node_id, node_ip)
    local httpc = http.new()
    httpc:set_timeout(5000)
    
    local url = string.format("http://%s:3001/health", node_ip)
    local res, err = httpc:request_uri(url, {
        method = "GET",
        headers = {
            ["User-Agent"] = "OpenResty-Health-Check"
        }
    })
    
    if not res then
        ngx.log(ngx.WARN, "節點健康檢查失敗: ", node_id, " - ", (err or "connection failed"))
        return false
    end
    
    local is_healthy = res.status == 200
    ngx.log(ngx.DEBUG, "節點健康檢查: ", node_id, " - 狀態: ", res.status, " 健康: ", is_healthy)
    
    return is_healthy
end

-- 掃描所有節點並執行故障檢測/恢復檢查
local function scan_all_nodes()
    local function list_nodes()
        local db = get_db_connection()
        if not db then
            ngx.log(ngx.ERR, "創建 MySQL 連接失敗")
            return {}
        end

        local sql = "SELECT node_id, ip, status FROM node"
        local res, err = db:query(sql)
        db:close()

        if not res then
            ngx.log(ngx.ERR, "查詢節點清單失敗: ", err)
            return {}
        end
        return res
    end

    local summary = { checked = 0, failed = 0, recovered = 0 }
    local nodes = list_nodes()
    
    for _, n in ipairs(nodes) do
        summary.checked = summary.checked + 1
        
        -- 檢查節點狀態變化
        if n.status == 'offline' then
            -- 檢查離線節點是否應該恢復
            local recovery_start = fault_detector:get("recovery_start_" .. n.node_id) or 0
            local current_time = os.time()
            
            if current_time - recovery_start >= CONFIG.recovery_timeout then
                -- 標記為恢復中，同時更新 last_heartbeat
                local db = get_db_connection()
                if db then
                    local sql = "UPDATE node SET status = 'recovering', last_heartbeat = ? WHERE node_id = ?"
                    db:query(sql, {current_time, n.node_id})
                    db:close()
                    
                    summary.recovered = summary.recovered + 1
                    ngx.log(ngx.INFO, "節點 ", n.node_id, " 開始恢復流程，時間: ", current_time)
                end
            end
        elseif n.status == 'recovering' then
            -- 檢查恢復中的節點是否完成恢復
            local recovery_start = fault_detector:get("recovery_start_" .. n.node_id) or 0
            local current_time = os.time()
            
            if current_time - recovery_start >= CONFIG.recovery_timeout then
                -- 標記為在線，同時更新 last_heartbeat
                local db = get_db_connection()
                if db then
                    local sql = "UPDATE node SET status = 'online', last_heartbeat = ? WHERE node_id = ?"
                    db:query(sql, {current_time, n.node_id})
                    db:close()
                    
                    -- 清理恢復計時器
                    fault_detector:set("recovery_start_" .. n.node_id, 0)
                    
                    ngx.log(ngx.INFO, "節點 ", n.node_id, " 恢復完成，時間: ", current_time)
                end
            end
        end
    end

    if fault_detector then
        fault_detector:set("last_cycle", ngx.time())
        fault_detector:set("last_summary", cjson.encode(summary))
        fault_detector:set("scan_count", (fault_detector:get("scan_count") or 0) + 1)
    end

    return summary
end

-- 檢查節點狀態並處理故障轉移
local function check_nodes_and_handle_failover()
    local db = get_db_connection()
    if not db then
        return false
    end
    
    local current_time = os.time()
    
    -- 獲取所有節點
    local nodes_sql = "SELECT node_id, ip, status, last_heartbeat FROM node ORDER BY node_id"
    local nodes, err = db:query(nodes_sql)
    
    if not nodes then
        ngx.log(ngx.ERR, "查詢節點失敗: ", err)
        db:close()
        return false
    end
    
    local offline_nodes = {}
    local recovering_nodes = {}
    
    for _, node in ipairs(nodes) do
        if node.status == 'online' then
            -- 檢查在線節點的健康狀態
            local is_healthy = perform_health_check(node.node_id, node.ip)
            
            if not is_healthy then
                -- 增加失敗計數
                local failure_key = "failure_count_" .. node.node_id
                local failure_count = fault_detector:get(failure_key) or 0
                failure_count = failure_count + 1
                fault_detector:set(failure_key, failure_count)
                
                ngx.log(ngx.WARN, "節點健康檢查失敗: ", node.node_id, " 失敗次數: ", failure_count)
                
                -- 如果達到失敗閾值，標記為離線
                if failure_count >= CONFIG.failure_threshold then
                    local update_sql = "UPDATE node SET status = 'offline' WHERE node_id = ?"
                    db:query(update_sql, {node.node_id})
                    
                    table.insert(offline_nodes, node)
                    ngx.log(ngx.ERR, "節點標記為離線: ", node.node_id)
                    
                    -- 重置失敗計數
                    fault_detector:set(failure_key, 0)
                end
            else
                -- 健康檢查成功，重置失敗計數並更新 last_heartbeat
                local failure_key = "failure_count_" .. node.node_id
                fault_detector:set(failure_key, 0)
                
                -- 更新節點的 last_heartbeat
                local heartbeat_sql = "UPDATE node SET last_heartbeat = ? WHERE node_id = ?"
                local ok, err = db:query(heartbeat_sql, {current_time, node.node_id})
                if not ok then
                    ngx.log(ngx.ERR, "更新節點心跳失敗: ", node.node_id, " - ", (err or "unknown error"))
                else
                    ngx.log(ngx.DEBUG, "節點健康檢查成功，更新心跳: ", node.node_id, " 時間: ", current_time)
                end
            end
        elseif node.status == 'offline' then
            -- 檢查離線節點是否恢復
            local is_healthy = perform_health_check(node.node_id, node.ip)
            if is_healthy then
                -- 更新節點狀態為恢復中，同時更新 last_heartbeat
                local update_sql = "UPDATE node SET status = 'recovering', last_heartbeat = ? WHERE node_id = ?"
                local ok, err = db:query(update_sql, {current_time, node.node_id})
                if not ok then
                    ngx.log(ngx.ERR, "更新節點恢復狀態失敗: ", node.node_id, " - ", (err or "unknown error"))
                else
                    table.insert(recovering_nodes, node)
                    ngx.log(ngx.INFO, "節點開始恢復: ", node.node_id, " 時間: ", current_time)
                end
                
                -- 設置恢復計時器
                fault_detector:set("recovery_start_" .. node.node_id, current_time)
            end
        elseif node.status == 'recovering' then
            -- 檢查恢復中的節點
            local recovery_start = fault_detector:get("recovery_start_" .. node.node_id) or 0
            if current_time - recovery_start >= CONFIG.recovery_timeout then
                -- 更新節點狀態為在線，同時更新 last_heartbeat
                local update_sql = "UPDATE node SET status = 'online', last_heartbeat = ? WHERE node_id = ?"
                local ok, err = db:query(update_sql, {current_time, node.node_id})
                if not ok then
                    ngx.log(ngx.ERR, "更新節點在線狀態失敗: ", node.node_id, " - ", (err or "unknown error"))
                else
                    ngx.log(ngx.INFO, "節點恢復完成: ", node.node_id, " 時間: ", current_time)
                end
                
                -- 清理恢復計時器
                fault_detector:delete("recovery_start_" .. node.node_id)
            end
        end
    end
    
    -- 處理故障轉移
    if #offline_nodes > 0 then
        for _, node in ipairs(offline_nodes) do
            handle_node_failover(db, node.node_id)
        end
        
        -- 更新故障轉移統計
        health_checker:set("last_failover", current_time)
        health_checker:set("failover_count", (health_checker:get("failover_count") or 0) + 1)
    end
    
    db:close()
    return true
end

-- 處理節點故障轉移
local function handle_node_failover(db, failed_node_id)
    ngx.log(ngx.INFO, "處理節點故障轉移: ", failed_node_id)
    
    -- 獲取受影響的監控器
    local affected_monitors_sql = "SELECT id, name FROM monitor WHERE assigned_node = ? OR (assigned_node IS NULL AND node_id = ?)"
    local affected_monitors, err = db:query(affected_monitors_sql, {failed_node_id, failed_node_id})
    
    if not affected_monitors or #affected_monitors == 0 then
        ngx.log(ngx.INFO, "沒有需要轉移的監控器: ", failed_node_id)
        return
    end
    
    -- 獲取所有在線節點
    local online_nodes_sql = "SELECT node_id FROM node WHERE status = 'online'"
    local online_nodes, err = db:query(online_nodes_sql)
    
    if not online_nodes or #online_nodes == 0 then
        ngx.log(ngx.ERR, "沒有可用的在線節點進行故障轉移！")
        -- 取消分配監控器
        for _, monitor in ipairs(affected_monitors) do
            local unassign_sql = "UPDATE monitor SET assigned_node = NULL WHERE id = ?"
            db:query(unassign_sql, {monitor.id})
        end
        return
    end
    
    ngx.log(ngx.INFO, "將 ", #affected_monitors, " 個監控器從 ", failed_node_id, " 轉移到 ", #online_nodes, " 個可用節點")
    
    -- 簡單的輪詢分配策略
    local node_index = 1
    for _, monitor in ipairs(affected_monitors) do
        local target_node = online_nodes[node_index].node_id
        local update_sql = "UPDATE monitor SET assigned_node = ? WHERE id = ?"
        db:query(update_sql, {target_node, monitor.id})
        
        ngx.log(ngx.INFO, "轉移監控器 \"", monitor.name, "\" (ID: ", monitor.id, ") 從 ", failed_node_id, " 到 ", target_node)
        
        -- 輪詢到下一個節點
        node_index = (node_index % #online_nodes) + 1
    end
    
    ngx.log(ngx.INFO, "節點故障轉移完成: ", failed_node_id, "，重新分配了 ", #affected_monitors, " 個監控器")
end

-- 獲取節點狀態概覽
local function get_node_status_overview()
    local db = get_db_connection()
    if not db then
        return { error = "無法連接資料庫" }
    end
    
    local nodes_sql = [[
        SELECT 
            n.node_id,
            n.ip,
            n.status,
            n.last_heartbeat,
            n.created_at,
            n.updated_at,
            COUNT(m.id) as monitor_count
        FROM node n
        LEFT JOIN monitor m ON n.node_id = m.assigned_node OR (m.assigned_node IS NULL AND m.node_id = n.node_id)
        GROUP BY n.node_id, n.ip, n.status, n.last_heartbeat, n.created_at, n.updated_at
        ORDER BY n.node_id
    ]]
    
    local nodes, err = db:query(nodes_sql)
    if not nodes then
        db:close()
        return { error = "查詢節點失敗: " .. (err or "unknown") }
    end
    
    -- 格式化時間戳
    for _, node in ipairs(nodes) do
        if node.last_heartbeat then
            node.last_heartbeat_formatted = os.date("%Y-%m-%d %H:%M:%S", node.last_heartbeat)
        end
        if node.created_at then
            node.created_at_formatted = os.date("%Y-%m-%d %H:%M:%S", node.created_at)
        end
        if node.updated_at then
            node.updated_at_formatted = os.date("%Y-%m-%d %H:%M:%S", node.updated_at)
        end
    end
    
    db:close()
    
    return {
        nodes = nodes,
        total_nodes = #nodes,
        online_nodes = #nodes > 0 and #nodes or 0,
        timestamp = os.time(),
        config = CONFIG
    }
end

-- 獲取健康檢查統計資訊
local function get_health_check_statistics()
    return {
        last_heartbeat = health_checker:get("last_heartbeat") or 0,
        heartbeat_count = health_checker:get("heartbeat_count") or 0,
        last_failover = health_checker:get("last_failover") or 0,
        failover_count = health_checker:get("failover_count") or 0,
        timestamp = os.time()
    }
end

-- 獲取故障檢測狀態概覽
local function get_fault_detection_status()
    local last_cycle = fault_detector and fault_detector:get("last_cycle") or 0
    local last_summary_json = fault_detector and fault_detector:get("last_summary") or nil
    local last_summary = nil
    
    if last_summary_json then
        local ok, decoded = pcall(cjson.decode, last_summary_json)
        if ok then
            last_summary = decoded
        end
    end
    
    return {
        last_cycle = last_cycle,
        last_summary = last_summary or { checked = 0, failed = 0, recovered = 0 },
        scan_count = fault_detector and fault_detector:get("scan_count") or 0,
        config = CONFIG,
        timestamp = os.time()
    }
end

-- 導出函數
return {
    send_heartbeat = send_heartbeat,
    scan_all_nodes = scan_all_nodes,
    check_nodes_and_handle_failover = check_nodes_and_handle_failover,
    get_node_status_overview = get_node_status_overview,
    get_health_check_statistics = get_health_check_statistics,
    get_fault_detection_status = get_fault_detection_status,
    CONFIG = CONFIG
}
