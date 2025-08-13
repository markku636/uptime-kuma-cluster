-- 測試 require 腳本
-- 用於驗證 Lua 模組路徑配置是否正確

ngx.log(ngx.INFO, "[TEST] 開始測試 require 功能...")

-- 測試 require load_balancer
local ok, load_balancer = pcall(require, "load_balancer")
if ok then
    ngx.log(ngx.INFO, "[TEST] load_balancer 模組載入成功")
else
    ngx.log(ngx.ERR, "[TEST] load_balancer 模組載入失敗: ", load_balancer)
end

-- 測試 require health_check
local ok2, health_check = pcall(require, "health_check")
if ok2 then
    ngx.log(ngx.INFO, "[TEST] health_check 模組載入成功")
else
    ngx.log(ngx.ERR, "[TEST] health_check 模組載入失敗: ", health_check)
end

-- 測試 require debug_helper
local ok3, debug_helper = pcall(require, "debug_helper")
if ok3 then
    ngx.log(ngx.INFO, "[TEST] debug_helper 模組載入成功")
else
    ngx.log(ngx.ERR, "[TEST] debug_helper 模組載入失敗: ", debug_helper)
end

-- 測試 require cjson
local ok4, cjson = pcall(require, "cjson")
if ok4 then
    ngx.log(ngx.INFO, "[TEST] cjson 模組載入成功")
else
    ngx.log(ngx.ERR, "[TEST] cjson 模組載入失敗: ", cjson)
end

-- 測試 require resty.mysql
local ok5, mysql = pcall(require, "resty.mysql")
if ok5 then
    ngx.log(ngx.INFO, "[TEST] resty.mysql 模組載入成功")
else
    ngx.log(ngx.ERR, "[TEST] resty.mysql 模組載入失敗: ", mysql)
end

ngx.log(ngx.INFO, "[TEST] require 測試完成")

-- 返回測試結果
return {
    load_balancer = ok,
    health_check = ok2,
    debug_helper = ok3,
    cjson = ok4,
    mysql = ok5
}
