# Uptime Kuma Cluster 部署指南

## 概述

本項目實現了 Uptime Kuma 的高可用性集群部署，使用 **OpenResty (Nginx + Lua)** 實現智能負載平衡，利用 MariaDB 作為共享資料庫，支援多節點部署和自動故障轉移。

## 架構特點

- **智能負載平衡**: 基於 monitor 數量和硬體資源的動態負載分配
- **高可用性**: 多節點部署，自動故障檢測和恢復
- **Lua 腳本支援**: 可自定義負載平衡邏輯和故障處理
- **健康檢查**: 完整的服務健康監控機制
- **WebSocket 支援**: 完整的 WebSocket 代理支援

## 系統架構

```
                     ┌─────────────────┐
                     │   OpenResty     │
                     │   (Nginx+Lua)   │
                     │   智能負載平衡    │
                     └─────────┬───────┘
                               │
                     ┌─────────┴───────┐
                     │                 │
        ┌───────────▼─────────┐ ┌─────▼────────────┐
        │   Uptime Kuma       │ │   Uptime Kuma   │
        │   Node 1            │ │   Node 2        │
        │   (Port 3001)       │ │   (Port 3002)   │
        └─────────┬───────────┘ └─────┬────────────┘
                  │                   │
                  └───────┬───────────┘
                          │
                ┌─────────▼─────────┐
                │     MariaDB       │
                │   (Port 3306)     │
                └───────────────────┘
```

## 前置需求

### 系統需求
- **作業系統**: Windows 10/11, Linux, macOS
- **記憶體**: 每個節點至少 2GB RAM
- **儲存空間**: 每個節點至少 10GB 可用空間
- **網路**: 節點間需要穩定的網路連接

### 軟體需求
- **Docker 20.10+** 或 Docker Desktop
- **Docker Compose 2.0+**
- **PowerShell 5.1+** (Windows) 或 **Bash** (Linux/macOS)

## 快速開始

### 1. 克隆項目

```bash
git clone <your-repo-url>
cd kuma
```

### 2. 部署集群

#### Windows PowerShell
```powershell
# 部署集群
.\deploy-cluster.ps1 deploy

# 檢查狀態
.\deploy-cluster.ps1 status

# 查看日誌
.\deploy-cluster.ps1 logs
```

#### Linux/macOS
```bash
# 部署集群
docker-compose -f docker-compose-cluster.yaml up -d

# 檢查狀態
docker-compose -f docker-compose-cluster.yaml ps

# 查看日誌
docker-compose -f docker-compose-cluster.yaml logs -f
```

### 3. 訪問服務

- **OpenResty 負載平衡器**: http://localhost:80
- **節點 1**: http://localhost:3001
- **節點 2**: http://localhost:3002
- **節點 3**: http://localhost:3003
- **MariaDB**: localhost:3306

## 配置說明

### Docker Compose 配置

主要配置文件: `docker-compose-cluster.yaml`

```yaml
services:
  mariadb:          # MariaDB 資料庫
  openresty:        # OpenResty 負載平衡器
  uptime-kuma-node1: # 節點 1
  uptime-kuma-node2: # 節點 2
  uptime-kuma-node3: # 節點 3
```

### OpenResty 配置

- **主配置**: `nginx/nginx.conf`
- **預設配置**: `nginx/conf.d/default.conf`
- **Lua 腳本**: `lua/` 目錄

### 環境變數

| 變數名 | 說明 | 預設值 |
|--------|------|--------|
| `UPTIME_KUMA_NODE_ID` | 節點 ID | node1, node2, node3 |
| `UPTIME_KUMA_DB_TYPE` | 資料庫類型 | mariadb |
| `UPTIME_KUMA_DB_HOSTNAME` | 資料庫主機 | mariadb |
| `UPTIME_KUMA_DB_PORT` | 資料庫端口 | 3306 |
| `UPTIME_KUMA_DB_NAME` | 資料庫名稱 | kuma |
| `UPTIME_KUMA_DB_USERNAME` | 資料庫用戶名 | kuma |
| `UPTIME_KUMA_DB_PASSWORD` | 資料庫密碼 | kuma_pass |

## 負載平衡機制

### 智能負載平衡

OpenResty 使用 Lua 腳本實現智能負載平衡：

1. **監控節點負載**: 每 30 秒查詢各節點的 monitor 數量
2. **計算負載分數**: 基於 monitor 數量和硬體資源計算負載分數
3. **動態路由**: 自動選擇負載最輕的節點處理請求

### 負載分數計算

```
負載分數 = monitor_weight × 0.7 + hardware_weight × 0.3

其中：
- monitor_weight = 1 / (monitor_count + 1)
- hardware_weight = (cpu_cores × 0.6 + memory_gb × 0.4) / 10
```

### 故障檢測和恢復

- **自動故障檢測**: 定期檢查節點健康狀態
- **狀態管理**: 支援 active, dead, recovering, recovery_failed 狀態
- **自動恢復**: 節點恢復後自動重新加入負載平衡

## 監控和管理

### 監控腳本

