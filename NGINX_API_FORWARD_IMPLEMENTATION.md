# Nginx API 轉發實施計劃

> **目標**：透過 Nginx 反向代理轉發 Uptime Kuma API，實現安全、高效的 API 訪問

**實施日期**：2025-12-12  
**預估時間**：2-3 小時  
**難度等級**：⭐⭐⭐ (中等)

---

## 📋 前置檢查清單

在開始實施前，請確認以下事項：

- [ ] Uptime Kuma 已正常運行
- [ ] Docker 和 Docker Compose 已安裝
- [ ] 具備伺服器 SSH 訪問權限（如適用）
- [ ] 已準備域名或測試環境
- [ ] 已備份現有配置

---

## 🎯 階段一：環境準備（30 分鐘）

### 步驟 1.1：確認 Uptime Kuma 運行狀態

```bash
# 檢查 Uptime Kuma 容器狀態
docker ps | grep uptime-kuma

# 測試 Uptime Kuma API 是否可訪問
curl http://localhost:3001/api/v1/status
```

**驗收標準**：
- ✅ 容器狀態為 `Up`
- ✅ API 返回 JSON 響應（即使返回認證錯誤也是正常的）

---

### 步驟 1.2：創建項目目錄結構

```bash
# 創建 Nginx 配置目錄
mkdir -p nginx/conf.d
mkdir -p nginx/ssl
mkdir -p nginx/logs

# 創建備份目錄
mkdir -p backups
```

**預期結果**：
```
kuma/
├── nginx/
│   ├── conf.d/
│   ├── ssl/
│   └── logs/
└── backups/
```

---

### 步驟 1.3：備份現有配置

```bash
# 如果已有 docker-compose.yaml，先備份
if [ -f docker-compose.yaml ]; then
    cp docker-compose.yaml backups/docker-compose.yaml.$(date +%Y%m%d_%H%M%S)
fi

# 如果已有 nginx 配置，先備份
if [ -f nginx.conf ]; then
    cp nginx.conf backups/nginx.conf.$(date +%Y%m%d_%H%M%S)
fi
```

---

## 🔧 階段二：選擇部署方案（15 分鐘）

### 方案選擇決策樹

```
您的需求是？
│
├─ 單一 Uptime Kuma 實例
│  ├─ 只需要 API → 使用「方案 A：僅 API 轉發」
│  └─ 需要 UI + API → 使用「方案 B：完整轉發」
│
└─ 多個 Uptime Kuma 實例（叢集）
   └─ 使用「方案 C：負載均衡」
```

---

### 方案 A：僅 API 轉發（推薦用於 API-only 場景）

**適用場景**：
- 僅提供 API 服務給外部應用
- 需要嚴格控制訪問範圍
- 不需要 Web UI

**配置文件**：創建 `nginx/conf.d/api-only.conf`

```nginx
upstream uptime_kuma_backend {
    server uptime-kuma:3001;
    keepalive 32;
}

server {
    listen 8080;
    server_name api.your-domain.com;

    # 日誌
    access_log /var/log/nginx/kuma-api-access.log;
    error_log /var/log/nginx/kuma-api-error.log;

    # API 路由
    location /api/ {
        proxy_pass http://uptime_kuma_backend;
        proxy_http_version 1.1;
        
        # 標頭設定
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Connection "";
        
        # 超時設定
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
        
        # CORS（如需要）
        add_header Access-Control-Allow-Origin *;
        add_header Access-Control-Allow-Methods "GET, POST, PUT, DELETE, OPTIONS";
        add_header Access-Control-Allow-Headers "Authorization, Content-Type";
        
        if ($request_method = 'OPTIONS') {
            return 204;
        }
    }

    # API 文檔
    location /api-docs {
        proxy_pass http://uptime_kuma_backend;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
    }

    # 拒絕其他請求
    location / {
        return 404 "API Only Service";
    }
}
```

---

### 方案 B：完整轉發（UI + API）

**適用場景**：
- 需要完整的 Uptime Kuma 功能
- 包含 Web UI 和 API
- 支援 WebSocket 連接

**配置文件**：創建 `nginx/conf.d/full-proxy.conf`

