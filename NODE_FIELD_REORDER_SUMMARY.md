# 節點欄位重新排序和翻譯修改總結

## 修改內容

### 1. 欄位順序調整
將 "Default Node" (預設節點) 欄位移動到 "Assigned Node" (指派節點) 欄位之上，使介面更加邏輯化。

**修改前順序:**
1. 指派節點 (Assigned Node)
2. 預設節點 (Default Node)

**修改後順序:**
1. 預設節點 (Default Node) - 現在在上方
2. 指派節點 (Assigned Node) - 現在在下方

### 2. 翻譯添加

#### 繁體中文 (zh-TW.json)
```json
{
    "Default Node": "預設節點",
    "defaultNodeDescription": "指定此監測器的預設節點。用於負載平衡和故障轉移。"
}
```

#### 英文 (en.json)
```json
{
    "Default Node": "Default Node",
    "defaultNodeDescription": "Specify the default node for this monitor. Used for load balancing and failover."
}
```

### 3. 欄位功能說明

#### 預設節點 (Default Node)
- **欄位**: `monitor.node_id`
- **功能**: 指定監控器的預設節點
- **用途**: 用於負載平衡和故障轉移
- **說明**: 當指派節點未設定時，監控器將使用此預設節點

#### 指派節點 (Assigned Node)
- **欄位**: `monitor.assigned_node`
- **功能**: 覆蓋預設節點設定
- **用途**: 用於特定情況下的節點指派
- **說明**: 留空則允許任何節點執行，設定後將覆蓋預設節點

## 修改的檔案

### 1. `src/lang/zh-TW.json`
- 添加 "Default Node" 和 "defaultNodeDescription" 的繁體中文翻譯

### 2. `src/lang/en.json`
- 添加 "Default Node" 和 "defaultNodeDescription" 的英文翻譯

### 3. `src/pages/EditMonitor.vue`
- 調整欄位順序，將 "Default Node" 移到 "Assigned Node" 之上
- 更新註解說明

## 預期結果

修改後，新增/編輯監控器頁面的節點設定區段將顯示：

1. **預設節點** (Default Node)
   - 下拉選單包含所有可用節點
   - 說明文字：指定此監測器的預設節點。用於負載平衡和故障轉移。

2. **指派節點** (Assigned Node)
   - 下拉選單包含所有可用節點
   - 說明文字：指定應執行此監測器的節點。留空則允許任何節點執行。

## 測試方法

### 1. 使用測試腳本
在瀏覽器控制台中執行 `test-node-order.js` 腳本，檢查：
- 翻譯是否正確載入
- 節點選項是否包含所有節點
- 欄位順序是否正確

### 2. 手動驗證
1. 重新整理新增/編輯監控器頁面
2. 檢查節點設定區段的欄位順序
3. 檢查翻譯是否正確顯示
4. 驗證節點下拉選單功能

## 注意事項

- 此修改需要重新整理頁面才能生效
- 翻譯檔案已同時更新中英文版本
- 欄位的功能邏輯保持不變，僅調整了顯示順序
- 如果問題仍然存在，請檢查瀏覽器控制台的錯誤訊息

## 技術細節

### 欄位順序邏輯
將 "Default Node" 放在上方是因為：
1. 預設節點是基礎設定
2. 指派節點是覆蓋設定
3. 從邏輯上講，基礎設定應該在覆蓋設定之上

### 翻譯系統
- 使用 Vue.js 的 `$t()` 函數進行國際化
- 支援動態語言切換
- 翻譯檔案位於 `src/lang/` 目錄
