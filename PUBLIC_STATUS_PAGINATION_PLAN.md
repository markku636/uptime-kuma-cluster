# Public Status Page Monitor 分頁實作計劃

## 目標
為 Public Status Page 新增 Monitor 分頁功能，使用現有的分頁套件 `v-pagination-3` 實作，並支援依據分組的 Tab 切換功能。

## 現況分析

### 現有技術棧
- **分頁套件**: `v-pagination-3` (已在 `package.json` 中，Dashboard 中有使用範例)
- **Bootstrap**: 5.1.3 (支援 nav-tabs)
- **前端框架**: Vue 3
- **現有組件**: `PublicGroupList.vue` 負責顯示群組和監控項目

### 現有資料結構
```javascript
// StatusPage 資料結構
{
  config: { ... },
  incident: { ... },
  publicGroupList: [
    {
      id: number,
      name: string,
      monitorList: [
        {
          id: number,
          name: string,
          status: number,
          // ... 其他屬性
        }
      ]
    }
  ],
  maintenanceList: [ ... ]
}
```

## 實作計劃

### 階段一：前端 Tab 功能實作

#### 1.1 修改 StatusPage.vue
- **位置**: `src/pages/StatusPage.vue`
- **新增功能**:
  - 在 `PublicGroupList` 上方加入 Bootstrap nav-tabs
  - 新增 `activeTab` 資料屬性
  - 新增 Tab 切換邏輯
  - 新增分頁相關的資料屬性

```javascript
// 新增的 data 屬性
data() {
  return {
    // ... 現有屬性
    activeTab: 'all',  // 預設顯示全部
    page: 1,
    perPage: 10,      // 從父層傳下去的常數
    paginationConfig: {
      hideCount: true,
      chunksNavigation: "scroll",
    }
  }
}
```

#### 1.2 建立 Tab 結構
- **Tab 選項**:
  - "All" - 顯示所有群組
  - 動態產生各群組的 Tab (基於 `publicGroupList`)

#### 1.3 修改 PublicGroupList.vue
- **新增 Props**:
  - `activeTab`: 當前選中的 Tab
  - `page`: 當前頁碼
  - `perPage`: 每頁顯示數量
- **修改顯示邏輯**:
  - 根據 `activeTab` 過濾要顯示的群組
  - 實作分頁邏輯

### 階段二：後端 API 分頁支援

#### 2.1 修改 StatusPage API
- **檔案**: `server/routers/status-page-router.js`
- **新增參數**:
  - `group`: 指定群組 ID (可選，預設為全部)
  - `page`: 頁碼 (預設為 1)
  - `limit`: 每頁數量 (預設為 10)

#### 2.2 修改 StatusPage Model
- **檔案**: `server/model/status_page.js`
- **修改 `getStatusPageData` 方法**:
  - 新增分頁參數支援
  - 新增群組過濾邏輯
  - 回傳分頁相關資訊 (total, currentPage, totalPages)

```javascript
// 新的 API 回傳結構
{
  config: { ... },
  incident: { ... },
  publicGroupList: [...], // 分頁後的資料
  maintenanceList: [...],
  pagination: {
    total: number,      // 總監控項目數
    currentPage: number,
    totalPages: number,
    perPage: number
  },
  groupTabs: [          // 可用的群組 tabs
    { id: 'all', name: 'All', count: number },
    { id: number, name: string, count: number }
  ]
}
```

### 階段三：前端整合與最佳化

#### 3.1 整合分頁組件
- 在 `StatusPage.vue` 中整合 `v-pagination-3`
- 處理頁碼變更事件
- 處理 Tab 切換時重置頁碼

#### 3.2 資料載入最佳化
- Tab 切換時重新載入資料
- 維持當前頁面狀態 (URL query parameters)
- Loading 狀態處理

#### 3.3 響應式設計
- 手機版 Tab 顯示最佳化
- 分頁按鈕在小螢幕的處理

## 技術實作細節

### 常數配置
```javascript
// 在 StatusPage.vue 中定義，向下傳遞
const PAGINATION_CONFIG = {
  DEFAULT_PER_PAGE: 10,
  MAX_PER_PAGE: 50,
  MIN_PER_PAGE: 5
};
```

### Tab 切換邏輯
```javascript
methods: {
  switchTab(tabId) {
    this.activeTab = tabId;
    this.page = 1; // 重置到第一頁
    this.loadData(); // 重新載入資料
  },
  
  loadData() {
    const params = {
      group: this.activeTab === 'all' ? null : this.activeTab,
      page: this.page,
      limit: this.perPage
    };
    // API 呼叫
  }
}
```

### 分頁處理
```javascript
// 監聽頁碼變更
watch: {
  page() {
    this.loadData();
  }
}
```

## API 設計

### 新增 Query Parameters
```
GET /api/status-page/{slug}?group={groupId}&page={page}&limit={limit}
```

### 回應格式
```json
{
  "config": {...},
  "incident": {...},
  "publicGroupList": [...],
  "maintenanceList": [...],
  "pagination": {
    "total": 156,
    "currentPage": 2,
    "totalPages": 16,
    "perPage": 10
  },
  "groupTabs": [
    {"id": "all", "name": "All", "count": 156},
    {"id": 1, "name": "Web Services", "count": 45},
    {"id": 2, "name": "Databases", "count": 23}
  ]
}
```

## 資料庫考量
- **不修改現有資料庫結構**
- 使用現有的 `group` 和 `monitor` 關聯
- 在 SQL 查詢中實作分頁和過濾

## 效能最佳化
1. **後端分頁**: 避免載入所有資料到前端
2. **快取策略**: 可考慮對群組清單進行快取
3. **懶載入**: 只載入當前頁面的監控項目詳細資料

## 向後相容性
- 保持現有 API 不變
- 新參數為可選參數
- 前端優雅降級處理

## 測試計劃
1. **單元測試**: 分頁邏輯測試
2. **整合測試**: API 分頁功能測試
3. **E2E 測試**: Tab 切換和分頁操作測試
4. **效能測試**: 大量監控項目的分頁效能

## 交付時程
1. **第一階段** (3天): 前端 Tab 基礎功能
2. **第二階段** (3天): 後端 API 分頁支援
3. **第三階段** (2天): 整合與最佳化
4. **第四階段** (2天): 測試與修復

## 風險評估
- **低風險**: 使用現有技術棧，影響範圍可控
- **中風險**: 效能影響需要測試驗證
- **緩解措施**: 逐步實作，保持向後相容

## 後續擴展
- 支援自訂排序
- 支援搜尋功能
- 支援監控項目過濾器
- 支援 URL 直接連結到特定 Tab 和頁面
