# K6 Kuma 監控器創建測試

這個 K6 測試腳本會創建 40 個不重複名稱的監控器，測試 Kuma API 的性能和穩定性。

## 功能特點

- ✅ 創建 40 個唯一名稱的監控器
- ✅ 支援多種監控類型 (HTTP, Ping, DNS)
- ✅ 自動生成唯一名稱避免重複
- ✅ 詳細的執行報告和錯誤處理
- ✅ 自定義指標追蹤成功/失敗次數

## 檔案說明

- `k6-monitor-test.js` - 主要的 K6 測試腳本
- `run-k6-test.ps1` - PowerShell 執行腳本
- `K6_TEST_README.md` - 說明文件

## 前置需求

1. **安裝 K6**
   ```bash
   # 使用 Chocolatey
   choco install k6
   
   # 使用 winget
   winget install k6
   
   # 或從官網下載
   # https://k6.io/docs/get-started/installation/
   ```

2. **確認 Kuma 服務運行中**
   - 確保 Kuma 服務在 `http://192.168.99.88:9091` 正常運行
   - 確保 API Key `uk1_dRoog_hjdvwvtQTCwXeaXj2jbrjA0OVOsLIkSwJn` 有效

## 執行方式

### 方法 1: 使用 PowerShell 腳本
```powershell
.\run-k6-test.ps1
```

### 方法 2: 直接執行 K6
```bash
k6 run k6-monitor-test.js
```

## 測試配置

- **執行次數**: 40 次
- **虛擬用戶**: 1 個 (順序執行)
- **監控器類型**: HTTP, Ping, DNS (輪流)
- **命名規則**: `監控器_{序號}_{時間戳}_{隨機字串}`

## 創建的監控器類型

1. **HTTP 監控器**
   - 目標: `https://httpbin.org/status/200` 或 `https://jsonplaceholder.typicode.com/posts/1`
   - 方法: GET
   - 超時: 10 秒

2. **Ping 監控器**
   - 目標: `8.8.8.8` 或 `1.1.1.1`
   - 超時: 10 秒

3. **DNS 監控器**
   - 目標: `google.com`
   - 超時: 10 秒

## 輸出範例

```
🚀 開始執行 Kuma 監控器創建測試
目標 URL: http://192.168.99.88:9091
將創建 40 個不同的監控器...

正在創建第 1 個監控器: 監控器_1_1704067200000_abc123
✅ 成功創建監控器 ID: 42, 名稱: 監控器_1_1704067200000_abc123

正在創建第 2 個監控器: 監控器_2_1704067201000_def456
✅ 成功創建監控器 ID: 43, 名稱: 監控器_2_1704067201000_def456

...

📊 測試完成！
```

## 檢查項目

每個請求會檢查以下項目：
- ✅ HTTP 狀態碼是否為 201
- ✅ 響應是否包含監控器 ID
- ✅ 響應時間是否小於 5 秒

## 自定義指標

- `successful_monitor_creations` - 成功創建的監控器數量
- `failed_monitor_creations` - 失敗創建的監控器數量

## 後續清理

測試完成後，如果需要清理創建的監控器，可以：

1. 通過 API 查看所有監控器:
   ```bash
   curl -H "Authorization: uk1_dRoog_hjdvwvtQTCwXeaXj2jbrjA0OVOsLIkSwJn" \
        http://192.168.99.88:9091/api/v1/monitors
   ```

2. 刪除特定監控器:
   ```bash
   curl -X DELETE \
        -H "Authorization: uk1_dRoog_hjdvwvtQTCwXeaXj2jbrjA0OVOsLIkSwJn" \
        http://192.168.99.88:9091/api/v1/monitors/{monitor_id}
   ```

## 故障排除

1. **API Key 無效**
   - 檢查 Kuma 後台的 API Keys 設定
   - 確認權限設定正確

2. **連線失敗**
   - 檢查 Kuma 服務是否正常運行
   - 確認網路連線和防火牆設定

3. **創建失敗**
   - 檢查是否達到監控器數量限制
   - 確認 node_id "node1" 是否存在
