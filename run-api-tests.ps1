# Kuma API 測試執行腳本

Write-Host "🚀 Kuma REST API 測試腳本" -ForegroundColor Yellow
Write-Host "============================" -ForegroundColor Yellow

# 配置
$baseUrl = "http://127.0.0.1:9091"
$apiKey = "uk1_dRoog_hjdvwvtQTCwXeaXj2jbrjA0OVOsLIkSwJn"

# 檢查服務是否運行
Write-Host "`n檢查 Kuma 服務狀態..." -ForegroundColor Cyan
try {
    $statusResponse = Invoke-RestMethod -Uri "$baseUrl/api/v1/status" -Method GET
    if ($statusResponse.ok) {
        Write-Host "✅ Kuma 服務正常運行" -ForegroundColor Green
        Write-Host "   版本: $($statusResponse.version)" -ForegroundColor Gray
    }
} catch {
    Write-Host "❌ 無法連接到 Kuma 服務" -ForegroundColor Red
    Write-Host "請確保 Kuma 服務在 $baseUrl 正常運行" -ForegroundColor Red
    exit 1
}

# 準備請求標頭
$headers = @{
    "Authorization" = $apiKey
    "Content-Type" = "application/json"
}

Write-Host "`n開始執行 API 測試..." -ForegroundColor Yellow

# 1. 測試創建監控器
Write-Host "`n--- 1. 測試創建監控器 ---" -ForegroundColor Cyan
$monitorData = @{
    name = "PowerShell 測試監控器 - $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
    type = "http"
    url = "https://httpbin.org/status/200"
    interval = 60
    active = $true
    retryInterval = 30
    timeout = 10
    method = "GET"
    description = "通過 PowerShell 腳本創建的測試監控器"
} | ConvertTo-Json

try {
    $monitorResponse = Invoke-RestMethod -Uri "$baseUrl/api/v1/monitors" -Method POST -Body $monitorData -Headers $headers
    if ($monitorResponse.ok) {
        Write-Host "✅ 監控器創建成功" -ForegroundColor Green
        Write-Host "   ID: $($monitorResponse.data.id)" -ForegroundColor Gray
        Write-Host "   名稱: $($monitorResponse.data.name)" -ForegroundColor Gray
        $createdMonitorId = $monitorResponse.data.id
    }
} catch {
    Write-Host "❌ 監控器創建失敗: $($_.Exception.Message)" -ForegroundColor Red
}

# 2. 測試更新監控器
if ($createdMonitorId) {
    Write-Host "`n--- 2. 測試更新監控器 ---" -ForegroundColor Cyan
    $updateData = @{
        name = "更新後的監控器名稱 - $(Get-Date -Format 'HH:mm:ss')"
        description = "已更新的描述"
        interval = 120
    } | ConvertTo-Json
    
    try {
        $updateResponse = Invoke-RestMethod -Uri "$baseUrl/api/v1/monitors/$createdMonitorId" -Method PUT -Body $updateData -Headers $headers
        if ($updateResponse.ok) {
            Write-Host "✅ 監控器更新成功" -ForegroundColor Green
        }
    } catch {
        Write-Host "❌ 監控器更新失敗: $($_.Exception.Message)" -ForegroundColor Red
    }
}

# 3. 測試創建狀態頁面（帶 publicGroupList）
Write-Host "`n--- 3. 測試創建狀態頁面（帶 publicGroupList） ---" -ForegroundColor Cyan
$timestamp = Get-Date -Format 'yyyy-MM-dd-HH-mm-ss'
$statusPageData = @{
    title = "PowerShell 測試狀態頁面"
    slug = "powershell-test-$timestamp"
    description = "通過 PowerShell 腳本創建的測試狀態頁面"
    theme = "auto"
    autoRefreshInterval = 300
    published = $true
    search_engine_index = $true
    show_tags = $false
    show_powered_by = $true
    show_certificate_expiry = $false
    publicGroupList = @(
        @{
            name = "PowerShell 測試群組"
            monitorList = @(
                @{
                    id = $createdMonitorId
                    sendUrl = $true
                }
            )
        }
    )
} | ConvertTo-Json -Depth 3

