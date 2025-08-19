FROM openresty/openresty:alpine-fat

# 安裝必要套件與工具
RUN apk add --no-cache \
    git \
    build-base \
    cmake \
    perl \
    wget \
    tar \
    unzip \
    luarocks \
    tzdata \
    curl

# 透過 opm/luarocks 安裝常用 OpenResty 套件
# - resty.http: HTTP client 給健康檢查使用
# - resty.mysql: MySQL 連線庫
# - lua-cjson: JSON 處理庫
RUN for i in 1 2 3 4 5; do \
      opm install ledgetech/lua-resty-http && break || sleep 5; \
    done && \
    for i in 1 2 3 4 5; do \
      opm install openresty/lua-resty-mysql && break || sleep 5; \
    done && \
    for i in 1 2 3 4 5; do \
      opm install openresty/lua-cjson && break || sleep 5; \
    done

# 設定時區
ENV TZ=Asia/Taipei

# 建立資料夾結構
RUN mkdir -p /usr/local/openresty/nginx/lua \
    && mkdir -p /usr/local/openresty/nginx/logs \
    && mkdir -p /usr/local/openresty/nginx/conf/conf.d

# === 複製 Lua 健康檢查模組到容器中 ===
COPY lua/health_check.lua /usr/local/openresty/nginx/lua/health_check.lua

# === 下載並編譯 emmy_core.so (Lua 偵錯器) ===
WORKDIR /tmp
RUN git clone https://github.com/EmmyLua/EmmyLuaDebugger.git \
    && cd EmmyLuaDebugger \
    && mkdir build && cd build \
    && cmake .. -DCMAKE_BUILD_TYPE=Release -DLUA_INCLUDE_DIR=/usr/local/openresty/luajit/include/luajit-2.1 \
    && make \
    && find . -name emmy_core.so -exec cp {} /usr/local/openresty/lualib/emmy_core.so \; \
    && cd / && rm -rf /tmp/EmmyLuaDebugger

# 設定 Lua 模組路徑（含 site/lualib，供 opm/luarocks 套件）
# 注意：nginx/lua 路徑放在最後，這樣 require 會優先從標準路徑查找，找不到才從自定義路徑查找
ENV LUA_PATH="/usr/local/openresty/site/lualib/?.lua;/usr/local/openresty/lualib/?.lua;/usr/local/openresty/nginx/lua/?.lua;;"
ENV LUA_CPATH="/usr/local/openresty/site/lualib/?.so;/usr/local/openresty/lualib/?.so;;"

# 創建健康檢查腳本
RUN echo '#!/bin/sh\ncurl -f http://localhost/health || exit 1' > /usr/local/bin/healthcheck.sh \
    && chmod +x /usr/local/bin/healthcheck.sh

# 預設啟動
CMD ["/usr/local/openresty/bin/openresty", "-g", "daemon off;"]


