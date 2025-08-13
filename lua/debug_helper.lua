-- Debug Helper Library
-- 提供调试相关的辅助函数

local debug_helper = {}

-- 调试器配置
local DEBUG_CONFIG = {
    host = "0.0.0.0",
    port = 9966,
    enabled = true  -- 可以通过环境变量或配置控制
}

-- 初始化调试器
-- @param host: 监听主机地址，默认为 "0.0.0.0"
-- @param port: 监听端口，默认为 9966
-- @param wait_for_ide: 是否等待IDE连接，默认为 true
-- @param set_breakpoint: 是否设置断点，默认为 true
function debug_helper.init_debugger(host, port, wait_for_ide, set_breakpoint)
    -- 如果调试被禁用，直接返回
    if not DEBUG_CONFIG.enabled then
        return false
    end
    
    -- 使用传入参数或默认值
    host = host or DEBUG_CONFIG.host
    port = port or DEBUG_CONFIG.port
    wait_for_ide = wait_for_ide ~= false  -- 默认为 true
    set_breakpoint = set_breakpoint ~= false  -- 默认为 true
    
    local ok, dbg = pcall(require, "emmy_core")
    if ok and dbg then
        -- 启动TCP监听
        local listen_ok = pcall(dbg.tcpListen, dbg, host, port)
        if listen_ok then
            print(string.format("[DEBUG] 调试器已启动，监听 %s:%d", host, port))
            
            -- 等待IDE连接
            if wait_for_ide then
                print("[DEBUG] 等待IDE连接...")
                pcall(dbg.waitIDE, dbg)
            end
            
            -- 设置断点
            if set_breakpoint then
                print("[DEBUG] 设置断点")
                pcall(dbg.breakHere, dbg)
            end
            
            return true
        else
            print(string.format("[DEBUG] 启动调试器失败，无法监听 %s:%d", host, port))
            return false
        end
    else
        print("[DEBUG] 无法加载 emmy_core 模块，调试器未启动")
        return false
    end
end

-- 快速启动调试器（使用默认配置）
function debug_helper.quick_debug()
    return debug_helper.init_debugger()
end

-- 启用/禁用调试
function debug_helper.set_debug_enabled(enabled)
    DEBUG_CONFIG.enabled = enabled
    print(string.format("[DEBUG] 调试功能已%s", enabled and "启用" or "禁用"))
end

-- 设置调试配置
function debug_helper.set_debug_config(config)
    if type(config) == "table" then
        for key, value in pairs(config) do
            if DEBUG_CONFIG[key] ~= nil then
                DEBUG_CONFIG[key] = value
            end
        end
        print("[DEBUG] 调试配置已更新")
    end
end

-- 获取当前调试配置
function debug_helper.get_debug_config()
    return DEBUG_CONFIG
end

-- 检查调试器是否可用
function debug_helper.is_debugger_available()
    local ok, _ = pcall(require, "emmy_core")
    return ok
end

-- 安全调试函数（不会因为调试器不可用而报错）
function debug_helper.safe_debug(callback)
    if DEBUG_CONFIG.enabled and debug_helper.is_debugger_available() then
        local ok, err = pcall(callback)
        if not ok then
            print(string.format("[DEBUG] 调试回调执行失败: %s", err))
        end
        return ok
    end
    return false
end

return debug_helper
