# Uptime Kuma REST API 文檔

## 概覽

Uptime Kuma 現在提供完整的 REST API，允許您通過 HTTP 請求管理監控器、通知和其他資源。API 支持 JWT 認證和 API Key 認證。

## 訪問 API 文檔

### Swagger UI
訪問 Swagger 交互式文檔：
```
http://your-uptime-kuma-url/api-docs
```

### API 文檔 JSON
獲取 OpenAPI 3.0 JSON 格式文檔：
```
http://your-uptime-kuma-url/api-docs.json
```

## 認證

### 1. JWT Token 認證（推薦）

首先，通過 WebSocket 登入獲取 JWT token：

```javascript
// 使用原有的 socket.io 方式登入
const socket = io();
socket.emit("login", {
    username: "your-username",
    password: "your-password"
}, (response) => {
    if (response.ok) {
        const token = response.token;
        // 使用這個 token 進行 API 調用
    }
});
```

然後在 API 請求中使用 token：

```bash
curl -H "Authorization: Bearer YOUR_JWT_TOKEN" \
     http://your-uptime-kuma-url/api/v1/monitors
```

### 2. API Key 認證

您也可以在設置中創建 API Key，然後使用：

```bash
curl -H "Authorization: YOUR_API_KEY" \
     http://your-uptime-kuma-url/api/v1/monitors
```

## API 端點

### 基本信息

#### 獲取 API 狀態
```http
GET /api/v1/status
```

響應：
```json
{
  "ok": true,
  "msg": "Uptime Kuma API is working",
  "version": "2.0.0-beta.3"
}
```

### 監控器管理

#### 獲取所有監控器
```http
GET /api/v1/monitors
Authorization: Bearer YOUR_JWT_TOKEN
```

#### 獲取特定監控器
```http
GET /api/v1/monitors/{id}
Authorization: Bearer YOUR_JWT_TOKEN
```

#### 創建新監控器
```http
POST /api/v1/monitors
Authorization: Bearer YOUR_JWT_TOKEN
Content-Type: application/json

{
  "name": "My Website",
  "type": "http",
  "url": "https://example.com",
  "interval": 60,
  "active": true
}
```

#### 更新監控器
```http
PUT /api/v1/monitors/{id}
Authorization: Bearer YOUR_JWT_TOKEN
Content-Type: application/json

{
  "name": "Updated Website Name",
  "interval": 120
}
```

#### 刪除監控器
```http
DELETE /api/v1/monitors/{id}
Authorization: Bearer YOUR_JWT_TOKEN
```

#### 獲取監控器心跳數據
```http
GET /api/v1/monitors/{id}/heartbeats?period=24
Authorization: Bearer YOUR_JWT_TOKEN
```

### 推送監控器

#### 推送狀態更新（GET）
```http
GET /api/push/{pushToken}?status=up&msg=OK&ping=100
```

#### 推送狀態更新（POST）
```http
POST /api/push/{pushToken}
Content-Type: application/json

{
  "status": "up",
  "msg": "Service is running",
  "ping": 150
}
```

### 通知管理

#### 獲取所有通知
```http
GET /api/v1/notifications
Authorization: Bearer YOUR_JWT_TOKEN
```

### 徽章 API

#### 狀態徽章
```http
GET /api/badge/{id}/status?style=flat&label=Status
```

#### 運行時間徽章
```http
GET /api/badge/{id}/uptime/24h?style=flat
```

#### 響應時間徽章
```http
GET /api/badge/{id}/ping/24h?style=flat
```

#### 證書到期徽章
```http
GET /api/badge/{id}/cert-exp?style=flat
```

## 響應格式

### 成功響應
```json
{
  "ok": true,
  "msg": "操作成功",
  "data": {
    // 響應數據
  }
}
```

### 錯誤響應
```json
{
  "ok": false,
  "msg": "錯誤信息",
  "errors": [
    // 驗證錯誤詳情（如適用）
  ]
}
```

## 狀態代碼

- `0` - DOWN（離線）
- `1` - UP（在線）
- `2` - PENDING（等待中）
- `3` - MAINTENANCE（維護中）

## 速率限制

API 實施了速率限制：
- 每 15 分鐘每 IP 最多 100 個請求
- 超出限制將返回 429 錯誤

## 示例代碼

### JavaScript (Node.js)
```javascript
const axios = require('axios');

const api = axios.create({
  baseURL: 'http://your-uptime-kuma-url',
  headers: {
    'Authorization': 'Bearer YOUR_JWT_TOKEN',
    'Content-Type': 'application/json'
  }
});

// 獲取所有監控器
async function getMonitors() {
  try {
    const response = await api.get('/api/v1/monitors');
    console.log(response.data);
  } catch (error) {
    console.error('Error:', error.response.data);
  }
}

// 創建新監控器
async function createMonitor() {
  try {
    const response = await api.post('/api/v1/monitors', {
      name: 'My API Test',
      type: 'http',
      url: 'https://httpbin.org/status/200',
      interval: 60
    });
    console.log('Created monitor:', response.data);
  } catch (error) {
    console.error('Error:', error.response.data);
  }
}
```

### Python
```python
import requests

class UptimeKumaAPI:
    def __init__(self, base_url, token):
        self.base_url = base_url
        self.headers = {
            'Authorization': f'Bearer {token}',
            'Content-Type': 'application/json'
        }
    
    def get_monitors(self):
        response = requests.get(
            f'{self.base_url}/api/v1/monitors',
            headers=self.headers
        )
        return response.json()
    
    def create_monitor(self, name, monitor_type, url, interval=60):
        data = {
            'name': name,
            'type': monitor_type,
            'url': url,
            'interval': interval
        }
        response = requests.post(
            f'{self.base_url}/api/v1/monitors',
            json=data,
            headers=self.headers
        )
        return response.json()

# 使用示例
api = UptimeKumaAPI('http://your-uptime-kuma-url', 'YOUR_JWT_TOKEN')
monitors = api.get_monitors()
print(monitors)
```

### cURL 示例
```bash
# 獲取所有監控器
curl -H "Authorization: Bearer YOUR_JWT_TOKEN" \
     http://your-uptime-kuma-url/api/v1/monitors

# 創建新監控器
curl -X POST \
     -H "Authorization: Bearer YOUR_JWT_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"name":"Test Monitor","type":"http","url":"https://example.com","interval":60}' \
     http://your-uptime-kuma-url/api/v1/monitors

# 推送狀態更新
curl "http://your-uptime-kuma-url/api/push/YOUR_PUSH_TOKEN?status=up&msg=OK&ping=100"
```

## 注意事項

1. **認證**：大部分 API 端點需要認證，推送和徽章 API 除外
2. **權限**：用戶只能訪問自己創建的監控器和通知
3. **速率限制**：請注意 API 調用頻率限制
4. **版本**：當前 API 版本為 v1，未來版本變更將保持向後兼容
5. **CORS**：API 支持 CORS，可以從瀏覽器直接調用

## 支持

如需幫助或報告問題，請訪問：
- GitHub: https://github.com/louislam/uptime-kuma
- Discord: https://discord.gg/uptime-kuma 