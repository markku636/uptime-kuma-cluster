# Nginx 叢集負載均衡配置實施計劃

## 目標

建立一個高可用的 Uptime Kuma 叢集，透過 Nginx/OpenResty 實現 API 負載均衡和故障轉移。

---

## 一、架構概覽

```
                        ┌─────────────────────────┐
                        │      用戶端請求          │
                        │   (API / WebSocket)     │
                        └───────────┬─────────────┘
                                    │
                                    ▼
                        ┌─────────────────────────┐
                        │   Nginx / OpenResty     │
                        │     負載均衡器           │
                        │     (Port 80/443)       │
                        └───────────┬─────────────┘
                                    │
            ┌───────────────────────┼───────────────────────┐
            │                       │                       │
            ▼                       ▼                       ▼
    ┌───────────────┐       ┌───────────────┐       ┌───────────────┐
    │   Node 1      │       │   Node 2      │       │   Node 3      │
    │   Port 3001   │       │   Port 3001   │       │   Port 3001   │
    │   (8084外部)   │       │   (8085外部)   │       │   (8086外部)   │
    └───────┬───────┘       └───────┬───────┘       └───────┬───────┘
            │                       │                       │
            └───────────────────────┼───────────────────────┘
                                    │
                                    ▼
                        ┌─────────────────────────┐
                        │       MariaDB           │
                        │     共享資料庫           │
                        │     (Port 3306)         │
                        └─────────────────────────┘
```

---

## 二、實施步驟

### 階段 1：環境準備

#### 1.1 建立目錄結構

```powershell
# 建立必要目錄
mkdir -p data/node1
mkdir -p data/node2
mkdir -p data/node3
mkdir -p nginx/conf.d
mkdir -p nginx/ssl
mkdir -p nginx/logs
mkdir -p lua
```

#### 1.2 建立 Docker 網路

```powershell
docker network create kuma-network
```

---

### 階段 2：資料庫配置

#### 2.1 MariaDB 配置

所有節點共用同一個 MariaDB 實例：

```yaml
# docker-compose-cluster.yaml 中的 mariadb 服務
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
    - "9090:3306"
  restart: unless-stopped
  networks:
    - kuma-network
  healthcheck:
    test: ["CMD-SHELL", "mysqladmin ping -h 127.0.0.1 -u$$MYSQL_USER -p$$MYSQL_PASSWORD --silent"]
    interval: 10s
    timeout: 5s
    retries: 5
    start_period: 20s
```

---

### 階段 3：Nginx/OpenResty 負載均衡配置

#### 3.1 建立 nginx.conf

建立檔案 `nginx/nginx.conf`：

