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
    console.log('🔍 開始安全的 PUT 測試');
    
    // 1. 先查詢現有監控器
    console.log('\n--- 1. 查詢現有監控器 ---');
    const monitorsResponse = http.get(`${baseUrl}/api/v1/monitors`, { headers });
    
    if (monitorsResponse.status !== 200) {
        console.log('❌ 無法獲取監控器列表');
        return;
    }
    
    const monitorsData = JSON.parse(monitorsResponse.body);
    const availableMonitorIds = monitorsData.data.map(monitor => monitor.id);
    
    console.log(`✅ 找到 ${availableMonitorIds.length} 個監控器`);
    console.log(`可用的監控器 ID: [${availableMonitorIds.join(', ')}]`);
    
    if (availableMonitorIds.length === 0) {
        console.log('❌ 沒有可用的監控器，請先創建一些監控器');
        return;
    }
    
    // 2. 創建測試狀態頁面
    console.log('\n--- 2. 創建測試狀態頁面 ---');
    const timestamp = Date.now();
    const statusPageData = {
        title: '安全測試狀態頁面',
        slug: `safe-test-${timestamp}`,
        description: '使用安全監控器 ID 的測試頁面',
        theme: 'auto',
        published: true,
        publicGroupList: [
            {
                name: '初始群組',
                monitorList: [
                    {
                        id: availableMonitorIds[0],
                        sendUrl: true
                    }
                ]
            }
        ]
    };
    
    const createResponse = http.post(
        `${baseUrl}/api/v1/status-pages`,
        JSON.stringify(statusPageData),
        { headers }
    );
    
    const createSuccess = check(createResponse, {
        '狀態頁面創建成功': (r) => r.status === 201,
    });
    
    if (!createSuccess) {
        console.log(`❌ 狀態頁面創建失敗: ${createResponse.status} - ${createResponse.body}`);
        return;
    }
    
    const createResult = JSON.parse(createResponse.body);
    const testSlug = createResult.data.slug;
    console.log(`✅ 狀態頁面創建成功: ${testSlug}`);
    
    // 3. 測試安全的 PUT 更新
    console.log('\n--- 3. 測試安全的 PUT 更新 ---');
    
    // 只使用存在的監控器 ID
    const safeMonitorIds = availableMonitorIds.slice(0, Math.min(5, availableMonitorIds.length));
    
    const updateData = {
        title: '安全更新測試',
        publicGroupList: [
            {
                name: '生產環境',
                monitorList: safeMonitorIds.map((id, index) => ({
                    id: id,
                    sendUrl: index % 2 === 0,
                    url: index % 2 === 1 ? `https://prod-${index}.example.com` : undefined
                }))
            },
            {
                name: '測試環境',
                monitorList: [
                    {
                        id: safeMonitorIds[0],
                        sendUrl: false,
                        url: 'https://test.example.com'
                    }
                ]
            }
        ]
    };
    
    console.log('發送更新請求...');
    console.log(`使用的監控器 ID: [${safeMonitorIds.join(', ')}]`);
    
    const updateResponse = http.put(
        `${baseUrl}/api/v1/status-pages/${testSlug}`,
        JSON.stringify(updateData),
        { headers }
    );
    
    const updateSuccess = check(updateResponse, {
        'PUT 更新成功': (r) => r.status === 200,
    });
    
    if (updateSuccess) {
        console.log('✅ PUT 更新成功');
        
        // 4. 驗證更新結果
        console.log('\n--- 4. 驗證更新結果 ---');
        const verifyResponse = http.get(
            `${baseUrl}/api/v1/status-pages/${testSlug}?includeGroups=true`,
            { headers }
        );
        
        if (verifyResponse.status === 200) {
            const verifyData = JSON.parse(verifyResponse.body);
            if (verifyData.data.publicGroupList) {
                console.log(`✅ 驗證成功: 找到 ${verifyData.data.publicGroupList.length} 個群組`);
                verifyData.data.publicGroupList.forEach((group, index) => {
                    console.log(`   群組 ${index + 1}: ${group.name}`);
                    console.log(`     監控器數量: ${group.monitorList?.length || 0}`);
                    group.monitorList?.forEach((monitor, mIndex) => {
                        console.log(`       監控器 ${mIndex + 1}: ID=${monitor.id}, sendUrl=${monitor.sendUrl}`);
                    });
                });
            }
        }
        
    } else {
        console.log(`❌ PUT 更新失敗: ${updateResponse.status}`);
        console.log(`錯誤詳情: ${updateResponse.body}`);
    }
    
    console.log('\n🎯 安全測試完成');
}

export function teardown() {
    console.log('\n📋 安全測試總結:');
    console.log('✅ 動態檢查可用監控器');
    console.log('✅ 只使用存在的監控器 ID');
    console.log('✅ 避免外鍵約束錯誤');
    console.log('✅ 完整的錯誤處理');
}
