# monitor-cluster.ps1 - OpenResty Cluster 監控腳本
param(
    [int]$Interval = 30,
    [switch]$Continuous
)

Write-Host "=== OpenResty Cluster 監控腳本 ===" -ForegroundColor Green
Write-Host "監控間隔: ${Interval}秒" -ForegroundColor Yellow
Write-Host "連續監控: $Continuous" -ForegroundColor Yellow

# 檢查 Docker 容器狀態
function Check-ContainerStatus {
    Write-Host "`n1. 檢查 Docker 容器狀態..." -ForegroundColor Blue
    
    try {
        $containers = docker-compose -f docker-compose-cluster.yaml ps --format json | ConvertFrom-Json
        
        foreach ($container in $containers) {
            $status = $container.State
            $name = $container.Service
            $health = $container.Health
            
            switch ($status) {
                "running" {
                    if ($health -eq "healthy") {
                        Write-Host "  ✓ $name: 運行中 (健康)" -ForegroundColor Green
                    } else {
                        Write-Host "  ○ $name: 運行中 (健康檢查中)" -ForegroundColor Yellow
                    }
                }
                "restarting" {
                    Write-Host "  ⚠ $name: 重啟中" -ForegroundColor Yellow
                }
                "exited" {
                    Write-Host "  ✗ $name: 已退出" -ForegroundColor Red
                }
                default {
                    Write-Host "  ? $name: $status" -ForegroundColor Gray
                }
            }
        }
    }
    catch {
        Write-Host "  ✗ 無法獲取容器狀態: $($_.Exception.Message)" -ForegroundColor Red
    }
}

# 檢查負載平衡狀態
function Check-LoadBalancerStatus {
    Write-Host "`n2. 檢查負載平衡狀態..." -ForegroundColor Blue
    
    try {
        $loadStatus = Invoke-WebRequest -Uri "http://localhost/api/load_status" -TimeoutSec 5 -ErrorAction Stop
        
        if ($loadStatus.StatusCode -eq 200) {
            Write-Host "  ✓ 負載平衡 API 正常" -ForegroundColor Green
            
            $loadData = $loadStatus.Content | ConvertFrom-Json
            $lastUpdate = [DateTimeOffset]::FromUnixTimeSeconds($loadData.last_update).LocalDateTime
            
            Write-Host "  最後更新時間: $lastUpdate" -ForegroundColor Cyan
            
            if ($loadData.node_loads) {
                Write-Host "  節點負載狀態:" -ForegroundColor Cyan
                foreach ($node in $loadData.node_loads) {
                    $statusColor = switch ($node.status) {
                        "active" { "Green" }
                        "dead" { "Red" }
                        "recovering" { "Yellow" }
                        default { "Gray" }
                    }
                    
                    Write-Host "    $($node.node_id): $($node.monitor_count) monitors, 負載分數: $([math]::Round($node.load_score, 3)), 狀態: $($node.status)" -ForegroundColor $statusColor
                }
            }
        } else {
            Write-Host "  ✗ 負載平衡 API 異常 (狀態碼: $($loadStatus.StatusCode))" -ForegroundColor Red
        }
    }
    catch {
        Write-Host "  ✗ 負載平衡 API 異常: $($_.Exception.Message)" -ForegroundColor Red
    }
}

# 檢查 Nginx 狀態
function Check-NginxStatus {
    Write-Host "`n3. 檢查 OpenResty 狀態..." -ForegroundColor Blue
    
    try {
        $nginxStatus = Invoke-WebRequest -Uri "http://localhost/nginx_status" -TimeoutSec 5 -ErrorAction Stop
        
        if ($nginxStatus.StatusCode -eq 200) {
            Write-Host "  ✓ OpenResty 運行正常" -ForegroundColor Green
            
            $statusLines = $nginxStatus.Content -split "`n"
            foreach ($line in $statusLines) {
                if ($line -match "Active connections:\s*(\d+)") {
                    Write-Host "  活躍連接: $($matches[1])" -ForegroundColor Cyan
                }
                elseif ($line -match "(\d+)\s+(\d+)\s+(\d+)") {
                    Write-Host "  連接統計: 讀取 $($matches[1]), 寫入 $($matches[2]), 等待 $($matches[3])" -ForegroundColor Cyan
                }
            }
        } else {
            Write-Host "  ✗ OpenResty 異常 (狀態碼: $($nginxStatus.StatusCode))" -ForegroundColor Red
        }
    }
    catch {
        Write-Host "  ✗ OpenResty 異常: $($_.Exception.Message)" -ForegroundColor Red
    }
}

# 檢查節點健康狀態
function Check-NodeHealth {
    Write-Host "`n4. 檢查節點健康狀態..." -ForegroundColor Blue
    
    $ports = @(3001, 3002, 3003)
    $nodeNames = @("Node1", "Node2", "Node3")
    
    for ($i = 0; $i -lt $ports.Count; $i++) {
        $port = $ports[$i]
        $nodeName = $nodeNames[$i]
        
        try {
            $response = Invoke-WebRequest -Uri "http://localhost:$port/health" -TimeoutSec 5 -ErrorAction Stop
            
            if ($response.StatusCode -eq 200) {
                Write-Host "  ✓ $nodeName (端口 $port): 健康" -ForegroundColor Green
                
                # 嘗試解析健康檢查響應
                try {
                    $healthData = $response.Content | ConvertFrom-Json
                    if ($healthData.timestamp) {
                        Write-Host "    最後檢查時間: $($healthData.timestamp)" -ForegroundColor Gray
                    }
                }
                catch {
                    # 如果不是 JSON 格式，忽略
                }
            } else {
                Write-Host "  ✗ $nodeName (端口 $port): 異常 (狀態碼: $($response.StatusCode))" -ForegroundColor Red
            }
        }
        catch {
            Write-Host "  ✗ $nodeName (端口 $port): 無法連接" -ForegroundColor Red
        }
    }
}