```nginx
user root;
worker_processes auto;
worker_rlimit_nofile 65535;
error_log /var/log/nginx/error.log info;
pid /var/run/nginx.pid;

events {
    use epoll;
    worker_connections 65535;
    multi_accept on;
}

http {
    include /etc/nginx/mime.types;
    default_type application/octet-stream;

    # Docker 內建 DNS 解析器
    resolver 127.0.0.11 ipv6=off valid=30s;
    resolver_timeout 5s;

    # WebSocket Connection header 處理
    map $http_upgrade $connection_upgrade {
        default upgrade;
        ''      close;
    }

    # 日誌格式
    log_format main '$remote_addr - $remote_user [$time_local] "$request" '
                    '$status $body_bytes_sent "$http_referer" '
                    '"$http_user_agent" "$http_x_forwarded_for" '
                    'upstream: $upstream_addr';

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
    gzip_types text/plain text/css text/xml text/javascript 
               application/javascript application/json application/xml+rss;

    # ============================================
    # 上游伺服器群組 (Upstream)
    # ============================================
    upstream uptime_kuma_cluster {
        # 負載均衡策略 (選擇一種)
        
        # 策略 1: IP Hash - WebSocket 會話黏性 (推薦)
        ip_hash;
        
        # 策略 2: 最少連接數
        # least_conn;
        
        # 策略 3: Round-robin (預設)
        # (不需要額外配置)

        # 節點配置
        server uptime-kuma-node1:3001 max_fails=3 fail_timeout=30s;
        server uptime-kuma-node2:3001 max_fails=3 fail_timeout=30s;
        server uptime-kuma-node3:3001 max_fails=3 fail_timeout=30s;
        
        # 保持連接數
        keepalive 32;
    }

    # ============================================
    # 主服務器配置
    # ============================================
    server {
        listen 80;
        server_name _;

        # 隱藏版本資訊
        server_tokens off;

        # ==========================================
        # REST API 轉發
        # ==========================================
        location /api/ {
            proxy_pass http://uptime_kuma_cluster;
            proxy_http_version 1.1;
            
            # 代理標頭
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
            proxy_set_header Connection "";
            
            # 超時設定
            proxy_connect_timeout 60s;
            proxy_send_timeout 60s;
            proxy_read_timeout 60s;
            
            # 緩衝設定
            proxy_buffering off;
            proxy_buffer_size 4k;
            
            # 錯誤處理 - 自動故障轉移
            proxy_next_upstream error timeout http_502 http_503 http_504;
            proxy_next_upstream_tries 3;
        }

        # ==========================================
        # Swagger API 文檔
        # ==========================================
        location /api-docs {
            proxy_pass http://uptime_kuma_cluster;
            proxy_http_version 1.1;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
        }

        # ==========================================
        # WebSocket / Socket.IO 轉發
        # ==========================================
        location /socket.io/ {
            proxy_pass http://uptime_kuma_cluster;
            proxy_http_version 1.1;
            
            # WebSocket 必要標頭
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection $connection_upgrade;
            
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
            
            # WebSocket 長連接超時
            proxy_read_timeout 86400s;
            proxy_send_timeout 86400s;
            
            # 禁用緩衝
            proxy_buffering off;
        }

        # ==========================================
        # 健康檢查端點
        # ==========================================
        location /health {
            access_log off;
            return 200 "healthy\n";
            add_header Content-Type text/plain;
        }

        # ==========================================
        # Nginx 狀態頁面 (可選)
        # ==========================================
        location /nginx_status {
            stub_status on;
            access_log off;
            # 限制存取
            allow 127.0.0.1;
            allow 10.0.0.0/8;
            allow 172.16.0.0/12;
            allow 192.168.0.0/16;
            deny all;
        }

        # ==========================================
        # 前端 UI 轉發 (預設路由)
        # ==========================================
        location / {
            proxy_pass http://uptime_kuma_cluster;
            proxy_http_version 1.1;
            
            # WebSocket 支援
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection $connection_upgrade;
            
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
            
            # 緩存設定
            proxy_buffering off;
        }
    }

    # ============================================
    # 直接存取各節點 (管理/除錯用)
    # ============================================
    server {
        listen 8001;
        server_name _;
        location / {
            proxy_pass http://uptime-kuma-node1:3001;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection $connection_upgrade;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
        }
    }

    server {
        listen 8002;
        server_name _;
        location / {
            proxy_pass http://uptime-kuma-node2:3001;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection $connection_upgrade;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
        }
    }

    server {
        listen 8003;
        server_name _;
        location / {
            proxy_pass http://uptime-kuma-node3:3001;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection $connection_upgrade;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
        }
    }
}
```

---

### 階段 4：Docker Compose 完整配置

#### 4.1 完整 docker-compose-cluster.yaml

