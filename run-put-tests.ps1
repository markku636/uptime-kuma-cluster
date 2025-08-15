# Kuma PUT API 專門測試腳本

Write-Host "🔄 Kuma PUT API 測試腳本" -ForegroundColor Yellow
Write-Host "============================" -ForegroundColor Yellow

# 配置
$baseUrl = "http://127.0.0.1:9091"
$apiKey = "uk1_dRoog_hjdvwvtQTCwXeaXj2jbrjA0OVOsLIkSwJn"

# 準備請求標頭
$headers = @{
    "Authorization" = $apiKey
    "Content-Type" = "application/json"
}

Write-Host "`n檢查服務狀態..." -ForegroundColor Cyan
try {
    $statusResponse = Invoke-RestMethod -Uri "$baseUrl/api/v1/status" -Method GET
    if ($statusResponse.ok) {
        Write-Host "✅ Kuma 服務正常運行" -ForegroundColor Green
    }
} catch {
    Write-Host "❌ 無法連接到 Kuma 服務" -ForegroundColor Red
    exit 1
}

# 1. 創建測試資源
Write-Host "`n=== 1. 創建測試資源 ===" -ForegroundColor Cyan

# 創建監控器
$monitorData = @{
    name = "PUT測試監控器_$(Get-Date -Format 'HHmmss')"
    type = "http"
    url = "https://httpbin.org/status/200"
    interval = 60
    active = $true
    method = "GET"
} | ConvertTo-Json

$monitorResponse = Invoke-RestMethod -Uri "$baseUrl/api/v1/monitors" -Method POST -Body $monitorData -Headers $headers
$testMonitorId = $monitorResponse.data.id
Write-Host "✅ 創建測試監控器 ID: $testMonitorId" -ForegroundColor Green

# 創建狀態頁面
$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$statusPageData = @{
    title = "PUT測試狀態頁面"
    slug = "put-test-$timestamp"
    description = "用於 PUT API 測試的狀態頁面"
    theme = "auto"
    published = $true
    publicGroupList = @(
        @{
            name = "初始群組"
            monitorList = @(
                @{
                    id = $testMonitorId
                    sendUrl = $true
                }
            )
        }
    )
} | ConvertTo-Json -Depth 3

$statusPageResponse = Invoke-RestMethod -Uri "$baseUrl/api/v1/status-pages" -Method POST -Body $statusPageData -Headers $headers
$testStatusPageSlug = $statusPageResponse.data.slug
Write-Host "✅ 創建測試狀態頁面 Slug: $testStatusPageSlug" -ForegroundColor Green

# 2. 測試基本欄位更新
Write-Host "`n=== 2. 測試基本欄位更新 ===" -ForegroundColor Cyan

$basicUpdateData = @{
    title = "PUT測試狀態頁面 - 已更新"
    description = "更新後的描述內容"
    theme = "dark"
    autoRefreshInterval = 180
    published = $false
    search_engine_index = $false
    show_tags = $true
    show_powered_by = $false
    show_certificate_expiry = $true
} | ConvertTo-Json

try {
    $updateResponse = Invoke-RestMethod -Uri "$baseUrl/api/v1/status-pages/$testStatusPageSlug" -Method PUT -Body $basicUpdateData -Headers $headers
    if ($updateResponse.ok) {
        Write-Host "✅ 基本欄位更新成功" -ForegroundColor Green
        Write-Host "   更新的狀態頁面: $($updateResponse.data.title)" -ForegroundColor Gray
    }
} catch {
    Write-Host "❌ 基本欄位更新失敗: $($_.Exception.Message)" -ForegroundColor Red
}

# 3. 測試 publicGroupList 更新
Write-Host "`n=== 3. 測試 publicGroupList 更新 ===" -ForegroundColor Cyan

