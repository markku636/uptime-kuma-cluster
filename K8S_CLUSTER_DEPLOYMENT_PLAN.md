# Uptime Kuma Kubernetes Cluster 部署計劃

## 目標
1. 將現有的 Uptime Kuma 從 Docker Compose 架構遷移到 Kubernetes 集群部署
2. **保持 Docker Compose 和 K8s 雙環境兼容**
3. 解決動態 Node ID 問題

---

## 一、現有架構深度分析

### 1.1 目前 Node ID 機制

**Docker Compose 中寫死**：
```yaml
# docker-compose-cluster.yaml
environment:
  UPTIME_KUMA_NODE_ID: "node1"
  UPTIME_KUMA_NODE_NAME: "node1"
  UPTIME_KUMA_NODE_HOST: "uptime-kuma-node1:3001"
  UPTIME_KUMA_PRIMARY: "true"  # 主節點
```

**Node.js 初始化**：
```javascript
// server/model/node.js - initializeFromEnv()
const currentNodeId = process.env.UPTIME_KUMA_NODE_ID || process.env.NODE_ID || null;
// 啟動時從環境變數讀取，自動註冊到資料庫
```

### 1.2 目前的 Host 解析邏輯

**Lua config.lua**：
```lua
_M.cluster = {
    node_count = tonumber(os.getenv("CLUSTER_NODE_COUNT")) or 3,
    monitor_limit_per_node = tonumber(os.getenv("MONITOR_LIMIT_PER_NODE")) or 1000,
    default_node = "node1",
    default_port = 3001,
    node_host_prefix = "uptime-kuma-"  -- Docker 服務名稱前綴
}
```

**Lua monitor_router.lua - pick_node_for_request()**：
```lua
-- node_id 例如 "node2" -> 映射到 Docker 服務名稱
local host = config.cluster.node_host_prefix .. node_id  -- "uptime-kuma-node2"
local port = config.cluster.default_port  -- 3001
```

**DNS 解析 (Docker 環境)**：
```lua
local resolver = require "resty.dns.resolver"
local r = resolver:new{
    nameservers = {"127.0.0.11"},  -- Docker 內建 DNS
    ...
}
```

### 1.3 關鍵影響點總覽

| 組件 | 檔案 | 影響點 | Docker Compose | K8s |
|------|------|--------|----------------|-----|
| Node ID | `server/model/node.js` | `initializeFromEnv()` | 環境變數寫死 | Pod 名稱動態 |
| Node Host 構建 | `lua/config.lua` | `node_host_prefix` | `uptime-kuma-` | 需支援 K8s DNS |
| Node Host 映射 | `lua/monitor_router.lua` | `pick_node_for_request()` | `uptime-kuma-node1` | `uptime-kuma-0.headless.ns` |
| DNS 解析 | `lua/monitor_router.lua` | `resolve_host()` | Docker DNS `127.0.0.11` | K8s CoreDNS |
| 健康檢查 | `lua/health_check.lua` | `check_node_health()` | 透過 hostname | 透過 Service DNS |
| 主節點判定 | `server/model/node.js` | `isPrimary` | 環境變數指定 | Pod index 0 自動判定 |

### 1.4 K8s 遷移的挑戰

| 問題 | Docker Compose | K8s StatefulSet |
|------|---------------|-----------------|
| Node ID 格式 | `node1`, `node2` | `uptime-kuma-0`, `uptime-kuma-1` |
| Host 格式 | `uptime-kuma-node1:3001` | `uptime-kuma-0.uptime-kuma-headless.ns.svc:3001` |
| DNS Server | `127.0.0.11` (Docker) | CoreDNS (通常 `10.96.0.10`) |
| 擴縮容 | 手動修改 yaml | 自動擴縮，節點需自動註冊/註銷 |
| 故障恢復 | 容器重啟保持 ID | Pod 重建，StatefulSet 保持穩定名稱 |
| 主節點 | `UPTIME_KUMA_PRIMARY=true` | 需自動判定（index 0） |

---

## 二、雙環境兼容設計（核心）

### 2.1 環境偵測機制

透過環境變數自動判斷運行環境：

```javascript
// 新增: server/util/cluster-env.js

/**
 * 集群環境偵測工具
 */
class ClusterEnv {
    constructor() {
        this._detectEnvironment();
    }

    _detectEnvironment() {
        // 偵測 K8s 環境的標誌
        this.isK8s = !!(
            process.env.KUBERNETES_SERVICE_HOST ||  // K8s 自動注入
            process.env.K8S_MODE === 'true' ||
            process.env.NAMESPACE
        );
        
        // 偵測 Docker Compose 環境
        this.isDockerCompose = !this.isK8s && !!(
            process.env.UPTIME_KUMA_NODE_HOST?.includes('uptime-kuma-node') ||
            process.env.COMPOSE_PROJECT_NAME
        );
        
        // 本地開發環境
        this.isLocal = !this.isK8s && !this.isDockerCompose;
    }
    
    /**
     * 取得環境名稱
     */
    getEnvironmentName() {
        if (this.isK8s) return 'kubernetes';
        if (this.isDockerCompose) return 'docker-compose';
        return 'local';
    }
    
    /**
     * 偵測 Node ID 格式
     * @param {string} nodeId 
     * @returns {'k8s-statefulset' | 'docker-compose' | 'custom'}
     */
    detectNodeIdFormat(nodeId) {
        if (!nodeId) return 'custom';
        
        // K8s StatefulSet 格式: xxx-0, xxx-1
        if (/^[\w-]+-\d+$/.test(nodeId)) {
            return 'k8s-statefulset';
        }
        
        // Docker Compose 格式: node1, node2
        if (/^node\d+$/.test(nodeId)) {
            return 'docker-compose';
        }
        
        return 'custom';
    }
    
    /**
     * 從 Node ID 提取索引
     * @param {string} nodeId 
     * @returns {number|null}
     */
    extractNodeIndex(nodeId) {
        if (!nodeId) return null;
        
        // K8s 格式: uptime-kuma-0 -> 0
        const k8sMatch = nodeId.match(/-(\d+)$/);
        if (k8sMatch) return parseInt(k8sMatch[1], 10);
        
        // Docker Compose 格式: node1 -> 0 (1-indexed to 0-indexed)
        const dockerMatch = nodeId.match(/^node(\d+)$/);
        if (dockerMatch) return parseInt(dockerMatch[1], 10) - 1;
        
        return null;
    }
    
    /**
     * 判斷是否為主節點
     * @param {string} nodeId 
     * @returns {boolean}
     */
    isPrimaryNode(nodeId) {
        // 環境變數明確指定
        if (process.env.UPTIME_KUMA_PRIMARY === '1' || 
            process.env.UPTIME_KUMA_PRIMARY === 'true') {
            return true;
        }
        
        // 根據索引判斷（index 0 為主節點）
        const index = this.extractNodeIndex(nodeId);
        return index === 0;
    }
    
    /**
     * 構建 Node Host
     * @param {string} nodeId 
     * @returns {string}
     */
    buildNodeHost(nodeId) {
        // 如果環境變數已指定，直接使用
        if (process.env.UPTIME_KUMA_NODE_HOST) {
            return process.env.UPTIME_KUMA_NODE_HOST;
        }
        
        const port = process.env.UPTIME_KUMA_PORT || '3001';
        
        if (this.isK8s) {
            // K8s Headless Service DNS 格式
            const namespace = process.env.NAMESPACE || 'default';
            const serviceName = process.env.HEADLESS_SERVICE_NAME || 'uptime-kuma-headless';
            return `${nodeId}.${serviceName}.${namespace}.svc.cluster.local:${port}`;
        }
        
        if (this.isDockerCompose) {
            // Docker Compose 格式
            const format = this.detectNodeIdFormat(nodeId);
            if (format === 'docker-compose') {
                // node1 -> uptime-kuma-node1
                return `uptime-kuma-${nodeId}:${port}`;
            }
            // 自定義格式，假設 container name = nodeId
            return `${nodeId}:${port}`;
        }
        
        // 本地開發
        return `127.0.0.1:${port}`;
    }
    
    /**
     * 取得 DNS 伺服器
     * @returns {string[]}
     */
    getDnsServers() {
        if (this.isK8s) {
            // K8s CoreDNS - 從 /etc/resolv.conf 讀取或使用預設
            return process.env.DNS_SERVERS?.split(',') || ['10.96.0.10'];
        }
        
        if (this.isDockerCompose) {
            // Docker 內建 DNS
            return ['127.0.0.11'];
        }
        
        // 本地環境
        return ['8.8.8.8', '8.8.4.4'];
    }
}

module.exports = new ClusterEnv();
```