```yaml
version: '3.8'

volumes:
  kuma-db:
    name: kuma-db
    driver: local

services:
  # ==========================================
  # MariaDB 資料庫
  # ==========================================
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
      - "9090:3306"
    restart: unless-stopped
    networks:
      - kuma-network
    healthcheck:
      test: ["CMD-SHELL", "mysqladmin ping -h 127.0.0.1 -ukuma -pkuma_pass --silent"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 20s

  # ==========================================
  # Uptime Kuma 節點 1
  # ==========================================
  uptime-kuma-node1:
    image: ${IMAGE:-louislam/uptime-kuma:latest}
    container_name: uptime-kuma-node1
    volumes:
      - ./data/node1:/app/data
    ports:
      - "8084:3001"
    environment:
      - UPTIME_KUMA_DISABLE_FRAME_SAMEORIGIN=true
      - UPTIME_KUMA_TRUST_PROXY=true
      - UPTIME_KUMA_DB_TYPE=mariadb
      - UPTIME_KUMA_DB_HOSTNAME=mariadb
      - UPTIME_KUMA_DB_PORT=3306
      - UPTIME_KUMA_DB_NAME=kuma
      - UPTIME_KUMA_DB_USERNAME=kuma
      - UPTIME_KUMA_DB_PASSWORD=kuma_pass
      - UPTIME_KUMA_NODE_ID=node1
    depends_on:
      mariadb:
        condition: service_healthy
    restart: unless-stopped
    networks:
      - kuma-network

  # ==========================================
  # Uptime Kuma 節點 2
  # ==========================================
  uptime-kuma-node2:
    image: ${IMAGE:-louislam/uptime-kuma:latest}
    container_name: uptime-kuma-node2
    volumes:
      - ./data/node2:/app/data
    ports:
      - "8085:3001"
    environment:
      - UPTIME_KUMA_DISABLE_FRAME_SAMEORIGIN=true
      - UPTIME_KUMA_TRUST_PROXY=true
      - UPTIME_KUMA_DB_TYPE=mariadb
      - UPTIME_KUMA_DB_HOSTNAME=mariadb
      - UPTIME_KUMA_DB_PORT=3306
      - UPTIME_KUMA_DB_NAME=kuma
      - UPTIME_KUMA_DB_USERNAME=kuma
      - UPTIME_KUMA_DB_PASSWORD=kuma_pass
      - UPTIME_KUMA_NODE_ID=node2
    depends_on:
      mariadb:
        condition: service_healthy
    restart: unless-stopped
    networks:
      - kuma-network

  # ==========================================
  # Uptime Kuma 節點 3
  # ==========================================
  uptime-kuma-node3:
    image: ${IMAGE:-louislam/uptime-kuma:latest}
    container_name: uptime-kuma-node3
    volumes:
      - ./data/node3:/app/data
    ports:
      - "8086:3001"
    environment:
      - UPTIME_KUMA_DISABLE_FRAME_SAMEORIGIN=true
      - UPTIME_KUMA_TRUST_PROXY=true
      - UPTIME_KUMA_DB_TYPE=mariadb
      - UPTIME_KUMA_DB_HOSTNAME=mariadb
      - UPTIME_KUMA_DB_PORT=3306
      - UPTIME_KUMA_DB_NAME=kuma
      - UPTIME_KUMA_DB_USERNAME=kuma
      - UPTIME_KUMA_DB_PASSWORD=kuma_pass
      - UPTIME_KUMA_NODE_ID=node3
    depends_on:
      mariadb:
        condition: service_healthy
    restart: unless-stopped
    networks:
      - kuma-network

  # ==========================================
  # Nginx 負載均衡器
  # ==========================================
  nginx:
    image: nginx:alpine
    container_name: uptime-kuma-nginx
    ports:
      - "80:80"
      - "443:443"
      - "8001:8001"  # Node 1 直接存取
      - "8002:8002"  # Node 2 直接存取
      - "8003:8003"  # Node 3 直接存取
    volumes:
      - ./nginx/nginx.conf:/etc/nginx/nginx.conf:ro
      - ./nginx/ssl:/etc/nginx/ssl:ro
      - ./nginx/logs:/var/log/nginx
    depends_on:
      - uptime-kuma-node1
      - uptime-kuma-node2
      - uptime-kuma-node3
    restart: unless-stopped
    networks:
      - kuma-network

networks:
  kuma-network:
    driver: bridge
```

---

### 階段 5：啟動與驗證

#### 5.1 啟動叢集

```powershell
# 建立網路 (如果不存在)
docker network create kuma-network

# 啟動所有服務
docker-compose -f docker-compose-cluster.yaml up -d

# 查看服務狀態
docker-compose -f docker-compose-cluster.yaml ps

# 查看日誌
docker-compose -f docker-compose-cluster.yaml logs -f
```

#### 5.2 驗證服務

```powershell
# 1. 測試 Nginx 健康檢查
curl http://localhost/health

# 2. 測試 API 狀態
curl http://localhost/api/v1/status

# 3. 測試各節點直接存取
curl http://localhost:8001/api/v1/status  # Node 1
curl http://localhost:8002/api/v1/status  # Node 2
curl http://localhost:8003/api/v1/status  # Node 3

# 4. 測試負載均衡 (執行多次觀察 upstream 變化)
for ($i=1; $i -le 10; $i++) { curl http://localhost/api/v1/status }

# 5. 測試 Swagger 文檔
curl http://localhost/api-docs
```

---

## 三、負載均衡策略說明

### 策略比較

| 策略 | 適用場景 | 優點 | 缺點 |
|------|----------|------|------|
| **ip_hash** | WebSocket/Session | 會話一致性 | 負載可能不均勻 |
| **least_conn** | CPU 密集型 | 負載均衡 | WebSocket 可能有問題 |
| **round_robin** | 無狀態 API | 簡單均勻 | 無會話親和性 |
| **random** | 大規模部署 | 避免熱點 | 隨機性 |

### 推薦配置

對於 Uptime Kuma，**推薦使用 `ip_hash`**，原因：
1. Socket.IO WebSocket 需要會話黏性
2. 用戶登入狀態需要保持在同一節點
3. 避免 WebSocket 連接切換節點造成斷線

---

## 四、故障轉移配置

### 4.1 自動故障轉移

```nginx
location /api/ {
    proxy_pass http://uptime_kuma_cluster;
    
    # 故障轉移條件
    proxy_next_upstream error timeout http_502 http_503 http_504;
    
    # 最多嘗試 3 個節點
    proxy_next_upstream_tries 3;
    
    # 故障轉移超時
    proxy_next_upstream_timeout 30s;
}
```

### 4.2 節點健康檢查參數

