# Uptime Kuma 集群配置說明

## 概述

本配置使用 Docker Compose 部署 Uptime Kuma 集群，包含：
- 1個 MariaDB 資料庫
- 3個 Uptime Kuma 節點
- 1個 OpenResty 負載平衡器

## 文件結構

```
├── docker-compose-cluster.yaml    # Docker Compose 主配置文件
├── cluster.env                    # 環境變數配置文件
├── nginx/                        # Nginx 配置目錄
│   ├── nginx.conf               # 主配置文件
│   ├── conf.d/                  # 子配置文件
│   └── ssl/                     # SSL 證書目錄
└── data/                        # 節點數據目錄
    ├── node1/                   # 節點1數據
    ├── node2/                   # 節點2數據
    └── node3/                   # 節點3數據
```

## 環境變數配置

### 資料庫配置
- `DB_TYPE`: 資料庫類型 (mariadb)
- `DB_HOST`: 資料庫主機名
- `DB_PORT`: 資料庫端口
- `DB_NAME`: 資料庫名稱
- `DB_USER`: 資料庫用戶名
- `DB_PASSWORD`: 資料庫密碼
- `DB_ROOT_PASSWORD`: 資料庫root密碼

### 節點配置
- `NODE1_ID`, `NODE2_ID`, `NODE3_ID`: 節點ID
- `NODE1_NAME`, `NODE2_NAME`, `NODE3_NAME`: 節點名稱
- `NODE1_HOST`, `NODE2_HOST`, `NODE3_HOST`: 節點主機名
- `NODE1_PORT`, `NODE2_PORT`, `NODE3_PORT`: 節點端口

### OpenResty配置
- `OPENRESTY_DEBUG_ENABLED`: 啟用調試模式
- `OPENRESTY_DEBUG_HOST`: 調試主機
- `OPENRESTY_DEBUG_PORT`: 調試端口
- `DEBUG_LOG_LEVEL`: 日誌級別

### 健康檢查配置
- `HEALTH_CHECK_INTERVAL`: 健康檢查間隔
- `HEALTH_CHECK_TIMEOUT`: 健康檢查超時
- `HEALTH_CHECK_RETRIES`: 健康檢查重試次數
- `HEALTH_CHECK_START_PERIOD`: 健康檢查開始等待時間

## 使用方法

### 1. 啟動集群
```bash
docker-compose -f docker-compose-cluster.yaml up -d
```

### 2. 查看服務狀態
```bash
docker-compose -f docker-compose-cluster.yaml ps
```

### 3. 查看日誌
```bash
# 查看所有服務日誌
docker-compose -f docker-compose-cluster.yaml logs

# 查看特定服務日誌
docker-compose -f docker-compose-cluster.yaml logs uptime-kuma-node1
```

### 4. 停止集群
```bash
docker-compose -f docker-compose-cluster.yaml down
```

## 配置修改

### 修改節點數量
1. 在 `cluster.env` 中添加新的節點配置
2. 在 `docker-compose-cluster.yaml` 中添加新的節點服務
3. 更新 OpenResty 的 `depends_on` 配置

### 修改端口配置
在 `cluster.env` 中修改對應的端口變數：
```bash
NODE1_PORT=9091
NODE2_PORT=9092
NODE3_PORT=9093
```

### 修改資料庫配置
在 `cluster.env` 中修改資料庫相關變數：
```bash
DB_HOST=mariadb
DB_PORT=3306
DB_NAME=kuma
DB_USER=kuma
DB_PASSWORD=your_new_password
```

## 優勢

1. **集中管理**: 所有環境變數集中在 `cluster.env` 文件中
2. **易於維護**: 修改配置只需編輯一個文件
3. **可重用**: 使用 YAML anchors 和 aliases 避免重複配置
4. **靈活性**: 可以輕鬆添加或移除節點
5. **一致性**: 所有服務使用相同的配置模板

## 故障排除

### 常見問題

1. **節點無法啟動**: 檢查資料庫連接和環境變數
2. **負載平衡器無法訪問**: 檢查端口映射和網路配置
3. **健康檢查失敗**: 調整健康檢查參數

### 日誌查看
```bash
# 查看特定服務的詳細日誌
docker-compose -f docker-compose-cluster.yaml logs -f uptime-kuma-node1

# 查看資料庫日誌
docker-compose -f docker-compose-cluster.yaml logs -f mariadb
```

## 安全注意事項

1. 修改默認密碼
2. 限制網路訪問
3. 定期更新鏡像
4. 監控日誌文件
5. 備份重要數據