try {
    $statusPageResponse = Invoke-RestMethod -Uri "$baseUrl/api/v1/status-pages" -Method POST -Body $statusPageData -Headers $headers
    if ($statusPageResponse.ok) {
        Write-Host "✅ 狀態頁面創建成功" -ForegroundColor Green
        Write-Host "   ID: $($statusPageResponse.data.id)" -ForegroundColor Gray
        Write-Host "   Slug: $($statusPageResponse.data.slug)" -ForegroundColor Gray
        $createdStatusPageId = $statusPageResponse.data.id
        $createdStatusPageSlug = $statusPageResponse.data.slug
        
        # 驗證 publicGroupList 是否生效
        Write-Host "   驗證 publicGroupList..." -ForegroundColor Yellow
        try {
            $verifyResponse = Invoke-RestMethod -Uri "$baseUrl/api/v1/status-pages/$createdStatusPageSlug?includeGroups=true" -Method GET -Headers $headers
            if ($verifyResponse.ok -and $verifyResponse.data.publicGroupList) {
                Write-Host "   ✅ publicGroupList 生效！找到 $($verifyResponse.data.publicGroupList.Count) 個群組" -ForegroundColor Green
                foreach ($group in $verifyResponse.data.publicGroupList) {
                    Write-Host "     📁 群組: $($group.name)" -ForegroundColor Cyan
                    if ($group.monitorList) {
                        Write-Host "       📊 包含 $($group.monitorList.Count) 個監控器" -ForegroundColor Gray
                    }
                }
            } else {
                Write-Host "   ❌ publicGroupList 沒有生效" -ForegroundColor Red
            }
        } catch {
            Write-Host "   ❌ 驗證 publicGroupList 失敗: $($_.Exception.Message)" -ForegroundColor Red
        }
    }
} catch {
    Write-Host "❌ 狀態頁面創建失敗: $($_.Exception.Message)" -ForegroundColor Red
}

# 4. 測試創建群組
if ($createdStatusPageId -and $createdMonitorId) {
    Write-Host "`n--- 4. 測試創建群組 ---" -ForegroundColor Cyan
    $groupData = @{
        name = "PowerShell 測試群組"
        status_page_id = $createdStatusPageId
        public = $true
        weight = 1
        monitorList = @(
            @{
                id = $createdMonitorId
                sendUrl = $true
                weight = 1
            }
        )
    } | ConvertTo-Json -Depth 3
    
    try {
        $groupResponse = Invoke-RestMethod -Uri "$baseUrl/api/v1/groups" -Method POST -Body $groupData -Headers $headers
        if ($groupResponse.ok) {
            Write-Host "✅ 群組創建成功" -ForegroundColor Green
            Write-Host "   ID: $($groupResponse.data.id)" -ForegroundColor Gray
            Write-Host "   名稱: $($groupResponse.data.name)" -ForegroundColor Gray
            $createdGroupId = $groupResponse.data.id
        }
    } catch {
        Write-Host "❌ 群組創建失敗: $($_.Exception.Message)" -ForegroundColor Red
    }
}

# 5. 測試查詢 API
Write-Host "`n--- 5. 測試查詢 API ---" -ForegroundColor Cyan

# 查詢所有監控器
try {
    $monitorsResponse = Invoke-RestMethod -Uri "$baseUrl/api/v1/monitors" -Method GET -Headers $headers
    if ($monitorsResponse.ok) {
        Write-Host "✅ 查詢監控器成功，共 $($monitorsResponse.data.Count) 個" -ForegroundColor Green
    }
} catch {
    Write-Host "❌ 查詢監控器失敗: $($_.Exception.Message)" -ForegroundColor Red
}

# 查詢所有狀態頁面
try {
    $statusPagesResponse = Invoke-RestMethod -Uri "$baseUrl/api/v1/status-pages" -Method GET -Headers $headers
    if ($statusPagesResponse.ok) {
        Write-Host "✅ 查詢狀態頁面成功，共 $($statusPagesResponse.data.Count) 個" -ForegroundColor Green
    }
} catch {
    Write-Host "❌ 查詢狀態頁面失敗: $($_.Exception.Message)" -ForegroundColor Red
}

# 6. 測試錯誤處理
Write-Host "`n--- 6. 測試錯誤處理 ---" -ForegroundColor Cyan

# 測試創建無效監控器
$invalidMonitorData = @{
    name = ""
    type = "invalid_type"
} | ConvertTo-Json

try {
    Invoke-RestMethod -Uri "$baseUrl/api/v1/monitors" -Method POST -Body $invalidMonitorData -Headers $headers | Out-Null
    Write-Host "❌ 錯誤處理測試失敗：應該返回錯誤但成功了" -ForegroundColor Red
} catch {
    Write-Host "✅ 錯誤處理測試成功：正確返回錯誤" -ForegroundColor Green
}

