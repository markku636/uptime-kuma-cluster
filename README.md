
-----

## 🎯 系統概述

本專案是一個基於 **Nginx OpenResty** 的智能負載平衡和健康檢查系統，專為 **Uptime Kuma** 的多節點集群部署而設計。系統透過 Lua 腳本實現了應用層級的邏輯，具備自動故障檢測、故障轉移（Failover）、智能負載分配以及監控任務的重新平衡（Rebalancing）功能，確保監控服務的高可用性（HA）。

- 部落格詳解（架構與實作心法）：https://blog.markkulab.net/implement-uptime-kuma-cluster-vibe-coding/

-----

## 🚀 快速開始（Windows）

- **前置需求**：已安裝 Docker Desktop；已安裝 Node.js 18+；PowerShell 5.1（預設）。
- **啟動三節點叢集 + OpenResty 代理**：

```powershell
# 於專案根目錄執行
& 'C:\Program Files\Docker\Docker\resources\bin\docker.EXE' compose -f 'docker-compose-cluster.yaml' up -d --build

# 查看容器狀態
& 'C:\Program Files\Docker\Docker\resources\bin\docker.EXE' ps

# 檢查健康狀態 API（代理）
Invoke-WebRequest -Uri 'http://localhost/api/system-status' | Select-Object -ExpandProperty Content
```

- **單機開發模式（僅後端 / 前端）**：
  - 後端（Node）：`node start-server.js`
  - 前端（Vite）：`npm run dev`

如需更完整的部署與集群說明，請參考 `CLUSTER_DEPLOYMENT_GUIDE.md` 與 `nginx.conf`。

-----

## ⚡ 功能特性

| 特性 | 描述 |
| :--- | :--- |
| **⚖️ 智能負載平衡** | 根據節點當前的監控器數量（Monitor Count）計算負載分數，自動將請求路由至最空閒的節點。 |
| **💓 主動健康檢查** | 系統每 **60秒** 對節點進行一次主動健康檢查，確保節點響應正常。 |
| **🔄 自動故障轉移** | 當檢測到節點故障（連續 3 次失敗）時，自動將該節點的監控任務轉移至其他健康節點。 |
| **🛡️ 節點恢復管理** | 內建 **5分鐘** 的冷靜恢復機制，防止節點頻繁震盪（Flapping）影響系統穩定性。 |
| **⚖️ 監控器再平衡** | 支援手動或自動觸發監控器重新分配，確保長期運行下的集群負載均衡。 |

-----

## 📦 目錄導覽

- `docker-compose-cluster.yaml`：啟動多節點 Uptime Kuma + OpenResty 代理的 Compose 檔。
- `nginx/`、`nginx.conf`：OpenResty/Nginx 主設定與站台設定。
- `lua/`：負載平衡與健康檢查 Lua 腳本。
- `server/`：Kuma 伺服端邏輯（認證、作業排程、通知等）。
- `db/`：資料庫初始化與遷移腳本（Knex）。
- `extra/`：輔助工具與腳本，例如版本更新、健康檢查、範例伺服器等。
- `public/`、`src/`：前端資源與程式碼。
- `API_DOCUMENTATION.md`：HTTP API 詳細說明與使用範例。

-----

## 🏗️ 架構設計

### 系統邏輯架構

```mermaid
graph TD
    Client[Client Request] --> Nginx[Nginx OpenResty<br>Load Balancer]
    
    subgraph "Nginx Logic (Lua)"
        LB[Load Balancer]
        HC[Health Check & Failover]
    end
    
    Nginx --> LB
    Nginx --> HC
    
    LB -->|Route to Best Node| Node1
    LB -->|Route to Best Node| Node2
    LB -->|Route to Best Node| Node3
    
    HC -.->|Monitor| Node1[Uptime Kuma Node 1<br>:3001]
    HC -.->|Monitor| Node2[Uptime Kuma Node 2<br>:3002]
    HC -.->|Monitor| Node3[Uptime Kuma Node 3<br>:3003]
    
    Node1 --> DB[(MariaDB Database)]
    Node2 --> DB
    Node3 --> DB
```

### 負載平衡決策流程

