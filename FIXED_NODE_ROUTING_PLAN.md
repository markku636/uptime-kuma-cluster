# Fixed Node Routing Implementation Plan
# 固定節點路由實作計劃

## 📋 Overview | 概述

This document describes the implementation plan for the Fixed Node Routing feature in the OpenResty load balancer. This feature allows developers to route all requests to a specific node via Cookie for debugging and testing purposes.

本文檔描述 OpenResty 負載均衡器中固定節點路由功能的實作計劃。此功能允許開發者透過 Cookie 將所有請求路由到指定節點，方便調試和測試。

---

## 🎯 Feature Requirements | 功能需求

1. **Set Cookie** → Route all requests to specified node | 設定 Cookie → 所有請求路由到指定節點
2. **Clear Cookie** → Restore normal load balancing | 清除 Cookie → 恢復原本的負載均衡邏輯
3. **Simple URL Operation** → Set/clear Cookie by visiting specific URLs | 簡易 URL 操作 → 透過訪問特定 URL 即可設定/清除 Cookie

---

## 🏗️ Architecture | 架構

### Cookie Specification | Cookie 規格

```
Cookie Name: KUMA_FIXED_NODE
Cookie Value: node1 | node2 | node3 | node4 | node5
Expiry: 7 days (default, configurable)
Flags: HttpOnly, Path=/
```

### Routing Logic Flow | 路由邏輯流程

```
┌─────────────────────────────────────────────────────────┐
│              Request enters OpenResty                    │
│                    請求進入 OpenResty                     │
└─────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────┐
│         Check Cookie: KUMA_FIXED_NODE                    │
│              檢查 Cookie                                  │
└─────────────────────────────────────────────────────────┘
                            │
              ┌─────────────┴─────────────┐
              │                           │
        Has Cookie                   No Cookie
        有 Cookie                    無 Cookie
              │                           │
              ▼                           ▼
┌─────────────────────┐      ┌─────────────────────────────┐
│  Validate node      │      │  Use original load          │
│  exists and online  │      │  balancing logic            │
│  驗證節點存在且在線   │      │  使用原本負載均衡邏輯         │
└─────────────────────┘      └─────────────────────────────┘
              │
    ┌─────────┴─────────┐
    │                   │
  Valid              Invalid
  有效                無效
    │                   │
    ▼                   ▼
┌─────────────┐   ┌───────────────────────┐
│ Route to    │   │ Clear Cookie, use     │
│ fixed node  │   │ load balancing        │
│ 路由到固定   │   │ 清除 Cookie，使用      │
│ 節點        │   │ 負載均衡               │
└─────────────┘   └───────────────────────┘
```

---

## 🌐 URL Endpoints | URL 端點

### Simple URL Operations | 簡易 URL 操作

| Action 操作 | URL | Response 回應 |
| :--- | :--- | :--- |
| Set to node1 | `GET /lb/fixed-node/node1` | HTML page with success message |
| Set to node2 | `GET /lb/fixed-node/node2` | HTML page with success message |
| Set to node3 | `GET /lb/fixed-node/node3` | HTML page with success message |
| Clear setting | `GET /lb/clear-fixed-node` | HTML page confirming cleared |

### API Operations | API 操作

| Action 操作 | Method | URL | Body |
| :--- | :--- | :--- | :--- |
| Set fixed node | POST | `/lb/set-fixed-node` | `{"node": "node2", "expires": 604800}` |
| Clear fixed node | POST | `/lb/clear-fixed-node` | - |
| View status | GET | `/lb/fixed-node-status` | - |
| List available nodes | GET | `/lb/available-nodes` | - |

---

## 📁 Files to Modify | 需要修改的檔案

### 1. `lua/monitor_router.lua`

Add the following functions | 新增以下函數：

