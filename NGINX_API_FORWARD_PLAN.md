# Nginx 轉發 Uptime Kuma API 計劃

## 目標

配置 Nginx 作為反向代理，將外部請求轉發到 Uptime Kuma 的 API 端點。

---

## 一、Uptime Kuma API 端點概覽

### 主要 API 路徑

| 路徑 | 說明 | 需要認證 |
|------|------|----------|
| `/api/v1/*` | REST API 主要端點 | ✅ |
| `/api/push/{pushToken}` | 推送監控 API | ❌ (使用 Token) |
| `/api/badge/*` | 徽章 API | ❌ |
| `/api-docs` | Swagger UI 文檔 | ❌ |
| `/api-docs.json` | OpenAPI JSON | ❌ |
| `/socket.io/` | WebSocket 連接 | ✅ |

---

## 二、Nginx 配置方案

### 方案 A：基本單節點配置

適用於單一 Uptime Kuma 實例。

```nginx
events {
    worker_connections 1024;
}

http {
    server {
        listen 80;
        server_name your-domain.com;

        # ==========================================
        # REST API 轉發
        # ==========================================
        location /api/ {
            proxy_pass http://uptime-kuma:3001;
            proxy_http_version 1.1;
            
            # 標頭設定
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
            
            # 超時設定
            proxy_connect_timeout 60s;
            proxy_send_timeout 60s;
            proxy_read_timeout 60s;
        }

        # ==========================================
        # Swagger 文檔轉發
        # ==========================================
        location /api-docs {
            proxy_pass http://uptime-kuma:3001;
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
            proxy_pass http://uptime-kuma:3001;
            proxy_http_version 1.1;
            
            # WebSocket 升級必要標頭
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection "upgrade";
            
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
            
            # WebSocket 需要較長超時
            proxy_read_timeout 86400s;
            proxy_send_timeout 86400s;
        }

        # ==========================================
        # 前端 UI 轉發
        # ==========================================
        location / {
            proxy_pass http://uptime-kuma:3001;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection "upgrade";
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
        }
    }
}
```

---

### 方案 B：叢集負載均衡配置

適用於多節點 Uptime Kuma 叢集。

```nginx
events {
    worker_connections 1024;
}

http {
    # 上游伺服器群組
    upstream uptime_kuma_cluster {
        # 負載均衡策略 (選擇一種)
        # least_conn;     # 最少連接
        # ip_hash;        # IP 黏性會話
        
        server uptime-kuma-node1:3001;
        server uptime-kuma-node2:3001;
        server uptime-kuma-node3:3001;
        
        # 保持連接數
        keepalive 32;
    }

    server {
        listen 80;
        server_name your-domain.com;

        # API 轉發
        location /api/ {
            proxy_pass http://uptime_kuma_cluster;
            proxy_http_version 1.1;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
            proxy_set_header Connection "";
            
            # 緩衝設定
            proxy_buffering off;
        }

        # WebSocket 轉發
        location /socket.io/ {
            proxy_pass http://uptime_kuma_cluster;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection "upgrade";
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
        }

        # 其他請求
        location / {
            proxy_pass http://uptime_kuma_cluster;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection "upgrade";
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
        }
    }
}
```

---

### 方案 C：僅轉發 API（不含 UI）

適用於只需要 API 存取的場景。

```nginx
http {
    server {
        listen 8080;
        server_name api.your-domain.com;

        # 只轉發 API 端點
        location /api/ {
            proxy_pass http://uptime-kuma:3001;
            proxy_http_version 1.1;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
            
            # CORS 設定（如果需要跨域存取）
            add_header Access-Control-Allow-Origin *;
            add_header Access-Control-Allow-Methods "GET, POST, PUT, DELETE, OPTIONS";
            add_header Access-Control-Allow-Headers "Authorization, Content-Type";
            
            # 處理 OPTIONS 預檢請求
            if ($request_method = 'OPTIONS') {
                return 204;
            }
        }

        # 拒絕其他路徑
        location / {
            return 404 "API Only";
        }
    }
}
```

---

## 三、HTTPS 配置（推薦用於生產環境）

