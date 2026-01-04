# =============================================================================
# Uptime Kuma - 手動部署資源
# =============================================================================
#
# 此資料夾包含需要手動部署的敏感資源：
#   - Secret: 資料庫密碼等敏感資訊
#   - PersistentVolume/PersistentVolumeClaim: 持久化存儲
#
# 部署順序：
#   1. 先部署 secret.yaml
#   2. 再部署 pv-pvc.yaml
#   3. 最後使用 Helm 部署主應用
#
# 使用方式：
#   kubectl apply -f secret.yaml
#   kubectl apply -f pv-pvc.yaml
#   helm install uptime-kuma ../uptime-kuma -n uptime-kuma
#
# =============================================================================