```nginx
upstream uptime_kuma_backend {
    server uptime-kuma:3001;
    keepalive 32;
}

server {
    listen 80;
    server_name your-domain.com;

    # 日誌
    access_log /var/log/nginx/kuma-access.log;
    error_log /var/log/nginx/kuma-error.log;

    # API 轉發
    location /api/ {
        proxy_pass http://uptime_kuma_backend;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Connection "";
    }

    # WebSocket / Socket.IO
    location /socket.io/ {
        proxy_pass http://uptime_kuma_backend;
        proxy_http_version 1.1;
        
        # WebSocket 升級
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # WebSocket 長連接
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }

    # 前端 UI
    location / {
        proxy_pass http://uptime_kuma_backend;
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

### 方案 C：負載均衡（多節點叢集）

**適用場景**：
- 高可用性需求
- 大量併發請求
- 多個 Uptime Kuma 實例

**配置文件**：創建 `nginx/conf.d/load-balancer.conf`

```nginx
upstream uptime_kuma_cluster {
    # 負載均衡策略
    least_conn;  # 最少連接數
    
    # 後端伺服器
    server uptime-kuma-1:3001 weight=1 max_fails=3 fail_timeout=30s;
    server uptime-kuma-2:3001 weight=1 max_fails=3 fail_timeout=30s;
    server uptime-kuma-3:3001 weight=1 max_fails=3 fail_timeout=30s;
    
    keepalive 64;
}