### 2.2 修改 server/model/node.js（雙環境兼容）

```javascript
const { BeanModel } = require("redbean-node/dist/bean-model");
const { R } = require("redbean-node");
const { log } = require("../../src/util");
const clusterEnv = require("../util/cluster-env");

class Node extends BeanModel {
    // ... 現有方法保持不變 ...

    /**
     * Initialize node from environment variable if set
     * 支援 Docker Compose 和 K8s 雙環境
     * @returns {Promise<void>}
     */
    static async initializeFromEnv() {
        const currentNodeId = process.env.UPTIME_KUMA_NODE_ID || process.env.NODE_ID || null;
        
        if (currentNodeId) {
            try {
                const envName = clusterEnv.getEnvironmentName();
                const nodeFormat = clusterEnv.detectNodeIdFormat(currentNodeId);
                
                log.info("node", `Initializing node in ${envName} environment (format: ${nodeFormat})`);
                
                // 判斷主節點
                const isPrimary = clusterEnv.isPrimaryNode(currentNodeId);
                
                // 構建 Node Host
                const nodeHost = clusterEnv.buildNodeHost(currentNodeId);
                
                // Node Name（優先使用環境變數，否則使用 Node ID）
                const nodeName = process.env.UPTIME_KUMA_NODE_NAME || currentNodeId;
                
                // 檢查節點是否已存在
                const existingNode = await Node.getByNodeId(currentNodeId);
                
                if (existingNode) {
                    log.info("node", `Node ${currentNodeId} exists, updating...`);
                    const now = R.isoDateTime();
                    await R.exec(
                        "UPDATE node SET node_name = ?, host = ?, modified_date = ?, status = ?, last_seen = ? WHERE node_id = ?",
                        [nodeName, nodeHost, now, "online", now, currentNodeId]
                    );
                    
                    // 如果是主節點但資料庫未標記，更新之
                    if (isPrimary && !existingNode.is_primary) {
                        await Node.setPrimaryNode(currentNodeId);
                    }
                } else {
                    log.info("node", `Creating new node: ${currentNodeId} (${nodeName})`);
                    log.info("node", `  Environment: ${envName}`);
                    log.info("node", `  Host: ${nodeHost}`);
                    log.info("node", `  Primary: ${isPrimary}`);
                    
                    await Node.createOrUpdate(currentNodeId, nodeName, nodeHost, isPrimary);
                }
                
            } catch (error) {
                log.error("node", `Failed to initialize node ${currentNodeId}: ${error.message}`);
            }
        } else {
            // 沒有環境變數，創建預設節點
            const existingNodes = await Node.getAll();
            if (existingNodes.length === 0) {
                log.info("node", "No nodes found, creating default local node.");
                await Node.createOrUpdate("local-node", "Local Node", "127.0.0.1:3001", true);
            }
        }
    }
}
```

### 2.3 修改 lua/config.lua（雙環境兼容）

