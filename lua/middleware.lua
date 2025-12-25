--[[
  中介層模組
  統一處理 access 和 header_filter 階段的共用邏輯
]]
local _M = {}
local router = require "monitor_router"
local config = require "config"

-- Access 階段：預選節點
function _M.preselect_node()
    router.preselect_node()
end

-- Header Filter 階段：添加路由資訊標頭
function _M.add_routing_headers()
    if ngx.ctx.use_fixed_node then
        ngx.header["X-Routed-Via"] = "fixed-node"
    else
        ngx.header["X-Routed-Via"] = "load-balancer"
    end
    ngx.header["X-Routed-To"] = ngx.ctx.upstream_hostname or "unknown"
    
    -- 如果需要清除無效的固定節點 Cookie
    if ngx.ctx.clear_fixed_node_cookie then
        ngx.header["Set-Cookie"] = config.cookie.fixed_node_name .. "=; Path=/; Max-Age=0; HttpOnly"
    end
end

return _M
