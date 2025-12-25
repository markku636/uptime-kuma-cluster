# OpenResty 全局流量手動切換節點計劃

## 📋 目標

提供管理員在 OpenResty 層級**強制所有流量**路由到指定節點的能力，並可恢復回自動負載平衡模式：

1. **全局強制路由**：強制 OpenResty 將所有請求轉發到特定節點（node1、node2、node3...）
2. **流量隔離**：用於維護、測試或故障排查場景
3. **恢復 LTM 模式**：一鍵恢復回原本的自動負載平衡機制
4. **狀態持久化**：重啟 OpenResty 後保持強制路由設定（可選）

---

## 🎯 使用場景

| 場景 | 說明 | API 端點 |
|:---|:---|:---|
| **緊急故障切換** | node2/node3 故障，強制所有流量切到 node1 | `POST /api/lb/force-route-to/node1` |
| **維護模式** | 需要對 node2/node3 進行維護，暫時將流量全部導向 node1 | `POST /api/lb/force-route-to/node1` |
| **測試新版本** | 在 node3 部署新版本，強制部分測試流量到 node3 驗證 | `POST /api/lb/force-route-to/node3` |
| **恢復負載平衡** | 維護完成，恢復回自動 LTM 模式 | `POST /api/lb/restore-ltm` |
| **查看當前模式** | 確認目前是強制路由還是 LTM 模式 | `GET /api/lb/routing-mode` |

---

## 🏗️ 架構設計

### 資料庫欄位說明

```sql
-- monitor 表相關欄位
CREATE TABLE monitor (
    id INTEGER PRIMARY KEY,
    node_id VARCHAR(50),           -- 預設節點（用於新建 + 恢復時的目標）
    assigned_node VARCHAR(50),      -- 當前實際運行節點（優先於 node_id）
    manual_override BOOLEAN DEFAULT 0,  -- 🆕 是否為手動固定（防止自動遷移）
    ...
);

-- node 表相關欄位
CREATE TABLE node (
    node_id VARCHAR(50) PRIMARY KEY,
    status VARCHAR(20),            -- 'online' / 'offline' / 'draining'
    drain_mode BOOLEAN DEFAULT 0,   -- 🆕 是否處於排空模式
    ...
);
```

### 有效節點計算邏輯

```
effective_node = 
  IF (assigned_node IS NOT NULL) THEN assigned_node
  ELSE node_id
```

---

## 🔧 功能實現

### 1. 單一監控切換節點

#### API 設計

```http
POST /api/monitors/{monitorId}/switch-node
Content-Type: application/json

{
  "targetNodeId": "node2",
  "reason": "Manual maintenance",
  "manualOverride": false
}
```

#### 回應

```json
{
  "ok": true,
  "msg": "Monitor #123 switched to node2",
  "monitor": {
    "id": 123,
    "name": "API Server",
    "node_id": "node1",
    "assigned_node": "node2",
    "effective_node": "node2"
  }
}
```

#### Lua 腳本實現

```lua
-- 在 nginx.conf 中新增 location
location /api/monitors/switch-node {
    content_by_lua_block {
        local cjson = require "cjson"
        local router = require "monitor_router"
        
        ngx.req.read_body()
        local body = ngx.req.get_body_data()
        local data = cjson.decode(body)
        
        local result = router.switch_monitor_node(
            data.monitorId,
            data.targetNodeId,
            data.manualOverride or false
        )
        
        ngx.header.content_type = "application/json"
        ngx.say(cjson.encode(result))
    }
}
```