```lua
--[[
  集中配置模組 - 支援 Docker Compose 和 K8s 雙環境
]]
local _M = {}

-- 環境偵測
local function detect_environment()
    -- K8s 環境標誌
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

-- 資料庫配置（兩種環境相同）
_M.database = {
    host = os.getenv("DB_HOST") or "mariadb",
    port = tonumber(os.getenv("DB_PORT")) or 3306,
    user = os.getenv("DB_USER") or "kuma",
    password = os.getenv("DB_PASSWORD") or "kuma_pass",
    database = os.getenv("DB_NAME") or "kuma",
    timeout = tonumber(os.getenv("DB_TIMEOUT")) or 5000
}

-- K8s 專用配置
_M.k8s = {
    enabled = (_M.environment == "kubernetes"),
    namespace = os.getenv("K8S_NAMESPACE") or os.getenv("NAMESPACE") or "default",
    headless_service = os.getenv("K8S_HEADLESS_SERVICE") or "uptime-kuma-headless",
    -- CoreDNS 地址（通常不需要指定，使用 /etc/resolv.conf）
    dns_server = os.getenv("K8S_DNS_SERVER") or nil
}

-- 集群配置（根據環境調整）
_M.cluster = {
    node_count = tonumber(os.getenv("CLUSTER_NODE_COUNT")) or 5,
    monitor_limit_per_node = tonumber(os.getenv("MONITOR_LIMIT_PER_NODE")) or 1000,
    default_port = tonumber(os.getenv("CLUSTER_DEFAULT_PORT")) or 3001,
    
    -- 根據環境決定預設節點和前綴
    default_node = _M.environment == "kubernetes" and "uptime-kuma-0" or "node1",
    
    -- Docker Compose: "uptime-kuma-"
    -- K8s: "" (因為 node_id 就是完整的 pod name)
    node_host_prefix = _M.environment == "kubernetes" and "" or (os.getenv("NODE_HOST_PREFIX") or "uptime-kuma-")
}

-- DNS 配置（根據環境調整）
_M.dns = {
    -- Docker: 127.0.0.11
    -- K8s: 使用 /etc/resolv.conf 或指定的 CoreDNS
    servers = _M.environment == "kubernetes" 
        and { _M.k8s.dns_server or "10.96.0.10" }
        or { "127.0.0.11" },
    timeout = 2000,
    retrans = 3
}

-- 健康檢查配置（兩種環境相同）
_M.health_check = {
    interval = tonumber(os.getenv("HEALTH_CHECK_INTERVAL")) or 30,
    timeout = tonumber(os.getenv("HEALTH_CHECK_TIMEOUT")) or 5000,
    consecutive_failures_threshold = 3,
    consecutive_success_threshold = 3
}

-- Cookie 配置（兩種環境相同）
_M.cookie = {
    fixed_node_name = "KUMA_FIXED_NODE",
    fixed_node_expires = 604800  -- 7 天
}

-- 快取配置（兩種環境相同）
_M.cache = {
    monitor_routing_ttl = 300  -- 5 分鐘
}

-- 調試配置
_M.debug = {
    enabled = os.getenv("EMMY_DEBUG_ENABLED") == "true",
    host = os.getenv("EMMY_DEBUG_HOST") or "0.0.0.0",
    port = tonumber(os.getenv("EMMY_DEBUG_PORT")) or 9966,
    log_level = os.getenv("DEBUG_LOG_LEVEL") or "INFO"
}

-- ============================================================
-- 輔助函數
-- ============================================================

--- 根據 node_id 構建完整的 host 地址
--- @param node_id string 節點 ID（如 "node1" 或 "uptime-kuma-0"）
--- @return string host 完整的 host:port 地址
function _M.build_node_host(node_id)
    if not node_id then
        return nil
    end
    
    local port = _M.cluster.default_port
    
    if _M.environment == "kubernetes" then
        -- K8s: uptime-kuma-0.uptime-kuma-headless.namespace.svc.cluster.local:3001
        -- 但如果資料庫 node.host 已經存了完整地址，直接使用
        if node_id:find("%.") then
            -- 已經是完整 FQDN
            return node_id .. ":" .. port
        end
        return string.format("%s.%s.%s.svc.cluster.local:%d",
            node_id,
            _M.k8s.headless_service,
            _M.k8s.namespace,
            port
        )
    else
        -- Docker Compose: uptime-kuma-node1:3001
        -- 檢查 node_id 格式
        if node_id:match("^node%d+$") then
            -- node1 -> uptime-kuma-node1
            return _M.cluster.node_host_prefix .. node_id .. ":" .. port
        elseif node_id:match("^uptime%-kuma%-") then
            -- 已經有前綴
            return node_id .. ":" .. port
        else
            -- 自定義格式
            return _M.cluster.node_host_prefix .. node_id .. ":" .. port
        end
    end
end

--- 從資料庫 node.host 欄位取得 host（優先使用資料庫值）
--- @param node table 節點資料（包含 node_id 和 host）
--- @return string, number host 和 port
function _M.get_node_host_port(node)
    local host, port
    
    -- 優先使用資料庫中儲存的 host
    if node.host and node.host ~= "" then
        -- 解析 host:port
        local h, p = node.host:match("^([^:]+):?(%d*)$")
        host = h or node.host
        port = tonumber(p) or _M.cluster.default_port
    else
        -- Fallback: 根據 node_id 構建
        local full_host = _M.build_node_host(node.node_id)
        host, port = full_host:match("^([^:]+):(%d+)$")
        port = tonumber(port) or _M.cluster.default_port
    end
    
    return host, port
end

--- 偵測 node_id 格式
--- @param node_id string
--- @return string 'k8s-statefulset' | 'docker-compose' | 'custom'
function _M.detect_node_id_format(node_id)
    if not node_id then return "custom" end
    
    -- K8s StatefulSet: xxx-0, xxx-1
    if node_id:match("^[%w%-]+%-(%d+)$") then
        return "k8s-statefulset"
    end
    
    -- Docker Compose: node1, node2
    if node_id:match("^node%d+$") then
        return "docker-compose"
    end
    
    return "custom"
end

--- 記錄環境資訊（啟動時呼叫）
function _M.log_environment()
    ngx.log(ngx.INFO, "========================================")
    ngx.log(ngx.INFO, "Uptime Kuma Cluster Environment")
    ngx.log(ngx.INFO, "========================================")
    ngx.log(ngx.INFO, "Environment: ", _M.environment)
    ngx.log(ngx.INFO, "Default Node: ", _M.cluster.default_node)
    ngx.log(ngx.INFO, "Node Host Prefix: ", _M.cluster.node_host_prefix)
    ngx.log(ngx.INFO, "DNS Servers: ", table.concat(_M.dns.servers, ", "))
    if _M.k8s.enabled then
        ngx.log(ngx.INFO, "K8s Namespace: ", _M.k8s.namespace)
        ngx.log(ngx.INFO, "K8s Headless Service: ", _M.k8s.headless_service)
    end
    ngx.log(ngx.INFO, "========================================")
end

return _M
```

### 2.4 修改 lua/monitor_router.lua（雙環境兼容）

```lua
-- 修改 resolve_host() 函數支援雙環境 DNS

local function resolve_host(hostname)
    local resolver = require "resty.dns.resolver"
    
    -- 使用配置的 DNS 伺服器
    local r, err = resolver:new{
        nameservers = config.dns.servers,
        retrans = config.dns.retrans,
        timeout = config.dns.timeout,
    }
    
    if not r then
        ngx.log(ngx.ERR, "failed to create resolver: ", err)
        return nil, err
    end
    
    local answers, err = r:query(hostname, { qtype = r.TYPE_A })
    if not answers then
        ngx.log(ngx.ERR, "failed to query DNS for ", hostname, ": ", err)
        return nil, err
    end
    
    if answers.errcode then
        ngx.log(ngx.ERR, "DNS error for ", hostname, ": ", answers.errstr)
        return nil, answers.errstr
    end
    
    for _, ans in ipairs(answers) do
        if ans.type == r.TYPE_A then
            ngx.log(ngx.DEBUG, "resolved ", hostname, " to ", ans.address)
            return ans.address
        end
    end
    
    return nil, "no A record found"
end

-- 修改 pick_node_for_request() 使用 config 輔助函數

function _M.pick_node_for_request()
    local db_conn, err = db_connect()
    if not db_conn then
        ngx.log(ngx.ERR, "pick_node_for_request: cannot connect to DB")
        -- Fallback
        local fallback_host = config.build_node_host(config.cluster.default_node)
        local host, port = fallback_host:match("^([^:]+):(%d+)$")
        return host, tonumber(port)
    end

    local sql = [[
        SELECT
            n.node_id,
            n.host,
            COUNT(m.id) AS monitor_count
        FROM node n
        LEFT JOIN monitor m
            ON m.node_id = n.node_id
           AND m.active = 1
        WHERE n.status = 'online'
        GROUP BY n.node_id, n.host
        ORDER BY monitor_count ASC, n.node_id ASC
        LIMIT 1
    ]]

    local res, qerr = db_conn:query(sql)
    db_conn:close()

    if not res or #res == 0 then
        ngx.log(ngx.ERR, "pick_node_for_request: no online nodes found")
        local fallback_host = config.build_node_host(config.cluster.default_node)
        local host, port = fallback_host:match("^([^:]+):(%d+)$")
        return host, tonumber(port)
    end

    local row = res[1]
    
    -- 使用 config 輔助函數取得 host 和 port
    local host, port = config.get_node_host_port(row)
    
    ngx.log(ngx.INFO,
        "pick_node_for_request: routed to ", host, ":", port,
        " (node_id=", row.node_id, ", monitors=", row.monitor_count, ")"
    )
    
    return host, port
end
```

