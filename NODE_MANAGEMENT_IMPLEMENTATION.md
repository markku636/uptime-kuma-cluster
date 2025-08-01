# 節點管理功能實現總結

## 概述
成功將 `UPTIME_KUMA_NODE_ID` 從環境變數移至資料庫，並實作了完整的節點管理功能。

## 已實現的功能

### 1. 資料庫遷移
- **文件**: `db/knex_migrations/2025-07-01-0000-create-nodes.js`
- **功能**: 創建 `node` 表，包含以下欄位：
  - `id`: 主鍵
  - `node_id`: 節點 ID（唯一）
  - `node_name`: 節點名稱
  - `ip`: IP 地址（可選）
  - `created_date`: 創建時間
  - `modified_date`: 修改時間

### 2. Node Model
- **文件**: `server/model/node.js`
- **功能**:
  - 完整的 CRUD 操作
  - 自動從環境變數初始化節點記錄
  - 靜態方法用於獲取當前節點信息
  - JSON 格式轉換

### 3. 後端 API
- **文件**: `server/socket-handlers/node-socket-handler.js`
- **功能**:
  - `getNodeList`: 獲取所有節點列表
  - `addNode`: 新增節點
  - `updateNode`: 更新節點信息
  - `deleteNode`: 刪除節點（有監控器分配的節點無法刪除）

### 4. 伺服器啟動邏輯更新
- **文件**: `server/uptime-kuma-server.js`
- **功能**: 伺服器啟動時自動檢查並創建節點記錄
- **文件**: `server/server.js`
- **功能**: 集成節點 socket handler 和發送節點列表

### 5. 客戶端支援
- **文件**: `server/client.js`
- **功能**: 添加 `sendNodeList` 函數和節點列表事件處理

### 6. 前端管理頁面
- **文件**: `src/components/settings/Nodes.vue`
- **功能**:
  - 節點列表顯示
  - 新增節點對話框
  - 編輯節點功能
  - 刪除節點功能
  - 當前節點標識
  - 響應式設計

### 7. 路由配置
- **文件**: `src/router.js`
- **功能**: 添加節點管理頁面路由

### 8. 設定頁面集成
- **文件**: `src/pages/Settings.vue`
- **功能**: 在設定菜單中添加節點管理選項

### 9. 全域狀態管理
- **文件**: `src/mixins/socket.js`
- **功能**: 添加 `nodeList` 到全域狀態和事件處理

## 環境變數支援

系統現在支援以下環境變數：
- `UPTIME_KUMA_NODE_ID` 或 `NODE_ID`: 節點 ID
- `UPTIME_KUMA_NODE_NAME` 或 `NODE_NAME`: 節點名稱（可選）
- `UPTIME_KUMA_NODE_IP` 或 `NODE_IP`: 節點 IP（可選）

## 自動初始化

當伺服器啟動時：
1. 檢查是否設定了 `UPTIME_KUMA_NODE_ID`
2. 如果設定了，檢查資料庫中是否存在該節點
3. 如果不存在，自動創建節點記錄
4. 使用環境變數中的名稱和 IP，如果沒有設定則使用預設值

## 監控器過濾

更新的監控器過濾邏輯：
- 繼續支援基於 `UPTIME_KUMA_NODE_ID` 的過濾
- 增加了資料庫節點信息的查詢和日誌
- 向前端發送當前節點的詳細信息

## 使用方法

### 訪問節點管理頁面
1. 登入 Uptime Kuma
2. 進入 **設定** 頁面
3. 點擊左側菜單中的 **Nodes**

### 新增節點
1. 點擊 **Add Node** 按鈕
2. 填寫節點 ID（必填，不可重複）
3. 填寫節點名稱（必填）
4. 填寫 IP 地址（可選）
5. 點擊 **Add** 保存

### 編輯節點
1. 在節點列表中點擊 **Edit** 按鈕
2. 修改節點名稱或 IP 地址
3. 注意：節點 ID 創建後無法修改
4. 點擊 **Update** 保存

### 刪除節點
1. 在節點列表中點擊 **Delete** 按鈕
2. 確認刪除操作
3. 注意：有監控器分配的節點無法刪除

## 向後兼容性

- 完全向後兼容現有的環境變數配置
- 現有的 `UPTIME_KUMA_NODE_ID` 設定會自動同步到資料庫
- 不影響現有的監控器分配和過濾邏輯

## 安全性

- 所有 API 操作都需要用戶登入
- 節點 ID 的唯一性由資料庫約束保證
- 防止刪除有依賴的節點

## 測試狀態

✅ 專案構建成功
✅ 所有新增的文件和修改都通過編譯
✅ SCSS 樣式問題已修復
✅ 前後端集成完成 