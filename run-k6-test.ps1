# K6 監控器創建測試執行腳本

Write-Host "檢查 K6 是否已安裝..." -ForegroundColor Yellow

# 檢查 k6 是否已安裝
try {
    $k6Version = k6 version
    Write-Host "K6 已安裝: $k6Version" -ForegroundColor Green
} catch {
    Write-Host "K6 未安裝，請先安裝 K6:" -ForegroundColor Red
    Write-Host "1. 使用 Chocolatey: choco install k6" -ForegroundColor Cyan
    Write-Host "2. 使用 winget: winget install k6" -ForegroundColor Cyan
    Write-Host "3. 或從官網下載: https://k6.io/docs/get-started/installation/" -ForegroundColor Cyan
    exit 1
}

Write-Host "`n開始執行 K6 測試..." -ForegroundColor Yellow
Write-Host "將創建 40 個不重複名稱的監控器" -ForegroundColor Cyan

# 執行 K6 測試
k6 run k6-monitor-test.js

Write-Host "`n測試執行完成！" -ForegroundColor Green
Write-Host "檢查結果請查看上面的輸出或訪問 Kuma 後台" -ForegroundColor Cyan