### 2.5 環境變數對照表

| 環境變數 | Docker Compose | K8s | 說明 |
|---------|----------------|-----|------|
| `UPTIME_KUMA_NODE_ID` | `node1`, `node2` | Pod 名稱自動注入 | 節點唯一識別碼 |
| `UPTIME_KUMA_NODE_NAME` | `node1` | Pod 名稱 | 顯示名稱 |
| `UPTIME_KUMA_NODE_HOST` | `uptime-kuma-node1:3001` | 自動構建 | 節點存取地址 |
| `UPTIME_KUMA_PRIMARY` | `true` (node1) | 不需要，自動判定 | 是否為主節點 |
| `K8S_MODE` | 不設定 | `true` | 強制啟用 K8s 模式 |
| `NAMESPACE` | 不設定 | 自動注入 | K8s namespace |
| `HEADLESS_SERVICE_NAME` | 不設定 | `uptime-kuma-headless` | Headless service 名稱 |
| `KUBERNETES_SERVICE_HOST` | 不存在 | K8s 自動注入 | K8s 環境偵測標誌 |

---

## 三、需要修改的程式碼檔案清單

### 3.1 Node.js 端

| 檔案 | 修改內容 | 優先級 |
|------|----------|--------|
| `server/util/cluster-env.js` | **新增** - 環境偵測工具類 | P0 |
| `server/model/node.js` | 修改 `initializeFromEnv()` 支援雙環境 | P0 |
| `server/server.js` | 引入 cluster-env，啟動時記錄環境資訊 | P1 |

### 3.2 Lua 端 (OpenResty)

| 檔案 | 修改內容 | 優先級 |
|------|----------|--------|
| `lua/config.lua` | 新增環境偵測、K8s 配置、輔助函數 | P0 |
| `lua/monitor_router.lua` | 修改 `resolve_host()`、`pick_node_for_request()` | P0 |
| `lua/health_check.lua` | 修改健康檢查使用 config 輔助函數 | P1 |

### 3.3 配置檔案

| 檔案 | 修改內容 | 優先級 |
|------|----------|--------|
| `nginx/nginx.conf` | 確保使用 Lua config 的 DNS 設定 | P1 |
| `docker-compose-cluster.yaml` | 保持不變（向後兼容） | - |
| `k8s/*.yaml` | **新增** - K8s 部署檔案 | P0 |

---

## 四、推薦的 K8s 目錄結構

```
k8s/
├── base/
│   ├── namespace.yaml
│   ├── configmap.yaml
│   ├── secret.yaml
│   └── kustomization.yaml
├── database/
│   ├── mariadb-statefulset.yaml
│   ├── mariadb-service.yaml
│   ├── mariadb-pvc.yaml
│   └── kustomization.yaml
├── uptime-kuma/
│   ├── statefulset.yaml          # 使用方案 A
│   ├── service-headless.yaml     # 用於 Pod 間通訊
│   ├── service-cluster.yaml      # 用於內部存取
│   ├── configmap.yaml            # 應用配置
│   ├── hpa.yaml                  # 自動擴展
│   ├── pdb.yaml                  # Pod 中斷預算
│   └── kustomization.yaml
├── openresty/
│   ├── deployment.yaml
│   ├── service.yaml
│   ├── configmap-nginx.yaml      # nginx.conf
│   ├── configmap-lua.yaml        # lua scripts
│   └── kustomization.yaml
├── ingress/
│   ├── ingress.yaml
│   └── certificate.yaml
└── overlays/
    ├── dev/
    │   ├── kustomization.yaml
    │   └── replicas-patch.yaml   # replicas: 2
    ├── staging/
    │   └── kustomization.yaml
    └── production/
        ├── kustomization.yaml
        └── replicas-patch.yaml   # replicas: 5
```

---

## 四、完整 K8s YAML 範例

### 4.1 Namespace
```yaml
# k8s/base/namespace.yaml
apiVersion: v1
kind: Namespace
metadata:
  name: uptime-kuma
  labels:
    app.kubernetes.io/name: uptime-kuma
```

### 4.2 Secret（資料庫密碼）
```yaml
# k8s/base/secret.yaml
apiVersion: v1
kind: Secret
metadata:
  name: uptime-kuma-db-secret
  namespace: uptime-kuma
type: Opaque
stringData:
  MYSQL_ROOT_PASSWORD: "kuma_root_pass"
  MYSQL_PASSWORD: "kuma_pass"
  MYSQL_USER: "kuma"
  MYSQL_DATABASE: "kuma"
```

### 4.3 ConfigMap（應用配置）
```yaml
# k8s/uptime-kuma/configmap.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: uptime-kuma-config
  namespace: uptime-kuma
data:
  UPTIME_KUMA_DB_TYPE: "mariadb"
  UPTIME_KUMA_DB_PORT: "3306"
  UPTIME_KUMA_DISABLE_FRAME_SAMEORIGIN: "true"
  API_RATE_LIMIT: "4000"
  # Headless service 名稱，用於構建 Node Host
  HEADLESS_SERVICE_NAME: "uptime-kuma-headless"
```