1.  **請求到達**：Nginx 接收到客戶端請求。
2.  **獲取負載**：Lua 腳本從共享記憶體讀取各節點當前的監控器數量。
3.  **計算分數**：使用公式 `Score = 1 / (monitor_count + 1)` 計算負載分數。
4.  **選擇節點**：選擇分數最高（負載最低）的節點進行路由。
5.  **後端處理**：請求被轉發至選定的 Uptime Kuma 節點。

-----

## 🔧 模組說明

系統核心邏輯由兩個主要的 Lua 模組構成：

### 1\. 負載平衡器 (`load_balancer.lua`)

負責處理請求分發邏輯與負載計算。

  * **核心職責**：
      * **負載決策**：執行節點選擇算法。
      * **狀態更新**：每 **30秒** 更新一次節點的負載資訊。
      * **再平衡**：提供手動觸發重新分配監控器的功能。
  * **關鍵函數**：
      * `balance_load()`: 執行負載平衡邏輯。
      * `get_best_node()`: 比較分數並返回最佳節點。
      * `trigger_manual_rebalancing()`: 觸發監控任務的重新分配。

### 2\. 健康檢查模組 (`health_check.lua`)

負責維護集群穩定性與故障處理。

  * **核心職責**：
      * **心跳機制**：每 **60秒** 發送心跳包。
      * **故障檢測**：每 **10秒** 高頻掃描節點狀態。
      * **故障轉移**：當節點標記為 `offline` 時，執行監控器轉移邏輯。
  * **關鍵函數**：
      * `perform_health_check()`: 執行 HTTP/TCP 探測。
      * `check_nodes_and_handle_failover()`: 核心故障轉移邏輯。
      * `handle_node_failover()`: 具體執行資料庫層面的任務轉移。

-----

## 🌐 API 接口

openresty 提供了一系列 HTTP API 用於監控狀態與管理集群。

### 🔍 狀態監控

| 方法 | 路徑 | 描述 |
| :--- | :--- | :--- |
| `GET` | `/health` | 返回 Nginx 負載平衡器本身的健康狀態與時間戳。 |
| `GET` | `/api/system-status` | **推薦**：返回所有模組的綜合狀態資訊（包含節點、負載、故障檢測）。 |
| `GET` | `/api/node-status` | 返回所有後端節點的詳細狀態（Online/Offline/Recovering）。 |
| `GET` | `/api/load-balancer-status` | 查看節點負載分數、最後更新時間。 |
| `GET` | `/api/health-check-status` | 查看心跳統計、故障轉移歷史記錄。 |
| `GET` | `/api/fault-detection-status` | 查看故障檢測掃描器的運行統計。 |

### ⚙️ 管理與操作

| 方法 | 路徑 | 描述 |
| :--- | :--- | :--- |
| `GET` | `/api/update-loads` | 手動強制更新負載資訊。 |
| `GET` | `/api/trigger-rebalancing` | 手動觸發一次監控器重新平衡。 |
| `GET` | `/api/force-rebalance-all` | **危險**：強制重新分配所有監控器（用於集群嚴重不平衡時）。 |
| `GET` | `/api/rebalancing-status` | 查看當前重新平衡操作的進度與統計。 |

-----

## ⚙️ 配置說明

### 1\. 環境變數

請確保 Nginx 運行環境中包含以下變數（推薦在 `nginx.conf` 或 Docker `env` 中設置）：

```bash
# 資料庫配置 (用於 Lua 連接 MariaDB)
DB_HOST=mariadb
DB_PORT=3306
DB_USER=kuma
DB_PASSWORD=kuma_pass
DB_NAME=kuma

# 本地節點標識
UPTIME_KUMA_NODE_ID=nginx-node
UPTIME_KUMA_NODE_HOST=127.0.0.1
```

### 2\. Nginx 共享記憶體

在 `nginx.conf` 的 `http` 區塊中定義 Lua 共享字典：

```nginx
http {
    # ... 其他配置
    
    # 分配共享記憶體區域
    lua_shared_dict load_balancer 10m;    # 存儲負載狀態
    lua_shared_dict fault_detector 5m;    # 存儲故障檢測計數
    lua_shared_dict health_checker 5m;    # 存儲健康檢查結果
    
    # ...
}
```

### 3\. 定時任務 (Timers)