```lua
-- Cookie name constant | Cookie 名稱常數
local FIXED_NODE_COOKIE = "KUMA_FIXED_NODE"

-- Check and parse fixed node Cookie | 檢查並解析固定節點 Cookie
function _M.get_fixed_node_from_cookie()
    local cookie_value = ngx.var.cookie_KUMA_FIXED_NODE
    
    if not cookie_value or cookie_value == "" then
        return nil
    end
    
    -- Validate format (node1, node2, node3...)
    if not string.match(cookie_value, "^node%d+$") then
        ngx.log(ngx.WARN, "Invalid fixed node cookie value: ", cookie_value)
        return nil
    end
    
    return cookie_value
end

-- Validate node is valid and online | 驗證節點是否有效且在線
function _M.validate_fixed_node(node_id)
    local db, err = db_connect()
    if not db then
        return false, "database_unavailable"
    end
    
    local sql = string.format([[
        SELECT node_id, status 
        FROM node 
        WHERE node_id = '%s' AND status = 'online'
        LIMIT 1
    ]], node_id)
    
    local res, err = db:query(sql)
    db:close()
    
    if not res or #res == 0 then
        return false, "node_not_found_or_offline"
    end
    
    return true, nil
end
```

Modify `preselect_node()` function | 修改 `preselect_node()` 函數：

```lua
function _M.preselect_node()
    local host, port
    local use_fixed_node = false
    
    -- 1. Check for fixed node Cookie first | 先檢查是否有固定節點 Cookie
    local fixed_node = _M.get_fixed_node_from_cookie()
    
    if fixed_node then
        -- Validate node | 驗證節點有效性
        local valid, reason = _M.validate_fixed_node(fixed_node)
        
        if valid then
            host = "uptime-kuma-" .. fixed_node
            port = 3001
            use_fixed_node = true
            ngx.log(ngx.INFO, "Using fixed node from cookie: ", fixed_node)
        else
            ngx.log(ngx.WARN, "Fixed node ", fixed_node, " is invalid (", reason, "), clearing cookie")
            ngx.ctx.clear_fixed_node_cookie = true
        end
    end
    
    -- 2. If no valid fixed node, use original logic | 如果沒有有效的固定節點，使用原本邏輯
    if not use_fixed_node then
        host, port = _M.pick_node_for_request()
    end
    
    -- Resolve hostname to IP | 解析 hostname 為 IP 地址
    local ip, err = resolve_host(host)
    if not ip then
        ngx.log(ngx.WARN, "preselect_node: failed to resolve ", host, ", using fallback")
        ip, err = resolve_host("uptime-kuma-node1")
    end
    
    ngx.ctx.upstream_host = ip
    ngx.ctx.upstream_port = port
    ngx.ctx.upstream_hostname = host
    ngx.ctx.use_fixed_node = use_fixed_node
end
```

### 2. `nginx/nginx.conf`

Add the following location blocks | 新增以下 location 區塊：

