import http from 'k6/http';
import { check } from 'k6';
import { Counter } from 'k6/metrics';
import { sleep } from 'k6';

// 自定義指標
const successfulCreations = new Counter('successful_creations');
const failedCreations = new Counter('failed_creations');
const apiErrors = new Counter('api_errors');
const rateLimitHits = new Counter('rate_limit_hits');

// 配置
const baseUrl = 'http://192.168.99.88:9091';
const apiKey = 'uk1_SIDZNvdGb6dLKvtBJEfoYhoDTAwIn68aqlO-HwZN';

// 測試配置 - 創建 100 個 monitor，大幅降低頻率
export const options = {
  iterations: 100,  // 執行 100 次
  vus: 1,           // 只使用 1 個虛擬用戶，避免並行請求
  thresholds: {
    http_req_duration: ['p(95)<15000'], // 95% 的請求要在 15 秒內完成
    http_req_failed: ['rate<0.2'],      // 錯誤率要低於 20%
  },
};

// 生成唯一的名稱
function generateUniqueName(prefix, iterationIndex) {
  const timestamp = Date.now();
  const randomSuffix = Math.random().toString(36).substring(2, 8);
  return `${prefix}_${iterationIndex + 1}_${timestamp}_${randomSuffix}`;
}

// 生成監控器配置
function generateMonitorConfig(iterationIndex) {
  const httpUrls = [
    'https://httpbin.org/status/200',
    'https://httpbin.org/status/201',
    'https://httpbin.org/status/202',
    'https://httpbin.org/status/204',
    'https://httpbin.org/status/301',
    'https://httpbin.org/status/302',
    'https://httpbin.org/status/400',
    'https://httpbin.org/status/401',
    'https://httpbin.org/status/403',
    'https://httpbin.org/status/404',
    'https://httpbin.org/status/500',
    'https://httpbin.org/status/502',
    'https://httpbin.org/status/503',
  
  ];

  const selectedUrl = httpUrls[iterationIndex % httpUrls.length];
  const baseName = generateUniqueName('HTTP 監控器', iterationIndex);

  const config = {
    name: baseName,
    type: 'http',
    url: selectedUrl,
    method: 'GET',
    interval: 60,
    active: true,
    retryInterval: 30,
    timeout: 10,
    acceptStatusCodes: '200-299',
    description: `自動創建的 HTTP 測試監控器 - 第 ${iterationIndex + 1} 個`,
    tags: [`auto-created`, `test-${iterationIndex + 1}`, `type-http`]
  };

  return config;
}

// HTTP 請求參數
function getRequestParams() {
  return {
    headers: {
      'Authorization': apiKey,
      'Content-Type': 'application/json',
    },
  };
}

// 檢查響應
function checkResponse(response, expectedStatus, description) {
  // 檢查是否觸發速率限制
  if (response.status === 429) {
    rateLimitHits.add(1);
    console.log(`🚫 觸發速率限制 (429): ${description}`);
    return null;
  }

  const success = check(response, {
    [`${description} - status is ${expectedStatus}`]: (r) => r.status === expectedStatus,
    [`${description} - response time < 10000ms`]: (r) => r.timings.duration < 10000,
    [`${description} - has response body`]: (r) => r.body && r.body.length > 0,
  });

  if (success) {
    successfulCreations.add(1);
    try {
      const body = JSON.parse(response.body);
      console.log(`✅ ${description} 成功: ${body.msg || 'OK'}`);
      return body;
    } catch (e) {
      console.log(`✅ ${description} 成功 (無法解析 JSON 響應)`);
      return { ok: true };
    }
  } else {
    failedCreations.add(1);
    apiErrors.add(1);
    console.log(`❌ ${description} 失敗: 狀態碼 ${response.status}`);
    console.log(`響應內容: ${response.body}`);
    return null;
  }
}

export default function () {
  const iterationIndex = __ITER;
  
  // 創建監控器
  const monitorConfig = generateMonitorConfig(iterationIndex);
  const monitorResponse = http.post(
    `${baseUrl}/api/v1/monitors`,
    JSON.stringify(monitorConfig),
    getRequestParams()
  );
  
  const monitorResult = checkResponse(monitorResponse, 201, `創建監控器 ${iterationIndex + 1}`);
  if (monitorResult && monitorResult.data) {
    console.log(`📊 監控器 ${iterationIndex + 1} 創建成功: ID=${monitorResult.data.id}, 名稱=${monitorResult.data.name}`);
  } else {
    console.log(`❌ 監控器 ${iterationIndex + 1} 創建失敗`);
  }

  // 每 10 個監控器顯示進度
  if ((iterationIndex + 1) % 10 === 0) {
    console.log(`\n🎯 進度: 已完成 ${iterationIndex + 1}/100 個監控器創建\n`);
  }

  // 大幅增加延遲，避免觸發速率限制
  // 每 3 個請求後等待 5 秒
  if ((iterationIndex + 1) % 3 === 0) {
    console.log(`⏳ 等待 5 秒避免觸發速率限制...`);
    sleep(5);
  } else {
    // 其他請求間隔 2-4 秒（隨機延遲）
    const randomDelay = 2 + Math.random() * 2;
    console.log(`⏳ 等待 ${randomDelay.toFixed(1)} 秒...`);
    sleep(randomDelay);
  }
}

// 設置函數
export function setup() {
  console.log('🚀 開始執行創建 100 個監控器的測試');
  console.log(`目標 URL: ${baseUrl}`);
  console.log(`API Key: ${apiKey}`);
  console.log('測試配置:');
  console.log('  - 總計創建: 100 個 HTTP 監控器');
  console.log('  - 並行用戶: 1 個 (避免並行請求)');
  console.log('  - 監控器類型: HTTP 監控器');
  console.log('  - 目標網站: httpbin (多種狀態碼), Google, GitHub, Stack Overflow, Wikipedia');
  console.log('  - 每個監控器都有唯一名稱和標籤');
  console.log('  - 延遲策略: 每 3 個請求後等待 5 秒，其他請求間隔 2-4 秒');
  console.log('  - 總預估時間: 約 8-10 分鐘');
  console.log('\n開始創建...\n');
  return {};
}

// 清理函數
export function teardown(data) {
  console.log('\n📊 測試完成！');
  console.log('測試報告:');
  console.log(`  ✅ 成功創建: ${successfulCreations.count} 個監控器`);
  console.log(`  ❌ 創建失敗: ${failedCreations.count} 個`);
  console.log(`  🚨 API 錯誤: ${apiErrors.count} 個`);
  console.log(`  🚫 速率限制: ${rateLimitHits.count} 次`);
  console.log('\n可以通過以下方式查看創建的監控器:');
  console.log(`- 監控器列表: GET ${baseUrl}/api/v1/monitors`);
  console.log(`- 使用 Authorization: ${apiKey}`);
  console.log('\n🎉 100 個監控器創建測試完成！');
}
