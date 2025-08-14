-- OpenResty 調試初始化腳本
-- 此腳本會在 nginx 啟動時自動載入並初始化調試器

local debug_helper = require("debug_helper")

-- 檢查環境變數是否啟用調試
local debug_enabled = os.getenv("EMMY_DEBUG_ENABLED")
local debug_host = os.getenv("EMMY_DEBUG_HOST") or "0.0.0.0"
local debug_port = tonumber(os.getenv("EMMY_DEBUG_PORT")) or 9966

if debug_enabled == "true" then
    ngx.log(ngx.INFO, "[DEBUG] 正在初始化調試器...")
    
    -- 設置調試配置
    debug_helper.set_debug_config({
        host = debug_host,
        port = debug_port,
        enabled = true
    })
    
    -- 啟動調試器
    local success = debug_helper.init_debugger(debug_host, debug_port, true, true)
    
    if success then
        ngx.log(ngx.INFO, string.format("[DEBUG] 調試器已啟動，監聽 %s:%d", debug_host, debug_port))
        ngx.log(ngx.INFO, "[DEBUG] 等待 IDE 連接...")
    else
        ngx.log(ngx.WARN, "[DEBUG] 調試器啟動失敗")
    end
else
    ngx.log(ngx.INFO, "[DEBUG] 調試功能未啟用")
end

-- 返回調試器狀態
return debug_helper
