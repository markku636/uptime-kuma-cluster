# =============================================================================
# Uptime Kuma Kubernetes 部署指南
# =============================================================================

## 目錄結構

```
deployment/k8s/
├── uptime-kuma/                    # Helm Chart
│   ├── Chart.yaml                  # Chart 定義
│   ├── values.yaml                 # 預設值配置
│   ├── .helmignore                 # Helm 忽略檔案
│   └── templates/                  # K8s 資源模板
│       ├── _helpers.tpl            # 模板輔助函數
│       ├── namespace.yaml          # Namespace
│       ├── serviceaccount.yaml     # ServiceAccount
│       ├── configmap.yaml          # ConfigMap
│       ├── service.yaml            # Services
│       ├── statefulset.yaml        # Uptime Kuma StatefulSet
│       ├── mariadb-deployment.yaml # MariaDB Deployment
│       ├── openresty-deployment.yaml # OpenResty Deployment
│       ├── ingress.yaml            # Ingress (optional)
│       ├── hpa.yaml                # HPA (optional)
│       └── NOTES.txt               # 部署說明
│
└── manual-resources/               # 手動部署資源
    ├── README.md                   # 說明文件
    ├── namespace.yaml              # Namespace
    ├── secret.yaml                 # 資料庫密碼 Secret
    └── pv-pvc.yaml                 # PersistentVolume 和 PVC
```

## 部署步驟

### 1. 前置準備

確保您已安裝：
- kubectl
- Helm 3.x
- 可連接的 Kubernetes 集群

### 2. 建立 Namespace

```bash
kubectl apply -f manual-resources/namespace.yaml
```

### 3. 部署 Secret（重要！請先修改密碼）

編輯 `manual-resources/secret.yaml` 修改密碼後：

```bash
kubectl apply -f manual-resources/secret.yaml
```

或使用 kubectl 直接建立：

```bash
kubectl create secret generic uptime-kuma-db-secret \
  --namespace uptime-kuma \
  --from-literal=root-password=YOUR_ROOT_PASSWORD \
  --from-literal=username=kuma \
  --from-literal=password=YOUR_DB_PASSWORD
```

### 4. 部署 PersistentVolume（根據環境選擇）

```bash
kubectl apply -f manual-resources/pv-pvc.yaml
```

### 5. 使用 Helm 部署應用

```bash
# 安裝
helm install uptime-kuma ./uptime-kuma -n uptime-kuma

# 或指定自訂 values
helm install uptime-kuma ./uptime-kuma -n uptime-kuma -f custom-values.yaml
```

### 6. 驗證部署

```bash
# 檢查 Pods
kubectl get pods -n uptime-kuma

# 檢查 Services
kubectl get svc -n uptime-kuma

# 查看日誌
kubectl logs -f -l app.kubernetes.io/name=uptime-kuma -n uptime-kuma
```

## 配置說明

### values.yaml 主要配置項

| 參數 | 說明 | 預設值 |
|------|------|--------|
| `uptimeKuma.replicaCount` | Uptime Kuma 副本數 | 3 |
| `uptimeKuma.image.repository` | 映像倉庫 | uptime-kuma-bun-cluster |
| `uptimeKuma.image.tag` | 映像標籤 | local |
| `openresty.enabled` | 是否啟用 OpenResty | true |
| `openresty.replicaCount` | OpenResty 副本數 | 2 |
| `mariadb.enabled` | 是否啟用 MariaDB | true |
| `mariadb.persistence.enabled` | 是否啟用持久化 | true |
| `service.type` | Service 類型 | LoadBalancer |
| `ingress.enabled` | 是否啟用 Ingress | false |
| `autoscaling.enabled` | 是否啟用 HPA | false |

### 自訂配置範例

建立 `custom-values.yaml`：

```yaml
uptimeKuma:
  replicaCount: 5
  resources:
    requests:
      cpu: 200m
      memory: 512Mi
    limits:
      cpu: 1000m
      memory: 1Gi

openresty:
  replicaCount: 3

service:
  type: ClusterIP

ingress:
  enabled: true
  className: nginx
  hosts:
    - host: uptime-kuma.example.com
      paths:
        - path: /
          pathType: Prefix
  tls:
    - secretName: uptime-kuma-tls
      hosts:
        - uptime-kuma.example.com

autoscaling:
  enabled: true
  minReplicas: 3
  maxReplicas: 10
```

## 升級與回滾

### 升級

```bash
helm upgrade uptime-kuma ./uptime-kuma -n uptime-kuma -f custom-values.yaml
```

### 回滾

```bash
# 查看歷史版本
helm history uptime-kuma -n uptime-kuma

# 回滾到指定版本
helm rollback uptime-kuma [REVISION] -n uptime-kuma
```

## 卸載

```bash
# 卸載 Helm release
helm uninstall uptime-kuma -n uptime-kuma

# 刪除手動資源（可選）
kubectl delete -f manual-resources/pv-pvc.yaml
kubectl delete -f manual-resources/secret.yaml
kubectl delete -f manual-resources/namespace.yaml
```

## 故障排除

### 常見問題

1. **Pod 無法啟動**
   - 檢查 Secret 是否正確建立
   - 檢查 PVC 是否綁定成功

2. **資料庫連接失敗**
   - 確認 MariaDB Pod 運行正常
   - 檢查 Secret 中的密碼是否正確

3. **服務無法存取**
   - 檢查 Service 和 Ingress 配置
   - 確認防火牆規則

### 查看詳細日誌

```bash
# Uptime Kuma 日誌
kubectl logs -f deployment/uptime-kuma-0 -n uptime-kuma

# MariaDB 日誌
kubectl logs -f deployment/uptime-kuma-mariadb -n uptime-kuma

# OpenResty 日誌
kubectl logs -f deployment/uptime-kuma-openresty -n uptime-kuma
```
