# 修復監控器 ID 問題的腳本

Write-Host "🔧 修復監控器 ID 問題" -ForegroundColor Yellow
Write-Host "==============================" -ForegroundColor Yellow

$baseUrl = "http://127.0.0.1:9091"
$apiKey = "uk1_dRoog_hjdvwvtQTCwXeaXj2jbrjA0OVOsLIkSwJn"

$headers = @{
    "Authorization" = $apiKey
    "Content-Type" = "application/json"
}

# 1. 檢查現有監控器
Write-Host "`n1. 檢查現有監控器..." -ForegroundColor Cyan
try {
    $monitorsResponse = Invoke-RestMethod -Uri "$baseUrl/api/v1/monitors" -Method GET -Headers $headers
    if ($monitorsResponse.ok) {
        $existingMonitors = $monitorsResponse.data
        Write-Host "✅ 找到 $($existingMonitors.Count) 個現有監控器" -ForegroundColor Green
        
        Write-Host "現有監控器列表:" -ForegroundColor White
        foreach ($monitor in $existingMonitors) {
            Write-Host "  ID: $($monitor.id) - $($monitor.name) ($($monitor.type))" -ForegroundColor Gray
        }
        
        $availableIds = $existingMonitors | Select-Object -ExpandProperty id
        Write-Host "可用的 ID: [$($availableIds -join ', ')]" -ForegroundColor Yellow
    }
} catch {
    Write-Host "❌ 無法獲取監控器列表: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

# 2. 創建更多監控器（如果需要的話）
if ($existingMonitors.Count -lt 5) {
    Write-Host "`n2. 創建額外的測試監控器..." -ForegroundColor Cyan
    
    $additionalMonitors = @(
        @{
            name = "HTTP測試監控器_$(Get-Date -Format 'HHmmss')"
            type = "http"
            url = "https://httpbin.org/status/200"
            method = "GET"
            interval = 60
            active = $true
        },
        @{
            name = "Ping測試監控器_$(Get-Date -Format 'HHmmss')"
            type = "ping"
            hostname = "8.8.8.8"
            interval = 60
            active = $true
        },
        @{
            name = "DNS測試監控器_$(Get-Date -Format 'HHmmss')"
            type = "dns"
            hostname = "google.com"
            interval = 60
            active = $true
        }
    )
    
    $newMonitorIds = @()
    foreach ($monitorData in $additionalMonitors) {
        try {
            $monitorJson = $monitorData | ConvertTo-Json
            $createResponse = Invoke-RestMethod -Uri "$baseUrl/api/v1/monitors" -Method POST -Body $monitorJson -Headers $headers
            if ($createResponse.ok) {
                $newId = $createResponse.data.id
                $newMonitorIds += $newId
                Write-Host "✅ 創建監控器成功: ID $newId - $($monitorData.name)" -ForegroundColor Green
            }
        } catch {
            Write-Host "⚠️  創建監控器失敗: $($_.Exception.Message)" -ForegroundColor Yellow
        }
    }
    
    # 更新可用 ID 列表
    $availableIds += $newMonitorIds
}

# 3. 生成安全的測試數據
Write-Host "`n3. 生成安全的測試數據..." -ForegroundColor Cyan

$safeMonitorIds = $availableIds | Select-Object -First 5
Write-Host "將使用的安全監控器 ID: [$($safeMonitorIds -join ', ')]" -ForegroundColor Yellow

# 4. 測試安全的 PUT 更新
Write-Host "`n4. 執行安全的 PUT 測試..." -ForegroundColor Cyan

$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$testSlug = "safe-put-test-$timestamp"

# 先創建測試狀態頁面
$statusPageData = @{
    title = "安全 PUT 測試頁面"
    slug = $testSlug
    description = "使用安全監控器 ID 的測試"
    theme = "auto"
    published = $true
    publicGroupList = @(
        @{
            name = "初始群組"
            monitorList = @(
                @{
                    id = $safeMonitorIds[0]
                    sendUrl = $true
                }
            )
        }
    )
} | ConvertTo-Json -Depth 3

try {
    $createResponse = Invoke-RestMethod -Uri "$baseUrl/api/v1/status-pages" -Method POST -Body $statusPageData -Headers $headers
    if ($createResponse.ok) {
        Write-Host "✅ 測試狀態頁面創建成功: $($createResponse.data.slug)" -ForegroundColor Green
        
        # 執行 PUT 更新
        $updateData = @{
            title = "安全更新測試"
            publicGroupList = @(
                @{
                    name = "生產環境群組"
                    monitorList = @(
                        @{
                            id = $safeMonitorIds[0]
                            sendUrl = $true
                        },
                        @{
                            id = $safeMonitorIds[1]
                            sendUrl = $false
                            url = "https://prod.example.com"
                        }
                    )
                },
                @{
                    name = "測試環境群組"
                    monitorList = @(
                        @{
                            id = $safeMonitorIds[0]
                            sendUrl = $false
                            url = "https://test.example.com"
                        }
                    )
                }
            )
        } | ConvertTo-Json -Depth 4
        
        $putResponse = Invoke-RestMethod -Uri "$baseUrl/api/v1/status-pages/$testSlug" -Method PUT -Body $updateData -Headers $headers
        if ($putResponse.ok) {
            Write-Host "✅ PUT 更新成功！" -ForegroundColor Green
            
            # 驗證結果
            $verifyResponse = Invoke-RestMethod -Uri "$baseUrl/api/v1/status-pages/$testSlug?includeGroups=true" -Method GET -Headers $headers
            if ($verifyResponse.data.publicGroupList) {
                Write-Host "✅ 驗證成功: 找到 $($verifyResponse.data.publicGroupList.Count) 個群組" -ForegroundColor Green
                foreach ($group in $verifyResponse.data.publicGroupList) {
                    Write-Host "  📁 群組: $($group.name) (包含 $($group.monitorList.Count) 個監控器)" -ForegroundColor Cyan
                }
            }
        }
    }
} catch {
    Write-Host "❌ 測試失敗: $($_.Exception.Message)" -ForegroundColor Red
}

# 5. 提供修復建議
Write-Host "`n========== 修復建議 ==========" -ForegroundColor Yellow
Write-Host "如果遇到監控器 ID 不存在的問題:" -ForegroundColor Cyan
Write-Host "1. 先執行: GET $baseUrl/api/v1/monitors 查看可用 ID" -ForegroundColor White
Write-Host "2. 只使用存在的監控器 ID: [$($availableIds -join ', ')]" -ForegroundColor White
Write-Host "3. 可以重複使用相同的監控器 ID 在不同群組中" -ForegroundColor White
Write-Host "4. 執行安全測試: k6 run safe-put-test.js" -ForegroundColor White

Write-Host "`n🎉 修復腳本執行完成！" -ForegroundColor Green