Lua 腳本中預設的定時器間隔：

  * **負載更新**: `30s`
  * **故障掃描**: `10s`
  * **心跳發送**: `60s`
  * **故障轉移檢查**: `60s`

-----

## 🚀 部署指南

### 前置需求

  * **Nginx OpenResty** (建議版本 1.19+)
  * **MariaDB/MySQL** (Uptime Kuma 的數據存儲)
  * **Uptime Kuma** (已配置為多節點模式運行)

### 步驟 1: 部署 Lua 腳本

將 `lua` 資料夾中的腳本複製到 OpenResty 的庫目錄：

```bash
cp lua/load_balancer.lua /usr/local/openresty/lualib/
cp lua/health_check.lua /usr/local/openresty/lualib/
```

### 步驟 2: 配置 Nginx

複製並修改 `nginx.conf`：

```bash
cp nginx/nginx.conf /usr/local/openresty/nginx/conf/
```

確保 `upstream` 塊正確指向你的 Uptime Kuma 節點：

```nginx
upstream uptime_kuma_backend {
    zone uptime_kuma_backend 64k;
    ip_hash; # 作為基礎，Lua 會覆蓋此決策
    
    server uptime-kuma-node1:3001 max_fails=3 fail_timeout=30s;
    server uptime-kuma-node2:3002 max_fails=3 fail_timeout=30s;
    server uptime-kuma-node3:3003 max_fails=3 fail_timeout=30s;
    
    keepalive 32;
}
```

### 步驟 3: 啟動服務

```bash
# 檢查配置語法
nginx -t

# 啟動或重載 Nginx
nginx -s reload

# 驗證系統狀態
curl http://localhost/api/system-status
```

-----

## 🧪 測試與工具

- **K6 API 壓力測試**：
  - 綜合測試：`k6-api-comprehensive-test.js`
  - 併發建立監控器：`k6-create-100-monitors.js`
  - 單路由壓測：`k6-monitor-test.js`
  - 執行方式（PowerShell）：

```powershell
# 需要已安裝 k6；於專案根目錄
k6 run .\k6-api-comprehensive-test.js
```

## 📊 監控與維護

為了確保生產環境的穩定性，建議關注以下指標：

1.  **日誌監控**：
      * `/usr/local/openresty/nginx/logs/error.log`: 關注 Lua 腳本報錯或資料庫連接錯誤。
2.  **API 巡檢**：
      * 定期調用 `/api/node-status` 確保沒有節點卡在 `recovering` 狀態過久。
3.  **故障排查檢查清單**：
      * 🔍 **資料庫連接**：Lua 腳本依賴直接寫入 DB 來轉移監控器，確保 DB 帳號權限正確。
      * 🔍 **網絡延遲**：如果心跳頻繁超時，考慮增加 `timeout` 設定。

-----

## 🔒 安全考量
-----

## ❓ 常見問題（FAQ）

- **API 返回 502 / 504**：
  - 檢查 `nginx/logs/error.log` 是否有 Lua 或資料庫連線錯誤。
  - 確認 `DB_*` 環境變數已在容器或系統層正確設置。
- **節點反覆恢復/離線（Flapping）**：
  - 調整健康檢查間隔或超時；檢查網路延遲與節點負載。
- **監控器分佈不均**：
  - 使用 `/api/trigger-rebalancing` 或 `/api/force-rebalance-all` 進行再平衡。

-----

## 📚 相關文件

- `API_DOCUMENTATION.md`：完整 API 規範與示例。
- `CLUSTER_DEPLOYMENT_GUIDE.md`：集群部署與操作指南。
- `PUBLIC_STATUS_PAGINATION_PLAN.md`：公開狀態頁分頁計畫。
- `SECURITY.md`、`CODE_OF_CONDUCT.md`、`CONTRIBUTING.md`：安全與貢獻規範。



  * **API 訪問控制**：目前的 API 接口未配置認證，建議在 Nginx 中透過 `allow/deny` 指令限制僅內網 IP 可訪問 `/api/` 路徑，或添加 Basic Auth。
  * **資料庫憑證**：避免將密碼硬編碼在 Lua 腳本中，始終使用 `os.getenv` 讀取環境變數。