```nginx
# -----------------------------------------------------------
# Fixed Node Routing - Simple URL Operations
# 固定節點路由 - 簡易 URL 操作
# -----------------------------------------------------------

# Set fixed node via URL | 透過 URL 設定固定節點
# GET /lb/fixed-node/node1, /lb/fixed-node/node2, etc.
location ~ ^/lb/fixed-node/(node\d+)$ {
    set $target_node $1;
    
    content_by_lua_block {
        local cjson = require "cjson"
        local router = require "monitor_router"
        local node_id = ngx.var.target_node
        
        -- Validate node | 驗證節點
        local valid, reason = router.validate_fixed_node(node_id)
        
        if not valid then
            ngx.status = 400
            ngx.header.content_type = "text/html; charset=utf-8"
            ngx.say(string.format([[
<!DOCTYPE html>
<html>
<head><title>Setting Failed | 設定失敗</title></head>
<body style="font-family: Arial, sans-serif; padding: 40px; text-align: center;">
    <h1 style="color: #e74c3c;">❌ Setting Failed | 設定失敗</h1>
    <p>Node <strong>%s</strong> is invalid or offline</p>
    <p>節點 <strong>%s</strong> 無效或離線</p>
    <p>Reason 原因: %s</p>
    <p><a href="/lb/available-nodes">View Available Nodes | 查看可用節點</a></p>
</body>
</html>
            ]], node_id, node_id, reason or "unknown"))
            return
        end
        
        -- Set Cookie (7 days) | 設定 Cookie（7 天）
        local expires = 604800
        local cookie = string.format(
            "KUMA_FIXED_NODE=%s; Path=/; Max-Age=%d; HttpOnly",
            node_id, expires
        )
        ngx.header["Set-Cookie"] = cookie
        
        ngx.header.content_type = "text/html; charset=utf-8"
        ngx.say(string.format([[
<!DOCTYPE html>
<html>
<head><title>Fixed Node Set | 固定節點已設定</title></head>
<body style="font-family: Arial, sans-serif; padding: 40px; text-align: center;">
    <h1 style="color: #27ae60;">✅ Success | 設定成功</h1>
    <p>All requests will be routed to <strong style="color: #3498db; font-size: 1.5em;">%s</strong></p>
    <p>所有請求將固定路由到 <strong style="color: #3498db; font-size: 1.5em;">%s</strong></p>
    <p>Expiry 有效期: 7 days 天</p>
    <hr style="margin: 30px 0;">
    <p>Clear fixed node 清除固定節點: <a href="/lb/clear-fixed-node">/lb/clear-fixed-node</a></p>
    <p>View status 查看狀態: <a href="/lb/fixed-node-status">/lb/fixed-node-status</a></p>
    <p><a href="/">Back to Home 返回首頁</a></p>
</body>
</html>
        ]], node_id, node_id))
    }
}

# Clear fixed node via URL | 透過 URL 清除固定節點
# GET /lb/clear-fixed-node
location = /lb/clear-fixed-node {
    content_by_lua_block {
        -- Clear Cookie | 清除 Cookie
        local cookie = "KUMA_FIXED_NODE=; Path=/; Max-Age=0; HttpOnly"
        ngx.header["Set-Cookie"] = cookie
        
        ngx.header.content_type = "text/html; charset=utf-8"
        ngx.say([[
<!DOCTYPE html>
<html>
<head><title>Fixed Node Cleared | 固定節點已清除</title></head>
<body style="font-family: Arial, sans-serif; padding: 40px; text-align: center;">
    <h1 style="color: #27ae60;">✅ Cleared | 已清除</h1>
    <p>Fixed node Cookie has been cleared</p>
    <p>固定節點 Cookie 已清除</p>
    <p>Requests will use <strong>normal load balancing</strong></p>
    <p>後續請求將恢復<strong>正常負載均衡</strong></p>
    <hr style="margin: 30px 0;">
    <p>Set fixed node again 重新設定固定節點:</p>
    <p>
        <a href="/lb/fixed-node/node1">node1</a> | 
        <a href="/lb/fixed-node/node2">node2</a> | 
        <a href="/lb/fixed-node/node3">node3</a>
    </p>
    <p><a href="/">Back to Home 返回首頁</a></p>
</body>
</html>
        ]])
    }
}

# -----------------------------------------------------------
# Fixed Node Routing - JSON API
# 固定節點路由 - JSON API
# -----------------------------------------------------------

# Set fixed node (API) | 設定固定節點 (API)
# POST /lb/set-fixed-node
location = /lb/set-fixed-node {
    content_by_lua_block {
        local cjson = require "cjson"
        
        if ngx.req.get_method() ~= "POST" then
            ngx.status = 405
            ngx.header.content_type = "application/json"
            ngx.say('{"error":"Method not allowed"}')
            return
        end
        
        ngx.req.read_body()
        local body = ngx.req.get_body_data()
        
        if not body then
            ngx.status = 400
            ngx.header.content_type = "application/json"
            ngx.say('{"error":"Missing request body"}')
            return
        end
        
        local ok, data = pcall(cjson.decode, body)
        if not ok or not data.node then
            ngx.status = 400
            ngx.header.content_type = "application/json"
            ngx.say('{"error":"Invalid JSON or missing node parameter"}')
            return
        end
        
        local node_id = data.node
        local expires = data.expires or 604800
        
        if not string.match(node_id, "^node%d+$") then
            ngx.status = 400
            ngx.header.content_type = "application/json"
            ngx.say('{"error":"Invalid node format. Use node1, node2, etc."}')
            return
        end
        
        local router = require "monitor_router"
        local valid, reason = router.validate_fixed_node(node_id)
        
        if not valid then
            ngx.status = 400
            ngx.header.content_type = "application/json"
            ngx.say(cjson.encode({error = "Node validation failed", reason = reason}))
            return
        end
        
        local cookie = string.format(
            "KUMA_FIXED_NODE=%s; Path=/; Max-Age=%d; HttpOnly",
            node_id, expires
        )
        ngx.header["Set-Cookie"] = cookie
        
        ngx.header.content_type = "application/json"
        ngx.say(cjson.encode({
            success = true,
            node = node_id,
            expires_in_seconds = expires,
            message = "Fixed node cookie set successfully"
        }))
    }
}

# Clear fixed node (API) | 清除固定節點 (API)
# POST /lb/clear-fixed-node
location = /lb/clear-fixed-node {
    content_by_lua_block {
        local cjson = require "cjson"
        
        local cookie = "KUMA_FIXED_NODE=; Path=/; Max-Age=0; HttpOnly"
        ngx.header["Set-Cookie"] = cookie
        
        ngx.header.content_type = "application/json"
        ngx.say(cjson.encode({
            success = true,
            message = "Fixed node cookie cleared. Load balancing restored."
        }))
    }
}

# View fixed node status | 查看固定節點狀態
# GET /lb/fixed-node-status
location = /lb/fixed-node-status {
    content_by_lua_block {
        local cjson = require "cjson"
        local router = require "monitor_router"
        
        local fixed_node = ngx.var.cookie_KUMA_FIXED_NODE
        local status = {
            has_fixed_node = false,
            current_node = nil,
            is_valid = false,
            cluster_status = router.get_cluster_status()
        }
        
        if fixed_node and fixed_node ~= "" then
            status.has_fixed_node = true
            status.current_node = fixed_node
            
            local valid, reason = router.validate_fixed_node(fixed_node)
            status.is_valid = valid
            if not valid then
                status.invalid_reason = reason
            end
        end
        
        ngx.header.content_type = "application/json"
        ngx.say(cjson.encode(status))
    }
}

# List available nodes | 列出可用節點
# GET /lb/available-nodes
location = /lb/available-nodes {
    content_by_lua_block {
        local cjson = require "cjson"
        local router = require "monitor_router"
        
        local status = router.get_cluster_status()
        local available_nodes = {}
        
        if status.nodes then
            for _, node in ipairs(status.nodes) do
                if node.status == "online" then
                    table.insert(available_nodes, {
                        node_id = node.node_id,
                        status = node.status,
                        monitor_count = node.monitor_count,
                        set_url = "/lb/fixed-node/" .. node.node_id
                    })
                end
            end
        end
        
        ngx.header.content_type = "application/json"
        ngx.say(cjson.encode({
            available_nodes = available_nodes,
            total_count = #available_nodes,
            clear_url = "/lb/clear-fixed-node"
        }))
    }
}
```

