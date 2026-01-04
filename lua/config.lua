--[[
  集中配置模組 - 支援 Docker Compose 和 K8s 雙環境
  所有環境變數和預設值集中在這裡管理
]]
local _M = {}

-- ============================================================
-- 環境偵測
-- ============================================================

--- 偵測當前運行環境
--- @return string 'kubernetes' | 'docker-compose' | 'local'
local function detect_environment()
    -- K8s 環境標誌 (KUBERNETES_SERVICE_HOST 是 K8s 自動注入的)
    if os.getenv("KUBERNETES_SERVICE_HOST") or os.getenv("K8S_MODE") == "true" then
        return "kubernetes"
    end
    -- Docker Compose 環境
    if os.getenv("COMPOSE_PROJECT_NAME") then
        return "docker-compose"
    end
    -- 預設為 Docker Compose（向後兼容）
    return "docker-compose"
end

_M.environment = detect_environment()

-- ============================================================
-- 資料庫配置（兩種環境相同）
-- ============================================================

_M.database = {
    host = os.getenv("DB_HOST") or "mariadb",
    port = tonumber(os.getenv("DB_PORT")) or 3306,
    user = os.getenv("DB_USER") or "kuma",
    password = os.getenv("DB_PASSWORD") or "kuma_pass",
    database = os.getenv("DB_NAME") or "kuma",
    timeout = tonumber(os.getenv("DB_TIMEOUT")) or 5000
}

-- ============================================================
-- K8s 專用配置
-- ============================================================

_M.k8s = {
    enabled = (_M.environment == "kubernetes"),
    namespace = os.getenv("K8S_NAMESPACE") or os.getenv("NAMESPACE") or "default",
    headless_service = os.getenv("K8S_HEADLESS_SERVICE") or os.getenv("HEADLESS_SERVICE_NAME") or "uptime-kuma-headless",
    -- CoreDNS 地址（通常不需要指定，使用 /etc/resolv.conf）
    dns_server = os.getenv("K8S_DNS_SERVER") or nil
}

-- ============================================================
-- 集群配置（根據環境調整）
-- ============================================================

_M.cluster = {
    node_count = tonumber(os.getenv("CLUSTER_NODE_COUNT")) or 5,
    monitor_limit_per_node = tonumber(os.getenv("MONITOR_LIMIT_PER_NODE")) or 1000,
    default_port = tonumber(os.getenv("CLUSTER_DEFAULT_PORT")) or 3001,
    
    -- 根據環境決定預設節點
    -- K8s: uptime-kuma-0 (StatefulSet 格式)
    -- Docker Compose: node1 (傳統格式)
    default_node = _M.environment == "kubernetes" and "uptime-kuma-0" or "node1",
    
    -- 節點 Host 前綴
    -- Docker Compose: "uptime-kuma-" -> uptime-kuma-node1
    -- K8s: "" (因為 node_id 就是完整的 pod name，host 從資料庫讀取)
    node_host_prefix = _M.environment == "kubernetes" and "" or (os.getenv("NODE_HOST_PREFIX") or "uptime-kuma-")
}

-- ============================================================
-- DNS 配置（根據環境調整）
-- ============================================================

_M.dns = {
    -- Docker: 127.0.0.11 (Docker 內建 DNS)
    -- K8s: CoreDNS (通常是 10.96.0.10，但建議使用 /etc/resolv.conf)
    servers = _M.environment == "kubernetes"
        and { _M.k8s.dns_server or "10.96.0.10" }
        or { "127.0.0.11" },
    timeout = tonumber(os.getenv("DNS_TIMEOUT")) or 2000,
    retrans = tonumber(os.getenv("DNS_RETRANS")) or 3
}

-- ============================================================
-- 健康檢查配置（兩種環境相同）
-- ============================================================

_M.health_check = {
    interval = tonumber(os.getenv("HEALTH_CHECK_INTERVAL")) or 30,
    timeout = tonumber(os.getenv("HEALTH_CHECK_TIMEOUT")) or 5000,
    consecutive_failures_threshold = 3,
    consecutive_success_threshold = 3
}

-- ============================================================
-- Cookie 配置（兩種環境相同）
-- ============================================================

_M.cookie = {
    fixed_node_name = "KUMA_FIXED_NODE",
    fixed_node_expires = 604800  -- 7 天
}

-- ============================================================
-- 快取配置（兩種環境相同）
-- ============================================================

_M.cache = {
    monitor_routing_ttl = 300  -- 5 分鐘
}

-- ============================================================
-- 調試配置
-- ============================================================

_M.debug = {
    enabled = os.getenv("EMMY_DEBUG_ENABLED") == "true",
    host = os.getenv("EMMY_DEBUG_HOST") or "0.0.0.0",
    port = tonumber(os.getenv("EMMY_DEBUG_PORT")) or 9966,
    log_level = os.getenv("DEBUG_LOG_LEVEL") or "INFO"
}