```powershell
# 單次監控
.\monitor-cluster.ps1

# 連續監控 (每 30 秒)
.\monitor-cluster.ps1 -Continuous

# 自定義監控間隔 (每 60 秒)
.\monitor-cluster.ps1 -Interval 60 -Continuous
```

### 負載平衡測試

```powershell
# 測試 100 個請求
.\test-load-balance.ps1

# 測試 500 個請求，間隔 50ms
.\test-load-balance.ps1 -RequestCount 500 -DelayMs 50
```

### API 端點

- **健康檢查**: `GET /health`
- **負載狀態**: `GET /api/load_status`
- **手動更新負載**: `GET /api/update_loads`
- **Nginx 狀態**: `GET /nginx_status`

## 故障排除

### 常見問題

#### 1. 容器無法啟動

```bash
# 檢查日誌
docker-compose -f docker-compose-cluster.yaml logs

# 檢查端口衝突
netstat -an | findstr :80
netstat -an | findstr :3001
```

#### 2. 負載平衡不工作

```bash
# 檢查 OpenResty 配置
docker exec uptime-kuma-openresty nginx -t

# 檢查 Lua 腳本
docker exec uptime-kuma-openresty ls -la /usr/local/openresty/lualib/
```

#### 3. 資料庫連接失敗

```bash
# 檢查 MariaDB 狀態
docker exec uptime-kuma-mariadb mysqladmin ping -h 127.0.0.1 -u kuma -p

# 檢查網路
docker network ls
docker network inspect kuma_kuma-network
```

### 日誌查看

```bash
# 查看所有服務日誌
docker-compose -f docker-compose-cluster.yaml logs -f

# 查看特定服務日誌
docker-compose -f docker-compose-cluster.yaml logs -f openresty
docker-compose -f docker-compose-cluster.yaml logs -f uptime-kuma-node1
```

## 擴展和自定義

### 添加新節點

1. 在 `docker-compose-cluster.yaml` 中添加新節點服務
2. 在 `nginx/nginx.conf` 的 upstream 中添加新節點
3. 在資料庫中添加新節點記錄

### 自定義負載平衡邏輯

修改 `lua/load_balancer.lua` 中的負載計算邏輯：

```lua
-- 自定義負載分數計算
node.load_score = your_custom_calculation(node)
```

### 添加新的監控指標

在 `lua/fault_detection.lua` 中添加新的健康檢查邏輯。

## 性能優化

### 系統調優

- **增加 worker 進程**: 修改 `nginx/nginx.conf` 中的 `worker_processes`
- **調整連接數**: 修改 `worker_connections` 和 `keepalive_timeout`
- **啟用 Gzip**: 已預設啟用，可調整壓縮級別

### 資料庫優化

- **連接池**: 調整 MariaDB 的 `max_connections`
- **查詢快取**: 啟用 MariaDB 查詢快取
- **索引優化**: 為 `monitor` 表的 `node_id` 添加索引

## 安全考慮

### 網路安全

- **防火牆**: 只開放必要的端口 (80, 443, 3001-3003)
- **內部網路**: 使用 Docker 內部網路隔離服務
- **SSL/TLS**: 支援 HTTPS 配置

### 資料安全

- **資料庫密碼**: 使用強密碼並定期更換
- **備份策略**: 定期備份 MariaDB 資料
- **存取控制**: 限制資料庫存取權限

## 備份和恢復

### 資料庫備份

```bash
# 創建備份
docker exec uptime-kuma-mariadb mysqldump -u kuma -p kuma > backup.sql

# 恢復備份
docker exec -i uptime-kuma-mariadb mysql -u kuma -p kuma < backup.sql
```

### 配置備份

```bash
# 備份配置
tar -czf kuma-cluster-config-$(date +%Y%m%d).tar.gz nginx/ lua/ docker-compose-cluster.yaml
```

## 更新和維護

### 更新集群

```bash
# 停止集群
.\deploy-cluster.ps1 stop

# 拉取最新鏡像
docker-compose -f docker-compose-cluster.yaml pull

# 重新部署
.\deploy-cluster.ps1 deploy
```

### 定期維護

- **日誌輪轉**: 定期清理舊日誌文件
- **資料庫維護**: 定期執行 `OPTIMIZE TABLE` 和 `ANALYZE TABLE`
- **系統更新**: 定期更新 Docker 和系統套件

## 支援和貢獻

### 問題回報

如果遇到問題，請：

1. 檢查日誌文件
2. 查看故障排除指南
3. 在 GitHub Issues 中回報問題

### 貢獻代碼

歡迎提交 Pull Request 來改進項目：

1. Fork 項目
2. 創建功能分支
3. 提交變更
4. 創建 Pull Request

## 授權

本項目採用 MIT 授權條款，詳見 [LICENSE](LICENSE) 文件。

## 更新日誌

### v1.0.0 (2025-01-01)
- 初始版本發布
- 支援 3 節點集群部署
- OpenResty 智能負載平衡
- 自動故障檢測和恢復
- PowerShell 部署和監控腳本
