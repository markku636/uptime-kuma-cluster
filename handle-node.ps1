# 處理特定節點腳本
# 用於處理 "HTTP 監控器_1_1755658199209_a8c094" 節點

Write-Host "開始處理節點: HTTP 監控器_1_1755658199209_a8c094" -ForegroundColor Green

# 檢查Node.js是否安裝
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "錯誤: 未找到Node.js，請先安裝Node.js" -ForegroundColor Red
    exit 1
}

# 檢查腳本文件是否存在
if (-not (Test-Path "handle-specific-node.js")) {
    Write-Host "錯誤: 未找到 handle-specific-node.js 文件" -ForegroundColor Red
    exit 1
}

# 運行節點處理腳本
Write-Host "運行節點處理腳本..." -ForegroundColor Yellow
try {
    node handle-specific-node.js
    Write-Host "節點處理完成！" -ForegroundColor Green
} catch {
    Write-Host "運行腳本時發生錯誤: $_" -ForegroundColor Red
    exit 1
}

Write-Host "按任意鍵繼續..." -ForegroundColor Cyan
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
