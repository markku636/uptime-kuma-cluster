import http from 'k6/http';
import { check } from 'k6';
import { Counter } from 'k6/metrics';

// 自定義指標
const successfulCreations = new Counter('successful_creations');
const failedCreations = new Counter('failed_creations');
const apiErrors = new Counter('api_errors');

// 配置
const baseUrl = 'http://127.0.0.1:9091';
const apiKey = 'uk1_dRoog_hjdvwvtQTCwXeaXj2jbrjA0OVOsLIkSwJn';

// 測試配置
export const options = {
  iterations: 10,  // 執行 10 次
  vus: 1,          // 單一虛擬用戶
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
      method: 'GET'
    },
    {
      type: 'ping',
      hostname: '8.8.8.8'
    },
    {
      type: 'dns',
      hostname: 'google.com'
    }
  ];

  const selectedType = monitorTypes[iterationIndex % monitorTypes.length];
  const baseName = generateUniqueName('監控器', iterationIndex);

  let config = {
    name: baseName,
    type: selectedType.type,
    interval: 60,
    active: true,
    retryInterval: 30,
    timeout: 10,
    node_id: 'node1',
    description: `測試監控器 - ${selectedType.type} - ${iterationIndex + 1}`
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
  console.log(`\n=== 第 ${iterationIndex + 1} 次測試開始 ===`);
  
  let createdMonitor = null;
  let createdStatusPage = null;
  let createdGroup = null;

  // 1. 創建監控器
  console.log(`\n--- 1. 創建監控器 ---`);
  const monitorConfig = generateMonitorConfig(iterationIndex);
  const monitorResponse = http.post(
    `${baseUrl}/api/v1/monitors`,
    JSON.stringify(monitorConfig),
    getRequestParams()
  );
  
  const monitorResult = checkResponse(monitorResponse, 201, '創建監控器');
  if (monitorResult && monitorResult.data) {
    createdMonitor = monitorResult.data;
    console.log(`📊 監控器 ID: ${createdMonitor.id}, 名稱: ${createdMonitor.name}`);
  }

  // 2. 更新監控器 (如果創建成功)
  if (createdMonitor) {
    console.log(`\n--- 2. 更新監控器 ---`);
    const updateConfig = {
      name: createdMonitor.name + '_已更新',
      description: '已更新的描述',
      interval: 120
    };
    
    const updateResponse = http.put(
      `${baseUrl}/api/v1/monitors/${createdMonitor.id}`,
      JSON.stringify(updateConfig),
      getRequestParams()
    );
    
    checkResponse(updateResponse, 200, '更新監控器');
  }

  // 3. 創建狀態頁面（帶 publicGroupList）
  console.log(`\n--- 3. 創建狀態頁面（帶 publicGroupList） ---`);
  const statusPageConfig = {
    title: generateUniqueName('狀態頁面', iterationIndex),
    slug: generateUniqueName('status-page', iterationIndex).toLowerCase().replace(/[_\u4e00-\u9fff]/g, '-'),
    description: `測試狀態頁面 - 第 ${iterationIndex + 1} 次`,
    theme: 'auto',
    autoRefreshInterval: 300,
    published: true,
    search_engine_index: true,
    show_tags: false,
    show_powered_by: true,
    show_certificate_expiry: false,
    publicGroupList: createdMonitor ? [
      {
        name: generateUniqueName('群組', iterationIndex),
        monitorList: [
          {
            id: createdMonitor.id,
            sendUrl: true
          }
        ]
      }
    ] : []
  };

  const statusPageResponse = http.post(
    `${baseUrl}/api/v1/status-pages`,
    JSON.stringify(statusPageConfig),
    getRequestParams()
  );
  
  const statusPageResult = checkResponse(statusPageResponse, 201, '創建狀態頁面');
  if (statusPageResult && statusPageResult.data) {
    createdStatusPage = statusPageResult.data;
    console.log(`📄 狀態頁面 ID: ${createdStatusPage.id}, Slug: ${createdStatusPage.slug}`);
  }

  // 4. 創建群組 (如果狀態頁面和監控器都創建成功)
  if (createdStatusPage && createdMonitor) {
    console.log(`\n--- 4. 創建群組 ---`);
    const groupConfig = {
      name: generateUniqueName('群組', iterationIndex),
      status_page_id: createdStatusPage.id,
      public: true,
      weight: 1,
      monitorList: [
        {
          id: createdMonitor.id,
          sendUrl: true,
          weight: 1
        }
      ]
    };

    const groupResponse = http.post(
      `${baseUrl}/api/v1/groups`,
      JSON.stringify(groupConfig),
      getRequestParams()
    );
    
    const groupResult = checkResponse(groupResponse, 201, '創建群組');
    if (groupResult && groupResult.data) {
      createdGroup = groupResult.data;
      console.log(`👥 群組 ID: ${createdGroup.id}, 名稱: ${createdGroup.name}`);
    }
  }

  // 5. 更新群組 (如果創建成功)
  if (createdGroup) {
    console.log(`\n--- 5. 更新群組 ---`);
    const updateGroupConfig = {
      name: createdGroup.name + '_已更新',
      weight: 2
    };
    
    const updateGroupResponse = http.put(
      `${baseUrl}/api/v1/groups/${createdGroup.id}`,
      JSON.stringify(updateGroupConfig),
      getRequestParams()
    );
    
    checkResponse(updateGroupResponse, 200, '更新群組');
  }

  // 6. 查詢創建的資源
  console.log(`\n--- 6. 驗證創建的資源 ---`);
  
  // 查詢監控器
  if (createdMonitor) {
    const getMonitorResponse = http.get(
      `${baseUrl}/api/v1/monitors/${createdMonitor.id}`,
      getRequestParams()
    );
    checkResponse(getMonitorResponse, 200, '查詢監控器');
  }

  // 查詢狀態頁面並驗證 publicGroupList
  if (createdStatusPage) {
    const getStatusPageResponse = http.get(
      `${baseUrl}/api/v1/status-pages/${createdStatusPage.slug}?includeGroups=true`,
      getRequestParams()
    );
    const statusPageResult = checkResponse(getStatusPageResponse, 200, '查詢狀態頁面');
    
    // 驗證 publicGroupList
    if (statusPageResult && statusPageResult.data && statusPageResult.data.publicGroupList) {
      const groupCount = statusPageResult.data.publicGroupList.length;
      if (groupCount > 0) {
        console.log(`✅ publicGroupList 驗證成功：找到 ${groupCount} 個群組`);
        statusPageResult.data.publicGroupList.forEach((group, index) => {
          console.log(`   群組 ${index + 1}: ${group.name} (包含 ${group.monitorList?.length || 0} 個監控器)`);
        });
      } else {
        console.log(`⚠️  publicGroupList 為空`);
      }
    } else {
      console.log(`❌ publicGroupList 驗證失敗：沒有找到群組資料`);
    }
  }

  // 查詢群組
  if (createdGroup) {
    const getGroupResponse = http.get(
      `${baseUrl}/api/v1/groups/${createdGroup.id}`,
      getRequestParams()
    );
    checkResponse(getGroupResponse, 200, '查詢群組');
  }

  // 7. 測試列表 API
  console.log(`\n--- 7. 測試列表 API ---`);
  
  // 列出所有監控器
  const listMonitorsResponse = http.get(
    `${baseUrl}/api/v1/monitors`,
    getRequestParams()
  );
  checkResponse(listMonitorsResponse, 200, '列出監控器');

  // 列出所有狀態頁面
  const listStatusPagesResponse = http.get(
    `${baseUrl}/api/v1/status-pages`,
    getRequestParams()
  );
  checkResponse(listStatusPagesResponse, 200, '列出狀態頁面');

  console.log(`=== 第 ${iterationIndex + 1} 次測試完成 ===\n`);
}

