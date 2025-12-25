--[[
  共用資料庫模組
  統一資料庫連接邏輯，避免重複代碼
]]
-- luacheck: globals ngx
local _M = {}
local config = require "config"
local mysql = require "resty.mysql"

-- 建立資料庫連接
function _M.connect()
    local db, err = mysql:new()
    if not db then
        ngx.log(ngx.ERR, "Failed to create MySQL connection: ", err)
        return nil, err
    end
    
    db:set_timeout(config.database.timeout)
    
    local ok, err = db:connect({
        host = config.database.host,
        port = config.database.port,
        user = config.database.user,
        password = config.database.password,
        database = config.database.database
    })
    
    if not ok then
        ngx.log(ngx.ERR, "Failed to connect to database: ", err)
        return nil, err
    end
    
    return db
end

-- 執行查詢並自動關閉連接
function _M.query(sql)
    local db, err = _M.connect()
    if not db then
        return nil, err
    end
    
    local res, err = db:query(sql)
    db:close()
    
    if not res then
        ngx.log(ngx.ERR, "Query failed: ", err)
        return nil, err
    end
    
    return res
end

-- 執行查詢並保持連接 (caller 負責關閉)
function _M.query_keep_alive(db, sql)
    if not db then
        return nil, "no database connection"
    end
    
    local res, err = db:query(sql)
    if not res then
        ngx.log(ngx.ERR, "Query failed: ", err)
        return nil, err
    end
    
    return res
end

return _M
