// 測試 publicGroupList 功能的腳本
import http from 'k6/http';
import { check } from 'k6';

const baseUrl = 'http://127.0.0.1:9091';
const apiKey = 'uk1_dRoog_hjdvwvtQTCwXeaXj2jbrjA0OVOsLIkSwJn';

const headers = {
    'Authorization': apiKey,
    'Content-Type': 'application/json',
};

export const options = {
    iterations: 1,
    vus: 1,
};

export default function () {
    console.log('🚀 開始測試 publicGroupList 功能');
    
    let createdMonitorId = null;
    let createdStatusPageId = null;
    
    // 步驟 1: 創建一個監控器
    console.log('\n--- 步驟 1: 創建監控器 ---');
    const monitorData = {
        name: `測試監控器_${Date.now()}`,
        type: 'http',
        url: 'https://httpbin.org/status/200',
        interval: 60,
        active: true,
        method: 'GET'
    };
    
    const monitorResponse = http.post(
        `${baseUrl}/api/v1/monitors`,
        JSON.stringify(monitorData),
        { headers }
    );
    
    const monitorSuccess = check(monitorResponse, {
        '監控器創建成功': (r) => r.status === 201,
    });
    
    if (monitorSuccess) {
        const monitorResult = JSON.parse(monitorResponse.body);
        createdMonitorId = monitorResult.data.id;
        console.log(`✅ 監控器創建成功，ID: ${createdMonitorId}`);
    } else {
        console.log(`❌ 監控器創建失敗: ${monitorResponse.status} - ${monitorResponse.body}`);
        return;
    }
    
    // 步驟 2: 創建帶有 publicGroupList 的狀態頁面
    console.log('\n--- 步驟 2: 創建帶 publicGroupList 的狀態頁面 ---');
    const timestamp = Date.now();
    const statusPageData = {
        title: `測試狀態頁面_${timestamp}`,
        slug: `test-status-page-${timestamp}`,
        description: '測試 publicGroupList 功能',
        theme: 'auto',
        published: true,
        publicGroupList: [
            {
                name: '測試群組 1',
                monitorList: [
                    {
                        id: createdMonitorId,
                        sendUrl: true
                    }
                ]
            },
            {
                name: '測試群組 2',
                monitorList: [
                    {
                        id: createdMonitorId,
                        sendUrl: false,
                        url: 'https://custom-url.example.com'
                    }
                ]
            }
        ]
    };
    
    console.log('發送狀態頁面創建請求，包含 publicGroupList:');
    console.log(JSON.stringify(statusPageData, null, 2));
    
    const statusPageResponse = http.post(
        `${baseUrl}/api/v1/status-pages`,
        JSON.stringify(statusPageData),
        { headers }
    );
    
    const statusPageSuccess = check(statusPageResponse, {
        '狀態頁面創建成功': (r) => r.status === 201,
    });
    
    if (statusPageSuccess) {
        const statusPageResult = JSON.parse(statusPageResponse.body);
        createdStatusPageId = statusPageResult.data.id;
        console.log(`✅ 狀態頁面創建成功，ID: ${createdStatusPageId}, Slug: ${statusPageResult.data.slug}`);
    } else {
        console.log(`❌ 狀態頁面創建失敗: ${statusPageResponse.status} - ${statusPageResponse.body}`);
        return;
    }
    
    // 步驟 3: 驗證群組是否成功創建
    console.log('\n--- 步驟 3: 驗證群組創建 ---');
    
    // 查詢狀態頁面，檢查是否有群組
    const getStatusPageResponse = http.get(
        `${baseUrl}/api/v1/status-pages/${statusPageData.slug}?includeGroups=true`,
        { headers }
    );
    
    const getSuccess = check(getStatusPageResponse, {
        '狀態頁面查詢成功': (r) => r.status === 200,
    });
    
    if (getSuccess) {
        const statusPageData = JSON.parse(getStatusPageResponse.body);
        console.log('查詢到的狀態頁面數據:');
        console.log(JSON.stringify(statusPageData.data, null, 2));
        
        if (statusPageData.data.publicGroupList && statusPageData.data.publicGroupList.length > 0) {
            console.log(`✅ publicGroupList 功能正常！找到 ${statusPageData.data.publicGroupList.length} 個群組`);
            
            statusPageData.data.publicGroupList.forEach((group, index) => {
                console.log(`   群組 ${index + 1}: ${group.name}`);
                if (group.monitorList && group.monitorList.length > 0) {
                    console.log(`     包含 ${group.monitorList.length} 個監控器`);
                    group.monitorList.forEach((monitor, mIndex) => {
                        console.log(`       監控器 ${mIndex + 1}: ID=${monitor.id}, sendUrl=${monitor.sendUrl}`);
                        if (monitor.url) {
                            console.log(`         自定義 URL: ${monitor.url}`);
                        }
                    });
                }
            });
        } else {
            console.log('❌ publicGroupList 功能異常：沒有找到群組');
        }
    } else {
        console.log(`❌ 狀態頁面查詢失敗: ${getStatusPageResponse.status} - ${getStatusPageResponse.body}`);
    }
    
    // 步驟 4: 驗證數據庫中的群組記錄（通過查詢群組端點）
    console.log('\n--- 步驟 4: 直接查詢群組記錄 ---');
    
    // 由於沒有群組列表端點，我們通過查詢狀態頁面的公開群組來驗證
    if (createdStatusPageId) {
        // 檢查是否可以通過狀態頁面的公開端點看到群組
        const publicStatusResponse = http.get(`${baseUrl}/api/status-page/${statusPageData.slug}`);
        
        const publicSuccess = check(publicStatusResponse, {
            '公開狀態頁面查詢成功': (r) => r.status === 200,
        });
        
        if (publicSuccess) {
            const publicData = JSON.parse(publicStatusResponse.body);
            console.log('公開狀態頁面數據:');
            console.log(JSON.stringify(publicData, null, 2));
            
            if (publicData.publicGroupList && publicData.publicGroupList.length > 0) {
                console.log(`✅ 公開端點也能看到群組！共 ${publicData.publicGroupList.length} 個群組`);
            } else {
                console.log('⚠️  公開端點沒有看到群組，可能是權限設定問題');
            }
        }
    }
    
    console.log('\n🎯 測試完成！');
}

export function teardown() {
    console.log('\n📋 測試總結:');
    console.log('1. 檢查控制台輸出確認 publicGroupList 是否正常工作');
    console.log('2. 如果看到群組資料，表示功能正常');
    console.log('3. 如果沒有看到群組，請檢查 API 實作');
}
