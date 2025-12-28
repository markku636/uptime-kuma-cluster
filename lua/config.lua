--[[
  集中配置模組
  所有環境變數和預設值集中在這裡管理
  
  效能優化版本 - 支援 10,000+ 監控
  Performance optimized version - supports 10,000+ monitors
]]
local _M = {}

-- 資料庫配置 (主庫 - 用於寫入)
-- Database config (Primary - for writes)
_M.database = {
    host = os.getenv("DB_HOST") or "mariadb",
    port = tonumber(os.getenv("DB_PORT")) or 3306,
    user = os.getenv("DB_USER") or "kuma",
    password = os.getenv("DB_PASSWORD") or "kuma_pass",
    database = os.getenv("DB_NAME") or "kuma",
    timeout = tonumber(os.getenv("DB_TIMEOUT")) or 5000
}

-- 資料庫讀取複本配置 (用於讀取負載分散)
-- Database read replica config (for read load distribution)
_M.database_replica = {
    enabled = os.getenv("DB_REPLICA_ENABLED") == "true",
    host = os.getenv("DB_REPLICA_HOST") or "mariadb-replica",
    port = tonumber(os.getenv("DB_REPLICA_PORT")) or 3306,
    user = os.getenv("DB_REPLICA_USER") or os.getenv("DB_USER") or "kuma",
    password = os.getenv("DB_REPLICA_PASSWORD") or os.getenv("DB_PASSWORD") or "kuma_pass",
    database = os.getenv("DB_REPLICA_NAME") or os.getenv("DB_NAME") or "kuma"
}

-- Redis 快取配置 (用於高效能路由快取)
-- Redis cache config (for high-performance routing cache)
_M.redis = {
    enabled = os.getenv("REDIS_ENABLED") == "true",
    host = os.getenv("REDIS_HOST") or "redis",
    port = tonumber(os.getenv("REDIS_PORT")) or 6379,
    password = os.getenv("REDIS_PASSWORD") or nil,
    database = tonumber(os.getenv("REDIS_DATABASE")) or 0,
    timeout = tonumber(os.getenv("REDIS_TIMEOUT")) or 1000,
    pool_size = tonumber(os.getenv("REDIS_POOL_SIZE")) or 100,
    -- 快取 TTL 設定
    routing_ttl = tonumber(os.getenv("REDIS_ROUTING_TTL")) or 900,  -- 15 分鐘
    node_status_ttl = tonumber(os.getenv("REDIS_NODE_STATUS_TTL")) or 30,  -- 30 秒
    setup_status_ttl = tonumber(os.getenv("REDIS_SETUP_STATUS_TTL")) or 10  -- 10 秒
}

-- 集群配置 (擴展至 10 節點)
-- Cluster config (extended to 10 nodes)
_M.cluster = {
    node_count = tonumber(os.getenv("CLUSTER_NODE_COUNT")) or 10,
    monitor_limit_per_node = tonumber(os.getenv("MONITOR_LIMIT_PER_NODE")) or 3000,
    default_node = "node1",
    default_port = 3001,
    node_host_prefix = "uptime-kuma-"  -- Docker 服務名稱前綴
}

-- 健康檢查配置 (優化間隔)
-- Health check config (optimized intervals)
_M.health_check = {
    interval = tonumber(os.getenv("HEALTH_CHECK_INTERVAL")) or 10,  -- 從 15 秒減少到 10 秒
    timeout = tonumber(os.getenv("HEALTH_CHECK_TIMEOUT")) or 5000,
    consecutive_failures_threshold = 2,  -- 從 3 減少到 2，更快故障偵測
    consecutive_success_threshold = 2    -- 從 3 減少到 2，更快恢復
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

-- 快取配置 (擴展 TTL)
-- Cache config (extended TTL)
_M.cache = {
    monitor_routing_ttl = tonumber(os.getenv("CACHE_ROUTING_TTL")) or 900,  -- 15 分鐘
    node_capacity_ttl = tonumber(os.getenv("CACHE_NODE_CAPACITY_TTL")) or 60,  -- 1 分鐘
    setup_status_ttl = tonumber(os.getenv("CACHE_SETUP_STATUS_TTL")) or 10  -- 10 秒
}

return _M
