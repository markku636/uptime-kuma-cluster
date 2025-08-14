# deploy-cluster.ps1 - Uptime Kuma Cluster 部署腳本
param(
    [string]$Action = "deploy",
    [string]$Environment = "production"
)

Write-Host "=== Uptime Kuma Cluster 部署腳本 ===" -ForegroundColor Green
Write-Host "動作: $Action" -ForegroundColor Yellow
Write-Host "環境: $Environment" -ForegroundColor Yellow

# 檢查 Docker 是否運行
function Test-Docker {
    try {
        docker version | Out-Null
        return $true
    }
    catch {
        Write-Host "錯誤: Docker 未運行或未安裝" -ForegroundColor Red
        return $false
    }
}

# 檢查 Docker Compose 是否可用
function Test-DockerCompose {
    try {
        docker-compose --version | Out-Null
        return $true
    }
    catch {
        Write-Host "錯誤: Docker Compose 未安裝" -ForegroundColor Red
        return $false
    }
}

# 創建必要的目錄
function Create-Directories {
    Write-Host "創建必要的目錄..." -ForegroundColor Blue
    
    $directories = @(
        "data/node1",
        "data/node2", 
        "data/node3",
        "nginx/logs"
    )
    
    foreach ($dir in $directories) {
        if (!(Test-Path $dir)) {
            New-Item -ItemType Directory -Path $dir -Force | Out-Null
            Write-Host "創建目錄: $dir" -ForegroundColor Green
        }
    }
}

# 部署集群
function Deploy-Cluster {
    Write-Host "開始部署 Uptime Kuma Cluster..." -ForegroundColor Blue
    
    # 創建目錄
    Create-Directories
    
    # 啟動服務
    Write-Host "啟動 MariaDB..." -ForegroundColor Blue
    docker-compose -f docker-compose-cluster.yaml up -d mariadb
    
    # 等待資料庫就緒
    Write-Host "等待資料庫就緒..." -ForegroundColor Blue
    Start-Sleep -Seconds 30
    
    # 啟動節點
    Write-Host "啟動 Uptime Kuma 節點..." -ForegroundColor Blue
    docker-compose -f docker-compose-cluster.yaml up -d uptime-kuma-node1
    Start-Sleep -Seconds 10
    docker-compose -f docker-compose-cluster.yaml up -d uptime-kuma-node2
    Start-Sleep -Seconds 10
    docker-compose -f docker-compose-cluster.yaml up -d uptime-kuma-node3
    Start-Sleep -Seconds 10
    
    # 啟動 OpenResty
    Write-Host "啟動 OpenResty 負載平衡器..." -ForegroundColor Blue
    docker-compose -f docker-compose-cluster.yaml up -d openresty
    
    # 檢查服務狀態
    Write-Host "檢查服務狀態..." -ForegroundColor Blue
    Start-Sleep -Seconds 10
    
    docker-compose -f docker-compose-cluster.yaml ps
    
    Write-Host "=== Cluster 部署完成 ===" -ForegroundColor Green
    Write-Host "OpenResty: http://localhost:80" -ForegroundColor Cyan
    Write-Host "節點 1: http://localhost:3001" -ForegroundColor Cyan
    Write-Host "節點 2: http://localhost:3002" -ForegroundColor Cyan
    Write-Host "節點 3: http://localhost:3003" -ForegroundColor Cyan
    Write-Host "MariaDB: localhost:3306" -ForegroundColor Cyan
}

# 停止集群
function Stop-Cluster {
    Write-Host "停止 Uptime Kuma Cluster..." -ForegroundColor Blue
    docker-compose -f docker-compose-cluster.yaml down
    Write-Host "集群已停止" -ForegroundColor Green
}

# 重啟集群
function Restart-Cluster {
    Write-Host "重啟 Uptime Kuma Cluster..." -ForegroundColor Blue
    Stop-Cluster
    Start-Sleep -Seconds 5
    Deploy-Cluster
}

