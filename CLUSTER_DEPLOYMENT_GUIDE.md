# Uptime Kuma Cluster 部署指南 (OpenResty 版本)

## 概述

本指南說明如何將 Uptime Kuma 從單節點部署擴充為高可用性的 cluster 模式，使用 **OpenResty (Nginx + Lua)** 實現智能負載平衡，利用 MariaDB 作為共享資料庫和新增的節點管理功能。

## 架構圖

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
- **節點數量**: 建議至少 3 個節點 (1 個主節點 + 2 個工作節點)
- **記憶體**: 每個節點至少 2GB RAM
- **儲存空間**: 每個節點至少 10GB 可用空間
- **網路**: 節點間需要穩定的網路連接

### 軟體需求
- **OpenResty 1.21+** (Nginx + Lua 整合版本)
- **MariaDB 10.5+** 或 MySQL 8.0+
- **Docker 20.10+** 或 Docker Compose 2.0+

## 部署步驟

### 1. 安裝 OpenResty

#### 1.1 安裝 OpenResty

```bash
#!/bin/bash
# install-openresty.sh

echo "=== 安裝 OpenResty ==="

# 安裝依賴
echo "安裝依賴套件..."
sudo apt-get update
sudo apt-get install -y build-essential libpcre3-dev libssl-dev zlib1g-dev

# 下載 OpenResty
echo "下載 OpenResty..."
cd /tmp
wget https://openresty.org/download/openresty-1.21.4.1.tar.gz
tar -xzf openresty-1.21.4.1.tar.gz
cd openresty-1.21.4.1

# 編譯安裝
echo "編譯安裝 OpenResty..."
./configure --prefix=/usr/local/openresty \
            --with-http_stub_status_module \
            --with-http_realip_module \
            --with-http_ssl_module \
            --with-http_gzip_static_module \
            --with-http_upstream_check_module

make -j$(nproc)
sudo make install

# 創建系統服務
echo "創建系統服務..."
sudo tee /etc/systemd/system/openresty.service > /dev/null << EOF
[Unit]
Description=OpenResty HTTP Server
After=network.target

[Service]
Type=forking
PIDFile=/usr/local/openresty/nginx/logs/nginx.pid
ExecStartPre=/usr/local/openresty/nginx/sbin/nginx -t
ExecStart=/usr/local/openresty/nginx/sbin/nginx
ExecReload=/usr/local/openresty/nginx/sbin/nginx -s reload
ExecStop=/usr/local/openresty/nginx/sbin/nginx -s stop
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF

# 啟用服務
sudo systemctl daemon-reload
sudo systemctl enable openresty
sudo systemctl start openresty

echo "=== OpenResty 安裝完成 ==="
echo "服務狀態: sudo systemctl status openresty"
echo "重啟服務: sudo systemctl restart openresty"
```

### 2. 準備 MariaDB 資料庫

#### 2.1 創建 MariaDB 容器

```yaml
# docker-compose-mariadb.yml
version: '3.8'

services:
  mariadb:
    image: mariadb:10.11
    container_name: uptime-kuma-mariadb
    restart: unless-stopped
    environment:
      MYSQL_ROOT_PASSWORD: your_root_password
      MYSQL_DATABASE: uptime_kuma
      MYSQL_USER: uptime_kuma
      MYSQL_PASSWORD: your_uptime_kuma_password
    volumes:
      - mariadb_data:/var/lib/mysql
      - ./mariadb/init:/docker-entrypoint-initdb.d
    ports:
      - "3306:3306"
    networks:
      - uptime_kuma_network

volumes:
  mariadb_data:

networks:
  uptime_kuma_network:
    driver: bridge
```

### 3. 配置 OpenResty 負載平衡器

#### 3.1 創建 OpenResty 容器

```yaml
# docker-compose-openresty.yml
version: '3.8'

services:
  openresty:
    image: openresty/openresty:1.21.4.1-alpine
    container_name: uptime-kuma-openresty
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx/nginx.conf:/etc/nginx/nginx.conf:ro
      - ./nginx/conf.d:/etc/nginx/conf.d:ro
      - ./nginx/ssl:/etc/nginx/ssl:ro
      - ./nginx/logs:/var/log/nginx
    depends_on:
      - uptime-kuma-node1
      - uptime-kuma-node2
      - uptime-kuma-node3
    networks:
      - uptime_kuma_network
    healthcheck:
      test: ["CMD", "wget", "--quiet", "--tries=1", "--spider", "http://localhost/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s

volumes:
  nginx_logs:

networks:
  uptime_kuma_network:
    external: true
```

