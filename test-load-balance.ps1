# test-load-balance.ps1 - OpenResty 負載平衡效果測試腳本
param(
    [int]$RequestCount = 100,
    [int]$DelayMs = 100
)

Write-Host "=== OpenResty 負載平衡效果測試 ===" -ForegroundColor Green
Write-Host "測試請求數量: $RequestCount" -ForegroundColor Yellow
Write-Host "請求間隔: ${DelayMs}ms" -ForegroundColor Yellow

# 初始化節點計數器
$nodeCounts = @{
    "node1" = 0
    "node2" = 0
    "node3" = 0
    "unknown" = 0
}

$totalResponseTime = 0
$successCount = 0
$errorCount = 0

Write-Host "`n開始發送測試請求..." -ForegroundColor Blue

for ($i = 1; $i -le $RequestCount; $i++) {
    try {
        # 發送請求並記錄響應時間
        $stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
        $response = Invoke-WebRequest -Uri "http://localhost/" -TimeoutSec 10 -ErrorAction Stop
        $stopwatch.Stop()
        
        if ($response.StatusCode -eq 200) {
            $successCount++
            $totalResponseTime += $stopwatch.ElapsedMilliseconds
            
            # 根據響應內容或標頭判斷節點
            $nodeId = "unknown"
            if ($response.Headers.ContainsKey("X-Node-ID")) {
                $nodeId = $response.Headers["X-Node-ID"]
            } elseif ($response.Headers.ContainsKey("Server")) {
                $server = $response.Headers["Server"]
                if ($server -like "*node1*") { $nodeId = "node1" }
                elseif ($server -like "*node2*") { $nodeId = "node2" }
                elseif ($server -like "*node3*") { $nodeId = "node3" }
            }
            
            $nodeCounts[$nodeId]++
            
            # 顯示進度
            if ($i % 10 -eq 0) {
                Write-Host "已發送 $i 個請求..." -ForegroundColor Cyan
            }
        } else {
            $errorCount++
            Write-Host "請求 $i 失敗，狀態碼: $($response.StatusCode)" -ForegroundColor Red
        }
    }
    catch {
        $errorCount++
        Write-Host "請求 $i 異常: $($_.Exception.Message)" -ForegroundColor Red
    }
    
    # 請求間隔
    if ($i -lt $RequestCount) {
        Start-Sleep -Milliseconds $DelayMs
    }
}

# 顯示測試結果
Write-Host "`n=== 測試結果 ===" -ForegroundColor Green

# 統計分配結果
Write-Host "`n負載分配結果:" -ForegroundColor Yellow
Write-Host "Node1: $($nodeCounts['node1']) 請求" -ForegroundColor Cyan
Write-Host "Node2: $($nodeCounts['node2']) 請求" -ForegroundColor Cyan
Write-Host "Node3: $($nodeCounts['node3']) 請求" -ForegroundColor Cyan
Write-Host "未知節點: $($nodeCounts['unknown']) 請求" -ForegroundColor Yellow

# 計算分配比例
$totalSuccessful = $nodeCounts["node1"] + $nodeCounts["node2"] + $nodeCounts["node3"]
if ($totalSuccessful -gt 0) {
    Write-Host "`n分配比例:" -ForegroundColor Yellow
    Write-Host "Node1: $([math]::Round($nodeCounts['node1'] * 100 / $totalSuccessful, 1))%" -ForegroundColor Cyan
    Write-Host "Node2: $([math]::Round($nodeCounts['node2'] * 100 / $totalSuccessful, 1))%" -ForegroundColor Cyan
    Write-Host "Node3: $([math]::Round($nodeCounts['node3'] * 100 / $totalSuccessful, 1))%" -ForegroundColor Cyan
}

# 響應時間統計
if ($successCount -gt 0) {
    $avgResponseTime = [math]::Round($totalResponseTime / $successCount, 2)
    Write-Host "`n響應時間統計:" -ForegroundColor Yellow
    Write-Host "平均響應時間: ${avgResponseTime}ms" -ForegroundColor Cyan
    Write-Host "總響應時間: ${totalResponseTime}ms" -ForegroundColor Cyan
}

# 成功率統計
$successRate = [math]::Round($successCount * 100 / $RequestCount, 1)
Write-Host "`n成功率統計:" -ForegroundColor Yellow
Write-Host "成功請求: $successCount" -ForegroundColor Green
Write-Host "失敗請求: $errorCount" -ForegroundColor Red
Write-Host "成功率: ${successRate}%" -ForegroundColor Cyan

# 檢查負載平衡效果
Write-Host "`n負載平衡效果分析:" -ForegroundColor Yellow
$maxRequests = ($nodeCounts.Values | Measure-Object -Maximum).Maximum
$minRequests = ($nodeCounts.Values | Where-Object { $_ -gt 0 } | Measure-Object -Minimum).Minimum

if ($minRequests -gt 0) {
    $balanceRatio = [math]::Round($maxRequests / $minRequests, 2)
    if ($balanceRatio -le 1.5) {
        Write-Host "✓ 負載分配非常均衡 (比例: $balanceRatio)" -ForegroundColor Green
    } elseif ($balanceRatio -le 2.0) {
        Write-Host "○ 負載分配較為均衡 (比例: $balanceRatio)" -ForegroundColor Yellow
    } else {
        Write-Host "✗ 負載分配不夠均衡 (比例: $balanceRatio)" -ForegroundColor Red
    }
} else {
    Write-Host "✗ 無法分析負載平衡效果" -ForegroundColor Red
}

# 檢查負載平衡 API
Write-Host "`n檢查負載平衡 API..." -ForegroundColor Blue
try {
    $loadStatus = Invoke-WebRequest -Uri "http://localhost/api/load_status" -TimeoutSec 5 -ErrorAction Stop
    if ($loadStatus.StatusCode -eq 200) {
        Write-Host "✓ 負載平衡 API 正常" -ForegroundColor Green
        $loadData = $loadStatus.Content | ConvertFrom-Json
        Write-Host "節點負載資訊:" -ForegroundColor Cyan
        $loadData.node_loads | ForEach-Object {
            Write-Host "  $($_.node_id): $($_.monitor_count) monitors, 負載分數: $([math]::Round($_.load_score, 3))" -ForegroundColor White
        }
    }
} catch {
    Write-Host "✗ 負載平衡 API 異常: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host "`n=== 測試完成 ===" -ForegroundColor Green