```nginx
upstream uptime_kuma_cluster {
    server uptime-kuma-node1:3001 max_fails=3 fail_timeout=30s;
    server uptime-kuma-node2:3001 max_fails=3 fail_timeout=30s;
    server uptime-kuma-node3:3001 max_fails=3 fail_timeout=30s;
}
```

- `max_fails=3`: 連續 3 次失敗後標記為不可用
- `fail_timeout=30s`: 30 秒後重試不可用的節點

---

## 五、監控與維運

### 5.1 查看 Nginx 狀態

```powershell
# 查看 Nginx 狀態頁面
curl http://localhost/nginx_status

# 輸出範例:
# Active connections: 15 
# server accepts handled requests
#  1234 1234 5678 
# Reading: 0 Writing: 1 Waiting: 14
```

### 5.2 查看日誌

```powershell
# 查看 Nginx 存取日誌
docker exec uptime-kuma-nginx tail -f /var/log/nginx/access.log

# 查看錯誤日誌
docker exec uptime-kuma-nginx tail -f /var/log/nginx/error.log
```

### 5.3 重載配置

```powershell
# 測試配置語法
docker exec uptime-kuma-nginx nginx -t

# 重載配置 (不中斷服務)
docker exec uptime-kuma-nginx nginx -s reload
```

---

## 六、進階配置

### 6.1 速率限制

```nginx
http {
    # 定義速率限制區域
    limit_req_zone $binary_remote_addr zone=api_limit:10m rate=10r/s;
    limit_req_zone $binary_remote_addr zone=general_limit:10m rate=30r/s;

    server {
        # API 速率限制
        location /api/ {
            limit_req zone=api_limit burst=20 nodelay;
            proxy_pass http://uptime_kuma_cluster;
            # ... 其他配置
        }

        # 一般請求速率限制
        location / {
            limit_req zone=general_limit burst=50 nodelay;
            proxy_pass http://uptime_kuma_cluster;
            # ... 其他配置
        }
    }
}
```

### 6.2 HTTPS 配置

```nginx
server {
    listen 80;
    server_name your-domain.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name your-domain.com;

    ssl_certificate /etc/nginx/ssl/fullchain.pem;
    ssl_certificate_key /etc/nginx/ssl/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers on;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 10m;

    # ... 其他 location 配置
}
```

### 6.3 備用節點配置

```nginx
upstream uptime_kuma_cluster {
    ip_hash;
    
    server uptime-kuma-node1:3001 max_fails=3 fail_timeout=30s;
    server uptime-kuma-node2:3001 max_fails=3 fail_timeout=30s;
    server uptime-kuma-node3:3001 max_fails=3 fail_timeout=30s;
    
    # 備用節點 - 只有在主節點都不可用時才啟用
    server uptime-kuma-backup:3001 backup;
}
```

---

## 七、檢查清單

### 部署前檢查

- [ ] Docker 和 Docker Compose 已安裝
- [ ] 必要端口已開放 (80, 443, 8001-8003, 8084-8086, 9090)
- [ ] 目錄結構已建立
- [ ] nginx.conf 配置正確
- [ ] docker-compose-cluster.yaml 配置正確

### 部署後驗證

- [ ] MariaDB 健康檢查通過
- [ ] 所有 Uptime Kuma 節點啟動成功
- [ ] Nginx 代理正常運作
- [ ] API 端點可存取
- [ ] WebSocket 連接正常
- [ ] 負載均衡分配正常
- [ ] 故障轉移測試通過

---

## 八、常見問題

### Q1: WebSocket 連接不穩定

**解決方案**: 確保使用 `ip_hash` 策略，並正確設定 WebSocket 超時：

```nginx
proxy_read_timeout 86400s;
proxy_send_timeout 86400s;
```

### Q2: 502 Bad Gateway 錯誤

**可能原因**:
1. 後端節點未啟動
2. 網路連接問題
3. upstream 配置錯誤

**排查步驟**:
```powershell
docker ps  # 檢查容器狀態
docker logs uptime-kuma-node1  # 檢查節點日誌
docker exec uptime-kuma-nginx ping uptime-kuma-node1  # 測試網路
```

### Q3: 會話丟失/需要重複登入

**解決方案**: 
1. 使用 `ip_hash` 策略
2. 確保所有節點共用同一個 MariaDB
3. 檢查 `UPTIME_KUMA_TRUST_PROXY=true` 設定

---

## 九、參考資源

- [現有叢集部署指南](./CLUSTER_DEPLOYMENT_GUIDE.md)
- [API 文檔](./API_DOCUMENTATION.md)
- [Nginx 官方文檔](https://nginx.org/en/docs/)
- [Docker Compose 文檔](https://docs.docker.com/compose/)
