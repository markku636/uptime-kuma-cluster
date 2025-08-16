import http from 'k6/http';
import { check } from 'k6';
import { Counter } from 'k6/metrics';
import { sleep } from 'k6';

// 自定義指標
const successfulCreations = new Counter('successful_creations');
const failedCreations = new Counter('failed_creations');
const apiErrors = new Counter('api_errors');

// 配置
const baseUrl = 'http://127.0.0.1:3001';
const apiKey = 'uk1_fhNBcThusPsjocw0YmR144BJs-RQZV9weVr6NvZJ';

// 測試配置 - 創建 100 個 monitor
export const options = {
  iterations: 100,  // 執行 100 次
  vus: 1,           // 降低到 1 個虛擬用戶，避免觸發速率限制
  thresholds: {
    http_req_duration: ['p(95)<10000'], // 95% 的請求要在 10 秒內完成
    http_req_failed: ['rate<0.1'],      // 錯誤率要低於 10%
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
  const monitorTypes = [
    {
      type: 'http',
      url: 'https://httpbin.org/status/200',
      method: 'GET',
      name: 'HTTP 監控器'
    },
    {
      type: 'ping',
      hostname: '8.8.8.8',
      name: 'Ping 監控器'
    },
    {
      type: 'dns',
      hostname: 'google.com',
      name: 'DNS 監控器'
    },
    {
      type: 'tcp',
      hostname: 'google.com',
      port: 80,
      name: 'TCP 監控器'
    },
    {
      type: 'http',
      url: 'https://www.google.com',
      method: 'GET',
      name: 'Google 監控器'
    }
  ];

  const selectedType = monitorTypes[iterationIndex % monitorTypes.length];
  const baseName = generateUniqueName(selectedType.name, iterationIndex);

  let config = {
    name: baseName,
    type: selectedType.type,
    interval: 60,
    active: true,
    retryInterval: 30,
    timeout: 10,
    description: `自動創建的測試監控器 - ${selectedType.name} - 第 ${iterationIndex + 1} 個`,
    tags: [`auto-created`, `test-${iterationIndex + 1}`, `type-${selectedType.type}`]
  };

  // 根據類型添加特定的配置
  switch (selectedType.type) {
    case 'http':
      config.url = selectedType.url;
      config.method = selectedType.method;
      config.acceptStatusCodes = '200-299';
      break;
    case 'ping':
      config.hostname = selectedType.hostname;
      config.interval = 120; // ping 監控器間隔稍長
      break;
    case 'dns':
      config.hostname = selectedType.hostname;
      config.dns_resolver = '1.1.1.1';
      break;
    case 'tcp':
      config.hostname = selectedType.hostname;
      config.port = selectedType.port;
      break;
  }

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
  const success = check(response, {
    [`${description} - status is ${expectedStatus}`]: (r) => r.status === expectedStatus,
    [`${description} - response time < 5000ms`]: (r) => r.timings.duration < 5000,
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

  // 添加延遲，避免觸發速率限制
  // 每 5 個請求後等待 2 秒
  if ((iterationIndex + 1) % 5 === 0) {
    console.log(`⏳ 等待 2 秒避免觸發速率限制...`);
    sleep(2);
  } else {
    // 其他請求間隔 0.5 秒
    sleep(0.5);
  }
}

// 設置函數
export function setup() {
  console.log('🚀 開始執行創建 100 個監控器的測試');
  console.log(`目標 URL: ${baseUrl}`);
  console.log(`API Key: ${apiKey}`);
  console.log('測試配置:');
  console.log('  - 總計創建: 100 個監控器');
  console.log('  - 並行用戶: 5 個');
  console.log('  - 監控器類型: HTTP, Ping, DNS, TCP');
  console.log('  - 每個監控器都有唯一名稱和標籤');
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
  console.log('\n可以通過以下方式查看創建的監控器:');
  console.log(`- 監控器列表: GET ${baseUrl}/api/v1/monitors`);
  console.log(`- 使用 Authorization: ${apiKey}`);
  console.log('\n🎉 100 個監控器創建測試完成！');
}