// 設置和清理函數
export function setup() {
  console.log('🚀 開始執行 Kuma 完整 API 測試');
  console.log(`目標 URL: ${baseUrl}`);
  console.log('測試項目:');
  console.log('  - 創建監控器 (POST /api/v1/monitors)');
  console.log('  - 更新監控器 (PUT /api/v1/monitors/{id})');
  console.log('  - 創建狀態頁面 (POST /api/v1/status-pages)');
  console.log('  - 創建群組 (POST /api/v1/groups)');
  console.log('  - 更新群組 (PUT /api/v1/groups/{id})');
  console.log('  - 查詢各種資源 (GET APIs)');
  console.log('將執行 10 次完整測試...\n');
  return {};
}

export function teardown(data) {
  console.log('\n📊 測試完成！');
  console.log('測試報告:');
  console.log(`  ✅ 成功操作: ${successfulCreations.count}`);
  console.log(`  ❌ 失敗操作: ${failedCreations.count}`);
  console.log(`  🚨 API 錯誤: ${apiErrors.count}`);
  console.log('\n可以通過以下方式查看創建的資源:');
  console.log(`- 監控器: GET ${baseUrl}/api/v1/monitors`);
  console.log(`- 狀態頁面: GET ${baseUrl}/api/v1/status-pages`);
  console.log(`Authorization: ${apiKey}`);
}
