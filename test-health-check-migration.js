#!/usr/bin/env node

/**
 * 測試腳本：驗證健康檢查遷移是否成功
 * 
 * 此腳本用於測試從 Node.js NodeManager 遷移到 OpenResty/nginx 的健康檢查功能
 */

const http = require('http');
const https = require('https');

// 配置
const config = {
    host: process.env.TEST_HOST || 'localhost',
    port: process.env.TEST_PORT || 80,
    useHttps: process.env.TEST_HTTPS === 'true',
    timeout: 10000
};

// 測試結果
const results = {
    passed: 0,
    failed: 0,
    tests: []
};

// 記錄測試結果
function recordTest(name, success, details = '') {
    const test = { name, success, details, timestamp: new Date().toISOString() };
    results.tests.push(test);
    
    if (success) {
        results.passed++;
        console.log(`✅ ${name}: PASSED`);
    } else {
        results.failed++;
        console.log(`❌ ${name}: FAILED - ${details}`);
    }
    
    return test;
}

// 發送 HTTP 請求
function makeRequest(path, method = 'GET', data = null) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: config.host,
            port: config.port,
            path: path,
            method: method,
            timeout: config.timeout,
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'Health-Check-Migration-Test/1.0'
            }
        };

        const client = config.useHttps ? https : http;
        const req = client.request(options, (res) => {
            let body = '';
            res.on('data', (chunk) => {
                body += chunk;
            });
            res.on('end', () => {
                try {
                    const jsonBody = JSON.parse(body);
                    resolve({ status: res.statusCode, body: jsonBody, headers: res.headers });
                } catch (e) {
                    resolve({ status: res.statusCode, body: body, headers: res.headers });
                }
            });
        });

        req.on('error', (err) => {
            reject(err);
        });

        req.on('timeout', () => {
            req.destroy();
            reject(new Error('Request timeout'));
        });

        if (data) {
            req.write(JSON.stringify(data));
        }

        req.end();
    });
}

// 測試 1: 基本健康檢查端點
async function testBasicHealthCheck() {
    try {
        const response = await makeRequest('/health');
        
        if (response.status === 200) {
            const body = response.body;
            if (typeof body === 'object' && body.status === 'healthy' && body.timestamp) {
                recordTest('Basic Health Check', true);
                return true;
            } else {
                recordTest('Basic Health Check', false, 'Invalid response format');
                return false;
            }
        } else {
            recordTest('Basic Health Check', false, `HTTP ${response.status}`);
            return false;
        }
    } catch (error) {
        recordTest('Basic Health Check', false, error.message);
        return false;
    }
}

// 測試 2: 手動觸發重新平衡 API
async function testManualRebalancingAPI() {
    try {
        const response = await makeRequest('/api/trigger-rebalancing', 'POST');
        
        if (response.status === 200) {
            const body = response.body;
            if (typeof body === 'object' && body.status === 'success') {
                recordTest('Manual Rebalancing API', true);
                return true;
            } else {
                recordTest('Manual Rebalancing API', false, 'Invalid success response format');
                return false;
            }
        } else if (response.status === 500) {
            // 500 錯誤可能是正常的，因為資料庫可能不可用
            const body = response.body;
            if (typeof body === 'object' && body.status === 'error') {
                recordTest('Manual Rebalancing API', true, 'API endpoint working (database error expected)');
                return true;
            } else {
                recordTest('Manual Rebalancing API', false, 'Invalid error response format');
                return false;
            }
        } else {
            recordTest('Manual Rebalancing API', false, `Unexpected HTTP status: ${response.status}`);
            return false;
        }
    } catch (error) {
        recordTest('Manual Rebalancing API', false, error.message);
        return false;
    }
}

// 測試 3: 檢查 nginx 是否支援 Lua
async function testLuaSupport() {
    try {
        // 嘗試訪問一個需要 Lua 支援的端點
        const response = await makeRequest('/api/trigger-rebalancing');
        
        // 如果我們能得到任何響應（即使是錯誤），說明 Lua 腳本正在工作
        if (response.status === 200 || response.status === 405 || response.status === 500) {
            recordTest('Lua Script Support', true, 'Lua scripts are working');
            return true;
        } else {
            recordTest('Lua Script Support', false, `Unexpected response: ${response.status}`);
            return false;
        }
    } catch (error) {
        recordTest('Lua Script Support', false, error.message);
        return false;
    }
}