-- ============================================================
-- 輔助函數
-- ============================================================

--- 偵測 node_id 格式
--- @param node_id string
--- @return string 'k8s-statefulset' | 'docker-compose' | 'custom'
function _M.detect_node_id_format(node_id)
    if not node_id then return "custom" end
    
    -- K8s StatefulSet: xxx-0, xxx-1, uptime-kuma-0
    if node_id:match("^[%w%-]+%-(%d+)$") then
        return "k8s-statefulset"
    end
    
    -- Docker Compose: node1, node2
    if node_id:match("^node%d+$") then
        return "docker-compose"
    end
    
    return "custom"
end

--- 根據 node_id 構建完整的 host 地址
--- @param node_id string 節點 ID（如 "node1" 或 "uptime-kuma-0"）
--- @return string host 完整的 host:port 地址
function _M.build_node_host(node_id)
    if not node_id then
        return nil
    end
    
    local port = _M.cluster.default_port
    
    if _M.environment == "kubernetes" then
        -- K8s: <pod-name>.<headless-service>.<namespace>.svc.cluster.local:port
        -- 如果 node_id 已經包含 "."，假設是完整 FQDN
        if node_id:find("%.") then
            return node_id .. ":" .. port
        end
        return string.format("%s.%s.%s.svc.cluster.local:%d",
            node_id,
            _M.k8s.headless_service,
            _M.k8s.namespace,
            port
        )
    else
        -- Docker Compose 環境
        local format = _M.detect_node_id_format(node_id)
        if format == "docker-compose" then
            -- node1 -> uptime-kuma-node1:3001
            return _M.cluster.node_host_prefix .. node_id .. ":" .. port
        elseif node_id:match("^uptime%-kuma%-") then
            -- 已經有前綴 (uptime-kuma-node1)
            return node_id .. ":" .. port
        else
            -- 自定義格式
            return _M.cluster.node_host_prefix .. node_id .. ":" .. port
        end
    end
end

--- 從資料庫 node 記錄取得 host 和 port
--- 優先使用資料庫中儲存的 host 值
--- @param node table 節點資料（包含 node_id 和 host）
--- @return string, number host 和 port
function _M.get_node_host_port(node)
    local host, port
    
    -- 優先使用資料庫中儲存的 host
    if node.host and node.host ~= "" and node.host ~= ngx.null then
        -- 解析 host:port
        local h, p = node.host:match("^([^:]+):?(%d*)$")
        host = h or node.host
        port = tonumber(p) or _M.cluster.default_port
    else
        -- Fallback: 根據 node_id 構建
        local full_host = _M.build_node_host(node.node_id)
        if full_host then
            host, port = full_host:match("^([^:]+):(%d+)$")
            port = tonumber(port) or _M.cluster.default_port
        else
            -- 最後 fallback
            host = _M.cluster.node_host_prefix .. _M.cluster.default_node
            port = _M.cluster.default_port
        end
    end
    
    return host, port
end

--- 從 node_id 提取索引
--- @param node_id string
--- @return number|nil
function _M.extract_node_index(node_id)
    if not node_id then return nil end
    
    -- K8s 格式: uptime-kuma-0 -> 0
    local k8s_match = node_id:match("%-(%d+)$")
    if k8s_match then
        return tonumber(k8s_match)
    end
    
    -- Docker Compose 格式: node1 -> 0 (1-indexed to 0-indexed)
    local docker_match = node_id:match("^node(%d+)$")
    if docker_match then
        return tonumber(docker_match) - 1
    end
    
    return nil
end

--- 判斷是否為主節點
--- @param node_id string
--- @return boolean
function _M.is_primary_node(node_id)
    local index = _M.extract_node_index(node_id)
    return index == 0
end

--- 記錄環境資訊（啟動時呼叫）
function _M.log_environment()
    ngx.log(ngx.INFO, "========================================")
    ngx.log(ngx.INFO, "Uptime Kuma Cluster Environment Config")
    ngx.log(ngx.INFO, "========================================")
    ngx.log(ngx.INFO, "Environment: ", _M.environment)
    ngx.log(ngx.INFO, "Default Node: ", _M.cluster.default_node)
    ngx.log(ngx.INFO, "Node Host Prefix: '", _M.cluster.node_host_prefix, "'")
    ngx.log(ngx.INFO, "Default Port: ", _M.cluster.default_port)
    ngx.log(ngx.INFO, "DNS Servers: ", table.concat(_M.dns.servers, ", "))
    if _M.k8s.enabled then
        ngx.log(ngx.INFO, "K8s Namespace: ", _M.k8s.namespace)
        ngx.log(ngx.INFO, "K8s Headless Service: ", _M.k8s.headless_service)
    end
    ngx.log(ngx.INFO, "========================================")
end

return _M