#### 3.2 OpenResty 配置檔案

創建 `nginx/nginx.conf`:

```nginx
user nginx;
worker_processes auto;
error_log /var/log/nginx/error.log warn;
pid /var/run/nginx.pid;

events {
    worker_connections 1024;
    use epoll;
    multi_accept on;
}

http {
    include /etc/nginx/mime.types;
    default_type application/octet-stream;

    # 日誌格式
    log_format main '$remote_addr - $remote_user [$time_local] "$request" '
                    '$status $body_bytes_sent "$http_referer" '
                    '"$http_user_agent" "$http_x_forwarded_for"';

    access_log /var/log/nginx/access.log main;

    # 基本設定
    sendfile on;
    tcp_nopush on;
    tcp_nodelay on;
    keepalive_timeout 65;
    types_hash_max_size 2048;
    client_max_body_size 100M;

    # Gzip 壓縮
    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_types text/plain text/css text/xml text/javascript application/javascript application/xml+rss application/json;

    # 上游伺服器配置
    upstream uptime_kuma_backend {
        least_conn;
        server uptime-kuma-node1:3001 max_fails=3 fail_timeout=30s;
        server uptime-kuma-node2:3001 max_fails=3 fail_timeout=30s;
        server uptime-kuma-node3:3001 max_fails=3 fail_timeout=30s;
        
        # 健康檢查
        keepalive 32;
    }

    # 健康檢查端點
    server {
        listen 80;
        server_name _;
        
        location /health {
            access_log off;
            return 200 "healthy\n";
            add_header Content-Type text/plain;
        }
    }

    # 主要服務配置
    server {
        listen 80;
        server_name _;
        
        # 安全標頭
        add_header X-Frame-Options "SAMEORIGIN" always;
        add_header X-Content-Type-Options "nosniff" always;
        add_header X-XSS-Protection "1; mode=block" always;
        add_header Referrer-Policy "strict-origin-when-cross-origin" always;

        # 靜態檔案快取
        location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg)$ {
            expires 1y;
            add_header Cache-Control "public, immutable";
            proxy_pass http://uptime_kuma_backend;
        }

        # API 和主要請求
        location / {
            proxy_pass http://uptime_kuma_backend;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
            
            # WebSocket 支援
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection "upgrade";
            
            # 超時設定
            proxy_connect_timeout 60s;
            proxy_send_timeout 60s;
            proxy_read_timeout 60s;
            
            # 緩衝設定
            proxy_buffering on;
            proxy_buffer_size 4k;
            proxy_buffers 8 4k;
        }
    }
}
```

創建 `nginx/conf.d/default.conf`:

```nginx
# 預設伺服器配置
server {
    listen 80 default_server;
    server_name _;
    
    # 重定向到 HTTPS (如果啟用)
    # return 301 https://$server_name$request_uri;
    
    # 或者直接代理到後端
    location / {
        proxy_pass http://uptime_kuma_backend;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

#### 2.2 初始化資料庫

使用 Knex Migrations 來管理資料庫結構，參考 `db/knex_migrations` 資料夾的寫法：

創建 `db/knex_migrations/2025-01-01-0000-create-cluster-tables.js`:

```javascript
// 已改用 `node` 表，舊的 `heartbeat_nodes` 遷移已移除
```

創建 `db/knex_migrations/2025-01-01-0001-add-node-id-to-monitor.js`:

```javascript
exports.up = function (knex) {
    return knex.schema.alterTable("monitor", function (table) {
        table.string("node_id", 50).nullable();
        table.index("node_id", "idx_node_id");
    });
};

exports.down = function (knex) {
    return knex.schema.alterTable("monitor", function (table) {
        table.dropIndex("node_id", "idx_node_id");
        table.dropColumn("node_id");
    });
};
```

**注意事項：**
- 使用 Knex 方法而非原生 SQL，確保支援 SQLite 和 MariaDB
- 遵循命名規範：`YYYY-MM-DD-HHMM-description.js`
- 所有表格必須有名為 `id` 的主鍵
- 使用 `exports.up` 和 `exports.down` 函數來支援回滾

### 4. 配置 Uptime Kuma 節點

#### 4.1 更新現有的 docker-compose-single-node.yaml

基於現有的 `docker-compose-single-node.yaml`，我們需要加入 OpenResty 服務：

```yaml
# docker-compose-single-node.yaml (更新版)
version: '3.8'

