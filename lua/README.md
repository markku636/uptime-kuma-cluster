# Lua 模組說明

## 概述

本目錄包含 OpenResty 用於 Uptime Kuma Cluster 的 Lua 模組，提供負載平衡、健康檢查、路由決策等核心功能。

## 檔案結構

```
lua/
├── config.lua            # 集中配置管理
├── db.lua                # 共用資料庫連接模組
├── logger.lua            # 共用日誌模組
├── middleware.lua        # 中介層 (access/header_filter)
├── health_check.lua      # 健康檢查與節點管理
├── monitor_router.lua    # 路由決策邏輯
├── test_lua_modules.lua  # 單元測試模組
└── README.md             # 本說明文檔
```

## 模組說明

### config.lua - 集中配置

所有環境變數和預設值集中管理：

```lua
local config = require "config"

-- 資料庫配置
config.database.host      -- DB_HOST (預設: mariadb)
config.database.port      -- DB_PORT (預設: 3306)
config.database.user      -- DB_USER (預設: kuma)
config.database.password  -- DB_PASSWORD
config.database.database  -- DB_NAME (預設: kuma)

-- 集群配置
config.cluster.node_count              -- CLUSTER_NODE_COUNT (預設: 3)
config.cluster.monitor_limit_per_node  -- MONITOR_LIMIT_PER_NODE (預設: 1000)
config.cluster.default_node            -- 預設節點 (node1)
config.cluster.default_port            -- 預設端口 (3001)
config.cluster.node_host_prefix        -- Docker 服務名稱前綴

-- 健康檢查配置
config.health_check.interval           -- HEALTH_CHECK_INTERVAL (預設: 30秒)
config.health_check.timeout            -- HEALTH_CHECK_TIMEOUT (預設: 5000ms)

-- 調試配置
config.debug.enabled                   -- EMMY_DEBUG_ENABLED
config.debug.host                      -- EMMY_DEBUG_HOST
config.debug.port                      -- EMMY_DEBUG_PORT
```

### db.lua - 資料庫模組

統一的資料庫連接邏輯：

```lua
local db = require "db"

-- 建立連接
local conn, err = db.connect()
if conn then
    local res = conn:query("SELECT * FROM node")
    conn:close()
end

-- 執行查詢並自動關閉連接
local res, err = db.query("SELECT * FROM monitor WHERE id = 1")
```

### logger.lua - 日誌模組

統一的日誌格式和分類：

```lua
local logger = require "logger"

-- 調試日誌 (只在 debug 模式輸出)
logger.debug("CATEGORY", "message %s", arg)

-- 各級別日誌
logger.info("SYSTEM", "服務啟動")
logger.warn("NETWORK", "連接超時")
logger.error("DATABASE", "查詢失敗: %s", err)

-- 便捷方法 (自動帶類別的調試日誌)
logger.health_check("檢查節點 %s", node_id)
logger.database("查詢結果: %d 筆", count)
logger.network("連接到 %s:%d", host, port)
logger.system("工作器啟動")
logger.router("路由到 %s", node)
```

支援的日誌類別：
- `HEALTH_CHECK` 🔍 - 健康檢查
- `DATABASE` 🗄️ - 資料庫操作
- `NETWORK` 🌐 - 網路連接
- `SYSTEM` ⚙️ - 系統資訊
- `ROUTER` 🔀 - 路由決策
- `DEBUG` 🐛 - 一般調試

### middleware.lua - 中介層

統一處理 nginx location 的共用邏輯：

```lua
-- 在 nginx.conf 中使用
access_by_lua_block { require("middleware").preselect_node() }
header_filter_by_lua_block { require("middleware").add_routing_headers() }
```

功能：
- `preselect_node()` - Access 階段預選節點
- `add_routing_headers()` - 添加 X-Routed-Via、X-Routed-To 標頭

### health_check.lua - 健康檢查

節點健康監控與故障轉移：