### 3. Response Headers (Optional) | 回應標頭（可選）

Add to proxy locations | 新增到 proxy location：

```nginx
header_filter_by_lua_block {
    if ngx.ctx.use_fixed_node then
        ngx.header["X-Routed-Via"] = "fixed-node"
    else
        ngx.header["X-Routed-Via"] = "load-balancer"
    end
    ngx.header["X-Routed-To"] = ngx.ctx.upstream_hostname or "unknown"
    
    -- Clear invalid Cookie | 清除無效的 Cookie
    if ngx.ctx.clear_fixed_node_cookie then
        ngx.header["Set-Cookie"] = "KUMA_FIXED_NODE=; Path=/; Max-Age=0; HttpOnly"
    end
}
```

---

## 📊 API Response Examples | API 回應範例

### GET /lb/available-nodes

```json
{
  "available_nodes": [
    {
      "node_id": "node1",
      "status": "online",
      "monitor_count": 150,
      "set_url": "/lb/fixed-node/node1"
    },
    {
      "node_id": "node2",
      "status": "online",
      "monitor_count": 120,
      "set_url": "/lb/fixed-node/node2"
    }
  ],
  "total_count": 2,
  "clear_url": "/lb/clear-fixed-node"
}
```

### GET /lb/fixed-node-status