volumes:
  kuma-db:
    name: kuma-db
    driver: local
    driver_opts:
      type: none
      o: bind
      device: /data/volume/uptimekuma
  nginx_logs:

services:
  mariadb:
    image: mariadb:10
    container_name: uptime-kuma-mariadb
    environment:
      MYSQL_ROOT_PASSWORD: kuma_root_pass
      MYSQL_DATABASE: kuma
      MYSQL_USER: kuma
      MYSQL_PASSWORD: kuma_pass
    volumes:
      - kuma-db:/var/lib/mysql
    ports:
      - "33066:3306"
    restart: unless-stopped
    networks:
      - kuma-network
    healthcheck:
      test: [ "CMD-SHELL", "mysqladmin ping -h 127.0.0.1 -u$$MYSQL_USER -p$$MYSQL_PASSWORD --silent" ]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 20s

  # 新增 OpenResty 負載平衡器
  openresty:
    image: openresty/openresty:1.21.4.1-alpine
    container_name: uptime-kuma-openresty
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx/nginx.conf:/etc/nginx/nginx.conf:ro
      - ./nginx/conf.d:/etc/nginx/conf.d:ro
      - ./nginx/ssl:/etc/nginx/ssl:ro
      - ./nginx/logs:/var/log/nginx
    depends_on:
      - uptime-kuma-node1
      - uptime-kuma-node2
    networks:
      - kuma-network
    healthcheck:
      test: ["CMD", "wget", "--quiet", "--tries=1", "--spider", "http://localhost/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s

  uptime-kuma-node1:
    image: ${IMAGE}
    build:
      context: .
      dockerfile: docker/dockerfile
      target: release
    container_name: uptime-kuma-node1
    volumes:
      - ./data/node1:/app/data
    ports:
      - "3001:3001"
    environment:
      - UM_ALLOW_IFRAME=true
      - UPTIME_KUMA_DISABLE_FRAME_SAMEORIGIN=true
      - UPTIME_KUMA_DB_TYPE=mariadb
      - UPTIME_KUMA_DB_HOSTNAME=mariadb
      - UPTIME_KUMA_DB_PORT=3306
      - UPTIME_KUMA_DB_NAME=kuma
      - UPTIME_KUMA_DB_USERNAME=kuma
      - UPTIME_KUMA_DB_PASSWORD=kuma_pass
      - UPTIME_KUMA_NODE_ID=node1
      - UPTIME_KUMA_FORCE_MIGRATE=true
    depends_on:
      mariadb:
        condition: service_healthy
    restart: unless-stopped
    networks:
      - kuma-network

  uptime-kuma-node2:
    image: ${IMAGE}
    build:
      context: .
      dockerfile: docker/dockerfile
      target: release
    container_name: uptime-kuma-node2
    volumes:
      - ./data/node2:/app/data
    ports:
      - "3002:3001"
    environment:
      - UM_ALLOW_IFRAME=true
      - UPTIME_KUMA_DISABLE_FRAME_SAMEORIGIN=true
      - UPTIME_KUMA_DB_TYPE=mariadb
      - UPTIME_KUMA_DB_HOSTNAME=mariadb
      - UPTIME_KUMA_DB_PORT=3306
      - UPTIME_KUMA_DB_NAME=kuma
      - UPTIME_KUMA_DB_USERNAME=kuma
      - UPTIME_KUMA_DB_PASSWORD=kuma_pass
      - UPTIME_KUMA_NODE_ID=node2
      - UPTIME_KUMA_FORCE_MIGRATE=true
    depends_on:
      mariadb:
        condition: service_healthy
    restart: unless-stopped
    networks:
      - kuma-network

networks:
  kuma-network:
    external: true
```

**主要更新內容：**

1. **新增 OpenResty 服務**：作為負載平衡器，監聽 80 和 443 端口
2. **整合現有配置**：保留原有的 MariaDB 和兩個 Uptime Kuma 節點
3. **網路配置**：所有服務使用同一個 `kuma-network` 網路
4. **依賴關係**：OpenResty 依賴於兩個 Uptime Kuma 節點
5. **健康檢查**：為 OpenResty 添加健康檢查機制

**使用方式：**

```bash
# 啟動所有服務
docker-compose -f docker-compose-single-node.yaml up -d

# 查看服務狀態
docker-compose -f docker-compose-single-node.yaml ps

# 查看日誌
docker-compose -f docker-compose-single-node.yaml logs -f openresty
```

**訪問方式：**
- **OpenResty 負載平衡器**：http://localhost (端口 80)
- **節點 1**：http://localhost:3001
- **節點 2**：http://localhost:3002
- **MariaDB**：localhost:33066
    container_name: uptime-kuma-node1
    restart: unless-stopped
    environment:
      - NODE_ENV=production
      - UPTIME_KUMA_IS_CONTAINER=1
      - DB_TYPE=mysql
      - DB_HOST=mariadb
      - DB_PORT=3306
      - DB_NAME=uptime_kuma
      - DB_USER=uptime_kuma
      - DB_PASSWORD=your_uptime_kuma_password
      - NODE_ID=node1
      - NODE_ROLE=primary
    volumes:
      - uptime_kuma_data_node1:/app/data
      - uptime_kuma_logs_node1:/app/logs
    ports:
      - "3001:3001"
    depends_on:
      - mariadb
    networks:
      - uptime_kuma_network

volumes:
  uptime_kuma_data_node1:
  uptime_kuma_logs_node1:

networks:
  uptime_kuma_network:
    external: true
```

#### 3.2 工作節點配置

```yaml
# docker-compose-node2.yml
version: '3.8'

services:
  uptime-kuma-node2:
    image: your-registry/uptime-kuma:latest
    container_name: uptime-kuma-node2
    restart: unless-stopped
    environment:
      - NODE_ENV=production
      - UPTIME_KUMA_IS_CONTAINER=1
      - DB_TYPE=mysql
      - DB_HOST=mariadb
      - DB_PORT=3306
      - DB_NAME=uptime_kuma
      - DB_USER=uptime_kuma
      - DB_PASSWORD=your_uptime_kuma_password
      - NODE_ID=node2
      - NODE_ROLE=worker
    volumes:
      - uptime_kuma_data_node2:/app/data
      - uptime_kuma_logs_node2:/app/logs
    ports:
      - "3002:3001"
    depends_on:
      - mariadb
    networks:
      - uptime_kuma_network

volumes:
  uptime_kuma_data_node2:
  uptime_kuma_logs_node2:

networks:
  uptime_kuma_network:
    external: true
```

### 4. OpenResty 智能負載平衡配置

#### 4.1 Lua 負載平衡腳本

創建 `lua/load_balancer.lua` 腳本：

```lua
-- lua/load_balancer.lua - OpenResty 智能負載平衡器
local cjson = require "cjson"
local mysql = require "resty.mysql"

-- 共享記憶體區域
local balancer = ngx.shared.load_balancer

-- 資料庫連接配置
local db_config = {
    host = os.getenv("DB_HOST") or "localhost",
    port = os.getenv("DB_PORT") or 3306,
    user = os.getenv("DB_USER") or "uptime_kuma",
    password = os.getenv("DB_PASSWORD") or "your_password",
    database = os.getenv("DB_NAME") or "uptime_kuma"
}

-- 獲取節點負載資訊
local function get_node_loads()
    local db, err = mysql:new()
    if not db then
        ngx.log(ngx.ERR, "創建 MySQL 連接失敗: ", err)
        return nil
    end
    
    -- 設置連接超時
    db:set_timeout(5000)
    
    -- 連接到資料庫
    local ok, err = db:connect(db_config)
    if not ok then
        ngx.log(ngx.ERR, "連接資料庫失敗: ", err)
        return nil
    end
    
    -- 查詢各節點的 monitor 數量
    local sql = [[
        SELECT 
            n.node_id,
            n.host,
            n.port,
            n.status,
            COUNT(m.id) as monitor_count
        FROM node n
        LEFT JOIN monitor m ON n.node_id = m.assigned_node
        WHERE n.status = 'online'
        GROUP BY n.node_id, n.status
        ORDER BY monitor_count ASC
    ]]
    
    local res, err = db:query(sql)
    if not res then
        ngx.log(ngx.ERR, "查詢失敗: ", err)
        db:close()
        return nil
    end
    
    -- 關閉資料庫連接
    db:close()
    
    -- 計算負載分數
    for i, node in ipairs(res) do
        local monitor_weight = 1 / (node.monitor_count + 1)
        node.load_score = monitor_weight
    end
    
    return res
end

-- 更新負載資訊
local function update_load_info()
    local node_loads = get_node_loads()
    if node_loads then
        balancer:set("node_loads", cjson.encode(node_loads))
        balancer:set("last_update", ngx.time())
        ngx.log(ngx.INFO, "負載資訊已更新")
        return true
    end
    return false
end

-- 獲取最佳節點
local function get_best_node()
    local node_loads_json = balancer:get("node_loads")
    if not node_loads_json then
        return nil
    end
    
    local node_loads = cjson.decode(node_loads_json)
    if not node_loads or #node_loads == 0 then
        return nil
    end
    
    -- 按負載分數排序，選擇分數最高的節點
    table.sort(node_loads, function(a, b)
        return a.load_score > b.load_score
    end)
    
    local best_node = node_loads[1]
    ngx.log(ngx.INFO, string.format("最佳節點: %s, 負載分數: %.3f, 監控數量: %d", 
        best_node.node_id, best_node.load_score, best_node.monitor_count))
    
    return best_node
end

-- 負載平衡決策
local function balance_load()
    local current_time = ngx.time()
    local last_update = balancer:get("last_update") or 0
    
    -- 每30秒更新一次負載資訊
    if current_time - last_update > 30 then
        update_load_info()
    end
    
    -- 獲取最佳節點
    local best_node = get_best_node()
    if best_node then
        -- 設置路由到最佳節點
        ngx.var.backend = string.format("http://%s:%s", best_node.host, best_node.port)
        return true
    end
    
    return false
end

-- 導出函數
return {
    balance_load = balance_load,
    get_best_node = get_best_node,
    update_load_info = update_load_info
}
```

#### 4.2 OpenResty 主配置檔案

```nginx
# nginx.conf - OpenResty 智能負載平衡配置
worker_processes auto;
worker_rlimit_nofile 65535;

events {
    use epoll;
    worker_connections 65535;
    multi_accept on;
}

http {
    # 基本設定
    include mime.types;
    default_type application/octet-stream;
    
    # 日誌格式
    log_format main '$remote_addr - $remote_user [$time_local] "$request" '
                    '$status $body_bytes_sent "$http_referer" '
                    '"$http_user_agent" "$http_x_forwarded_for" '
                    'upstream: $upstream_addr '
                    'upstream_status: $upstream_status '
                    'upstream_response_time: $upstream_response_time';
    
    access_log /var/log/nginx/access.log main;
    error_log /var/log/nginx/error.log;
    
    # 啟用 Lua 模組
    lua_load_resty_core off;
    lua_package_path "/usr/local/openresty/lualib/?.lua;;";
    
    # 共享記憶體區域
    lua_shared_dict load_balancer 10m;
    
    # 初始化腳本
    init_by_lua_block {
        require "resty.core"
        local load_balancer = require "load_balancer"
        
        -- 初始化負載平衡器
        local balancer = ngx.shared.load_balancer
        balancer:set("last_update", 0)
        balancer:set("node_loads", "{}")
        
        -- 首次更新負載資訊
        load_balancer.update_load_info()
    }
    
    # 定期更新負載資訊
    init_worker_by_lua_block {
        local load_balancer = require "load_balancer"
        
        local function update_worker()
            while true do
                ngx.sleep(30)  -- 每30秒更新一次
                load_balancer.update_load_info()
            end
        end
        
        ngx.timer.at(0, update_worker)
    }
    
    # 上游伺服器配置
upstream uptime_kuma_backend {
        zone uptime_kuma_backend 64k;
        
        # 動態節點配置
        server node1:3001 max_fails=3 fail_timeout=30s;
        server node2:3001 max_fails=3 fail_timeout=30s;
        server node3:3001 max_fails=3 fail_timeout=30s;
        
        # 健康檢查
        health_check interval=5s fails=3 passes=2 uri=/health;
}

server {
    listen 80;
    server_name your-domain.com;

        # 主要代理配置
    location / {
            access_by_lua_block {
                local load_balancer = require "load_balancer"
                
                -- 執行負載平衡決策
                local success = load_balancer.balance_load()
                if not success then
                    ngx.log(ngx.WARN, "負載平衡決策失敗，使用預設 upstream")
                end
            }
            
        proxy_pass http://uptime_kuma_backend;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # WebSocket 支援
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        
        # 超時設定
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
            
            # 故障處理
            proxy_next_upstream error timeout http_500 http_502 http_503 http_504;
            proxy_next_upstream_tries 3;
            proxy_next_upstream_timeout 10s;
        }
        
        # 負載平衡狀態 API
        location /api/load_status {
            content_by_lua_block {
                local balancer = ngx.shared.load_balancer
                local node_loads = balancer:get("node_loads")
                local last_update = balancer:get("last_update")
                
                ngx.header.content_type = "application/json"
                ngx.say(string.format('{"node_loads": %s, "last_update": %d}', 
                    node_loads or "{}", last_update or 0))
            }
        }
        
        # 手動觸發負載更新
        location /api/update_loads {
            content_by_lua_block {
                local load_balancer = require "load_balancer"
                
                local success = load_balancer.update_load_info()
                if success then
                    ngx.say('{"status": "success", "message": "負載資訊已更新"}')
                else
                    ngx.say('{"status": "error", "message": "負載資訊更新失敗"}')
                end
            }
        }
        
        # 健康檢查端點
        location /health {
            access_log off;
            return 200 '{"status":"healthy","timestamp":"$time_iso8601"}';
            add_header Content-Type application/json;
        }
        
        # Nginx 狀態監控
        location /nginx_status {
            stub_status on;
            access_log off;
            allow 127.0.0.1;
            deny all;
        }
    }
}
```

### 5. 故障檢測和自動恢復

#### 5.1 故障檢測 Lua 腳本

創建 `lua/fault_detection.lua` 腳本：

```lua
-- lua/fault_detection.lua - 故障檢測和恢復
local cjson = require "cjson"
local http = require "resty.http"
local mysql = require "resty.mysql"

-- 共享記憶體區域
local fault_detector = ngx.shared.fault_detector

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
    
    local res, err = httpc:request_uri("http://" .. node.host .. ":" .. node.port .. "/health", {
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
    
    -- 更新節點狀態（改用 node 表）
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
    
    if node.status == 'dead' then
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
    
    -- 更新節點狀態為恢復中（改用 node 表）
    local sql = "UPDATE node SET status = 'recovering' WHERE node_id = ?"
    local res, err = db:query(sql, {node_id})
    
    db:close()
    
    if res then
        ngx.log(ngx.INFO, "節點 " .. node_id .. " 復原流程已開始")
    end
end

return {
    detect_node_failure = detect_node_failure,
    check_node_recovery = check_node_recovery
}
```

### 6. 部署和監控腳本

#### 6.1 部署腳本

```bash
#!/bin/bash
# deploy-openresty-cluster.sh

echo "=== 部署 OpenResty Uptime Kuma Cluster ==="

# 1. 創建網路
echo "創建 Docker 網路..."
docker network create uptime_kuma_network 2>/dev/null || echo "網路已存在"

# 2. 啟動 MariaDB
echo "啟動 MariaDB..."
docker-compose -f docker-compose-mariadb.yml up -d

# 等待資料庫就緒
echo "等待資料庫就緒..."
sleep 30

# 3. 啟動節點
echo "啟動 Uptime Kuma 節點..."
docker-compose -f docker-compose-node1.yml up -d
sleep 10
docker-compose -f docker-compose-node2.yml up -d
sleep 10
docker-compose -f docker-compose-node3.yml up -d

# 4. 啟動 OpenResty
echo "啟動 OpenResty..."
sudo systemctl start openresty

# 5. 檢查服務狀態
echo "檢查服務狀態..."
sleep 10

# 檢查 OpenResty
if sudo systemctl is-active --quiet openresty; then
    echo "✓ OpenResty 運行正常"
else
    echo "✗ OpenResty 運行異常"
fi

# 檢查節點
for port in 3001 3002 3003; do
    if curl -f "http://localhost:$port/health" >/dev/null 2>&1; then
        echo "✓ 節點端口 $port 健康"
    else
        echo "✗ 節點端口 $port 異常"
    fi
done

echo "=== Cluster 部署完成 ==="
echo "OpenResty: http://localhost:80"
echo "節點 1: http://localhost:3001"
echo "節點 2: http://localhost:3002"
echo "節點 3: http://localhost:3003"
```

#### 6.2 監控腳本

```bash
#!/bin/bash
# monitor-openresty-cluster.sh

echo "=== OpenResty Cluster 監控 ==="

# 檢查 OpenResty 進程
echo "1. 檢查 OpenResty 進程狀態..."
if sudo systemctl is-active --quiet openresty; then
    echo "✓ OpenResty 進程運行中"
else
    echo "✗ OpenResty 進程未運行"
    exit 1
fi

# 檢查負載平衡狀態
echo "2. 檢查負載平衡狀態..."
if curl -s -f "http://localhost/api/load_status" > /dev/null 2>&1; then
    echo "✓ 負載平衡 API 正常"
    
    # 獲取節點負載資訊
    echo "3. 節點負載狀態..."
    curl -s "http://localhost/api/load_status" | jq -r '.node_loads[] | "\(.node_id): \(.monitor_count) monitors, 負載分數: \(.load_score)"'
    
else
    echo "✗ 負載平衡 API 異常"
fi

# 檢查 Nginx 狀態
echo "4. OpenResty 負載平衡狀態..."
if curl -s -f "http://localhost/nginx_status" > /dev/null 2>&1; then
    echo "✓ OpenResty 運行正常"
    curl -s http://localhost/nginx_status | grep -E "Active connections|Reading|Writing|Waiting"
else
    echo "✗ OpenResty 異常"
fi

# 檢查節點健康狀態
echo "5. 檢查節點健康狀態..."
for port in 3001 3002 3003; do
    if curl -s -f "http://localhost:$port/health" > /dev/null 2>&1; then
        echo "   ✓ 節點端口 $port 健康"
    else
        echo "   ✗ 節點端口 $port 故障"
    fi
done

# 手動觸發負載更新
echo "6. 觸發負載資訊更新..."
if curl -s -f "http://localhost/api/update_loads" > /dev/null 2>&1; then
    echo "✓ 負載資訊更新已觸發"
else
    echo "✗ 負載資訊更新失敗"
fi

echo "=== 監控完成 ==="
```

#### 6.3 負載平衡測試腳本

```bash
#!/bin/bash
# test-openresty-load-balance.sh

echo "=== OpenResty 負載平衡效果測試 ==="

# 發送測試請求並記錄分配結果
echo "發送 100 個測試請求..."
declare -A node_counts

for i in {1..100}; do
    # 發送請求並獲取響應
    response=$(curl -s -w "%{http_code}|%{remote_ip}|%{time_total}" -o /dev/null http://localhost/)
    http_code=$(echo $response | cut -d'|' -f1)
    remote_ip=$(echo $response | cut -d'|' -f2)
    response_time=$(echo $response | cut -d'|' -f3)
    
    # 統計各節點的請求數
    if [ "$http_code" = "200" ]; then
        case $remote_ip in
            "127.0.0.1:3001") node_counts["node1"]=$((node_counts["node1"] + 1)) ;;
            "127.0.0.1:3002") node_counts["node2"]=$((node_counts["node2"] + 1)) ;;
            "127.0.0.1:3003") node_counts["node3"]=$((node_counts["node3"] + 1)) ;;
        esac
    fi
    
    # 顯示進度
    if [ $((i % 10)) -eq 0 ]; then
        echo "已發送 $i 個請求..."
    fi
done

# 顯示分配結果
echo ""
echo "負載分配結果:"
echo "Node1: ${node_counts["node1"]:-0} 請求"
echo "Node2: ${node_counts["node2"]:-0} 請求"
echo "Node3: ${node_counts["node3"]:-0} 請求"

# 計算分配比例
total=$((node_counts["node1"] + node_counts["node2"] + node_counts["node3"]))
if [ $total -gt 0 ]; then
    echo ""
    echo "分配比例:"
    echo "Node1: $((node_counts["node1"] * 100 / total))%"
    echo "Node2: $((node_counts["node2"] * 100 / total))%"
    echo "Node3: $((node_counts["node3"] * 100 / total))%"
fi

echo "=== 測試完成 ==="
```

## 總結

通過這種 OpenResty 架構，系統可以：

1. **實時監控各節點的 monitor 數量**
2. **根據負載動態調整請求分配**
3. **自動選擇負載最輕的節點**
4. **實現真正的智能負載平衡**
5. **支援 Lua 腳本自定義邏輯**
6. **高效能的負載平衡處理**
7. **內建的故障檢測和恢復機制**

這樣就實現了基於 Uptime Kuma monitor 數量的 OpenResty 智能負載平衡解決方案！
