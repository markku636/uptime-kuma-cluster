# Uptime Kuma 集群 Setup 同步問題解決計劃

## ✅ 已實施：方案 E（集群感知模式）

**實施日期：** 2024-12-27

---

## 問題描述

在 Uptime Kuma 集群環境中：
- **Node 1** 完成初始化（建立使用者帳號）後
- **Node 2、3、4、5...** 進入時仍然不斷顯示 Setup 畫面

## 根本原因分析

### 1. `needSetup` 狀態是每個 Node 的本地變數

在 `server/server.js` 第 179 行：
```javascript
let needSetup = false;  // 這是每個 Node 進程的本地變數
```

### 2. 判斷邏輯

在 `server/server.js` 第 1852-1855 行，每個 Node 啟動時都會執行：
```javascript
let userCount = (await R.knex("user").count("id as count").first()).count;
if (userCount === 0) {
    log.info("server", "No user found, need setup");
    needSetup = true;
}
```

### 3. 問題點

雖然所有 Node 共享同一個 MariaDB 資料庫，但：
- 當 Node 2/3/4 比 Node 1 早完成資料庫連接初始化時
- 此時 Node 1 可能還沒完成 user 的建立
- 導致 Node 2/3/4 檢查到 `userCount === 0`，設定 `needSetup = true`
- 一旦設定後，這個本地變數不會再被更新

### 4. 時序問題 (Race Condition)

```
時間軸：
┌─────────────────────────────────────────────────────────────────────┐
│ Node1: [DB連接] → [Migration] → [initAfterDatabaseReady] → [Setup頁面] → [建立User]
│ Node2: [DB連接] → [Migration] → [initAfterDatabaseReady] → needSetup=true (因為還沒有user)
│ Node3: [DB連接] → [Migration] → [initAfterDatabaseReady] → needSetup=true (因為還沒有user)
└─────────────────────────────────────────────────────────────────────┘
```

---

## 解決方案 (更新版)

### ⭐ 方案 E：集群感知模式 - 只有 Primary Node 允許 Setup (最佳方案)

**核心思想：** 在集群環境下，只有 Primary Node (node1) 才應該顯示 Setup 頁面，其他 Node 應該等待或顯示「等待主節點完成初始化」訊息。

**優點：**
- 符合集群架構的設計理念
- 從根本上解決問題
- 提供更好的使用者體驗
- 不需要輪詢或額外的資料庫查詢

**實施方式：**

```javascript
// server/server.js - 修改 initAfterDatabaseReady 中的邏輯

const currentNodeId = process.env.UPTIME_KUMA_NODE_ID || process.env.NODE_ID || null;
const isPrimaryNode = currentNodeId === "node1" || currentNodeId === null || 
                      process.env.UPTIME_KUMA_PRIMARY === "true";

let userCount = (await R.knex("user").count("id as count").first()).count;

if (userCount === 0) {
    if (isPrimaryNode) {
        // 主節點：需要 setup
        log.info("server", "No user found, need setup (primary node)");
        needSetup = true;
    } else {
        // 從節點：等待主節點完成 setup，不顯示 setup 頁面
        log.info("server", `No user found, but this is secondary node (${currentNodeId}). Waiting for primary to complete setup...`);
        needSetup = false;
        
        // 啟動背景輪詢，等待主節點完成 setup
        waitForPrimarySetup();
    }
}
```

```javascript
// 新增函數：等待主節點完成 setup
async function waitForPrimarySetup() {
    const checkInterval = setInterval(async () => {
        try {
            const userCount = (await R.knex("user").count("id as count").first()).count;
            if (userCount > 0) {
                clearInterval(checkInterval);
                log.info("server", "Primary node has completed setup. This node is now ready.");
                // 可選：通知前端刷新
            }
        } catch (e) {
            log.warn("server", "Failed to check user count: " + e.message);
        }
    }, 3000); // 每 3 秒檢查一次
}
```

**前端處理 (從節點)：**
可以顯示「請在主節點完成初始化設定」的提示訊息，並提供連結到 Node 1。

---

### 方案 A：Socket 事件即時查詢資料庫 (簡單有效)

修改 `socket.on("needSetup")` 事件，從本地變數改為即時查詢資料庫：

**修改位置：** `server/server.js` 第 690-692 行

```javascript
// 修改前
socket.on("needSetup", async (callback) => {
    callback(needSetup);
});

// 修改後
socket.on("needSetup", async (callback) => {
    // 集群環境：每次都重新檢查資料庫中是否有使用者
    try {
        const userCount = (await R.knex("user").count("id as count").first()).count;
        callback(userCount === 0);
    } catch (e) {
        callback(needSetup);
    }
});
```

**優點：**
- 改動最小 (3 行程式碼)
- 立即生效
- 不影響現有架構

**缺點：**
- 每次 socket 連接都查詢一次資料庫（但影響極小）

---

### 方案 F：使用資料庫 Setting 作為共享狀態 (無輪詢)

**核心思想：** 利用已存在的 `setting` 表作為集群共享狀態。

```javascript
// 在 setup 完成時，設定一個 flag
await Settings.set("setupComplete", true);

// 在檢查是否需要 setup 時
const setupComplete = await Settings.get("setupComplete");
if (setupComplete) {
    needSetup = false;
} else {
    const userCount = (await R.knex("user").count("id as count").first()).count;
    needSetup = (userCount === 0);
}
```

**優點：**
- 使用現有的 Settings 機制
- 語意清晰
- 集群狀態一致

---

## 推薦方案比較

| 方案 | 改動量 | 效能影響 | 集群友好 | 使用者體驗 |
|------|--------|----------|----------|------------|
| **E (Primary Node)** | 中 | 低 | ⭐⭐⭐ | ⭐⭐⭐ |
| **A (即時查詢)** | 小 | 低 | ⭐⭐ | ⭐⭐ |
| **F (Setting 共享)** | 中 | 極低 | ⭐⭐⭐ | ⭐⭐ |

---

## 最終建議

### 快速修復：使用方案 A
3 行程式碼改動，立即解決問題。

### 長期方案：使用方案 E  
符合集群架構設計，提供最佳使用者體驗：
- Primary Node 顯示 Setup 頁面
- Secondary Node 顯示「等待主節點完成初始化」

---

## 實施步驟

### 快速修復 (方案 A)

**修改 `server/server.js` 第 690-692 行：**

```javascript
socket.on("needSetup", async (callback) => {
    try {
        const userCount = (await R.knex("user").count("id as count").first()).count;
        callback(userCount === 0);
    } catch (e) {
        callback(needSetup);
    }
});
```

### 完整方案 (方案 E)

1. 修改 `server/server.js` 中的 `initAfterDatabaseReady` 函數
2. 新增前端「等待主節點」頁面
3. 新增 `UPTIME_KUMA_PRIMARY` 環境變數支援

---

## 相關檔案

- `server/server.js` - 主要修改點
- `server/setup-database.js` - Setup 邏輯
- `server/model/node.js` - 已有 Node ID 環境變數邏輯
- `docker-compose-cluster-ci.yaml` - CI 環境設定

---

## 預計影響

- **效能影響：** 極小
- **相容性：** 完全向後相容
- **風險：** 低
