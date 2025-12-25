--[[
  共用日誌模組
  統一日誌格式和分類
]]
local _M = {}
local config = require "config"

-- 類別圖示對照
local CATEGORY_ICONS = {
    HEALTH_CHECK = "🔍",
    DATABASE = "🗄️",
    NETWORK = "🌐",
    SYSTEM = "⚙️",
    ROUTER = "🔀",
    DEBUG = "🐛"
}

-- 檢查是否啟用調試
local function is_debug_enabled()
    return config.debug.enabled
end

-- 基礎日誌函數
function _M.log(level, category, message, ...)
    local icon = CATEGORY_ICONS[category] or "📝"
    local formatted = string.format(message, ...)
    ngx.log(level, icon, " [", category, "] ", formatted)
end

-- 調試日誌 (只在 debug 模式輸出)
function _M.debug(category, message, ...)
    if not is_debug_enabled() then return end
    _M.log(ngx.DEBUG, category, message, ...)
end

-- Info 日誌
function _M.info(category, message, ...)
    _M.log(ngx.INFO, category, message, ...)
end

-- Warn 日誌
function _M.warn(category, message, ...)
    _M.log(ngx.WARN, category, message, ...)
end

-- Error 日誌
function _M.error(category, message, ...)
    _M.log(ngx.ERR, category, message, ...)
end

-- 便捷方法：各類別的調試日誌
function _M.health_check(message, ...)
    _M.debug("HEALTH_CHECK", message, ...)
end

function _M.database(message, ...)
    _M.debug("DATABASE", message, ...)
end

function _M.network(message, ...)
    _M.debug("NETWORK", message, ...)
end

function _M.system(message, ...)
    _M.debug("SYSTEM", message, ...)
end

function _M.router(message, ...)
    _M.debug("ROUTER", message, ...)
end

return _M
