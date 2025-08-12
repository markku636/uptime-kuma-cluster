-- lua/health_check.lua - OpenResty 健康檢查和故障轉移模組
local cjson = require "cjson"
local mysql = require "resty.mysql"

-- 共享記憶體區域
local health_checker = ngx.shared.health_checker
local fault_detector = ngx.shared.fault_detector

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
    
    -- 設置連接超時
    db:set_timeout(5000)
    
    -- 連接到資料庫
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
    
    ngx.log(ngx.DEBUG, "節點心跳已發送: ", node_id, " (", current_time, ")")
    
    db:close()
    return true
end

-- 檢查節點狀態並處理故障轉移
local function check_nodes_and_handle_failover()
    local db = get_db_connection()
    if not db then
        return false
    end
    
    local current_time = os.time()
    local heartbeat_timeout = 120  -- 2分鐘內沒有心跳就認為節點離線
    
    -- 檢查離線節點
    local offline_nodes_sql = "SELECT node_id FROM node WHERE last_heartbeat < ? AND status = 'online'"
    local offline_nodes, err = db:query(offline_nodes_sql, {current_time - heartbeat_timeout})
    
    if offline_nodes then
        for _, node in ipairs(offline_nodes) do
            -- 標記節點為離線
            local update_sql = "UPDATE node SET status = 'offline' WHERE node_id = ?"
            db:query(update_sql, {node.node_id})
            
            ngx.log(ngx.WARN, "節點標記為離線: ", node.node_id)
            
            -- 處理故障轉移
            handle_node_failover(db, node.node_id)
        end
    end
    
    -- 檢查節點恢復
    check_for_node_recovery(db)
    
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
    
    -- 使用智能分配策略
    local node_loads = get_node_monitor_counts(db, online_nodes)
    local reassignments = 0
    
    for _, monitor in ipairs(affected_monitors) do
        -- 選擇負載最輕的節點
        local target_node = select_least_loaded_node(node_loads)
        if target_node then
            local update_sql = "UPDATE monitor SET assigned_node = ? WHERE id = ?"
            db:query(update_sql, {target_node, monitor.id})
            
            -- 更新負載計數
            node_loads[target_node] = (node_loads[target_node] or 0) + 1
            reassignments = reassignments + 1
            
            ngx.log(ngx.INFO, "轉移監控器 \"", monitor.name, "\" (ID: ", monitor.id, ") 從 ", failed_node_id, " 到 ", target_node)
        end
    end
    
    ngx.log(ngx.INFO, "節點故障轉移完成: ", failed_node_id, "，重新分配了 ", reassignments, " 個監控器")
end

-- 獲取節點的監控器數量
local function get_node_monitor_counts(db, nodes)
    local counts = {}
    
    for _, node in ipairs(nodes) do
        local count_sql = "SELECT COUNT(*) as count FROM monitor WHERE assigned_node = ? OR (assigned_node IS NULL AND node_id = ?)"
        local count_result, err = db:query(count_sql, {node.node_id, node.node_id})
        
        if count_result and count_result[1] then
            counts[node.node_id] = tonumber(count_result[1].count) or 0
        else
            counts[node.node_id] = 0
        end
    end
    
    return counts
end

-- 選擇負載最輕的節點
local function select_least_loaded_node(node_loads)
    local min_load = math.huge
    local selected_node = nil
    
    for node_id, load in pairs(node_loads) do
        if load < min_load then
            min_load = load
            selected_node = node_id
        end
    end
    
    return selected_node
end