server {
    listen 80;
    server_name cluster.your-domain.com;

    location /api/ {
        proxy_pass http://uptime_kuma_cluster;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Connection "";
        
        # 健康檢查
        proxy_next_upstream error timeout invalid_header http_500 http_502 http_503;
    }

    location /socket.io/ {
        proxy_pass http://uptime_kuma_cluster;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }

    location / {
        proxy_pass http://uptime_kuma_cluster;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }
}
```

---

## 🚀 階段三：部署實施（45 分鐘）

### 步驟 3.1：創建 Docker Compose 配置

根據您選擇的方案，創建對應的 `docker-compose.yaml`：

#### 選項 A & B：單節點部署

```yaml
version: '3.8'

networks:
  kuma-network:
    driver: bridge

services:
  nginx:
    image: nginx:alpine
    container_name: kuma-nginx
    ports:
      - "80:80"
      - "443:443"
    volumes:
      # 根據您的方案選擇對應的配置文件
      - ./nginx/conf.d:/etc/nginx/conf.d:ro
      - ./nginx/logs:/var/log/nginx
      # 如果需要 SSL
      # - ./nginx/ssl:/etc/nginx/ssl:ro
    depends_on:
      - uptime-kuma
    networks:
      - kuma-network
    restart: unless-stopped

  uptime-kuma:
    image: louislam/uptime-kuma:latest
    container_name: uptime-kuma
    volumes:
      - ./data:/app/data
    environment:
      # 信任代理設定
      - UPTIME_KUMA_TRUST_PROXY=true
    networks:
      - kuma-network
    # 不直接對外暴露端口
    expose:
      - "3001"
    restart: unless-stopped
```

#### 選項 C：叢集部署

```yaml
version: '3.8'

networks:
  kuma-network:
    driver: bridge

services:
  nginx:
    image: nginx:alpine
    container_name: kuma-nginx-lb
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx/conf.d/load-balancer.conf:/etc/nginx/conf.d/default.conf:ro
      - ./nginx/logs:/var/log/nginx
    depends_on:
      - uptime-kuma-1
      - uptime-kuma-2
      - uptime-kuma-3
    networks:
      - kuma-network
    restart: unless-stopped

  uptime-kuma-1:
    image: louislam/uptime-kuma:latest
    container_name: uptime-kuma-1
    volumes:
      - ./data/node1:/app/data
    environment:
      - UPTIME_KUMA_TRUST_PROXY=true
    networks:
      - kuma-network
    expose:
      - "3001"
    restart: unless-stopped

  uptime-kuma-2:
    image: louislam/uptime-kuma:latest
    container_name: uptime-kuma-2
    volumes:
      - ./data/node2:/app/data
    environment:
      - UPTIME_KUMA_TRUST_PROXY=true
    networks:
      - kuma-network
    expose:
      - "3001"
    restart: unless-stopped

  uptime-kuma-3:
    image: louislam/uptime-kuma:latest
    container_name: uptime-kuma-3
    volumes:
      - ./data/node3:/app/data
    environment:
      - UPTIME_KUMA_TRUST_PROXY=true
    networks:
      - kuma-network
    expose:
      - "3001"
    restart: unless-stopped
```

---

### 步驟 3.2：驗證 Nginx 配置

```bash
# 啟動 Nginx 容器並測試配置
docker-compose run --rm nginx nginx -t

# 預期輸出：
# nginx: the configuration file /etc/nginx/nginx.conf syntax is ok
# nginx: configuration file /etc/nginx/nginx.conf test is successful
```

**如果出現錯誤**：
1. 檢查配置文件路徑是否正確
2. 檢查語法錯誤（缺少分號、括號不匹配等）
3. 確認 upstream 名稱與容器名稱一致

---

### 步驟 3.3：啟動服務

```bash
# 停止舊的容器（如果有）
docker-compose down

# 啟動新配置的服務
docker-compose up -d

# 查看容器狀態
docker-compose ps

# 查看 Nginx 日誌
docker-compose logs -f nginx
```

**驗收標準**：
- ✅ 所有容器狀態為 `Up`
- ✅ Nginx 日誌無錯誤訊息
- ✅ Uptime Kuma 容器正常運行

---

## 🧪 階段四：測試驗證（30 分鐘）

### 測試 4.1：基本連通性測試

```bash
# 測試 Nginx 基本響應
curl -I http://localhost

# 預期：HTTP/1.1 200 OK 或 301/302（如果配置了重定向）
```

---

### 測試 4.2：API 端點測試

```bash
# 測試 API 狀態端點
curl http://localhost/api/v1/status

# 測試 API 文檔
curl http://localhost/api-docs

# 測試推送 API（如果配置）
curl http://localhost/api/push/YOUR_PUSH_TOKEN?status=up&msg=OK
```

**預期結果**：
- ✅ 返回 JSON 格式響應
- ✅ 無 502 Bad Gateway 錯誤
- ✅ 無 CORS 錯誤（如果需要跨域）

---

### 測試 4.3：WebSocket 連接測試

```bash
# 使用 wscat 測試 WebSocket（需要先安裝）
npm install -g wscat

# 測試 Socket.IO 連接
wscat -c ws://localhost/socket.io/?EIO=4&transport=websocket
```

**預期結果**：
- ✅ 成功建立 WebSocket 連接
- ✅ 收到 Socket.IO 握手訊息

---

### 測試 4.4：負載測試（選用）

```bash
# 使用 Apache Bench 進行簡單負載測試
ab -n 100 -c 10 http://localhost/api/v1/status

# 或使用 hey
hey -n 100 -c 10 http://localhost/api/v1/status
```

**驗收標準**：
- ✅ 成功率 > 99%
- ✅ 平均響應時間 < 500ms
- ✅ 無連接錯誤

---

### 測試 4.5：日誌檢查

```bash
# 查看 Nginx 訪問日誌
tail -f nginx/logs/kuma-api-access.log

# 查看 Nginx 錯誤日誌
tail -f nginx/logs/kuma-api-error.log

# 查看 Uptime Kuma 日誌
docker-compose logs -f uptime-kuma
```

**檢查項目**：
- ✅ 真實客戶端 IP 正確記錄（非 Nginx IP）
- ✅ 無異常錯誤訊息
- ✅ API 請求正常記錄

---

## 🔒 階段五：安全加固（30 分鐘）

### 步驟 5.1：添加速率限制

在 Nginx 配置中添加：

```nginx
http {
    # 定義速率限制區域
    limit_req_zone $binary_remote_addr zone=api_limit:10m rate=10r/s;
    limit_req_zone $binary_remote_addr zone=general_limit:10m rate=50r/s;

    server {
        # API 路由添加限制
        location /api/ {
            limit_req zone=api_limit burst=20 nodelay;
            limit_req_status 429;
            # ... 其他配置
        }
    }
}
```

---

### 步驟 5.2：配置 HTTPS（生產環境必須）

#### 使用 Let's Encrypt（推薦）

```bash
# 安裝 Certbot
apt-get update && apt-get install certbot python3-certbot-nginx

# 獲取 SSL 憑證
certbot --nginx -d your-domain.com

# 自動續期（添加到 crontab）
0 0 * * * certbot renew --quiet
```

#### 手動配置 SSL

```nginx
server {
    listen 443 ssl http2;
    server_name your-domain.com;

    # SSL 憑證
    ssl_certificate /etc/nginx/ssl/fullchain.pem;
    ssl_certificate_key /etc/nginx/ssl/privkey.pem;
    
    # SSL 安全配置
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers on;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 10m;

    # ... 其他配置
}

# HTTP 重定向到 HTTPS
server {
    listen 80;
    server_name your-domain.com;
    return 301 https://$server_name$request_uri;
}
```

---

### 步驟 5.3：IP 白名單（選用）

```nginx
# 只允許特定 IP 訪問 API
location /api/ {
    allow 192.168.1.0/24;  # 允許內網
    allow 203.0.113.0/24;  # 允許辦公室 IP
    deny all;              # 拒絕其他
    
    proxy_pass http://uptime_kuma_backend;
    # ... 其他配置
}
```

---

### 步驟 5.4：隱藏版本資訊

```nginx
http {
    server_tokens off;        # 隱藏 Nginx 版本
    more_clear_headers Server; # 完全移除 Server 標頭（需要 headers-more 模組）
}
```

---

## 📊 階段六：監控與維護（持續進行）

### 設置監控指標

創建 `monitor-nginx.sh` 腳本：

```bash
#!/bin/bash

echo "=== Nginx 狀態 ==="
docker-compose ps nginx

echo -e "\n=== 錯誤日誌 (最近 10 條) ==="
tail -n 10 nginx/logs/kuma-api-error.log

echo -e "\n=== 連接統計 ==="
docker exec kuma-nginx sh -c "netstat -an | grep :80 | wc -l"

echo -e "\n=== 磁碟使用 ==="
du -sh nginx/logs/
```

---

### 日誌輪轉配置

創建 `/etc/logrotate.d/kuma-nginx`：

```
/path/to/kuma/nginx/logs/*.log {
    daily
    rotate 14
    compress
    delaycompress
    notifempty
    missingok
    sharedscripts
    postrotate
        docker exec kuma-nginx nginx -s reopen
    endscript
}
```

---

### 定期健康檢查

添加到 crontab：

```bash
# 每 5 分鐘檢查一次
*/5 * * * * curl -f http://localhost/api/v1/status || echo "API Down!" | mail -s "Alert" admin@example.com
```

---

## ✅ 完成檢查清單

實施完成後，請確認以下事項：

- [ ] Nginx 容器正常運行
- [ ] Uptime Kuma 容器正常運行
- [ ] API 端點可正常訪問
- [ ] WebSocket 連接正常
- [ ] 日誌正常記錄真實 IP
- [ ] HTTPS 配置完成（生產環境）
- [ ] 速率限制已啟用
- [ ] 監控腳本已設置
- [ ] 日誌輪轉已配置
- [ ] 備份策略已建立

---

## 🔧 常見問題排解

### 問題 1：502 Bad Gateway

**可能原因**：
- Uptime Kuma 容器未啟動
- Docker 網路問題
- upstream 名稱錯誤

**解決方案**：
```bash
# 檢查容器狀態
docker-compose ps

# 檢查網路連接
docker network inspect kuma_kuma-network

# 測試內部連接
docker exec kuma-nginx ping uptime-kuma
```

---

### 問題 2：WebSocket 連接失敗

**解決方案**：
確保配置中包含 Upgrade 標頭：
```nginx
proxy_set_header Upgrade $http_upgrade;
proxy_set_header Connection "upgrade";
```

---

### 問題 3：CORS 錯誤

**解決方案**：
添加 CORS 標頭：
```nginx
add_header Access-Control-Allow-Origin $http_origin;
add_header Access-Control-Allow-Credentials true;
```

---

## 📚 相關資源

- [Nginx 官方文檔](https://nginx.org/en/docs/)
- [Uptime Kuma API 文檔](./API_DOCUMENTATION.md)
- [Docker Compose 參考](https://docs.docker.com/compose/)
- [Let's Encrypt 憑證服務](https://letsencrypt.org/)

---

## 📝 實施記錄

| 日期 | 階段 | 狀態 | 備註 |
|------|------|------|------|
| 2025-12-12 | 環境準備 | ⏳ 待執行 |  |
| | 方案選擇 | ⏳ 待執行 |  |
| | 部署實施 | ⏳ 待執行 |  |
| | 測試驗證 | ⏳ 待執行 |  |
| | 安全加固 | ⏳ 待執行 |  |
| | 監控設置 | ⏳ 待執行 |  |

---

**版本**：1.0  
**最後更新**：2025-12-12  
**負責人**：_____  
**狀態**：📋 計劃中