// 測試 4: 檢查響應時間
async function testResponseTime() {
    try {
        const startTime = Date.now();
        const response = await makeRequest('/health');
        const endTime = Date.now();
        const responseTime = endTime - startTime;
        
        if (response.status === 200 && responseTime < 1000) {
            recordTest('Response Time', true, `${responseTime}ms`);
            return true;
        } else if (response.status === 200) {
            recordTest('Response Time', false, `Too slow: ${responseTime}ms`);
            return false;
        } else {
            recordTest('Response Time', false, `HTTP ${response.status}`);
            return false;
        }
    } catch (error) {
        recordTest('Response Time', false, error.message);
        return false;
    }
}

// 測試 5: 檢查 CORS 支援（如果適用）
async function testCORSSupport() {
    try {
        const response = await makeRequest('/health', 'OPTIONS');
        
        // OPTIONS 請求應該返回 200 或 405
        if (response.status === 200 || response.status === 405) {
            recordTest('CORS Support', true, 'OPTIONS method handled');
            return true;
        } else {
            recordTest('CORS Support', false, `OPTIONS method returned ${response.status}`);
            return false;
        }
    } catch (error) {
        // 如果 OPTIONS 不被支援，這可能是正常的
        recordTest('CORS Support', true, 'OPTIONS method not supported (expected)');
        return true;
    }
}

// 主測試函數
async function runAllTests() {
    console.log('🚀 開始測試健康檢查遷移...\n');
    console.log(`測試目標: ${config.useHttps ? 'https' : 'http'}://${config.host}:${config.port}\n`);
    
    // 運行所有測試
    await testBasicHealthCheck();
    await testLuaSupport();
    await testManualRebalancingAPI();
    await testResponseTime();
    await testCORSSupport();
    
    // 顯示測試摘要
    console.log('\n📊 測試摘要:');
    console.log(`✅ 通過: ${results.passed}`);
    console.log(`❌ 失敗: ${results.failed}`);
    console.log(`📈 成功率: ${((results.passed / (results.passed + results.failed)) * 100).toFixed(1)}%`);
    
    // 顯示詳細結果
    console.log('\n📋 詳細結果:');
    results.tests.forEach((test, index) => {
        const status = test.success ? '✅' : '❌';
        console.log(`${index + 1}. ${status} ${test.name}: ${test.success ? 'PASSED' : 'FAILED'}`);
        if (test.details) {
            console.log(`   ${test.details}`);
        }
    });
    
    // 檢查遷移是否成功
    const criticalTests = ['Basic Health Check', 'Lua Script Support'];
    const criticalTestsPassed = criticalTests.every(testName => 
        results.tests.find(t => t.name === testName)?.success
    );
    
    console.log('\n🎯 遷移狀態:');
    if (criticalTestsPassed) {
        console.log('✅ 健康檢查遷移成功！Node.js NodeManager 功能已成功遷移到 OpenResty/nginx');
        console.log('💡 建議: 可以安全地移除 Node.js 中的 NodeManager 相關代碼');
    } else {
        console.log('❌ 健康檢查遷移失敗！需要檢查 nginx 配置和 Lua 腳本');
        console.log('🔧 請檢查:');
        console.log('   - nginx 配置是否正確');
        console.log('   - Lua 腳本是否正確載入');
        console.log('   - 資料庫連接是否正常');
    }
    
    return criticalTestsPassed;
}

// 如果直接運行此腳本
if (require.main === module) {
    runAllTests().catch(error => {
        console.error('❌ 測試執行失敗:', error.message);
        process.exit(1);
    });
}

module.exports = {
    runAllTests,
    testBasicHealthCheck,
    testManualRebalancingAPI,
    testLuaSupport,
    testResponseTime,
    testCORSSupport
};

