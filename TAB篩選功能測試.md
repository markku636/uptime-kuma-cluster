# TAB 篩選功能重寫測試指南

## 🔄 重寫內容

### PublicGroupList 組件改進

1. **新增 `filteredGroupList` 計算屬性**
   ```javascript
   filteredGroupList() {
       // 編輯模式：顯示所有群組
       if (this.editMode) return this.$root.publicGroupList;
       
       // "All" TAB：顯示所有群組
       if (this.activeTab === 'all') return this.$root.publicGroupList;
       
       // 特定群組：只顯示選中的群組
       const selectedGroup = this.$root.publicGroupList.find(group => group.id == this.activeTab);
       return selectedGroup ? [selectedGroup] : [];
   }
   ```

2. **智能群組標題顯示**
   ```javascript
   shouldShowGroupTitle() {
       // 編輯模式：總是顯示
       if (this.editMode) return true;
       
       // "All" TAB：顯示群組標題
       if (this.activeTab === 'all') return true;
       
       // 單一群組：隱藏標題（TAB 已經表明是哪個群組）
       return false;
   }
   ```

3. **修復拖拽功能**
   - 只在 "All" TAB 和編輯模式下允許拖拽
   - 正確處理拖拽事件，更新原始數據

### StatusPage 組件改進

1. **增強調試信息**
   - TAB 生成時顯示詳細信息
   - 群組篩選時顯示當前狀態

## 🧪 測試案例

### 測試 1: "All" TAB 功能
1. 訪問 `http://localhost:3001/status/full-test-page`
2. 確保預設選中 "All" TAB
3. 驗證：
   - ✅ 顯示所有群組和其 monitor
   - ✅ 顯示群組標題
   - ✅ 每個群組都有自己的區塊

**預期結果**：
```
All TAB (選中) | Group1 TAB | Group2 TAB | ...

Group1 標題
├─ Monitor1
├─ Monitor2
└─ Monitor3

Group2 標題  
├─ Monitor4
└─ Monitor5
```

### 測試 2: 特定群組 TAB 功能
1. 點擊任何非 "All" 的群組 TAB
2. 驗證：
   - ✅ 只顯示該群組的 monitor
   - ✅ 不顯示群組標題（因為 TAB 已經表明群組）
   - ✅ Monitor 數量與 TAB 徽章一致

**預期結果**：
```
All TAB | Group1 TAB (選中) | Group2 TAB | ...

Monitor1 (直接顯示，無群組標題)
Monitor2
Monitor3
```

### 測試 3: TAB 切換功能
1. 在不同 TAB 之間切換
2. 觀察每次切換：
   - ✅ 內容立即更新
   - ✅ 顯示對應群組的 monitor
   - ✅ 分頁重置到第 1 頁
   - ✅ Console 有篩選日誌

**預期 Console 輸出**：
```javascript
// TAB 切換時
Switching tab from all to 5
Filtering to show group: Web Services (ID: 5)
Loaded paginated data: { ... }

// 找不到群組時
No group found for activeTab: 999
```

### 測試 4: 編輯模式
1. 如果有編輯權限，點擊 "Edit Status Page"
2. 驗證編輯模式下：
   - ✅ 顯示所有群組（忽略 TAB 篩選）
   - ✅ 顯示群組標題
   - ✅ 可以拖拽重新排序
   - ✅ 可以編輯群組和 monitor

### 測試 5: 分頁功能
1. 在每個 TAB 中測試分頁
2. 驗證：
   - ✅ 分頁控制器正確顯示
   - ✅ 分頁數量與 monitor 數量對應
   - ✅ 切換 TAB 時分頁重置

## 🔍 調試與驗證

### 開發者工具檢查
1. 打開 Console 查看調試信息
2. 檢查組件狀態：
   ```javascript
   // 查看當前篩選狀態
   console.log({
     activeTab: vm.activeTab,
     groupTabs: vm.groupTabs,
     totalGroups: vm.$root.publicGroupList.length,
     filteredGroups: vm.$refs.publicGroupList.filteredGroupList?.length
   });
   ```

### 預期的調試輸出
```javascript
// TAB 生成時
Generated tabs from data: {
  tabs: [{id: 'all', name: 'All', count: 15}, {id: 5, name: 'Web Services', count: 8}, ...],
  activeTab: 'all',
  totalGroups: 3
}

// 群組篩選時  
Filtering to show group: Web Services (ID: 5)

// TAB 切換時
Switching tab from all to 5
Tab switch complete
```

## ✅ 成功標準

✅ **TAB 篩選正確** - 每個 TAB 只顯示對應的 monitor  
✅ **UI 邏輯清晰** - "All" 顯示群組標題，單一群組隱藏標題  
✅ **切換流暢** - TAB 切換無閃現，內容立即更新  
✅ **分頁正常** - 每個 TAB 的分頁功能正常  
✅ **編輯模式兼容** - 編輯模式下功能不受影響  
✅ **拖拽功能** - 在適當條件下拖拽功能正常  

## 🚨 可能的問題

1. **群組 ID 不匹配**：檢查 `group.id` 是否與 `activeTab` 類型一致
2. **空群組顯示**：空群組應該顯示 "No Monitors" 訊息
3. **拖拽衝突**：確保篩選狀態下拖拽被正確禁用
4. **分頁計算錯誤**：檢查篩選後的 monitor 數量計算

## 📊 性能考量

- **計算屬性緩存**：`filteredGroupList` 只在依賴變化時重新計算
- **DOM 最小化**：只渲染當前需要的群組
- **記憶體效率**：不複製數據，只是篩選引用
