FROM openresty/openresty:alpine-fat

# 安裝必要的 Lua 模組
RUN opm install ledgetech/lua-resty-http \
    && opm install openresty/lua-resty-mysql \
    && opm install openresty/lua-cjson

# 建立必要的目錄
RUN mkdir -p /usr/local/openresty/nginx/conf/conf.d \
    && mkdir -p /usr/local/openresty/nginx/conf/ssl \
    && mkdir -p /usr/local/openresty/nginx/logs/debug

# 複製 Nginx 設定
COPY nginx/ /usr/local/openresty/nginx/conf/

# 複製 Lua 腳本到 lualib 或是指定路徑
# 建議放在 /usr/local/openresty/lualib 下以便直接 require
COPY lua/health_check.lua /usr/local/openresty/lualib/health_check.lua
COPY lua/monitor_router.lua /usr/local/openresty/lualib/monitor_router.lua

# 暴露埠
EXPOSE 80 443

# 啟動 OpenResty
CMD ["/usr/local/openresty/bin/openresty", "-g", "daemon off;"]