# 檢查集群狀態
function Check-ClusterStatus {
    Write-Host "檢查集群狀態..." -ForegroundColor Blue
    
    # 檢查容器狀態
    docker-compose -f docker-compose-cluster.yaml ps
    
    # 檢查健康狀態
    Write-Host "`n檢查健康狀態..." -ForegroundColor Blue
    
    $ports = @(80, 3001, 3002, 3003)
    foreach ($port in $ports) {
        try {
            $response = Invoke-WebRequest -Uri "http://localhost:$port/health" -TimeoutSec 5 -ErrorAction Stop
            if ($response.StatusCode -eq 200) {
                Write-Host "✓ 端口 $port 健康" -ForegroundColor Green
            } else {
                Write-Host "✗ 端口 $port 異常 (狀態碼: $($response.StatusCode))" -ForegroundColor Red
            }
        }
        catch {
            Write-Host "✗ 端口 $port 無法連接" -ForegroundColor Red
        }
    }
    
    # 檢查負載平衡狀態
    try {
        $loadStatus = Invoke-WebRequest -Uri "http://localhost/api/load_status" -TimeoutSec 5 -ErrorAction Stop
        if ($loadStatus.StatusCode -eq 200) {
            Write-Host "✓ 負載平衡 API 正常" -ForegroundColor Green
            $loadData = $loadStatus.Content | ConvertFrom-Json
            Write-Host "節點負載資訊: $($loadData | ConvertTo-Json -Depth 3)" -ForegroundColor Cyan
        }
    }
    catch {
        Write-Host "✗ 負載平衡 API 異常" -ForegroundColor Red
    }
}

# 查看日誌
function Show-Logs {
    param([string]$Service = "all")
    
    if ($Service -eq "all") {
        Write-Host "顯示所有服務日誌..." -ForegroundColor Blue
        docker-compose -f docker-compose-cluster.yaml logs --tail=50
    } else {
        Write-Host "顯示 $Service 服務日誌..." -ForegroundColor Blue
        docker-compose -f docker-compose-cluster.yaml logs --tail=50 $Service
    }
}

# 清理集群
function Clean-Cluster {
    Write-Host "清理集群..." -ForegroundColor Blue
    
    # 停止並移除容器
    docker-compose -f docker-compose-cluster.yaml down -v
    
    # 移除數據目錄
    if (Test-Path "data") {
        Remove-Item -Path "data" -Recurse -Force
        Write-Host "已清理數據目錄" -ForegroundColor Green
    }
    
    Write-Host "集群已清理完成" -ForegroundColor Green
}

# 主程序
function Main {
    # 檢查前置條件
    if (!(Test-Docker)) {
        Write-Host "請先啟動 Docker Desktop" -ForegroundColor Red
        exit 1
    }
    
    if (!(Test-DockerCompose)) {
        Write-Host "請先安裝 Docker Compose" -ForegroundColor Red
        exit 1
    }
    
    # 根據動作執行相應功能
    switch ($Action.ToLower()) {
        "deploy" { Deploy-Cluster }
        "stop" { Stop-Cluster }
        "restart" { Restart-Cluster }
        "status" { Check-ClusterStatus }
        "logs" { Show-Logs }
        "clean" { Clean-Cluster }
        default {
            Write-Host "用法: .\deploy-cluster.ps1 [動作]" -ForegroundColor Yellow
            Write-Host "可用動作:" -ForegroundColor Yellow
            Write-Host "  deploy  - 部署集群" -ForegroundColor Cyan
            Write-Host "  stop    - 停止集群" -ForegroundColor Cyan
            Write-Host "  restart - 重啟集群" -ForegroundColor Cyan
            Write-Host "  status  - 檢查狀態" -ForegroundColor Cyan
            Write-Host "  logs    - 查看日誌" -ForegroundColor Cyan
            Write-Host "  clean   - 清理集群" -ForegroundColor Cyan
        }
    }
}

# 執行主程序
Main