### 4.4 MariaDB StatefulSet
```yaml
# k8s/database/mariadb-statefulset.yaml
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: mariadb
  namespace: uptime-kuma
spec:
  serviceName: mariadb
  replicas: 1
  selector:
    matchLabels:
      app: mariadb
  template:
    metadata:
      labels:
        app: mariadb
    spec:
      containers:
      - name: mariadb
        image: mariadb:10
        ports:
        - containerPort: 3306
        envFrom:
        - secretRef:
            name: uptime-kuma-db-secret
        volumeMounts:
        - name: mariadb-data
          mountPath: /var/lib/mysql
        livenessProbe:
          exec:
            command: ["mysqladmin", "ping", "-h", "127.0.0.1", "-uroot", "-p$(MYSQL_ROOT_PASSWORD)"]
          initialDelaySeconds: 30
          periodSeconds: 10
        readinessProbe:
          exec:
            command: ["mysqladmin", "ping", "-h", "127.0.0.1", "-uroot", "-p$(MYSQL_ROOT_PASSWORD)"]
          initialDelaySeconds: 5
          periodSeconds: 5
  volumeClaimTemplates:
  - metadata:
      name: mariadb-data
    spec:
      accessModes: ["ReadWriteOnce"]
      resources:
        requests:
          storage: 10Gi
---
# k8s/database/mariadb-service.yaml
apiVersion: v1
kind: Service
metadata:
  name: mariadb
  namespace: uptime-kuma
spec:
  selector:
    app: mariadb
  ports:
  - port: 3306
  clusterIP: None  # Headless for StatefulSet
```

### 4.5 Uptime Kuma StatefulSet（核心 - 方案 A 實作）
```yaml
# k8s/uptime-kuma/statefulset.yaml
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: uptime-kuma
  namespace: uptime-kuma
  labels:
    app: uptime-kuma
spec:
  serviceName: uptime-kuma-headless
  replicas: 5
  podManagementPolicy: OrderedReady  # 確保 Pod 按順序啟動
  selector:
    matchLabels:
      app: uptime-kuma
  template:
    metadata:
      labels:
        app: uptime-kuma
    spec:
      # 等待主節點初始化完成
      initContainers:
      - name: wait-for-db
        image: busybox:1.35
        command: ['sh', '-c']
        args:
        - |
          echo "Waiting for MariaDB to be ready..."
          until nc -z mariadb 3306; do
            sleep 2
          done
          echo "MariaDB is available!"
      - name: wait-for-primary
        image: busybox:1.35
        command: ['sh', '-c']
        args:
        - |
          POD_INDEX=$(echo $HOSTNAME | grep -oE '[0-9]+$')
          if [ "$POD_INDEX" != "0" ]; then
            echo "This is pod index $POD_INDEX, waiting for primary (uptime-kuma-0)..."
            until nslookup uptime-kuma-0.uptime-kuma-headless.uptime-kuma.svc.cluster.local; do
              echo "Primary not ready, waiting..."
              sleep 3
            done
            # 額外等待幾秒讓主節點完成初始化
            sleep 10
            echo "Primary node is available!"
          else
            echo "This is the primary node (index 0), starting immediately..."
          fi
      
      containers:
      - name: uptime-kuma
        image: uptime-kuma-cluster:latest
        imagePullPolicy: IfNotPresent
        ports:
        - containerPort: 3001
          name: http
        
        # 環境變數 - 關鍵：使用 Downward API 動態注入 Node ID
        env:
        # ===== 動態 Node ID（使用 Pod 名稱）=====
        - name: UPTIME_KUMA_NODE_ID
          valueFrom:
            fieldRef:
              fieldPath: metadata.name
        - name: UPTIME_KUMA_NODE_NAME
          valueFrom:
            fieldRef:
              fieldPath: metadata.name
        - name: NAMESPACE
          valueFrom:
            fieldRef:
              fieldPath: metadata.namespace
        - name: POD_IP
          valueFrom:
            fieldRef:
              fieldPath: status.podIP
        
        # ===== 資料庫配置 =====
        - name: UPTIME_KUMA_DB_HOSTNAME
          value: "mariadb"
        - name: UPTIME_KUMA_DB_USERNAME
          valueFrom:
            secretKeyRef:
              name: uptime-kuma-db-secret
              key: MYSQL_USER
        - name: UPTIME_KUMA_DB_PASSWORD
          valueFrom:
            secretKeyRef:
              name: uptime-kuma-db-secret
              key: MYSQL_PASSWORD
        - name: UPTIME_KUMA_DB_NAME
          valueFrom:
            secretKeyRef:
              name: uptime-kuma-db-secret
              key: MYSQL_DATABASE
        
        # ===== 從 ConfigMap 載入其他配置 =====
        envFrom:
        - configMapRef:
            name: uptime-kuma-config
        
        # ===== 健康檢查 =====
        livenessProbe:
          httpGet:
            path: /api/health
            port: 3001
          initialDelaySeconds: 60
          periodSeconds: 30
          timeoutSeconds: 10
          failureThreshold: 3
        
        readinessProbe:
          httpGet:
            path: /api/health
            port: 3001
          initialDelaySeconds: 30
          periodSeconds: 10
          timeoutSeconds: 5
          failureThreshold: 3
        
        # ===== 資源限制 =====
        resources:
          requests:
            memory: "256Mi"
            cpu: "100m"
          limits:
            memory: "512Mi"
            cpu: "500m"
        
        # ===== 持久化儲存 =====
        volumeMounts:
        - name: data
          mountPath: /app/data
  
  # Volume Claim Template - 每個 Pod 獨立的 PVC
  volumeClaimTemplates:
  - metadata:
      name: data
    spec:
      accessModes: ["ReadWriteOnce"]
      resources:
        requests:
          storage: 1Gi
```

### 4.6 Services
```yaml
# k8s/uptime-kuma/service-headless.yaml
# Headless Service - 用於 StatefulSet Pod 間通訊
apiVersion: v1
kind: Service
metadata:
  name: uptime-kuma-headless
  namespace: uptime-kuma
  labels:
    app: uptime-kuma
spec:
  clusterIP: None
  selector:
    app: uptime-kuma
  ports:
  - port: 3001
    name: http

---
# k8s/uptime-kuma/service-cluster.yaml  
# ClusterIP Service - 用於 OpenResty 負載均衡
apiVersion: v1
kind: Service
metadata:
  name: uptime-kuma
  namespace: uptime-kuma
  labels:
    app: uptime-kuma
spec:
  type: ClusterIP
  selector:
    app: uptime-kuma
  ports:
  - port: 3001
    targetPort: 3001
    name: http
```