```lua
-- monitor_router.lua 新增函數
function _M.switch_monitor_node(monitor_id, target_node_id, manual_override)
    local db, err = db_connect()
    if not db then
        return {ok = false, msg = "Database connection failed: " .. err}
    end
    
    -- 1. 驗證目標節點存在且在線
    local check_sql = string.format(
        "SELECT status FROM node WHERE node_id = %s",
        ngx.quote_sql_str(target_node_id)
    )
    local node_res, err = db:query(check_sql)
    if not node_res or #node_res == 0 then
        db:close()
        return {ok = false, msg = "Target node not found"}
    end
    
    if node_res[1].status ~= "online" then
        db:close()
        return {ok = false, msg = "Target node is not online"}
    end
    
    -- 2. 更新監控的 assigned_node
    local update_sql = string.format([[
        UPDATE monitor 
        SET assigned_node = %s,
            manual_override = %d
        WHERE id = %d
    ]], 
        ngx.quote_sql_str(target_node_id),
        manual_override and 1 or 0,
        tonumber(monitor_id)
    )
    
    local res, err = db:query(update_sql)
    db:close()
    
    if not res then
        return {ok = false, msg = "Update failed: " .. err}
    end
    
    -- 3. 清除快取
    local cache_key = "monitor:" .. monitor_id
    routing_cache:delete(cache_key)
    
    ngx.log(ngx.INFO, string.format(
        "Monitor %d switched to node %s (manual_override=%s)",
        monitor_id, target_node_id, tostring(manual_override)
    ))
    
    return {
        ok = true,
        msg = string.format("Monitor #%d switched to %s", monitor_id, target_node_id)
    }
end
```

---

### 2. 批量切換監控

#### API 設計

```http
POST /api/monitors/batch-switch
Content-Type: application/json

{
  "monitorIds": [101, 102, 103],
  "targetNodeId": "node3",
  "reason": "Load balancing"
}
```

#### 回應

```json
{
  "ok": true,
  "msg": "Switched 3 monitors to node3",
  "results": [
    {"monitorId": 101, "success": true},
    {"monitorId": 102, "success": true},
    {"monitorId": 103, "success": false, "error": "Monitor not found"}
  ]
}
```

#### 實現

```lua
function _M.batch_switch_monitors(monitor_ids, target_node_id)
    local db, err = db_connect()
    if not db then
        return {ok = false, msg = "Database connection failed"}
    end
    
    -- 構建 IN 子句
    local ids_str = table.concat(monitor_ids, ",")
    local sql = string.format([[
        UPDATE monitor 
        SET assigned_node = %s
        WHERE id IN (%s)
    ]], ngx.quote_sql_str(target_node_id), ids_str)
    
    local res, err = db:query(sql)
    db:close()
    
    if not res then
        return {ok = false, msg = "Batch update failed: " .. err}
    end
    
    -- 清除所有相關快取
    for _, mid in ipairs(monitor_ids) do
        routing_cache:delete("monitor:" .. mid)
    end
    
    return {
        ok = true,
        msg = string.format("Switched %d monitors to %s", #monitor_ids, target_node_id),
        affected = res.affected_rows or #monitor_ids
    }
end
```

---

### 3. 節點排空（Drain Mode）

#### API 設計

```http
POST /api/nodes/{nodeId}/drain
Content-Type: application/json

{
  "targetStrategy": "distribute",  // 'distribute' | 'single' | 'auto'
  "targetNodeId": "node2",         // 僅當 strategy='single' 時需要
  "waitForCompletion": true
}
```

#### 排空策略

| 策略 | 說明 |
|:---|:---|
| `distribute` | 平均分配到其他所有在線節點（預設） |
| `single` | 全部遷移到指定的單一節點 |
| `auto` | 根據當前負載自動選擇最佳分配方式 |

#### 回應

```json
{
  "ok": true,
  "msg": "Node node1 drained successfully",
  "stats": {
    "totalMonitors": 25,
    "redistributed": 25,
    "failed": 0,
    "distribution": {
      "node2": 13,
      "node3": 12
    }
  }
}
```

#### 實現

