#!/bin/bash

# Uptime Kuma 集群擴展腳本
# 使用方法: ./expand-cluster.sh <節點數量>

set -e

# 檢查參數
if [ $# -ne 1 ]; then
    echo "使用方法: $0 <節點數量>"
    echo "範例: $0 6  # 將集群擴展到 6 個節點"
    exit 1
fi

TOTAL_NODES=$1

# 驗證節點數量
if ! [[ "$TOTAL_NODES" =~ ^[0-9]+$ ]] || [ "$TOTAL_NODES" -lt 1 ]; then
    echo "錯誤: 節點數量必須是正整數"
    exit 1
fi

if [ "$TOTAL_NODES" -gt 20 ]; then
    echo "警告: 節點數量超過 20 個，請確認您的系統資源足夠"
    read -p "繼續嗎? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

echo "正在將集群擴展到 $TOTAL_NODES 個節點..."

# 生成新的 docker-compose.yaml
cat > docker-compose-expanded-cluster.yaml << EOF
version: '3.8'

services:
  # 共用的 MariaDB 資料庫
  mariadb:
    image: mariadb:10
    container_name: uptime-kuma-mariadb
    environment:
      MYSQL_ROOT_PASSWORD: kuma_root_pass
      MYSQL_DATABASE: kuma
      MYSQL_USER: kuma
      MYSQL_PASSWORD: kuma_pass
    volumes:
      - kuma-db:/var/lib/mysql
    ports:
      - "3306:3306"
    restart: unless-stopped
    networks:
      - kuma-network

  # 負載均衡器
  nginx:
    image: nginx:alpine
    container_name: uptime-kuma-nginx
    ports:
      - "80:80"
      - "443:443"
EOF

# 添加直接存取端口
for i in $(seq 1 $TOTAL_NODES); do
    port=$((8000 + i))
    echo "      - \"$port:$port\"  # 直接存取 node$i" >> docker-compose-expanded-cluster.yaml
done

cat >> docker-compose-expanded-cluster.yaml << EOF
    volumes:
      - ./nginx-expanded-cluster.conf:/etc/nginx/nginx.conf
    depends_on:
EOF

# 添加 depends_on 列表
for i in $(seq 1 $TOTAL_NODES); do
    echo "      - uptime-kuma-node$i" >> docker-compose-expanded-cluster.yaml
done

cat >> docker-compose-expanded-cluster.yaml << EOF
    restart: unless-stopped
    networks:
      - kuma-network

EOF

# 生成所有節點配置
for i in $(seq 1 $TOTAL_NODES); do
    cat >> docker-compose-expanded-cluster.yaml << EOF
  # Node $i
  uptime-kuma-node$i:
    build:
      context: .
      dockerfile: docker/dockerfile
      target: release
    container_name: uptime-kuma-node$i
    volumes:
      - ./data/node$i:/app/data
    expose:
      - "3001"
    environment:
      - UM_ALLOW_IFRAME=true
      - UPTIME_KUMA_DISABLE_FRAME_SAMEORIGIN=true
      - UPTIME_KUMA_DB_TYPE=mariadb
      - UPTIME_KUMA_DB_HOSTNAME=mariadb
      - UPTIME_KUMA_DB_PORT=3306
      - UPTIME_KUMA_DB_NAME=kuma
      - UPTIME_KUMA_DB_USERNAME=kuma
      - UPTIME_KUMA_DB_PASSWORD=kuma_pass
      - UPTIME_KUMA_NODE_ID=node$i
      - UPTIME_KUMA_NODE_NAME=Node $i
      - UPTIME_KUMA_NODE_IP=uptime-kuma-node$i
    depends_on:
      - mariadb
    restart: unless-stopped
    networks:
      - kuma-network

EOF
done

cat >> docker-compose-expanded-cluster.yaml << EOF
volumes:
  kuma-db:

networks:
  kuma-network:
    driver: bridge
EOF

# 生成對應的 nginx 配置
cat > nginx-expanded-cluster.conf << 'EOF'
events {
    worker_connections 1024;
}

http {
    # 負載均衡配置
    upstream uptime_kuma_cluster {
        # Round-robin 負載均衡
EOF

# 添加所有節點到 upstream
for i in $(seq 1 $TOTAL_NODES); do
    echo "        server uptime-kuma-node$i:3001;" >> nginx-expanded-cluster.conf
done

cat >> nginx-expanded-cluster.conf << 'EOF'
        
        # 健康檢查配置 (需要 nginx-plus 或自定義健康檢查)
        # keepalive 32;
    }

    # 主要代理伺服器配置
    server {
        listen 80;
        server_name _;

        # 根路徑代理
        location / {
            proxy_pass http://uptime_kuma_cluster;
            proxy_http_version 1.1;
            
            # WebSocket 支援
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection "upgrade";
            
            # 基本代理標頭
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
            
            # 超時設定
            proxy_connect_timeout 60s;
            proxy_send_timeout 60s;
            proxy_read_timeout 60s;
            
            # 緩衝設定
            proxy_buffering off;
            proxy_buffer_size 4k;
            
            # 黏性會話 (可選 - 取消註釋啟用)
            # ip_hash;
        }
        
        # API 路徑特殊處理
        location /api/ {
            proxy_pass http://uptime_kuma_cluster;
            proxy_http_version 1.1;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
        }

        # Socket.IO 特殊處理
        location /socket.io/ {
            proxy_pass http://uptime_kuma_cluster;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection "upgrade";
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
        }

        # 健康檢查端點
        location /health {
            access_log off;
            return 200 "healthy\n";
            add_header Content-Type text/plain;
        }
    }

EOF

# 添加直接存取各節點的配置
for i in $(seq 1 $TOTAL_NODES); do
    port=$((8000 + i))
    cat >> nginx-expanded-cluster.conf << EOF
    # 直接存取 Node $i
    server {
        listen $port;
        server_name _;
        location / {
            proxy_pass http://uptime-kuma-node$i:3001;
            proxy_http_version 1.1;
            proxy_set_header Upgrade \$http_upgrade;
            proxy_set_header Connection "upgrade";
            proxy_set_header Host \$host;
            proxy_set_header X-Real-IP \$remote_addr;
            proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto \$scheme;
        }
    }

EOF
done

echo "}" >> nginx-expanded-cluster.conf

# 創建數據目錄
echo "正在創建數據目錄..."
for i in $(seq 1 $TOTAL_NODES); do
    mkdir -p "data/node$i"
    echo "已創建 data/node$i/"
done

# 設置權限
echo "正在設置權限..."
chmod +x expand-cluster.sh
chmod 644 docker-compose-expanded-cluster.yaml
chmod 644 nginx-expanded-cluster.conf

echo "✅ 集群配置生成完成！"
echo ""
echo "生成的檔案："
echo "  - docker-compose-expanded-cluster.yaml (Docker Compose 配置)"
echo "  - nginx-expanded-cluster.conf (Nginx 負載均衡配置)"
echo "  - data/node1/ 到 data/node$TOTAL_NODES/ (數據目錄)"
echo ""
echo "啟動集群："
echo "  docker-compose -f docker-compose-expanded-cluster.yaml up -d"
echo ""
echo "存取方式："
echo "  - 負載均衡存取: http://localhost"
echo "  - 健康檢查: http://localhost/health"
for i in $(seq 1 $TOTAL_NODES); do
    port=$((8000 + i))
    echo "  - 直接存取 Node $i: http://localhost:$port"
done
echo ""
echo "監控集群狀態："
echo "  docker-compose -f docker-compose-expanded-cluster.yaml ps"
echo "  docker-compose -f docker-compose-expanded-cluster.yaml logs -f" 