```lua
local health_check = require "health_check"

-- 初始化
health_check.init()

-- 執行健康檢查
health_check.run_health_check()

-- 取得統計資訊
local stats = health_check.get_statistics()

-- 啟動健康檢查工作器 (背景執行)
health_check.health_check_worker()
```

功能：
- 定期檢查各節點健康狀態
- 連續失敗 3 次自動將監控重新分配到其他節點
- 節點恢復後自動還原監控

### monitor_router.lua - 路由模組

智能路由決策：

```lua
local router = require "monitor_router"

-- 預選節點 (用於 access 階段)
router.preselect_node()

-- 取得預選結果 (用於 balancer 階段)
local host, port = router.get_preselected_node()

-- 根據 Monitor ID 路由
local node = router.route_by_monitor_id(monitor_id)

-- 取得集群狀態
local status = router.get_cluster_status()

-- 固定節點相關
local fixed_node = router.get_fixed_node_from_cookie()
local valid, reason = router.validate_fixed_node(node_id)
```

### test_lua_modules.lua - 單元測試

用於驗證各模組功能的單元測試：

```lua
-- 執行方式: 在 OpenResty 環境中執行
resty test_lua_modules.lua
```

測試涵蓋：
- `config.lua` - 配置讀取和預設值
- `logger.lua` - 日誌輸出和分類
- `db.lua` - 資料庫連接
- `monitor_router.lua` - 路由邏輯
- `health_check.lua` - 健康檢查功能
- `middleware.lua` - 中介層功能

功能：
- Mock ngx 物件支援非 OpenResty 環境測試
- 自動統計通過/失敗測試數
- 彩色輸出測試結果

## 環境變數

| 變數名 | 說明 | 預設值 |
|--------|------|--------|
| `DB_HOST` | 資料庫主機 | mariadb |
| `DB_PORT` | 資料庫端口 | 3306 |
| `DB_USER` | 資料庫用戶 | kuma |
| `DB_PASSWORD` | 資料庫密碼 | kuma_pass |
| `DB_NAME` | 資料庫名稱 | kuma |
| `CLUSTER_NODE_COUNT` | 節點數量 | 3 |
| `MONITOR_LIMIT_PER_NODE` | 每節點監控上限 | 1000 |
| `HEALTH_CHECK_INTERVAL` | 健康檢查間隔(秒) | 30 |
| `HEALTH_CHECK_TIMEOUT` | 健康檢查超時(ms) | 5000 |
| `EMMY_DEBUG_ENABLED` | 啟用調試 | false |
| `EMMY_DEBUG_HOST` | 調試器主機 | 0.0.0.0 |
| `EMMY_DEBUG_PORT` | 調試器端口 | 9966 |

## nginx.conf 使用範例

```nginx
# 在 location 中使用 middleware
location / {
    access_by_lua_block { require("middleware").preselect_node() }
    header_filter_by_lua_block { require("middleware").add_routing_headers() }
    
    proxy_pass http://uptime_kuma_cluster;
}

# 管理端點
location /lb/health {
    content_by_lua_block {
        local router = require "monitor_router"
        ngx.say(require('cjson').encode(router.get_cluster_status()))
    }
}
```

## 調試說明

### 啟用調試模式

設定環境變數：
```bash
EMMY_DEBUG_ENABLED=true
EMMY_DEBUG_PORT=9966
```

### 日誌類別

健康檢查模組支援分類日誌：
- `HEALTH_CHECK` - 健康檢查相關
- `DATABASE` - 資料庫操作
- `NETWORK` - 網路連接
- `SYSTEM` - 系統資訊

## 更新日誌

### v2.0.0 (2025-12-26)
- 重構：新增 `config.lua` 集中配置管理
- 重構：新增 `db.lua` 共用資料庫模組
- 重構：新增 `middleware.lua` 統一中介層
- 新增：`test_lua_modules.lua` 單元測試模組
- 優化：nginx.conf 減少約 70 行重複代碼
- 優化：配置修改只需改一處

### v1.0.0
- 初始版本
- 基本健康檢查功能
- Monitor 路由功能
- 固定節點路由支援