$groupUpdateData = @{
    title = "PUT測試狀態頁面 - 群組更新"
    publicGroupList = @(
        @{
            name = "更新後的群組 1"
            monitorList = @(
                @{
                    id = $testMonitorId
                    sendUrl = $false
                    url = "https://custom-url.example.com"
                }
            )
        },
        @{
            name = "新增的群組 2"
            monitorList = @(
                @{
                    id = $testMonitorId
                    sendUrl = $true
                }
            )
        }
    )
} | ConvertTo-Json -Depth 4

try {
    $groupUpdateResponse = Invoke-RestMethod -Uri "$baseUrl/api/v1/status-pages/$testStatusPageSlug" -Method PUT -Body $groupUpdateData -Headers $headers
    if ($groupUpdateResponse.ok) {
        Write-Host "✅ publicGroupList 更新成功" -ForegroundColor Green
        
        # 驗證更新結果
        $verifyResponse = Invoke-RestMethod -Uri "$baseUrl/api/v1/status-pages/$testStatusPageSlug?includeGroups=true" -Method GET -Headers $headers
        if ($verifyResponse.data.publicGroupList) {
            Write-Host "   📊 驗證結果: 找到 $($verifyResponse.data.publicGroupList.Count) 個群組" -ForegroundColor Green
            foreach ($group in $verifyResponse.data.publicGroupList) {
                Write-Host "     📁 群組: $($group.name) (包含 $($group.monitorList.Count) 個監控器)" -ForegroundColor Cyan
                foreach ($monitor in $group.monitorList) {
                    $sendUrlText = if ($monitor.sendUrl) { "顯示URL" } else { "隱藏URL" }
                    Write-Host "       📊 監控器 ID: $($monitor.id) - $sendUrlText" -ForegroundColor Gray
                    if ($monitor.url) {
                        Write-Host "         🔗 自定義 URL: $($monitor.url)" -ForegroundColor Gray
                    }
                }
            }
        }
    }
} catch {
    Write-Host "❌ publicGroupList 更新失敗: $($_.Exception.Message)" -ForegroundColor Red
}

# 4. 測試複雜的群組重組
Write-Host "`n=== 4. 測試複雜的群組重組 ===" -ForegroundColor Cyan

$complexGroupData = @{
    title = "PUT測試狀態頁面 - 複雜重組"
    publicGroupList = @(
        @{
            name = "生產環境"
            monitorList = @(
                @{
                    id = $testMonitorId
                    sendUrl = $true
                }
            )
        },
        @{
            name = "測試環境"
            monitorList = @(
                @{
                    id = $testMonitorId
                    sendUrl = $false
                    url = "https://test.example.com"
                }
            )
        },
        @{
            name = "開發環境"
            monitorList = @(
                @{
                    id = $testMonitorId
                    sendUrl = $false
                    url = "https://dev.example.com"
                }
            )
        }
    )
} | ConvertTo-Json -Depth 4

try {
    $complexUpdateResponse = Invoke-RestMethod -Uri "$baseUrl/api/v1/status-pages/$testStatusPageSlug" -Method PUT -Body $complexGroupData -Headers $headers
    if ($complexUpdateResponse.ok) {
        Write-Host "✅ 複雜群組重組成功" -ForegroundColor Green
    }
} catch {
    Write-Host "❌ 複雜群組重組失敗: $($_.Exception.Message)" -ForegroundColor Red
}

# 5. 測試清空 publicGroupList
Write-Host "`n=== 5. 測試清空 publicGroupList ===" -ForegroundColor Cyan

$clearGroupsData = @{
    title = "PUT測試狀態頁面 - 群組已清空"
    publicGroupList = @()
} | ConvertTo-Json

