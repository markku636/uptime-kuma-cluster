-- lua/fault_detection.lua - 故障檢測和恢復
local cjson = require "cjson"
local http = require "resty.http"
local mysql = require "resty.mysql"

-- 共享記憶體區域
local fault_detector = ngx.shared.fault_detector

-- 資料庫連接配置
local db_config = {
    host = os.getenv("DB_HOST") or "mariadb",
    port = os.getenv("DB_PORT") or 3306,
    user = os.getenv("DB_USER") or "kuma",
    password = os.getenv("DB_PASSWORD") or "kuma_pass",
    database = os.getenv("DB_NAME") or "kuma"
}

-- 獲取節點資訊
local function get_node_info(node_id)
    local db, err = mysql:new()
    if not db then
        return nil
    end
    
    db:set_timeout(5000)
    
    local ok, err = db:connect(db_config)
    if not ok then
        return nil
    end
    
    -- 改為讀取 node 表
    local sql = "SELECT * FROM node WHERE node_id = ?"
    local res, err = db:query(sql, {node_id})
    
    db:close()
    
    if res and #res > 0 then
        return res[1]
    end
    
    return nil
end

-- 檢測節點故障
local function detect_node_failure(node_id)
    local node = get_node_info(node_id)
    if not node then
        return false
    end
    
    -- 檢查節點響應性
    local is_responsive = check_node_responsiveness(node)
    if not is_responsive then
        ngx.log(ngx.WARN, "節點 " .. node_id .. " 無響應，標記為故障")
        mark_node_as_failed(node_id)
        return true
    end
    
    return false
end

-- 檢查節點響應性
local function check_node_responsiveness(node)
    local httpc = http.new()
    httpc:set_timeout(5000)
    
    -- node 表沒有 host/port，使用 ip 欄位，port 採用預設 3001
    local res, err = httpc:request_uri("http://" .. (node.ip or "127.0.0.1") .. ":3001/health", {
        method = "GET",
        headers = {
            ["User-Agent"] = "OpenResty-Health-Check"
        }
    })
    
    if not res then
        return false
    end
    
    return res.status == 200
end

-- 標記節點為故障
local function mark_node_as_failed(node_id)
    local db, err = mysql:new()
    if not db then
        ngx.log(ngx.ERR, "創建 MySQL 連接失敗: ", err)
        return
    end
    
    db:set_timeout(5000)
    
    local ok, err = db:connect(db_config)
    if not ok then
        ngx.log(ngx.ERR, "連接資料庫失敗: ", err)
        return
    end
    
    -- 更新節點狀態（改用 node 表，並用離線狀態）
    local sql = "UPDATE node SET status = 'offline' WHERE node_id = ?"
    local res, err = db:query(sql, {node_id})
    
    db:close()
    
    if res then
        ngx.log(ngx.INFO, "節點 " .. node_id .. " 已標記為故障")
    end
end

-- 檢查節點恢復
local function check_node_recovery(node_id)
    local node = get_node_info(node_id)
    if not node then
        return false
    end
    
    if node.status == 'offline' then
        local is_responsive = check_node_responsiveness(node)
        if is_responsive then
            ngx.log(ngx.INFO, "節點 " .. node_id .. " 已恢復，開始復原流程")
            start_recovery_process(node_id)
            return true
        end
    end
    
    return false
end

-- 開始復原流程
local function start_recovery_process(node_id)
    local db, err = mysql:new()
    if not db then
        return
    end
    
    db:set_timeout(5000)
    
    local ok, err = db:connect(db_config)
    if not ok then
        return
    end
    
    -- 更新節點狀態為恢復中（改用 node 表，僅更新狀態）
    local sql = "UPDATE node SET status = 'recovering' WHERE node_id = ?"
    local res, err = db:query(sql, {node_id})
    
    db:close()
    
    if res then
        ngx.log(ngx.INFO, "節點 " .. node_id .. " 復原流程已開始")
    end
end

-- 完成節點恢復
local function complete_node_recovery(node_id)
    local db, err = mysql:new()
    if not db then
        return
    end
    
    db:set_timeout(5000)
    
    local ok, err = db:connect(db_config)
    if not ok then
        return
    end
    
    -- 更新節點狀態為活躍（node 表使用 'online'）
    local sql = "UPDATE node SET status = 'online' WHERE node_id = ?"
    local res, err = db:query(sql, {node_id})
    
    db:close()
    
    if res then
        ngx.log(ngx.INFO, "節點 " .. node_id .. " 恢復完成")
    end
end

return {
    detect_node_failure = detect_node_failure,
    check_node_recovery = check_node_recovery,
    complete_node_recovery = complete_node_recovery,
    -- 以 OpenResty 定時器用法：掃描所有節點並執行故障檢測/恢復檢查
    scan_all_nodes = (function()
        local function list_nodes()
            local db, err = mysql:new()
            if not db then
                ngx.log(ngx.ERR, "創建 MySQL 連接失敗: ", err)
                return {}
            end

            db:set_timeout(5000)

            local ok, err = db:connect(db_config)
            if not ok then
                ngx.log(ngx.ERR, "連接資料庫失敗: ", err)
                return {}
            end

            -- 列出節點（改用 node 表，輸出 ip & 預設 port）
            local sql = "SELECT node_id, ip AS host, status FROM node"
            local res, err = db:query(sql)
            db:close()

            if not res then
                ngx.log(ngx.ERR, "查詢節點清單失敗: ", err)
                return {}
            end
            return res
        end

        return function()
            local summary = { checked = 0, failed = 0, recovered = 0 }
            local nodes = list_nodes()
            for _, n in ipairs(nodes) do
                summary.checked = summary.checked + 1
                if n.status == 'offline' then
                    if check_node_recovery(n.node_id) then
                        summary.recovered = summary.recovered + 1
                    end
                else
                    if detect_node_failure(n.node_id) then
                        summary.failed = summary.failed + 1
                    end
                end
            end

            if fault_detector then
                fault_detector:set("last_cycle", ngx.time())
                fault_detector:set("last_summary", cjson.encode(summary))
            end

            return summary
        end
    end)(),

    -- 查詢最近一次掃描摘要
    get_status_overview = function()
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
            last_summary = last_summary or { checked = 0, failed = 0, recovered = 0 }
        }
    end
}
