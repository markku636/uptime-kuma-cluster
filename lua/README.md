# Lua 调试库使用说明

## 概述

`debug_helper.lua` 是一个可重用的Lua调试库，它封装了 emmy_core 调试器的常用功能，提供了简单易用的API接口。

## 文件结构

- `debug_helper.lua` - 主要的调试库文件
- `debug_example.lua` - 使用示例文件
- `README.md` - 本说明文档

## 基本用法

### 1. 引入调试库

```lua
local debug_helper = require("debug_helper")
```

### 2. 快速启动调试器

```lua
-- 使用默认配置启动调试器
local success = debug_helper.quick_debug()
```

### 3. 自定义配置启动调试器

```lua
-- 参数: host, port, wait_for_ide, set_breakpoint
local success = debug_helper.init_debugger("127.0.0.1", 9967, true, false)
```

## API 函数说明

### `init_debugger(host, port, wait_for_ide, set_breakpoint)`

初始化并启动调试器。

**参数:**
- `host` (string, 可选): 监听主机地址，默认为 "0.0.0.0"
- `port` (number, 可选): 监听端口，默认为 9966
- `wait_for_ide` (boolean, 可选): 是否等待IDE连接，默认为 true
- `set_breakpoint` (boolean, 可选): 是否设置断点，默认为 true

**返回值:**
- `boolean`: 调试器是否成功启动

### `quick_debug()`

使用默认配置快速启动调试器。

**返回值:**
- `boolean`: 调试器是否成功启动

### `set_debug_enabled(enabled)`

启用或禁用调试功能。

**参数:**
- `enabled` (boolean): 是否启用调试功能

### `set_debug_config(config)`

设置调试配置。

**参数:**
- `config` (table): 配置表，支持 host, port, enabled 字段

### `get_debug_config()`

获取当前调试配置。

**返回值:**
- `table`: 当前配置表

### `is_debugger_available()`

检查 emmy_core 模块是否可用。

**返回值:**
- `boolean`: 调试器模块是否可用

### `safe_debug(callback)`

安全执行调试回调函数，不会因为调试器不可用而报错。

**参数:**
- `callback` (function): 要执行的调试回调函数

**返回值:**
- `boolean`: 回调是否成功执行

## 配置选项

调试库支持以下配置选项：

```lua
local DEBUG_CONFIG = {
    host = "0.0.0.0",    -- 监听主机地址
    port = 9966,         -- 监听端口
    enabled = true       -- 是否启用调试功能
}
```

## 使用示例

### 基本调试

```lua
local debug_helper = require("debug_helper")

-- 启动调试器
if debug_helper.quick_debug() then
    print("调试器已启动")
else
    print("调试器启动失败")
end
```

### 条件调试

```lua
local debug_helper = require("debug_helper")

-- 只在开发环境中启用调试
if os.getenv("ENV") == "development" then
    debug_helper.quick_debug()
end
```

### 自定义端口

```lua
local debug_helper = require("debug_helper")

-- 使用自定义端口启动调试器
debug_helper.init_debugger("0.0.0.0", 9999, true, true)
```

### 安全调试

```lua
local debug_helper = require("debug_helper")

-- 安全地执行调试代码
debug_helper.safe_debug(function()
    -- 这里放置需要调试的代码
    print("调试代码执行中...")
end)
```

## 注意事项

1. **依赖要求**: 需要安装 emmy_core 模块才能使用调试功能
2. **错误处理**: 所有函数都使用 pcall 进行错误处理，不会因为调试器问题导致程序崩溃
3. **配置持久性**: 配置更改在当前会话中有效，重启后恢复默认值
4. **端口冲突**: 确保指定的端口没有被其他程序占用

## 故障排除

### 调试器无法启动

1. 检查 emmy_core 模块是否正确安装
2. 确认端口是否被占用
3. 检查防火墙设置

### IDE无法连接

1. 确认调试器监听的IP地址和端口
2. 检查网络连接
3. 验证IDE的调试配置

## 更新日志

- v1.0.0: 初始版本，包含基本调试功能
- 支持自定义配置
- 提供安全调试接口
- 完整的错误处理