# 測試結果總結
Write-Host "`n========== 測試結果總結 ==========" -ForegroundColor Yellow
Write-Host "創建的資源:" -ForegroundColor Cyan
if ($createdMonitorId) {
    Write-Host "  📊 監控器 ID: $createdMonitorId" -ForegroundColor White
}
if ($createdStatusPageId) {
    Write-Host "  📄 狀態頁面 ID: $createdStatusPageId" -ForegroundColor White
}
if ($createdGroupId) {
    Write-Host "  👥 群組 ID: $createdGroupId" -ForegroundColor White
}

Write-Host "`n後續操作建議:" -ForegroundColor Cyan
Write-Host "1. 執行完整的 K6 測試: k6 run k6-api-comprehensive-test.js" -ForegroundColor Gray
Write-Host "2. 查看 Kuma 後台確認創建的資源" -ForegroundColor Gray
Write-Host "3. 查看 API 文檔: $baseUrl/api-docs" -ForegroundColor Gray

# 7. 測試 PUT API
if ($createdStatusPageSlug) {
    Write-Host "`n--- 7. 測試 PUT API ---" -ForegroundColor Cyan
    
    # 測試基本欄位更新
    Write-Host "測試基本欄位更新..." -ForegroundColor Yellow
    $updateData = @{
        title = "更新後的狀態頁面標題"
        description = "更新後的描述"
        theme = "dark"
        autoRefreshInterval = 240
        published = $false
    } | ConvertTo-Json
    
    try {
        $updateResponse = Invoke-RestMethod -Uri "$baseUrl/api/v1/status-pages/$createdStatusPageSlug" -Method PUT -Body $updateData -Headers $headers
        if ($updateResponse.ok) {
            Write-Host "✅ 基本欄位更新成功" -ForegroundColor Green
        }
    } catch {
        Write-Host "❌ 基本欄位更新失敗: $($_.Exception.Message)" -ForegroundColor Red
    }
    
    # 測試 publicGroupList 更新
    if ($createdMonitorId) {
        Write-Host "測試 publicGroupList 更新..." -ForegroundColor Yellow
        $groupUpdateData = @{
            title = "群組更新測試"
            publicGroupList = @(
                @{
                    name = "更新後的群組"
                    monitorList = @(
                        @{
                            id = $createdMonitorId
                            sendUrl = $false
                            url = "https://custom-update-url.example.com"
                        }
                    )
                },
                @{
                    name = "新增的群組"
                    monitorList = @(
                        @{
                            id = $createdMonitorId
                            sendUrl = $true
                        }
                    )
                }
            )
        } | ConvertTo-Json -Depth 4
        
        try {
            $groupUpdateResponse = Invoke-RestMethod -Uri "$baseUrl/api/v1/status-pages/$createdStatusPageSlug" -Method PUT -Body $groupUpdateData -Headers $headers
            if ($groupUpdateResponse.ok) {
                Write-Host "✅ publicGroupList 更新成功" -ForegroundColor Green
                
                # 驗證更新結果
                try {
                    $verifyUpdateResponse = Invoke-RestMethod -Uri "$baseUrl/api/v1/status-pages/$createdStatusPageSlug?includeGroups=true" -Method GET -Headers $headers
                    if ($verifyUpdateResponse.ok -and $verifyUpdateResponse.data.publicGroupList) {
                        Write-Host "   ✅ 驗證成功！更新後有 $($verifyUpdateResponse.data.publicGroupList.Count) 個群組" -ForegroundColor Green
                        foreach ($group in $verifyUpdateResponse.data.publicGroupList) {
                            Write-Host "     📁 群組: $($group.name)" -ForegroundColor Cyan
                        }
                    }
                } catch {
                    Write-Host "   ❌ 驗證更新結果失敗: $($_.Exception.Message)" -ForegroundColor Red
                }
            }
        } catch {
            Write-Host "❌ publicGroupList 更新失敗: $($_.Exception.Message)" -ForegroundColor Red
        }
    }
    
    # 測試清空 publicGroupList
    Write-Host "測試清空 publicGroupList..." -ForegroundColor Yellow
    $clearGroupsData = @{
        title = "清空群組測試"
        publicGroupList = @()
    } | ConvertTo-Json
    
    try {
        $clearResponse = Invoke-RestMethod -Uri "$baseUrl/api/v1/status-pages/$createdStatusPageSlug" -Method PUT -Body $clearGroupsData -Headers $headers
        if ($clearResponse.ok) {
            Write-Host "✅ publicGroupList 清空成功" -ForegroundColor Green
        }
    } catch {
        Write-Host "❌ publicGroupList 清空失敗: $($_.Exception.Message)" -ForegroundColor Red
    }
}

Write-Host "`n🎉 API 測試完成！" -ForegroundColor Green