# 檢查資料庫連接
function Check-DatabaseConnection {
    Write-Host "`n5. 檢查資料庫連接..." -ForegroundColor Blue
    
    try {
        # 檢查 MariaDB 容器狀態
        $mariadbContainer = docker ps --filter "name=uptime-kuma-mariadb" --format "{{.Status}}" 2>$null
        
        if ($mariadbContainer) {
            Write-Host "  ✓ MariaDB 容器運行中" -ForegroundColor Green
            Write-Host "    狀態: $mariadbContainer" -ForegroundColor Gray
        } else {
            Write-Host "  ✗ MariaDB 容器未運行" -ForegroundColor Red
        }
        
        # 檢查端口是否開放
        try {
            $tcpClient = New-Object System.Net.Sockets.TcpClient
            $tcpClient.ConnectAsync("localhost", 3306).Wait(5000) | Out-Null
            
            if ($tcpClient.Connected) {
                Write-Host "  ✓ MariaDB 端口 3306 可連接" -ForegroundColor Green
                $tcpClient.Close()
            } else {
                Write-Host "  ✗ MariaDB 端口 3306 無法連接" -ForegroundColor Red
            }
        }
        catch {
            Write-Host "  ✗ MariaDB 端口 3306 無法連接" -ForegroundColor Red
        }
    }
    catch {
        Write-Host "  ✗ 無法檢查資料庫狀態: $($_.Exception.Message)" -ForegroundColor Red
    }
}

# 檢查系統資源
function Check-SystemResources {
    Write-Host "`n6. 檢查系統資源..." -ForegroundColor Blue
    
    try {
        # CPU 使用率
        $cpu = Get-Counter "\Processor(_Total)\% Processor Time" -SampleInterval 1 -MaxSamples 1
        $cpuUsage = [math]::Round($cpu.CounterSamples[0].CookedValue, 1)
        Write-Host "  CPU 使用率: ${cpuUsage}%" -ForegroundColor Cyan
        
        # 記憶體使用率
        $memory = Get-Counter "\Memory\Available MBytes" -SampleInterval 1 -MaxSamples 1
        $availableMB = [math]::Round($memory.CounterSamples[0].CookedValue, 0)
        $totalMB = [math]::Round((Get-WmiObject -Class Win32_ComputerSystem).TotalPhysicalMemory / 1MB, 0)
        $memoryUsage = [math]::Round(($totalMB - $availableMB) * 100 / $totalMB, 1)
        Write-Host "  記憶體使用率: ${memoryUsage}% (可用: ${availableMB}MB / 總計: ${totalMB}MB)" -ForegroundColor Cyan
        
        # 磁碟使用率
        $disk = Get-WmiObject -Class Win32_LogicalDisk -Filter "DeviceID='C:'"
        $diskUsage = [math]::Round(($disk.Size - $disk.FreeSpace) * 100 / $disk.Size, 1)
        $freeGB = [math]::Round($disk.FreeSpace / 1GB, 1)
        $totalGB = [math]::Round($disk.Size / 1GB, 1)
        Write-Host "  磁碟使用率: ${diskUsage}% (可用: ${freeGB}GB / 總計: ${totalGB}GB)" -ForegroundColor Cyan
    }
    catch {
        Write-Host "  ✗ 無法檢查系統資源: $($_.Exception.Message)" -ForegroundColor Red
    }
}

# 手動觸發負載更新
function Update-LoadInfo {
    Write-Host "`n7. 觸發負載資訊更新..." -ForegroundColor Blue
    
    try {
        $updateResponse = Invoke-WebRequest -Uri "http://localhost/api/update_loads" -TimeoutSec 5 -ErrorAction Stop
        
        if ($updateResponse.StatusCode -eq 200) {
            $updateData = $updateResponse.Content | ConvertFrom-Json
            if ($updateData.status -eq "success") {
                Write-Host "  ✓ 負載資訊更新已觸發" -ForegroundColor Green
                Write-Host "    訊息: $($updateData.message)" -ForegroundColor Gray
            } else {
                Write-Host "  ✗ 負載資訊更新失敗: $($updateData.message)" -ForegroundColor Red
            }
        } else {
            Write-Host "  ✗ 負載資訊更新失敗 (狀態碼: $($updateResponse.StatusCode))" -ForegroundColor Red
        }
    }
    catch {
        Write-Host "  ✗ 負載資訊更新失敗: $($_.Exception.Message)" -ForegroundColor Red
    }
}

# 執行一次完整監控
function Execute-Monitoring {
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    Write-Host "`n=== 監控時間: $timestamp ===" -ForegroundColor Magenta
    
    Check-ContainerStatus
    Check-LoadBalancerStatus
    Check-NginxStatus
    Check-NodeHealth
    Check-DatabaseConnection
    Check-SystemResources
    Update-LoadInfo
    
    Write-Host "`n=== 監控完成 ===" -ForegroundColor Green
}

# 主程序
function Main {
    if ($Continuous) {
        Write-Host "開始連續監控，按 Ctrl+C 停止..." -ForegroundColor Yellow
        
        try {
            while ($true) {
                Execute-Monitoring
                Write-Host "等待 ${Interval} 秒後進行下次監控..." -ForegroundColor Gray
                Start-Sleep -Seconds $Interval
            }
        }
        catch {
            Write-Host "`n監控已停止" -ForegroundColor Yellow
        }
    } else {
        Execute-Monitoring
    }
}

# 執行主程序
Main