```lua
function _M.drain_node(node_id, strategy, target_node_id)
    local db, err = db_connect()
    if not db then
        return {ok = false, msg = "Database connection failed"}
    end
    
    -- 1. 設置節點為排空模式
    local drain_sql = string.format(
        "UPDATE node SET drain_mode = 1, status = 'draining' WHERE node_id = %s",
        ngx.quote_sql_str(node_id)
    )
    db:query(drain_sql)
    
    -- 2. 查詢該節點上的所有監控
    local select_sql = string.format([[
        SELECT id FROM monitor
        WHERE (assigned_node = %s OR (assigned_node IS NULL AND node_id = %s))
          AND manual_override = 0
    ]], ngx.quote_sql_str(node_id), ngx.quote_sql_str(node_id))
    
    local monitors, err = db:query(select_sql)
    if not monitors then
        db:close()
        return {ok = false, msg = "Failed to query monitors"}
    end
    
    local total = #monitors
    if total == 0 then
        db:close()
        return {ok = true, msg = "Node has no monitors to drain"}
    end
    
    -- 3. 根據策略執行遷移
    local distribution = {}
    
    if strategy == "single" then
        -- 全部遷移到單一目標節點
        local update_sql = string.format(
            "UPDATE monitor SET assigned_node = %s WHERE id IN (%s)",
            ngx.quote_sql_str(target_node_id),
            table.concat(monitors, ",")
        )
        db:query(update_sql)
        distribution[target_node_id] = total
        
    elseif strategy == "distribute" then
        -- 平均分配到其他線上節點
        local online_nodes_sql = string.format(
            "SELECT node_id FROM node WHERE status = 'online' AND node_id <> %s",
            ngx.quote_sql_str(node_id)
        )
        local targets, err = db:query(online_nodes_sql)
        
        if not targets or #targets == 0 then
            db:close()
            return {ok = false, msg = "No online nodes available for redistribution"}
        end
        
        -- Round-robin 分配
        for idx, mon in ipairs(monitors) do
            local target_idx = ((idx - 1) % #targets) + 1
            local target = targets[target_idx].node_id
            
            local upd_sql = string.format(
                "UPDATE monitor SET assigned_node = %s WHERE id = %d",
                ngx.quote_sql_str(target), mon.id
            )
            db:query(upd_sql)
            
            distribution[target] = (distribution[target] or 0) + 1
        end
    end
    
    db:close()
    
    -- 4. 清除快取
    for _, mon in ipairs(monitors) do
        routing_cache:delete("monitor:" .. mon.id)
    end
    
    ngx.log(ngx.INFO, string.format(
        "Drained node %s: %d monitors redistributed",
        node_id, total
    ))
    
    return {
        ok = true,
        msg = string.format("Node %s drained successfully", node_id),
        stats = {
            totalMonitors = total,
            redistributed = total,
            failed = 0,
            distribution = distribution
        }
    }
end
```

---

### 4. 固定監控到節點（Pin）

#### API 設計

```http
POST /api/monitors/{monitorId}/pin-to-node
Content-Type: application/json

{
  "nodeId": "node1",
  "reason": "Requires specific geographic location"
}
```

#### 特性

- 設置 `manual_override = 1`，防止自動健康檢查遷移
- 即使目標節點離線，監控也不會被自動遷移（需手動介入）

#### 解除固定

```http
POST /api/monitors/{monitorId}/unpin
```

```lua
function _M.unpin_monitor(monitor_id)
    local db, err = db_connect()
    if not db then
        return {ok = false, msg = "Database connection failed"}
    end
    
    local sql = string.format(
        "UPDATE monitor SET manual_override = 0, assigned_node = NULL WHERE id = %d",
        tonumber(monitor_id)
    )
    
    local res, err = db:query(sql)
    db:close()
    
    if not res then
        return {ok = false, msg = "Unpin failed: " .. err}
    end
    
    routing_cache:delete("monitor:" .. monitor_id)
    
    return {ok = true, msg = "Monitor unpinned, will follow default routing"}
end
```

---

## 🔐 權限與驗證

### 安全考量

