--[[
  Lua 模組單元測試
  測試重構後的模組是否正常運作
  
  執行方式: 在 OpenResty 環境中執行，或用 resty CLI
  resty test_lua_modules.lua
]]

-- Mock ngx 物件 (用於非 OpenResty 環境測試)
if not ngx then
    ngx = {
        log = function(level, ...) 
            local args = {...}
            print("[LOG] " .. table.concat(args, ""))
        end,
        DEBUG = 1,
        INFO = 2,
        WARN = 3,
        ERR = 4,
        shared = {
            health_checker = {
                get = function() return nil end,
                set = function() return true end,
                incr = function() return 1 end,
                delete = function() return true end
            },
            monitor_routing = {
                get = function() return nil end,
                set = function() return true end
            }
        },
        ctx = {},
        var = {},
        header = {},
        say = print,
        exit = function() end,
        quote_sql_str = function(s) return "'" .. s .. "'" end,
        crc32_short = function(s) return 12345 end
    }
    
    -- Mock os.getenv
    local original_getenv = os.getenv
    os.getenv = function(key)
        local mock_env = {
            DB_HOST = "localhost",
            DB_PORT = "3306",
            DB_USER = "test",
            DB_PASSWORD = "test",
            DB_NAME = "test",
            EMMY_DEBUG_ENABLED = "true"
        }
        return mock_env[key] or original_getenv(key)
    end
end

local test_results = {
    passed = 0,
    failed = 0,
    tests = {}
}

local function test(name, fn)
    local ok, err = pcall(fn)
    if ok then
        test_results.passed = test_results.passed + 1
        table.insert(test_results.tests, {name = name, status = "PASS"})
        print("✅ PASS: " .. name)
    else
        test_results.failed = test_results.failed + 1
        table.insert(test_results.tests, {name = name, status = "FAIL", error = err})
        print("❌ FAIL: " .. name .. " - " .. tostring(err))
    end
end

local function assert_equal(actual, expected, msg)
    if actual ~= expected then
        error(string.format("%s: expected '%s', got '%s'", msg or "Assertion failed", tostring(expected), tostring(actual)))
    end
end

local function assert_not_nil(value, msg)
    if value == nil then
        error(msg or "Expected non-nil value")
    end
end

local function assert_type(value, expected_type, msg)
    if type(value) ~= expected_type then
        error(string.format("%s: expected type '%s', got '%s'", msg or "Type assertion failed", expected_type, type(value)))
    end
end

print("\n" .. string.rep("=", 50))
print("🧪 Lua 模組單元測試")
print(string.rep("=", 50) .. "\n")

-- ============================================================
-- 測試 config.lua
-- ============================================================
print("\n📦 測試 config.lua")
print(string.rep("-", 30))

test("config: 模組載入", function()
    local config = require "config"
    assert_not_nil(config, "config should not be nil")
end)

test("config: database 配置存在", function()
    local config = require "config"
    assert_not_nil(config.database, "database config should exist")
    assert_not_nil(config.database.host, "database.host should exist")
    assert_not_nil(config.database.port, "database.port should exist")
end)

test("config: cluster 配置存在", function()
    local config = require "config"
    assert_not_nil(config.cluster, "cluster config should exist")
    assert_not_nil(config.cluster.node_count, "cluster.node_count should exist")
    assert_not_nil(config.cluster.monitor_limit_per_node, "cluster.monitor_limit_per_node should exist")
end)

test("config: health_check 配置存在", function()
    local config = require "config"
    assert_not_nil(config.health_check, "health_check config should exist")
    assert_not_nil(config.health_check.interval, "health_check.interval should exist")
end)

test("config: debug 配置存在", function()
    local config = require "config"
    assert_not_nil(config.debug, "debug config should exist")
    assert_type(config.debug.enabled, "boolean", "debug.enabled should be boolean")
end)

test("config: cookie 配置存在", function()
    local config = require "config"
    assert_not_nil(config.cookie, "cookie config should exist")
    assert_not_nil(config.cookie.fixed_node_name, "cookie.fixed_node_name should exist")
end)

-- ============================================================
-- 測試 logger.lua
-- ============================================================
print("\n📦 測試 logger.lua")
print(string.rep("-", 30))

test("logger: 模組載入", function()
    local logger = require "logger"
    assert_not_nil(logger, "logger should not be nil")
end)

test("logger: debug 函數存在", function()
    local logger = require "logger"
    assert_type(logger.debug, "function", "logger.debug should be a function")
end)

test("logger: info 函數存在", function()
    local logger = require "logger"
    assert_type(logger.info, "function", "logger.info should be a function")
end)

test("logger: warn 函數存在", function()
    local logger = require "logger"
    assert_type(logger.warn, "function", "logger.warn should be a function")
end)

