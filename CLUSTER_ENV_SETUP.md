# Uptime Kuma Cluster 環境變數配置說明

## 概述

這個 Docker Compose 集群配置現在支援使用環境變數來動態配置節點端口和主機地址，而不是硬編碼的值。

## 環境變數配置

### 1. 節點端口配置

- `NODE1_PORT`: 第一個節點的外部端口（預設：3001）
- `NODE2_PORT`: 第二個節點的外部端口（預設：3002）
- `NODE3_PORT`: 第三個節點的外部端口（預設：3003）

### 2. 節點主機配置

- `NODE_HOST`: 節點主機的 IP 地址（預設：192.168.201.101）

## 使用方法

### 方法 1：使用 .env 文件

1. 複製 `env.example` 為 `.env`：
   ```bash
   cp env.example .env
   ```

2. 編輯 `.env` 文件，根據你的環境修改值：
   ```bash
   # 節點端口配置
   NODE1_PORT=3001
   NODE2_PORT=3002
   NODE3_PORT=3003
   
   # 節點主機地址
   NODE_HOST=192.168.201.101
   ```

3. 啟動集群：
   ```bash
   docker-compose -f docker-compose-cluster.yaml up -d
   ```

### 方法 2：直接在命令行設定

```bash
# 設定環境變數
export NODE1_PORT=3001
export NODE2_PORT=3002
export NODE3_PORT=3003
export NODE_HOST=192.168.201.101

# 啟動集群
docker-compose -f docker-compose-cluster.yaml up -d
```

### 方法 3：在 docker-compose 命令中設定

```bash
docker-compose -f docker-compose-cluster.yaml \
  -e NODE1_PORT=3001 \
  -e NODE2_PORT=3002 \
  -e NODE3_PORT=3003 \
  -e NODE_HOST=192.168.201.101 \
  up -d
```

## 配置範例

### 基本配置（使用預設值）

如果使用預設配置，節點將使用以下設定：

- Node 1: `192.168.201.101:3001`
- Node 2: `192.168.201.101:3002`
- Node 3: `192.168.201.101:3003`

### 自定義配置

如果你想要使用不同的端口：

```bash
# .env 文件
NODE1_PORT=4001
NODE2_PORT=4002
NODE3_PORT=4003
NODE_HOST=10.0.0.100
```

結果：
- Node 1: `10.0.0.100:4001`
- Node 2: `10.0.0.100:4002`
- Node 3: `10.0.0.100:4003`

## 重要注意事項

1. **端口映射**：每個節點的內部端口都是 3001，但外部端口可以通過環境變數自定義
2. **主機地址**：`NODE_HOST` 變數會自動與對應的節點端口組合
3. **預設值**：如果環境變數未設定，系統會使用硬編碼的預設值
4. **健康檢查**：健康檢查仍然使用內部端口 3001

## 故障排除

### 端口衝突

如果遇到端口衝突，檢查：
1. 環境變數是否正確設定
2. 端口是否已被其他服務使用
3. 防火牆設定是否允許這些端口

### 環境變數未生效

確保：
1. `.env` 文件在正確的目錄中
2. 環境變數名稱拼寫正確
3. 重新啟動 Docker Compose 服務

## 相關文件

- `docker-compose-cluster.yaml`: 主要的集群配置文件
- `env.example`: 環境變數配置範例
- `CLUSTER_README.md`: 集群部署說明