```lua
-- 在所有管理 API 前檢查認證
local function check_admin_token()
    local token = ngx.var.http_authorization
    if not token or token ~= os.getenv("ADMIN_API_TOKEN") then
        ngx.status = 401
        ngx.say('{"ok":false,"msg":"Unauthorized"}')
        return ngx.exit(401)
    end
end

-- 在 location 中使用
location /api/monitors/switch-node {
    access_by_lua_block {
        local auth = require "auth"
        auth.check_admin_token()
    }
    content_by_lua_block {
        -- ... 業務邏輯
    }
}
```

---

## 📊 監控與日誌

### 操作審計日誌

```lua
local function log_manual_operation(operation, details)
    local db, err = db_connect()
    if not db then return end
    
    local log_sql = string.format([[
        INSERT INTO node_operation_log (operation, details, timestamp)
        VALUES (%s, %s, NOW())
    ]],
        ngx.quote_sql_str(operation),
        ngx.quote_sql_str(require("cjson").encode(details))
    )
    
    db:query(log_sql)
    db:close()
end

-- 在每次手動操作後調用
log_manual_operation("SWITCH_NODE", {
    monitor_id = 123,
    from_node = "node1",
    to_node = "node2",
    operator = "admin",
    reason = "Manual load balancing"
})
```

### 資料庫 Schema

```sql
CREATE TABLE node_operation_log (
    id INTEGER PRIMARY KEY AUTO_INCREMENT,
    operation VARCHAR(50) NOT NULL,
    details TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_timestamp (timestamp)
);
```

---

## 🚀 部署步驟

### Step 1: 資料庫遷移

創建 `db/knex_migrations/2025-01-15-0000-add-manual-override.js`：

```javascript
exports.up = async function (knex) {
    // 1. 為 monitor 表新增 manual_override 欄位
    await knex.schema.alterTable("monitor", function (table) {
        table.boolean("manual_override").defaultTo(false);
    });
    
    // 2. 為 node 表新增 drain_mode 欄位
    await knex.schema.alterTable("node", function (table) {
        table.boolean("drain_mode").defaultTo(false);
    });
    
    // 3. 創建操作日誌表
    await knex.schema.createTable("node_operation_log", function (table) {
        table.increments("id");
        table.string("operation", 50).notNullable();
        table.text("details");
        table.timestamp("timestamp").defaultTo(knex.fn.now());
        table.index("timestamp");
    });
};

exports.down = async function (knex) {
    await knex.schema.alterTable("monitor", function (table) {
        table.dropColumn("manual_override");
    });
    await knex.schema.alterTable("node", function (table) {
        table.dropColumn("drain_mode");
    });
    await knex.schema.dropTableIfExists("node_operation_log");
};
```

執行遷移：

```bash
npm run migrate
```

### Step 2: 更新 Lua 模組

在 `lua/monitor_router.lua` 中新增以下函數：

```lua
-- 新增函數（如上述 1-4 節所示）
function _M.switch_monitor_node(...)
function _M.batch_switch_monitors(...)
function _M.drain_node(...)
function _M.unpin_monitor(...)
```

### Step 3: 更新 Nginx 配置

在 `nginx/nginx.conf` 的 `server` 區塊中新增：