### 4.7 OpenResty Deployment
```yaml
# k8s/openresty/deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: openresty
  namespace: uptime-kuma
spec:
  replicas: 2
  selector:
    matchLabels:
      app: openresty
  template:
    metadata:
      labels:
        app: openresty
    spec:
      containers:
      - name: openresty
        image: uptimekuma-openresty:latest
        ports:
        - containerPort: 80
        env:
        - name: DB_HOST
          value: "mariadb"
        - name: DB_PORT
          value: "3306"
        - name: DB_USER
          valueFrom:
            secretKeyRef:
              name: uptime-kuma-db-secret
              key: MYSQL_USER
        - name: DB_PASSWORD
          valueFrom:
            secretKeyRef:
              name: uptime-kuma-db-secret
              key: MYSQL_PASSWORD
        - name: DB_NAME
          valueFrom:
            secretKeyRef:
              name: uptime-kuma-db-secret
              key: MYSQL_DATABASE
        # K8s 環境的節點發現方式
        - name: K8S_MODE
          value: "true"
        - name: K8S_NAMESPACE
          value: "uptime-kuma"
        - name: K8S_SERVICE_NAME
          value: "uptime-kuma-headless"
        volumeMounts:
        - name: nginx-config
          mountPath: /usr/local/openresty/nginx/conf/nginx.conf
          subPath: nginx.conf
        - name: lua-scripts
          mountPath: /usr/local/openresty/nginx/lua
      volumes:
      - name: nginx-config
        configMap:
          name: openresty-nginx-config
      - name: lua-scripts
        configMap:
          name: openresty-lua-scripts
```

### 4.8 Ingress
```yaml
# k8s/ingress/ingress.yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: uptime-kuma
  namespace: uptime-kuma
  annotations:
    nginx.ingress.kubernetes.io/proxy-read-timeout: "3600"
    nginx.ingress.kubernetes.io/proxy-send-timeout: "3600"
    nginx.ingress.kubernetes.io/websocket-services: "openresty"
    cert-manager.io/cluster-issuer: "letsencrypt-prod"
spec:
  ingressClassName: nginx
  tls:
  - hosts:
    - status.yourdomain.com
    secretName: uptime-kuma-tls
  rules:
  - host: status.yourdomain.com
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: openresty
            port:
              number: 80
```

### 4.9 HPA（自動擴展）
```yaml
# k8s/uptime-kuma/hpa.yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: uptime-kuma-hpa
  namespace: uptime-kuma
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: StatefulSet
    name: uptime-kuma
  minReplicas: 3
  maxReplicas: 10
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 70
  - type: Resource
    resource:
      name: memory
      target:
        type: Utilization
        averageUtilization: 80
  behavior:
    scaleDown:
      stabilizationWindowSeconds: 300
      policies:
      - type: Pods
        value: 1
        periodSeconds: 60
    scaleUp:
      stabilizationWindowSeconds: 60
      policies:
      - type: Pods
        value: 2
        periodSeconds: 60
```

### 4.10 PDB（Pod 中斷預算）
```yaml
# k8s/uptime-kuma/pdb.yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: uptime-kuma-pdb
  namespace: uptime-kuma
spec:
  minAvailable: 2
  selector:
    matchLabels:
      app: uptime-kuma
```

---

## 五、程式碼修改清單

### 5.1 修改 server/model/node.js

```javascript
// 新增 K8s 環境偵測與動態 Node ID 處理

/**
 * Initialize node from environment variable if set
 * 支援 K8s StatefulSet 動態 Pod 名稱
 * @returns {Promise<void>}
 */
static async initializeFromEnv() {
    const currentNodeId = process.env.UPTIME_KUMA_NODE_ID || process.env.NODE_ID || null;
    
    if (currentNodeId) {
        try {
            // K8s StatefulSet 環境偵測
            const isK8sStatefulSet = currentNodeId.match(/^[\w-]+-\d+$/);
            
            // 從 Pod 名稱提取索引（如 uptime-kuma-0 -> 0）
            const podIndex = currentNodeId.match(/-(\d+)$/)?.[1];
            
            // 決定是否為主節點
            // 1. 環境變數明確指定
            // 2. K8s StatefulSet 中 index 0 為主節點
            const isPrimary = 
                process.env.UPTIME_KUMA_PRIMARY === "1" || 
                process.env.UPTIME_KUMA_PRIMARY === "true" ||
                (isK8sStatefulSet && podIndex === '0');
            
            // 構建 Node Host
            let nodeHost = process.env.UPTIME_KUMA_NODE_HOST;
            if (!nodeHost && isK8sStatefulSet) {
                // K8s 環境自動構建 DNS 名稱
                const namespace = process.env.NAMESPACE || 'default';
                const serviceName = process.env.HEADLESS_SERVICE_NAME || 'uptime-kuma-headless';
                nodeHost = `${currentNodeId}.${serviceName}.${namespace}.svc.cluster.local:3001`;
            }
            nodeHost = nodeHost || '127.0.0.1:3001';
            
            const nodeName = process.env.UPTIME_KUMA_NODE_NAME || currentNodeId;
            
            // 檢查節點是否已存在
            const existingNode = await Node.getByNodeId(currentNodeId);
            if (existingNode) {
                log.info("node", `Node ${currentNodeId} already exists, updating...`);
                // 更新現有節點
                const now = R.isoDateTime();
                await R.exec(
                    "UPDATE node SET node_name = ?, host = ?, modified_date = ?, status = ?, last_seen = ? WHERE node_id = ?",
                    [nodeName, nodeHost, now, "online", now, currentNodeId]
                );
            } else {
                // 創建新節點
                log.info("node", `Creating new node: ${currentNodeId} (K8s: ${isK8sStatefulSet ? 'yes' : 'no'}, Primary: ${isPrimary})`);
                await Node.createOrUpdate(currentNodeId, nodeName, nodeHost, isPrimary);
            }
            
        } catch (error) {
            log.error("node", `Failed to initialize node ${currentNodeId}: ${error.message}`);
        }
    }
}
```

### 5.2 新增節點清理機制

```javascript
// server/model/node.js - 新增方法

/**
 * 清理不健康的節點（K8s Pod 被刪除時）
 * 可由定時任務或 OpenResty 健康檢查觸發
 * @param {number} timeoutMinutes 超時分鐘數
 * @returns {Promise<number>} 清理的節點數量
 */
static async cleanupStaleNodes(timeoutMinutes = 10) {
    const cutoffTime = new Date(Date.now() - timeoutMinutes * 60 * 1000).toISOString();
    
    // 將超時節點標記為 offline
    const result = await R.exec(
        "UPDATE node SET status = 'offline', modified_date = ? WHERE last_seen < ? AND status = 'online'",
        [R.isoDateTime(), cutoffTime]
    );
    
    if (result.affectedRows > 0) {
        log.info("node", `Marked ${result.affectedRows} stale nodes as offline`);
    }
    
    return result.affectedRows || 0;
}

/**
 * 發送心跳更新
 * @returns {Promise<void>}
 */
static async sendHeartbeat() {
    const currentNodeId = process.env.UPTIME_KUMA_NODE_ID || process.env.NODE_ID;
    if (currentNodeId) {
        const now = R.isoDateTime();
        await R.exec(
            "UPDATE node SET last_seen = ?, status = 'online' WHERE node_id = ?",
            [now, currentNodeId]
        );
    }
}
```

### 5.3 修改 OpenResty Lua 腳本支援 K8s

