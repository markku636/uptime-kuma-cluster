FROM openresty/openresty:alpine

# 建立必要的目錄
RUN mkdir -p /usr/local/openresty/nginx/conf/conf.d \
    && mkdir -p /usr/local/openresty/nginx/conf/ssl \
    && mkdir -p /usr/local/openresty/nginx/logs/debug

# 複製 Nginx 設定檔
COPY nginx/nginx.conf /usr/local/openresty/nginx/conf/nginx.conf
COPY nginx/conf.d/ /usr/local/openresty/nginx/conf/conf.d/
COPY nginx/ssl/ /usr/local/openresty/nginx/conf/ssl/

# 複製 Lua 腳本
COPY lua/health_check.lua /usr/local/openresty/lualib/health_check.lua
COPY lua/monitor_router.lua /usr/local/openresty/lualib/monitor_router.lua

# 暴露埠
EXPOSE 80 443

# 啟動 OpenResty
CMD ["/usr/local/openresty/bin/openresty", "-g", "daemon off;"]