```nginx
# 手動切換節點 API
location ~ ^/api/monitors/(\d+)/switch-node$ {
    set $monitor_id $1;
    content_by_lua_block {
        local cjson = require "cjson"
        local router = require "monitor_router"
        
        ngx.req.read_body()
        local body = ngx.req.get_body_data()
        if not body then
            ngx.status = 400
            ngx.say('{"ok":false,"msg":"Missing request body"}')
            return
        end
        
        local ok, data = pcall(cjson.decode, body)
        if not ok then
            ngx.status = 400
            ngx.say('{"ok":false,"msg":"Invalid JSON"}')
            return
        end
        
        local result = router.switch_monitor_node(
            ngx.var.monitor_id,
            data.targetNodeId,
            data.manualOverride or false
        )
        
        ngx.header.content_type = "application/json"
        ngx.say(cjson.encode(result))
    }
}

# 批量切換
location /api/monitors/batch-switch {
    content_by_lua_block {
        local cjson = require "cjson"
        local router = require "monitor_router"
        
        ngx.req.read_body()
        local body = ngx.req.get_body_data()
        local data = cjson.decode(body)
        
        local result = router.batch_switch_monitors(
            data.monitorIds,
            data.targetNodeId
        )
        
        ngx.header.content_type = "application/json"
        ngx.say(cjson.encode(result))
    }
}

# 節點排空
location ~ ^/api/nodes/([^/]+)/drain$ {
    set $node_id $1;
    content_by_lua_block {
        local cjson = require "cjson"
        local router = require "monitor_router"
        
        ngx.req.read_body()
        local body = ngx.req.get_body_data() or "{}"
        local data = cjson.decode(body)
        
        local result = router.drain_node(
            ngx.var.node_id,
            data.targetStrategy or "distribute",
            data.targetNodeId
        )
        
        ngx.header.content_type = "application/json"
        ngx.say(cjson.encode(result))
    }
}

# 固定/解除固定
location ~ ^/api/monitors/(\d+)/(pin-to-node|unpin)$ {
    set $monitor_id $1;
    set $action $2;
    content_by_lua_block {
        local cjson = require "cjson"
        local router = require "monitor_router"
        
        if ngx.var.action == "unpin" then
            local result = router.unpin_monitor(ngx.var.monitor_id)
            ngx.header.content_type = "application/json"
            ngx.say(cjson.encode(result))
        else
            ngx.req.read_body()
            local body = ngx.req.get_body_data()
            local data = cjson.decode(body)
            
            local result = router.switch_monitor_node(
                ngx.var.monitor_id,
                data.nodeId,
                true  -- manual_override = true
            )
            ngx.header.content_type = "application/json"
            ngx.say(cjson.encode(result))
        end
    }
}
```

### Step 4: 修改健康檢查邏輯

在 `lua/health_check.lua` 中更新 `redistribute_monitors_from_node`：

```lua
-- 修改監控重新分配邏輯，跳過手動固定的監控
local function redistribute_monitors_from_node(failed_node_id)
    -- ... 前面代碼相同 ...
    
    -- 查詢需要重新分配的監控（排除 manual_override = 1）
    local select_sql = string.format([[ 
        SELECT id FROM monitor 
        WHERE manual_override = 0
          AND (assigned_node = %s OR (assigned_node IS NULL AND node_id = %s))
        ORDER BY id
    ]], failedQuoted, failedQuoted)
    
    -- ... 後續代碼相同 ...
end
```

### Step 5: 重啟服務

```bash
# 檢查配置
nginx -t

# 重新載入配置
nginx -s reload

# 或使用 Docker
docker-compose -f docker-compose-cluster.yaml restart openresty
```

---

## 🧪 測試腳本

創建 `test-manual-switching.http`：

```http
### 1. 切換單一監控到 node2
POST http://localhost/api/monitors/1/switch-node
Content-Type: application/json
Authorization: Bearer your-admin-token

{
  "targetNodeId": "node2",
  "reason": "Testing manual switch",
  "manualOverride": false
}

### 2. 批量切換監控
POST http://localhost/api/monitors/batch-switch
Content-Type: application/json
Authorization: Bearer your-admin-token

{
  "monitorIds": [1, 2, 3],
  "targetNodeId": "node3",
  "reason": "Load balancing"
}

### 3. 排空 node1（分散式）
POST http://localhost/api/nodes/node1/drain
Content-Type: application/json
Authorization: Bearer your-admin-token

{
  "targetStrategy": "distribute",
  "waitForCompletion": true
}

### 4. 排空 node1（單一目標）
POST http://localhost/api/nodes/node1/drain
Content-Type: application/json
Authorization: Bearer your-admin-token

{
  "targetStrategy": "single",
  "targetNodeId": "node2"
}

### 5. 固定監控到節點
POST http://localhost/api/monitors/5/pin-to-node
Content-Type: application/json
Authorization: Bearer your-admin-token

{
  "nodeId": "node1",
  "reason": "Requires specific geo-location"
}

### 6. 解除固定
POST http://localhost/api/monitors/5/unpin
Authorization: Bearer your-admin-token

### 7. 查看當前負載
GET http://localhost/lb/capacity

### 8. 查看操作日誌（需額外實現查詢端點）
GET http://localhost/api/operation-logs?limit=50
Authorization: Bearer your-admin-token
```

