--[[
  集中配置模組
  所有環境變數和預設值集中在這裡管理
]]
local _M = {}

-- 資料庫配置
_M.database = {
    host = os.getenv("DB_HOST") or "mariadb",
    port = tonumber(os.getenv("DB_PORT")) or 3306,
    user = os.getenv("DB_USER") or "kuma",
    password = os.getenv("DB_PASSWORD") or "kuma_pass",
    database = os.getenv("DB_NAME") or "kuma",
    timeout = tonumber(os.getenv("DB_TIMEOUT")) or 5000
}

-- 集群配置
_M.cluster = {
    node_count = tonumber(os.getenv("CLUSTER_NODE_COUNT")) or 3,
    monitor_limit_per_node = tonumber(os.getenv("MONITOR_LIMIT_PER_NODE")) or 1000,
    default_node = "node1",
    default_port = 3001,
    node_host_prefix = "uptime-kuma-"  -- Docker 服務名稱前綴
}

-- 健康檢查配置
_M.health_check = {
    interval = tonumber(os.getenv("HEALTH_CHECK_INTERVAL")) or 30,
    timeout = tonumber(os.getenv("HEALTH_CHECK_TIMEOUT")) or 5000,
    consecutive_failures_threshold = 3,
    consecutive_success_threshold = 3
}

-- 調試配置
_M.debug = {
    enabled = os.getenv("EMMY_DEBUG_ENABLED") == "true",
    host = os.getenv("EMMY_DEBUG_HOST") or "0.0.0.0",
    port = tonumber(os.getenv("EMMY_DEBUG_PORT")) or 9966,
    log_level = os.getenv("DEBUG_LOG_LEVEL") or "INFO"
}

-- Cookie 配置
_M.cookie = {
    fixed_node_name = "KUMA_FIXED_NODE",
    fixed_node_expires = 604800  -- 7 天
}

-- 快取配置
_M.cache = {
    monitor_routing_ttl = 300  -- 5 分鐘
}

return _M