```lua
-- lua/config.lua 新增 K8s 配置
local config = {
    -- ... 現有配置 ...
    
    k8s = {
        enabled = os.getenv("K8S_MODE") == "true",
        namespace = os.getenv("K8S_NAMESPACE") or "default",
        service_name = os.getenv("K8S_SERVICE_NAME") or "uptime-kuma-headless",
        -- K8s DNS 服務發現
        dns_pattern = function(pod_name)
            return string.format("%s.%s.%s.svc.cluster.local",
                pod_name,
                config.k8s.service_name,
                config.k8s.namespace
            )
        end
    }
}
```

---

## 六、實施時程表（詳細）

### Phase 1: 程式碼修改 - 雙環境兼容（Day 1-3）

| 任務 | 檔案 | 預估時間 | 優先級 |
|------|------|---------|--------|
| 建立 cluster-env.js | `server/util/cluster-env.js` | 2 小時 | P0 |
| 修改 node.js initializeFromEnv | `server/model/node.js` | 2 小時 | P0 |
| 修改 config.lua 支援雙環境 | `lua/config.lua` | 3 小時 | P0 |
| 修改 monitor_router.lua | `lua/monitor_router.lua` | 2 小時 | P0 |
| 修改 health_check.lua | `lua/health_check.lua` | 1 小時 | P1 |
| 單元測試 | - | 2 小時 | P1 |
| **小計** | | **12 小時** | |

### Phase 2: Docker Compose 回歸測試（Day 4）

| 任務 | 說明 | 預估時間 |
|------|------|---------|
| 啟動現有 Docker Compose 集群 | 確保修改後仍能正常運作 | 1 小時 |
| 功能測試 | Monitor CRUD、WebSocket、路由 | 2 小時 |
| 擴縮容測試 | 新增/移除節點 | 1 小時 |
| 修復發現的問題 | - | 2 小時 |
| **小計** | | **6 小時** |

### Phase 3: K8s 基礎設施準備（Day 5-6）

| 任務 | 檔案 | 預估時間 |
|------|------|---------|
| 建立 k8s/ 目錄結構 | - | 0.5 小時 |
| 建立 namespace, secret, configmap | `k8s/base/*.yaml` | 1 小時 |
| 建立 MariaDB StatefulSet | `k8s/database/*.yaml` | 1 小時 |
| 部署並驗證 MariaDB | - | 1 小時 |
| 建立 Uptime Kuma StatefulSet | `k8s/uptime-kuma/*.yaml` | 2 小時 |
| 建立 OpenResty Deployment | `k8s/openresty/*.yaml` | 1 小時 |
| 建立 Ingress | `k8s/ingress/*.yaml` | 1 小時 |
| 建立 Kustomize overlays | `k8s/overlays/` | 1 小時 |
| **小計** | | **8.5 小時** |

### Phase 4: K8s 部署與測試（Day 7-8）

| 任務 | 說明 | 預估時間 |
|------|------|---------|
| 部署到 K8s (dev 環境) | `kubectl apply -k k8s/overlays/dev` | 1 小時 |
| 驗證 Pod 啟動順序 | 確認 uptime-kuma-0 先啟動 | 0.5 小時 |
| 驗證節點自動註冊 | 檢查資料庫 node 表 | 0.5 小時 |
| 功能測試 | Monitor CRUD、WebSocket | 2 小時 |
| 擴縮容測試 | `kubectl scale` | 1 小時 |
| 故障恢復測試 | `kubectl delete pod` | 1 小時 |
| 效能測試 | - | 2 小時 |
| **小計** | | **8 小時** |

### Phase 5: 文件與上線（Day 9-10）

| 任務 | 說明 | 預估時間 |
|------|------|---------|
| 更新 README | 新增 K8s 部署說明 | 2 小時 |
| 建立 K8s 部署指南 | - | 2 小時 |
| 生產環境部署 | - | 2 小時 |
| 監控設定 | Prometheus + Grafana | 2 小時 |
| **小計** | | **8 小時** |

### 總時程

| Phase | 任務 | 工時 |
|-------|------|------|
| Phase 1 | 程式碼修改 | 12 小時 |
| Phase 2 | Docker Compose 回歸測試 | 6 小時 |
| Phase 3 | K8s 基礎設施 | 8.5 小時 |
| Phase 4 | K8s 部署測試 | 8 小時 |
| Phase 5 | 文件與上線 | 8 小時 |
| **總計** | | **42.5 小時** |

---

## 七、測試計劃

### 7.1 Docker Compose 環境測試

```powershell
# 測試腳本: test-docker-compose.ps1

# 1. 啟動集群
docker-compose -f docker-compose-cluster.yaml up -d --build

# 2. 等待所有節點就緒
Start-Sleep -Seconds 60

# 3. 檢查節點註冊
$nodes = Invoke-RestMethod -Uri "http://localhost:8084/api/v1/nodes"
Write-Host "Registered nodes: $($nodes.data.Count)"

# 4. 驗證節點 ID 格式（應為 node1, node2...）
foreach ($node in $nodes.data) {
    if ($node.nodeId -match "^node\d+$") {
        Write-Host "✓ Node $($node.nodeId) - Docker Compose format"
    } else {
        Write-Host "✗ Node $($node.nodeId) - Unexpected format"
    }
}

# 5. 測試 Monitor 路由
$monitor = @{
    name = "Test Monitor"
    type = "http"
    url = "https://google.com"
} | ConvertTo-Json
# ... 建立 monitor 並驗證路由

# 6. 關閉集群
docker-compose -f docker-compose-cluster.yaml down
```

### 7.2 K8s 環境測試

```bash
#!/bin/bash
# test-k8s.sh

# 1. 部署到 K8s
kubectl apply -k k8s/overlays/dev

# 2. 等待所有 Pod 就緒
kubectl wait --for=condition=ready pod -l app=uptime-kuma -n uptime-kuma --timeout=300s

# 3. 檢查節點註冊
kubectl exec -it uptime-kuma-0 -n uptime-kuma -- curl -s localhost:3001/api/v1/nodes

# 4. 驗證節點 ID 格式（應為 uptime-kuma-0, uptime-kuma-1...）
# ...

# 5. 測試擴縮容
kubectl scale statefulset uptime-kuma -n uptime-kuma --replicas=7
sleep 60
kubectl scale statefulset uptime-kuma -n uptime-kuma --replicas=5

# 6. 驗證新節點自動註冊，縮容後節點標記為 offline

# 7. 測試故障恢復
kubectl delete pod uptime-kuma-2 -n uptime-kuma
# 驗證 Monitor 重新分配

# 8. 清理
kubectl delete -k k8s/overlays/dev
```

### 7.3 雙環境兼容性測試矩陣