---

## 📝 使用範例

### 場景 1: 維護前排空節點

```bash
# 1. 查看當前負載
curl http://localhost/lb/capacity

# 2. 排空 node2（準備維護）
curl -X POST http://localhost/api/nodes/node2/drain \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer admin-token" \
  -d '{
    "targetStrategy": "distribute"
  }'

# 3. 驗證監控已遷移
curl http://localhost/lb/capacity

# 4. 停止 node2 進行維護
docker stop uptime-kuma-node2

# 5. 維護完成後重啟
docker start uptime-kuma-node2

# 6. （可選）手動將監控遷回 node2
curl -X POST http://localhost/api/monitors/batch-switch \
  -H "Content-Type: application/json" \
  -d '{
    "monitorIds": [1, 2, 3],
    "targetNodeId": "node2"
  }'
```

### 場景 2: 特殊監控固定節點

```bash
# 固定地理位置敏感的監控到特定節點
curl -X POST http://localhost/api/monitors/999/pin-to-node \
  -H "Content-Type: application/json" \
  -d '{
    "nodeId": "node-us-west",
    "reason": "Must run from US West region for compliance"
  }'
```

---

## 🔍 故障排查

### 問題 1: 切換後監控未生效

**檢查**：

```bash
# 查看 Nginx 錯誤日誌
docker logs openresty | grep ERROR

# 檢查資料庫狀態
docker exec -it mariadb mysql -ukuma -pkuma_pass kuma \
  -e "SELECT id, name, node_id, assigned_node, manual_override FROM monitor WHERE id = 123;"
```

**解決**：清除路由快取

```bash
# 重啟 OpenResty
docker-compose restart openresty
```

### 問題 2: 排空節點失敗

**檢查**：

```bash
# 驗證有其他在線節點
curl http://localhost/lb/health

# 檢查是否有手動固定的監控
docker exec -it mariadb mysql -ukuma -pkuma_pass kuma \
  -e "SELECT COUNT(*) FROM monitor WHERE node_id = 'node1' AND manual_override = 1;"
```

---

## 🎯 最佳實踐

1. **維護前排空**：始終在維護節點前執行 drain 操作
2. **審慎使用 Pin**：僅對真正需要固定位置的監控使用 pin 功能
3. **監控日誌**：定期檢查 `node_operation_log` 表，審計手動操作
4. **漸進式切換**：大規模切換時分批進行，避免瞬時負載激增
5. **驗證後操作**：每次切換後使用 `/lb/capacity` 驗證結果

---

## 📚 相關文件

- `README.md` - 系統整體架構說明
- `CLUSTER_DEPLOYMENT_GUIDE.md` - 集群部署指南
- `API_DOCUMENTATION.md` - 完整 API 文檔
- `nginx/nginx.conf` - OpenResty 配置
- `lua/monitor_router.lua` - 路由邏輯實現
- `lua/health_check.lua` - 健康檢查與自動故障轉移

---

## 🚧 待實現功能（未來版本）

- [ ] Web UI 管理界面（可視化拖拽切換節點）
- [ ] 切換預覽（Dry-run 模式）
- [ ] 回滾功能（Undo 最近一次操作）
- [ ] 定時排空（Scheduled Drain）
- [ ] 智能推薦（AI 建議最佳遷移方案）
- [ ] 監控組批量管理
- [ ] 地理位置感知路由（Geo-aware Routing）

---

## 📞 支援

如遇問題，請查閱：
- 系統日誌：`docker logs openresty`
- 資料庫狀態：`docker exec mariadb mysqladmin status`
- 健康狀態：`curl http://localhost/api/system-status`