test("logger: error 函數存在", function()
    local logger = require "logger"
    assert_type(logger.error, "function", "logger.error should be a function")
end)

test("logger: 便捷方法存在", function()
    local logger = require "logger"
    assert_type(logger.health_check, "function", "logger.health_check should be a function")
    assert_type(logger.database, "function", "logger.database should be a function")
    assert_type(logger.network, "function", "logger.network should be a function")
    assert_type(logger.system, "function", "logger.system should be a function")
    assert_type(logger.router, "function", "logger.router should be a function")
end)

test("logger: debug 調用不報錯", function()
    local logger = require "logger"
    logger.debug("TEST", "test message %s", "arg1")
end)

test("logger: 便捷方法調用不報錯", function()
    local logger = require "logger"
    logger.health_check("test %d", 123)
    logger.database("test %s", "query")
    logger.network("test %s:%d", "host", 80)
    logger.system("test")
    logger.router("test %s", "node1")
end)

-- ============================================================
-- 測試 db.lua
-- ============================================================
print("\n📦 測試 db.lua")
print(string.rep("-", 30))

test("db: 模組載入", function()
    local db = require "db"
    assert_not_nil(db, "db should not be nil")
end)

test("db: connect 函數存在", function()
    local db = require "db"
    assert_type(db.connect, "function", "db.connect should be a function")
end)

test("db: query 函數存在", function()
    local db = require "db"
    assert_type(db.query, "function", "db.query should be a function")
end)

-- ============================================================
-- 測試 middleware.lua
-- ============================================================
print("\n📦 測試 middleware.lua")
print(string.rep("-", 30))

test("middleware: 模組載入", function()
    local middleware = require "middleware"
    assert_not_nil(middleware, "middleware should not be nil")
end)

test("middleware: preselect_node 函數存在", function()
    local middleware = require "middleware"
    assert_type(middleware.preselect_node, "function", "middleware.preselect_node should be a function")
end)

test("middleware: add_routing_headers 函數存在", function()
    local middleware = require "middleware"
    assert_type(middleware.add_routing_headers, "function", "middleware.add_routing_headers should be a function")
end)

-- ============================================================
-- 測試 monitor_router.lua
-- ============================================================
print("\n📦 測試 monitor_router.lua")
print(string.rep("-", 30))

test("monitor_router: 模組載入", function()
    local router = require "monitor_router"
    assert_not_nil(router, "monitor_router should not be nil")
end)

test("monitor_router: hash_route 函數存在", function()
    local router = require "monitor_router"
    assert_type(router.hash_route, "function", "router.hash_route should be a function")
end)

test("monitor_router: hash_route 回傳正確格式", function()
    local router = require "monitor_router"
    local result = router.hash_route(1)
    assert_not_nil(result, "hash_route should return a value")
    assert_equal(string.match(result, "^node%d+$") ~= nil, true, "hash_route should return nodeX format")
end)

test("monitor_router: route_by_user 函數存在", function()
    local router = require "monitor_router"
    assert_type(router.route_by_user, "function", "router.route_by_user should be a function")
end)

test("monitor_router: get_fixed_node_from_cookie 函數存在", function()
    local router = require "monitor_router"
    assert_type(router.get_fixed_node_from_cookie, "function", "router.get_fixed_node_from_cookie should be a function")
end)

-- ============================================================
-- 測試 health_check.lua
-- ============================================================
print("\n📦 測試 health_check.lua")
print(string.rep("-", 30))

test("health_check: 模組載入", function()
    local health_check = require "health_check"
    assert_not_nil(health_check, "health_check should not be nil")
end)

test("health_check: init 函數存在", function()
    local health_check = require "health_check"
    assert_type(health_check.init, "function", "health_check.init should be a function")
end)

test("health_check: get_statistics 函數存在", function()
    local health_check = require "health_check"
    assert_type(health_check.get_statistics, "function", "health_check.get_statistics should be a function")
end)

test("health_check: get_debug_config 函數存在", function()
    local health_check = require "health_check"
    assert_type(health_check.get_debug_config, "function", "health_check.get_debug_config should be a function")
end)

-- ============================================================
-- 測試結果
-- ============================================================
print("\n" .. string.rep("=", 50))
print("📊 測試結果")
print(string.rep("=", 50))
print(string.format("✅ 通過: %d", test_results.passed))
print(string.format("❌ 失敗: %d", test_results.failed))
print(string.format("📝 總計: %d", test_results.passed + test_results.failed))
print(string.rep("=", 50))

if test_results.failed > 0 then
    print("\n❌ 失敗的測試:")
    for _, t in ipairs(test_results.tests) do
        if t.status == "FAIL" then
            print("  - " .. t.name .. ": " .. t.error)
        end
    end
end

-- 回傳結果
return test_results.failed == 0