| 測試項目 | Docker Compose | K8s | 預期結果 |
|---------|----------------|-----|---------|
| Node ID 格式 | `node1` | `uptime-kuma-0` | 兩者皆可正常識別 |
| 主節點判定 | `UPTIME_KUMA_PRIMARY=true` | Pod index 0 | 正確判定 |
| Node Host 構建 | `uptime-kuma-node1:3001` | FQDN DNS | 正確解析 |
| DNS 解析 | `127.0.0.11` | CoreDNS | 正常解析 |
| 健康檢查 | ✓ | ✓ | 正常運作 |
| Monitor 路由 | ✓ | ✓ | 正確路由 |
| 擴縮容 | 手動 | 自動 | 節點正確註冊/註銷 |
| 故障轉移 | ✓ | ✓ | Monitor 重新分配 |

---

## 八、監控與可觀測性

### 8.1 Prometheus ServiceMonitor
```yaml
apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
metadata:
  name: uptime-kuma
  namespace: uptime-kuma
spec:
  selector:
    matchLabels:
      app: uptime-kuma
  endpoints:
  - port: http
    interval: 30s
    path: /metrics
```

### 8.2 關鍵監控指標

| 指標 | 說明 | 告警閾值 |
|------|------|---------|
| `uptime_kuma_node_status` | 節點狀態 | offline > 5 分鐘 |
| `uptime_kuma_monitor_count` | 各節點 monitor 數量 | 不平衡 > 20% |
| `uptime_kuma_api_latency` | API 回應時間 | > 1 秒 |
| `uptime_kuma_websocket_connections` | WebSocket 連線數 | < 預期 80% |

### 8.3 Grafana Dashboard
- Node 狀態監控
- Monitor 執行狀況
- API 回應時間
- WebSocket 連線數

---

## 九、回滾計劃

### 9.1 程式碼回滾

如果修改後的程式碼導致問題：

```bash
# 回滾到上一個版本
git revert HEAD

# 或回滾到指定 commit
git checkout <commit-hash> -- server/model/node.js lua/config.lua
```

### 9.2 K8s 部署回滾

```bash
# 1. 停止 K8s 部署
kubectl delete -f k8s/uptime-kuma/

# 2. 恢復 Docker Compose
docker-compose -f docker-compose-cluster.yaml up -d

# 3. 切換 DNS 回原本的環境
```

### 9.3 資料庫回滾

如果需要清理 K8s 環境產生的節點：

```sql
-- 刪除 K8s 格式的節點（uptime-kuma-X）
DELETE FROM node WHERE node_id LIKE 'uptime-kuma-%';

-- 或將所有節點標記為離線
UPDATE node SET status = 'offline' WHERE node_id LIKE 'uptime-kuma-%';
```

---

## 十、待確認事項

1. **儲存方案**: 使用哪種 PersistentVolume？（NFS/Longhorn/雲端）
2. **Image Registry**: 使用 Docker Hub 還是私有 Registry？
3. **Ingress Controller**: 使用 Nginx Ingress 還是其他？
4. **證書管理**: 使用 cert-manager 還是手動管理？
5. **監控堆疊**: 是否已有 Prometheus + Grafana？
6. **資料庫**: 是否需要在 K8s 中部署 MariaDB，還是使用外部資料庫？

---

## 十一、參考資源

- [Kubernetes StatefulSet 官方文檔](https://kubernetes.io/docs/concepts/workloads/controllers/statefulset/)
- [Downward API](https://kubernetes.io/docs/concepts/workloads/pods/downward-api/)
- [Headless Services](https://kubernetes.io/docs/concepts/services-networking/service/#headless-services)
- [Kustomize](https://kustomize.io/)

---

## 十二、實施完成記錄

### 12.1 已完成的程式碼修改

| 檔案 | 狀態 | 描述 |
|------|------|------|
| `server/util/cluster-env.js` | ✅ 完成 | 新增環境偵測工具類別，支援 Docker Compose 和 K8s 雙環境 |
| `server/model/node.js` | ✅ 完成 | 修改 `initializeFromEnv()` 使用 cluster-env 工具 |
| `lua/config.lua` | ✅ 完成 | 完全重寫，加入環境偵測和輔助函數 |
| `lua/monitor_router.lua` | ✅ 完成 | 修改 `route_to_primary_node()`, `pick_node_for_request()`, `resolve_host()` |
| `lua/health_check.lua` | ✅ 完成 | 修改 `check_node_health()` port 預設值 |

### 12.2 已建立的 K8s 資源

```
k8s/
├── kustomization.yaml           # ✅ Kustomize 配置
├── deploy.sh                    # ✅ 部署腳本
├── README.md                    # ✅ 部署指南
├── base/
│   ├── namespace.yaml           # ✅ 命名空間
│   ├── secret.yaml              # ✅ 密鑰（資料庫密碼）
│   └── configmap.yaml           # ✅ 配置
├── database/
│   └── mariadb-statefulset.yaml # ✅ MariaDB StatefulSet + Service
├── uptime-kuma/
│   ├── statefulset.yaml         # ✅ Uptime Kuma StatefulSet
│   ├── service-headless.yaml    # ✅ Headless Service（Pod DNS）
│   ├── service-cluster.yaml     # ✅ ClusterIP Service
│   └── ingress.yaml             # ✅ Ingress 配置
└── openresty/
    ├── configmap-nginx.yaml     # ✅ Nginx 配置
    └── deployment.yaml          # ✅ OpenResty Deployment + Service
```

### 12.3 環境變數對照表

| 用途 | Docker Compose | Kubernetes |
|------|---------------|------------|
| 環境偵測 | `COMPOSE_PROJECT_NAME` (自動) | `K8S_MODE=true` 或 `KUBERNETES_SERVICE_HOST` (自動) |
| 節點 ID | `UPTIME_KUMA_NODE_ID=node1` | `UPTIME_KUMA_NODE_ID` (Downward API 注入 pod name) |
| 節點 Host | `UPTIME_KUMA_NODE_HOST=uptime-kuma-node1:3001` | 自動構建: `uptime-kuma-0.headless.ns.svc.cluster.local:3001` |
| 主節點 | `UPTIME_KUMA_PRIMARY=true` | Pod index 0 自動判定 |
| DNS | `127.0.0.11` (Docker DNS) | CoreDNS (`10.96.0.10`) |

### 12.4 下一步行動

1. **測試 Docker Compose**
   ```bash
   docker-compose -f docker-compose-cluster.yaml up --build
   ```

2. **測試 K8s 部署**
   ```bash
   cd k8s
   chmod +x deploy.sh
   ./deploy.sh apply
   ```

3. **驗證項目**
   - [ ] 節點自動註冊
   - [ ] 主節點選舉
   - [ ] Monitor 路由
   - [ ] 健康檢查
   - [ ] WebSocket 連線