```json
{
  "has_fixed_node": true,
  "current_node": "node2",
  "is_valid": true,
  "cluster_status": {
    "timestamp": 1703577600,
    "nodes": [...]
  }
}
```

### POST /lb/set-fixed-node

Request:
```json
{
  "node": "node2",
  "expires": 604800
}
```

Response:
```json
{
  "success": true,
  "node": "node2",
  "expires_in_seconds": 604800,
  "message": "Fixed node cookie set successfully"
}
```

---

## 🔧 Implementation Steps | 實作步驟

### Phase 1: Modify Lua Router Module | 修改 Lua 路由模組
1. Add Cookie-related functions to `lua/monitor_router.lua`
2. Modify `preselect_node()` to check Cookie first

### Phase 2: Add Nginx Endpoints | 新增 Nginx 端點
1. Add `/lb/fixed-node/{node}` URL endpoint (HTML response)
2. Add `/lb/clear-fixed-node` URL endpoint (HTML response)
3. Add `/lb/set-fixed-node` API endpoint (JSON response)
4. Add `/lb/clear-fixed-node` API endpoint (JSON response)
5. Add `/lb/fixed-node-status` API endpoint
6. Add `/lb/available-nodes` API endpoint
7. Add `header_filter_by_lua_block` for routing info headers

### Phase 3: Testing | 測試
1. Test `/lb/fixed-node/node1` sets Cookie correctly
2. Test `/lb/clear-fixed-node` clears Cookie
3. Test requests route to specified node
4. Test invalid node handling
5. Test auto-clear when node goes offline

### Phase 4: Deployment | 部署
1. Rebuild Docker image
2. Deploy to test environment
3. Verify functionality

---

## 📋 Test File | 測試檔案

Create `test-fixed-node.http`:

```http
### List available nodes | 列出可用節點
GET http://localhost/lb/available-nodes

### Set fixed node via URL (browser) | 透過 URL 設定固定節點
GET http://localhost/lb/fixed-node/node1

### Set fixed node via URL (browser) | 透過 URL 設定固定節點
GET http://localhost/lb/fixed-node/node2

### View fixed node status | 查看固定節點狀態
GET http://localhost/lb/fixed-node-status

### Clear fixed node via URL (browser) | 透過 URL 清除固定節點
GET http://localhost/lb/clear-fixed-node

### Set fixed node via API | 透過 API 設定固定節點
POST http://localhost/lb/set-fixed-node
Content-Type: application/json

{
  "node": "node2",
  "expires": 3600
}

### Clear fixed node via API | 透過 API 清除固定節點
POST http://localhost/lb/clear-fixed-node
```

---

## ⚠️ Notes | 注意事項

1. **Security | 安全性**: Management APIs (`/lb/set-fixed-node`, etc.) should have authentication in production
2. **Cookie Security | Cookie 安全**: `HttpOnly` flag is set; add `Secure` flag for HTTPS environments
3. **Node Failure | 節點失效**: When a fixed node goes offline, Cookie is automatically cleared
4. **Performance | 效能影響**: Cookie check is just string comparison, minimal impact

---

## 📅 Timeline | 時程

| Phase 階段 | Duration 時間 | Description 說明 |
| :--- | :--- | :--- |
| Phase 1 | 1 hour | Modify Lua module |
| Phase 2 | 2 hours | Add Nginx endpoints |
| Phase 3 | 1 hour | Testing |
| Phase 4 | 30 min | Deployment |

**Total Estimated Time | 預估總時間**: ~4.5 hours
