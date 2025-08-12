# Node Manager 遷移到 OpenResty/nginx

## 概述

本項目已將原本在 Node.js 中實現的節點管理器 (NodeManager) 功能遷移到 Nginx + OpenResty 環境中，使用 Lua 腳本實現健康檢查、故障轉移和負載平衡功能。

## 遷移原因

1. **性能提升**: OpenResty 的 Lua 腳本執行效率更高，減少 Node.js 進程的負載
2. **架構簡化**: 將健康檢查邏輯集中到負載平衡器層，減少應用層的複雜性
3. **資源優化**: 減少 Node.js 進程的記憶體和 CPU 使用
4. **統一管理**: 健康檢查和負載平衡邏輯統一在 nginx 層管理

## 遷移的功能

### 1. 節點心跳管理
- **原實現**: `NodeManager.sendHeartbeat()` 在 Node.js 中每 30 秒執行
- **新實現**: `health_check.send_heartbeat()` 在 nginx 中每 30 秒執行
- **位置**: `lua/health_check.lua`

### 2. 節點狀態檢查和故障轉移
- **原實現**: `NodeManager.checkNodesAndHandleFailover()` 在 Node.js 中每 60 秒執行
- **新實現**: `health_check.check_nodes_and_handle_failover()` 在 nginx 中每 60 秒執行
- **位置**: `lua/health_check.lua`

### 3. 監控器重新平衡
- **原實現**: `NodeManager.rebalanceMonitors()` 在 Node.js 中執行
- **新實現**: `health_check.rebalance_monitors()` 在 nginx 中執行
- **位置**: `lua/health_check.lua`

### 4. 手動觸發重新平衡
- **原實現**: 通過 WebSocket API 調用 `nodeManager.triggerManualRebalancing()`
- **新實現**: 通過 HTTP API 調用 `POST /api/trigger-rebalancing`
- **位置**: nginx 配置中的 Lua 腳本

## 新的架構

### Nginx 配置更新
```nginx
# 新增共享記憶體區域
lua_shared_dict health_checker 5m;

# 初始化健康檢查器
init_by_lua_block {
    local health_check = require "health_check"
    -- 初始化健康檢查器
    local health_checker = ngx.shared.health_checker
    health_checker:set("last_heartbeat", 0)
    health_checker:set("last_check", 0)
}

# 定期執行健康檢查任務
init_worker_by_lua_block {
    local health_check = require "health_check"
    
    local function health_worker()
        while true do
            ngx.sleep(30)  -- 每30秒發送一次心跳
            pcall(health_check.send_heartbeat, os.getenv("UPTIME_KUMA_NODE_ID") or "nginx-node")
        end
    end

    local function failover_worker()
        while true do
            ngx.sleep(60)  -- 每60秒檢查一次節點狀態並處理故障轉移
            pcall(health_check.check_nodes_and_handle_failover)
        end
    end

    ngx.timer.at(20, health_worker)
    ngx.timer.at(25, failover_worker)
}
```

### 新的 API 端點
```nginx
# 手動觸發監控器重新平衡端點
location /api/trigger-rebalancing {
    content_by_lua_block {
        local health_check = require "health_check"
        local success = health_check.trigger_manual_rebalancing()
        
        if success then
            ngx.status = 200
            ngx.say('{"status":"success","message":"Monitor rebalancing triggered successfully"}')
        else
            ngx.status = 500
            ngx.say('{"status":"error","message":"Failed to trigger monitor rebalancing"}')
        end
        
        ngx.header.content_type = "application/json"
    }
}
```

## 環境變數配置

確保在 nginx 容器中設置以下環境變數：

```bash
# 節點識別
UPTIME_KUMA_NODE_ID=nginx-node
NODE_ID=nginx-node

# 資料庫連接
DB_HOST=mariadb
DB_PORT=3306
DB_USER=kuma
DB_PASSWORD=kuma_pass
DB_NAME=kuma
```

## 移除的文件和代碼

### 已刪除的文件
- `server/node-manager.js` - 完整的 NodeManager 類實現

### 已更新的文件
- `server/uptime-kuma-server.js` - 移除 NodeManager 的啟動和停止
- `server/socket-handlers/node-socket-handler.js` - 移除手動重新平衡的 NodeManager 調用
- `server/model/node.js` - 將相關方法標記為 deprecated

### 已棄用的方法
- `Node.updateHeartbeat()` - 現在由 nginx Lua 腳本處理
- `Node.markStaleNodesOffline()` - 現在由 nginx Lua 腳本處理

## 監控和調試

### 查看 nginx 日誌
```bash
# 查看 nginx 錯誤日誌
docker exec -it nginx-container tail -f /usr/local/openresty/nginx/logs/error.log

# 查看 nginx 訪問日誌
docker exec -it nginx-container tail -f /usr/local/openresty/nginx/logs/access.log
```

### 測試健康檢查 API
```bash
# 測試健康檢查端點
curl http://localhost/health

# 手動觸發監控器重新平衡
curl -X POST http://localhost/api/trigger-rebalancing
```

### 檢查節點狀態
```sql
-- 查看所有節點狀態
SELECT node_id, node_name, status, last_heartbeat, modified_date 
FROM node 
ORDER BY node_name;

-- 查看監控器分配情況
SELECT 
    m.name as monitor_name,
    m.assigned_node,
    n.node_name as node_name,
    n.status as node_status
FROM monitor m
LEFT JOIN node n ON m.assigned_node = n.node_id
ORDER BY m.name;
```

## 性能優化建議

1. **調整檢查間隔**: 根據實際需求調整心跳和故障檢查的間隔時間
2. **資料庫連接池**: 考慮在 Lua 腳本中實現資料庫連接池
3. **快取策略**: 對於頻繁查詢的節點狀態資訊，考慮使用 nginx 共享記憶體快取
4. **日誌級別**: 在生產環境中調整 Lua 腳本的日誌級別

## 故障排除

### 常見問題

1. **Lua 腳本無法載入**
   - 檢查 `lua_package_path` 配置
   - 確認 Lua 腳本文件存在且權限正確

2. **資料庫連接失敗**
   - 檢查環境變數配置
   - 確認資料庫服務可達性
   - 檢查資料庫用戶權限

3. **健康檢查不工作**
   - 檢查 nginx 錯誤日誌
   - 確認定時器是否正常啟動
   - 檢查共享記憶體配置

### 回滾方案

如果需要回滾到 Node.js 實現：

1. 恢復 `server/node-manager.js` 文件
2. 在 `uptime-kuma-server.js` 中恢復 NodeManager 的啟動代碼
3. 在 `node-socket-handler.js` 中恢復 NodeManager 的調用
4. 移除 nginx 配置中的健康檢查相關配置

## 總結

此次遷移成功將節點管理功能從 Node.js 層遷移到 Nginx + OpenResty 層，實現了：

- 更高效的資源使用
- 更簡潔的應用架構
- 更統一的負載平衡和健康檢查管理
- 更好的性能和可擴展性

新的架構保持了原有功能的完整性，同時提供了更好的性能和維護性。