```nginx
server {
    listen 80;
    server_name your-domain.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name your-domain.com;

    # SSL 憑證
    ssl_certificate /etc/nginx/ssl/fullchain.pem;
    ssl_certificate_key /etc/nginx/ssl/privkey.pem;
    
    # SSL 安全設定
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers on;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256;

    # API 轉發
    location /api/ {
        proxy_pass http://uptime-kuma:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # WebSocket 轉發
    location /socket.io/ {
        proxy_pass http://uptime-kuma:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # 前端
    location / {
        proxy_pass http://uptime-kuma:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

---

## 四、Docker Compose 整合範例

```yaml
version: '3.8'

services:
  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf:ro
      - ./ssl:/etc/nginx/ssl:ro
    depends_on:
      - uptime-kuma
    networks:
      - kuma-network

  uptime-kuma:
    image: louislam/uptime-kuma:latest
    volumes:
      - ./data:/app/data
    networks:
      - kuma-network
    # 不對外暴露端口，只透過 nginx 存取
    expose:
      - "3001"

networks:
  kuma-network:
    driver: bridge
```

---

## 五、實施步驟

### 步驟 1：準備配置檔案

```bash
# 建立 nginx 配置目錄
mkdir -p nginx/ssl

# 複製配置檔案
cp nginx.conf nginx/nginx.conf
```

### 步驟 2：設定 Uptime Kuma 信任代理

在 Uptime Kuma 中設定環境變數：

```yaml
environment:
  - UPTIME_KUMA_TRUST_PROXY=true
```

### 步驟 3：啟動服務

```bash
docker-compose up -d
```

### 步驟 4：測試 API

```bash
# 測試 API 狀態
curl http://localhost/api/v1/status

# 測試需要認證的 API
curl -H "Authorization: Bearer YOUR_TOKEN" \
     http://localhost/api/v1/monitors
```

---

## 六、常見問題排解

### 問題 1：WebSocket 連接失敗

**症狀**：Socket.IO 無法連接，前端顯示離線

**解決方案**：確保 WebSocket 升級標頭正確設定

```nginx
proxy_set_header Upgrade $http_upgrade;
proxy_set_header Connection "upgrade";
```

### 問題 2：API 返回 502 Bad Gateway

**症狀**：API 請求返回 502 錯誤

**解決方案**：
1. 檢查 Uptime Kuma 容器是否正常運行
2. 確認 upstream 伺服器地址正確
3. 檢查 Docker 網路連接

```bash
# 檢查容器狀態
docker ps

# 測試內部連接
docker exec nginx curl http://uptime-kuma:3001/api/v1/status
```

### 問題 3：CORS 錯誤

**症狀**：瀏覽器顯示跨域請求被阻止

**解決方案**：添加 CORS 標頭

```nginx
add_header Access-Control-Allow-Origin *;
add_header Access-Control-Allow-Methods "GET, POST, PUT, DELETE, OPTIONS";
add_header Access-Control-Allow-Headers "Authorization, Content-Type";
```

### 問題 4：真實 IP 地址丟失

**症狀**：Uptime Kuma 日誌顯示的都是 Nginx 的 IP

**解決方案**：設定信任代理

```yaml
# docker-compose.yaml
environment:
  - UPTIME_KUMA_TRUST_PROXY=true
```

---

## 七、安全建議

1. **使用 HTTPS**：生產環境務必啟用 SSL/TLS
2. **限制存取**：使用防火牆或 Nginx 限制 API 存取來源
3. **速率限制**：添加請求速率限制防止濫用

```nginx
# 速率限制配置
limit_req_zone $binary_remote_addr zone=api:10m rate=10r/s;

location /api/ {
    limit_req zone=api burst=20 nodelay;
    proxy_pass http://uptime-kuma:3001;
    # ... 其他配置
}
```

4. **隱藏版本資訊**：

```nginx
server_tokens off;
```

---

## 八、參考資源

- [Uptime Kuma API 文檔](./API_DOCUMENTATION.md)
- [Nginx 官方文檔](https://nginx.org/en/docs/)
- [Uptime Kuma 叢集部署指南](./CLUSTER_DEPLOYMENT_GUIDE.md)
