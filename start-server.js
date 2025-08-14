const { spawn } = require('child_process');
const path = require('path');

console.log('🚀 Starting Uptime Kuma Server...\n');

// 检查必要的依赖
try {
    require('swagger-jsdoc');
    require('swagger-ui-express');
    console.log('✅ Swagger dependencies found');
} catch (error) {
    console.log('❌ Missing Swagger dependencies:', error.message);
    console.log('   Please run: npm install swagger-jsdoc swagger-ui-express');
    process.exit(1);
}

// 启动服务器
const serverProcess = spawn('node', ['server/server.js'], {
    stdio: 'inherit',
    cwd: __dirname
});

// 等待服务器启动
setTimeout(() => {
    console.log('\n📋 Server should be running now. Testing endpoints...\n');
    
    // 运行测试脚本
    const testProcess = spawn('node', ['test-swagger.js'], {
        stdio: 'inherit',
        cwd: __dirname
    });
    
    testProcess.on('close', (code) => {
        console.log(`\n🧪 Test completed with code ${code}`);
        console.log('\n🔍 Manual testing:');
        console.log('   Swagger UI: http://localhost:3001/api-docs');
        console.log('   Swagger JSON: http://localhost:3001/api-docs.json');
        console.log('   API Status: http://localhost:3001/api/v1/status');
        console.log('   Frontend: http://localhost:3001/');
    });
    
}, 3000); // 等待 3 秒让服务器启动

// 处理进程退出
process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down...');
    serverProcess.kill('SIGINT');
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\n🛑 Shutting down...');
    serverProcess.kill('SIGTERM');
    process.exit(0);
});