-- 檢查節點恢復並觸發重新平衡
local function check_for_node_recovery()
    local db = get_db_connection()
    if not db then
        return
    end
    
    local all_nodes_sql = "SELECT node_id, status FROM node"
    local all_nodes, err = db:query(all_nodes_sql)
    
    if not all_nodes then
        db:close()
        return
    end
    
    local online_nodes = {}
    for _, node in ipairs(all_nodes) do
        if node.status == "online" then
            table.insert(online_nodes, node)
        end
    end
    
    if #online_nodes <= 1 then
        db:close()
        return
    end
    
    -- 檢查是否需要觸發重新平衡
    local should_rebalance = should_trigger_rebalancing(db, online_nodes)
    
    if should_rebalance then
        ngx.log(ngx.INFO, "由於節點變化觸發監控器重新平衡")
        rebalance_monitors(db, online_nodes)
    end
    
    db:close()
end

-- 檢查是否應該觸發重新平衡
local function should_trigger_rebalancing(db, online_nodes)
    -- 檢查是否有未分配的監控器
    local unassigned_count_sql = "SELECT COUNT(*) as count FROM monitor WHERE assigned_node IS NULL AND (node_id IS NULL OR node_id = '')"
    local unassigned_result, err = db:query(unassigned_count_sql)
    
    if unassigned_result and unassigned_result[1] and unassigned_result[1].count > 0 then
        ngx.log(ngx.INFO, "發現 ", unassigned_result[1].count, " 個未分配的監控器，觸發重新平衡")
        return true
    end
    
    -- 檢查監控器分佈是否不平衡
    local monitor_counts = get_node_monitor_counts(db, online_nodes)
    
    local counts = {}
    for _, count in pairs(monitor_counts) do
        table.insert(counts, count)
    end
    
    if #counts == 0 then
        return false
    end
    
    local max_count = math.max(table.unpack(counts))
    local min_count = math.min(table.unpack(counts))
    local avg_count = 0
    
    for _, count in ipairs(counts) do
        avg_count = avg_count + count
    end
    avg_count = avg_count / #counts
    
    -- 如果最大值和最小值的差異 > 平均值的 30%，觸發重新平衡
    local imbalance_threshold = avg_count * 0.3
    if max_count - min_count > imbalance_threshold and avg_count > 2 then
        ngx.log(ngx.INFO, "檢測到監控器分佈不平衡 (max: ", max_count, ", min: ", min_count, ", avg: ", string.format("%.1f", avg_count), ")，觸發重新平衡")
        return true
    end
    
    return false
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
    
    -- 使用智能分配策略
    local node_loads = {}
    for _, node in ipairs(online_nodes) do
        node_loads[node.node_id] = 0
    end
    
    local reassignments = 0
    
    for _, monitor in ipairs(all_monitors) do
        -- 選擇負載最輕的節點
        local target_node = select_least_loaded_node(node_loads)
        local effective_node = monitor.assigned_node or monitor.node_id or nil
        
        -- 只有當分配與有效節點不同時才更新
        if effective_node ~= target_node then
            local update_sql = "UPDATE monitor SET assigned_node = ? WHERE id = ?"
            db:query(update_sql, {target_node, monitor.id})
            reassignments = reassignments + 1
            
            -- 更新負載計數
            node_loads[target_node] = node_loads[target_node] + 1
            
            ngx.log(ngx.DEBUG, "重新分配監控器 \"", monitor.name, "\" (ID: ", monitor.id, ") 從 ", (effective_node or "unassigned"), " 到 ", target_node)
        else
            -- 更新負載計數（即使沒有重新分配）
            if target_node then
                node_loads[target_node] = node_loads[target_node] + 1
            end
        end
    end
    
    if reassignments > 0 then
        ngx.log(ngx.INFO, "重新平衡完成，重新分配了 ", reassignments, " 個監控器")
    else
        ngx.log(ngx.INFO, "不需要重新分配監控器 - 分佈已經最優")
    end
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
    
    rebalance_monitors(db, online_nodes)
    db:close()
    
    return true
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
        timestamp = os.time()
    }
end

-- 導出函數
return {
    send_heartbeat = send_heartbeat,
    check_nodes_and_handle_failover = check_nodes_and_handle_failover,
    trigger_manual_rebalancing = trigger_manual_rebalancing,
    get_node_status_overview = get_node_status_overview
}
