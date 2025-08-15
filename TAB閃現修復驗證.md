# TAB 閃現修復驗證指南

## 🔧 最新修復內容

### 主要變更

1. **使用 `v-show` 替代 `v-if`**
   ```vue
   <!-- 修復前 -->
   <div v-if="!enableEditMode && groupTabs && groupTabs.length > 0 && tabsInitialized">
   
   <!-- 修復後 -->
   <div v-show="!enableEditMode && groupTabs && groupTabs.length > 0 && !loading">
   ```

2. **改進 loading 狀態管理**
   - 確保 TAB 和分頁在數據完全載入後才顯示
   - 使用 `!loading` 作為顯示條件，更加穩定

3. **優化 `switchTab` 方法**
   - 添加重複點擊保護
   - 防止載入狀態導致的閃爍
   - 加入調試日誌

4. **改善數據載入時序**
   - `loadStatusPageData()` 現在返回 Promise
   - 確保 loading 狀態在數據載入完成後才設為 false

## 🧪 測試步驟

### 步驟 1: 啟動並訪問
```bash
npm start
```
訪問: http://localhost:3001/status/full-test-page

### 步驟 2: 打開開發者工具
- 按 F12 打開開發者工具
- 切換到 Console 標籤頁
- 重新整理頁面

### 步驟 3: 檢查初始載入
觀察以下項目：
- ✅ TAB 穩定顯示，不應該有閃現
- ✅ 分頁控制器正常顯示
- ✅ Console 中有 "Loaded paginated data:" 訊息

### 步驟 4: 測試 TAB 切換
1. 點擊不同的 TAB
2. 觀察：
   - ✅ TAB 不應該閃現或消失
   - ✅ 內容正確切換
   - ✅ Console 有 "Switching tab from X to Y" 訊息
   - ✅ 分頁重置到第 1 頁

### 步驟 5: 測試分頁功能
1. 使用分頁控制器導航
2. 觀察：
   - ✅ 分頁控制器穩定顯示
   - ✅ 內容正確切換
   - ✅ TAB 保持選中狀態

## 🔍 預期的 Console 輸出

```javascript
// 初始載入時
Loaded paginated data: {
  groupTabs: [{id: 'all', name: 'All', count: X}, ...],
  pagination: {total: X, currentPage: 1, ...},
  enableEditMode: false,
  activeTab: 'all',
  publicGroupListLength: X,
  loading: false
}

// TAB 切換時
Switching tab from all to [group-id]
Loaded paginated data: { ... }
```

## 🚨 問題診斷

### 如果 TAB 仍然閃現：
1. 檢查 Console 是否有錯誤訊息
2. 確認 `loading` 狀態是否正確變化
3. 檢查 `groupTabs` 陣列是否穩定

### 如果分頁不顯示：
1. 檢查 `pagination` 物件是否存在
2. 確認 `pagination.totalPages >= 1`
3. 檢查 `loading: false`

### 如果 TAB 切換不工作：
1. 檢查 Console 是否有 "Switching tab" 訊息
2. 確認 API 請求是否成功
3. 檢查 `activeTab` 值是否正確更新

## 📋 成功標準

✅ **TAB 顯示穩定** - 不閃現、不消失  
✅ **分頁控制器顯示** - 在底部正常顯示  
✅ **TAB 切換功能** - 點擊切換正常工作  
✅ **分頁功能** - 分頁導航正常工作  
✅ **數據載入** - Console 有正確的調試訊息  
✅ **性能良好** - 無多餘的 API 請求  

## 🛠️ 技術細節

### 關鍵修復
- 使用 `v-show` 而非 `v-if` 避免 DOM 重新創建
- 使用 `!loading` 作為穩定的顯示條件
- 改善 Promise 鏈處理載入狀態
- 添加重複點擊保護防止不必要的重新載入

### 顯示條件
```vue
v-show="!enableEditMode && groupTabs && groupTabs.length > 0 && !loading"
```

這個條件確保只有在：
- 不在編輯模式
- 有 TAB 數據
- 數據載入完成
時才顯示 UI 組件。
