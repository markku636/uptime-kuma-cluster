
import http from 'k6/http';
import { check } from 'k6';
import { Counter } from 'k6/metrics';

// 自定義指標
const successfulCreations = new Counter('successful_monitor_creations');
const failedCreations = new Counter('failed_monitor_creations');

// 配置
const baseUrl = 'http://127.0.0.1:9091';
const apiKey = 'uk1_dRoog_hjdvwvtQTCwXeaXj2jbrjA0OVOsLIkSwJn';

// 測試配置
export const options = {
  iterations: 40,  // 執行 40 次
  vus: 1,          // 單一虛擬用戶
};

// 生成唯一的監控器名稱
function generateUniqueName(iterationIndex) {
  const timestamp = Date.now();
  const randomSuffix = Math.random().toString(36).substring(2, 8);
  return `監控器_${iterationIndex + 1}_${timestamp}_${randomSuffix}`;
}

// 生成不同類型的監控器配置
function generateMonitorConfig(iterationIndex) {
  const monitorTypes = [
    {
      type: 'http',
      url: 'https://httpbin.org/status/200',
      method: 'GET'
    },
    {
      type: 'ping',
      hostname: '8.8.8.8'
    },
    {
      type: 'dns',
      hostname: 'google.com'
    },
    {
      type: 'http',
      url: 'https://jsonplaceholder.typicode.com/posts/1',
      method: 'GET'
    },
    {
      type: 'ping',
      hostname: '1.1.1.1'
    }
  ];

  const selectedType = monitorTypes[iterationIndex % monitorTypes.length];
  const baseName = generateUniqueName(iterationIndex);

  let config = {
    name: baseName,
    type: selectedType.type,
    interval: 60,
    active: true,
    retryInterval: 30,
    timeout: 10,
    node_id: 'node1'
  };

  // 根據類型添加特定的配置
  switch (selectedType.type) {
    case 'http':
      config.url = selectedType.url;
      config.method = selectedType.method;
      break;
    case 'ping':
      config.hostname = selectedType.hostname;
      break;
    case 'dns':
      config.hostname = selectedType.hostname;
      break;
  }

  return config;
}

export default function () {
  const iterationIndex = __ITER;
  
  // 生成監控器配置
  const monitorConfig = generateMonitorConfig(iterationIndex);
  
  // 準備請求
  const url = `${baseUrl}/api/v1/monitors`;
  const payload = JSON.stringify(monitorConfig);
  const params = {
    headers: {
      'Authorization': apiKey,
      'Content-Type': 'application/json',
    },
  };

  console.log(`正在創建第 ${iterationIndex + 1} 個監控器: ${monitorConfig.name}`);
  
  // 發送 POST 請求
  const response = http.post(url, payload, params);
  
  // 檢查響應
  const success = check(response, {
    'status is 201': (r) => r.status === 201,
    'response has monitor id': (r) => {
      try {
        const body = JSON.parse(r.body);
        return body.id !== undefined;
      } catch (e) {
        return false;
      }
    },
    'response time < 5000ms': (r) => r.timings.duration < 5000,
  });

  if (success) {
    successfulCreations.add(1);
    const responseBody = JSON.parse(response.body);
    console.log(`✅ 成功創建監控器 ID: ${responseBody.id}, 名稱: ${monitorConfig.name}`);
  } else {
    failedCreations.add(1);
    console.log(`❌ 創建監控器失敗: ${monitorConfig.name}, 狀態碼: ${response.status}`);
    console.log(`響應內容: ${response.body}`);
  }

  // 檢查狀態碼
  if (response.status !== 201) {
    console.log(`警告: 期望狀態碼 201，實際收到 ${response.status}`);
  }
}

// 設置和清理函數
export function setup() {
  console.log('🚀 開始執行 Kuma 監控器創建測試');
  console.log(`目標 URL: ${baseUrl}`);
  console.log('將創建 40 個不同的監控器...');
  return {};
}

export function teardown(data) {
  console.log('\n📊 測試完成！');
  console.log('可以通過以下方式查看創建的監控器:');
  console.log(`GET ${baseUrl}/api/v1/monitors`);
  console.log('Authorization: ' + apiKey);
}