try {
    $clearResponse = Invoke-RestMethod -Uri "$baseUrl/api/v1/status-pages/$testStatusPageSlug" -Method PUT -Body $clearGroupsData -Headers $headers
    if ($clearResponse.ok) {
        Write-Host "✅ publicGroupList 清空成功" -ForegroundColor Green
        
        # 驗證清空結果
        $verifyClearResponse = Invoke-RestMethod -Uri "$baseUrl/api/v1/status-pages/$testStatusPageSlug?includeGroups=true" -Method GET -Headers $headers
        $groupCount = $verifyClearResponse.data.publicGroupList.Count
        if ($groupCount -eq 0) {
            Write-Host "   ✅ 驗證成功: 群組數量為 $groupCount" -ForegroundColor Green
        } else {
            Write-Host "   ❌ 驗證失敗: 仍有 $groupCount 個群組" -ForegroundColor Red
        }
    }
} catch {
    Write-Host "❌ publicGroupList 清空失敗: $($_.Exception.Message)" -ForegroundColor Red
}

# 6. 測試部分更新（不影響 publicGroupList）
Write-Host "`n=== 6. 測試部分更新 ===" -ForegroundColor Cyan

$partialUpdateData = @{
    description = "僅更新描述，不影響現有群組設定"
    autoRefreshInterval = 600
} | ConvertTo-Json

try {
    $partialResponse = Invoke-RestMethod -Uri "$baseUrl/api/v1/status-pages/$testStatusPageSlug" -Method PUT -Body $partialUpdateData -Headers $headers
    if ($partialResponse.ok) {
        Write-Host "✅ 部分更新成功" -ForegroundColor Green
    }
} catch {
    Write-Host "❌ 部分更新失敗: $($_.Exception.Message)" -ForegroundColor Red
}

# 7. 測試錯誤處理
Write-Host "`n=== 7. 測試錯誤處理 ===" -ForegroundColor Cyan

$errorTestData = @{
    title = "不存在的頁面"
} | ConvertTo-Json

try {
    $errorResponse = Invoke-RestMethod -Uri "$baseUrl/api/v1/status-pages/non-existent-page-$(Get-Date -Format 'HHmmss')" -Method PUT -Body $errorTestData -Headers $headers
    Write-Host "❌ 錯誤處理測試失敗: 應該返回 404 但成功了" -ForegroundColor Red
} catch {
    $statusCode = $_.Exception.Response.StatusCode.value__
    if ($statusCode -eq 404) {
        Write-Host "✅ 錯誤處理測試成功: 正確返回 404" -ForegroundColor Green
    } else {
        Write-Host "⚠️  錯誤處理測試部分成功: 返回狀態碼 $statusCode" -ForegroundColor Yellow
    }
}

# 測試結果總結
Write-Host "`n========== PUT API 測試總結 ==========" -ForegroundColor Yellow
Write-Host "測試的功能:" -ForegroundColor Cyan
Write-Host "  ✅ 基本欄位更新" -ForegroundColor White
Write-Host "  ✅ publicGroupList 完整更新" -ForegroundColor White
Write-Host "  ✅ 複雜群組重組" -ForegroundColor White
Write-Host "  ✅ publicGroupList 清空" -ForegroundColor White
Write-Host "  ✅ 部分更新功能" -ForegroundColor White
Write-Host "  ✅ 錯誤處理機制" -ForegroundColor White

Write-Host "`n創建的測試資源:" -ForegroundColor Cyan
Write-Host "  📊 監控器 ID: $testMonitorId" -ForegroundColor White
Write-Host "  📄 狀態頁面 Slug: $testStatusPageSlug" -ForegroundColor White

Write-Host "`n後續驗證:" -ForegroundColor Cyan
Write-Host "1. 訪問狀態頁面: $baseUrl/status/$testStatusPageSlug" -ForegroundColor Gray
Write-Host "2. 查看 API 結果: GET $baseUrl/api/v1/status-pages/$testStatusPageSlug" -ForegroundColor Gray
Write-Host "3. 執行 K6 測試: k6 run k6-put-api-test.js" -ForegroundColor Gray

Write-Host "`n🎉 PUT API 測試完成！" -ForegroundColor Green
