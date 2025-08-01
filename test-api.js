/**
 * Simple API Test Script for Uptime Kuma
 * 
 * This script tests the basic functionality of the Uptime Kuma REST API
 * 
 * Usage:
 * 1. Make sure Uptime Kuma is running
 * 2. Update the BASE_URL and TOKEN below
 * 3. Run: node test-api.js
 */

const axios = require('axios');

// Configuration - Update these values
const BASE_URL = 'http://localhost:3001';  // Your Uptime Kuma URL
const TOKEN = 'YOUR_JWT_TOKEN_HERE';       // Get this from browser DevTools after login

// API client configuration
const api = axios.create({
    baseURL: BASE_URL,
    headers: {
        'Authorization': `Bearer ${TOKEN}`,
        'Content-Type': 'application/json'
    },
    timeout: 10000
});

async function testAPI() {
    console.log('🚀 Testing Uptime Kuma REST API...\n');

    try {
        // Test 1: Check API Status (No auth required)
        console.log('1. Testing API Status...');
        const statusResponse = await axios.get(`${BASE_URL}/api/v1/status`);
        console.log('✅ Status:', statusResponse.data);
        console.log('');

        // Test 2: Get all monitors
        console.log('2. Testing Get Monitors...');
        const monitorsResponse = await api.get('/api/v1/monitors');
        console.log('✅ Monitors:', monitorsResponse.data);
        console.log('');

        // Test 3: Create a new monitor
        console.log('3. Testing Create Monitor...');
        const newMonitor = {
            name: 'API Test Monitor',
            type: 'http',
            url: 'https://httpbin.org/status/200',
            interval: 60,
            active: true
        };

        const createResponse = await api.post('/api/v1/monitors', newMonitor);
        console.log('✅ Created Monitor:', createResponse.data);
        const monitorId = createResponse.data.data.monitorID;
        console.log('');

        // Test 4: Get specific monitor
        console.log('4. Testing Get Specific Monitor...');
        const getMonitorResponse = await api.get(`/api/v1/monitors/${monitorId}`);
        console.log('✅ Monitor Details:', getMonitorResponse.data);
        console.log('');

        // Test 5: Update monitor
        console.log('5. Testing Update Monitor...');
        const updateData = {
            name: 'Updated API Test Monitor',
            interval: 120
        };
        const updateResponse = await api.put(`/api/v1/monitors/${monitorId}`, updateData);
        console.log('✅ Updated Monitor:', updateResponse.data);
        console.log('');

        // Test 6: Get heartbeats
        console.log('6. Testing Get Heartbeats...');
        const heartbeatsResponse = await api.get(`/api/v1/monitors/${monitorId}/heartbeats?period=24`);
        console.log('✅ Heartbeats:', heartbeatsResponse.data);
        console.log('');

        // Test 7: Get notifications
        console.log('7. Testing Get Notifications...');
        const notificationsResponse = await api.get('/api/v1/notifications');
        console.log('✅ Notifications:', notificationsResponse.data);
        console.log('');

        // Test 8: Delete monitor (cleanup)
        console.log('8. Testing Delete Monitor (cleanup)...');
        const deleteResponse = await api.delete(`/api/v1/monitors/${monitorId}`);
        console.log('✅ Deleted Monitor:', deleteResponse.data);
        console.log('');

        console.log('🎉 All API tests passed successfully!');

    } catch (error) {
        console.error('❌ API Test Failed:');
        if (error.response) {
            console.error('Status:', error.response.status);
            console.error('Data:', error.response.data);
        } else {
            console.error('Error:', error.message);
        }
        
        // Common error solutions
        console.log('\n🔧 Troubleshooting:');
        if (error.response?.status === 401) {
            console.log('- Make sure you have a valid JWT token');
            console.log('- Check if the token is properly set in the TOKEN variable');
            console.log('- Verify that authentication is not disabled in Uptime Kuma');
        } else if (error.code === 'ECONNREFUSED') {
            console.log('- Make sure Uptime Kuma is running');
            console.log('- Check if BASE_URL is correct');
        }
    }
}

async function demonstratePushAPI() {
    console.log('\n📡 Testing Push API (No authentication required)...');
    
    try {
        // Note: You need a push monitor set up in Uptime Kuma to test this
        // Get the push token from the monitor settings
        const PUSH_TOKEN = 'YOUR_PUSH_TOKEN_HERE'; // Replace with actual push token
        
        if (PUSH_TOKEN === 'YOUR_PUSH_TOKEN_HERE') {
            console.log('⚠️  Push API test skipped - Please set up a push monitor and update PUSH_TOKEN');
            return;
        }

        const pushResponse = await axios.get(`${BASE_URL}/api/push/${PUSH_TOKEN}?status=up&msg=API Test&ping=100`);
        console.log('✅ Push API Response:', pushResponse.data);
    } catch (error) {
        console.log('❌ Push API test failed:', error.response?.data || error.message);
    }
}

async function demonstrateBadgeAPI() {
    console.log('\n🏷️  Testing Badge API (No authentication required)...');
    
    try {
        // Note: Replace with actual monitor ID
        const MONITOR_ID = 1; // Update this with a real monitor ID
        
        console.log(`Badge URLs for monitor ${MONITOR_ID}:`);
        console.log(`- Status: ${BASE_URL}/api/badge/${MONITOR_ID}/status`);
        console.log(`- Uptime: ${BASE_URL}/api/badge/${MONITOR_ID}/uptime/24h`);
        console.log(`- Response: ${BASE_URL}/api/badge/${MONITOR_ID}/response`);
        console.log(`- Ping: ${BASE_URL}/api/badge/${MONITOR_ID}/ping/24h`);
        
        // Test status badge
        const badgeResponse = await axios.get(`${BASE_URL}/api/badge/${MONITOR_ID}/status`);
        console.log('✅ Badge API working (returns SVG)');
    } catch (error) {
        console.log('❌ Badge API test failed:', error.response?.status || error.message);
    }
}

// Show usage information
if (TOKEN === 'YOUR_JWT_TOKEN_HERE') {
    console.log('⚠️  Please update the configuration before running tests:');
    console.log('1. Set BASE_URL to your Uptime Kuma URL');
    console.log('2. Get a JWT token by logging into Uptime Kuma and checking browser DevTools');
    console.log('3. Set TOKEN variable with your JWT token');
    console.log('4. Run: node test-api.js\n');
}

// Run all tests
testAPI()
    .then(() => demonstratePushAPI())
    .then(() => demonstrateBadgeAPI())
    .catch(console.error); 