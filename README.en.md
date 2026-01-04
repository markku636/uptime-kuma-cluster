# Uptime Kuma Cluster

<div align="center">

![OpenResty](https://img.shields.io/badge/OpenResty-Nginx-green?style=flat-square)
![Lua](https://img.shields.io/badge/Lua-5.1-blue?style=flat-square)
![MariaDB](https://img.shields.io/badge/MariaDB-10.x-orange?style=flat-square)
![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?style=flat-square)

**High-Availability Uptime Kuma Cluster Solution**

📖 [Blog Post (Architecture & Implementation)](https://blog.markkulab.net/implement-uptime-kuma-cluster-vibe-coding/)

🌐 [中文版 Chinese Version](README.md)

</div>

---

## 🆚 Differences from Original Uptime Kuma

| Feature | Original Uptime Kuma | Uptime Kuma Cluster (This Project) |
|:---|:---|:---|
| **Architecture** | Single node | Multi-node HA cluster |
| **Database** | SQLite (local file) | MariaDB (shared database) |
| **Load Balancing** | ❌ None | ✅ OpenResty + Lua smart routing |
| **Failover** | ❌ Service interruption when node fails | ✅ Auto-detect and migrate monitors |
| **Horizontal Scaling** | ❌ Cannot scale | ✅ Dynamic node addition/removal |
| **K8s Auto-Scaling** | ❌ None | ✅ HPA auto-scaling (CPU/Memory) |
| **Monitor Distribution** | Single machine handles all monitors | Auto-distribute to least busy node |
| **Node Health Check** | ❌ None | ✅ Periodic check, auto-mark anomalies |
| **Development/Debug** | Direct connection | ✅ Fixed node routing (Cookie) |
| **RESTful API** | ❌ No cluster management API | ✅ Programmatic monitor creation & management |

> 💡 **In short**: Original Uptime Kuma is "standalone", this project transforms it into a "cluster version", solving single point of failure issues, suitable for production environments requiring high availability.

---

## 📋 Table of Contents

<a id="toc"></a>

| Section | Description |
|:---|:---|
| [🎯 Overview](#-overview) | Project introduction and core features |
| [✨ Extended Features](#-extended-features) | New features compared to original Uptime Kuma |
| [🚀 Quick Start](#-quick-start) | Start cluster in 5 minutes |
| [📘 Usage Guide](#-usage-guide) | Feature introduction from user perspective |
| [🎯 Fixed Node Routing](#-fixed-node-routing) | Node locking for development/debugging |
| [🌐 API Endpoints](#-api-endpoints) | Complete RESTful API list |
| [🏗️ Architecture](#️-architecture) | System architecture and flow diagrams |
| [🔧 Module Description](#-module-description) | Detailed Lua module explanation |
| [⚙️ Configuration](#️-configuration) | Environment variables and config files |
| [🚀 Deployment Guide](#-deployment-guide) | Production deployment steps |
| [☸️ K8s Deployment & Auto-Scaling](#️-kubernetes-deployment--auto-scaling) | Kubernetes HPA auto-scaling |
| [📦 Directory Structure](#-directory-structure) | Project file descriptions |
| [❓ FAQ](#-faq) | Troubleshooting |

---

## 🎯 Overview
### System Logic Architecture
**Core Value**: Original Uptime Kuma is single-node architecture. This project implements **multi-node high availability** through OpenResty + Lua, automatically migrating monitor tasks when a node fails.
```mermaid
graph TD
    Client[Client Request] --> Nginx[Nginx OpenResty<br>Load Balancer]
    
    subgraph "Nginx Logic (Lua)"
        LB[Load Balancer]
        HC[Health Check & Failover]
    end
    
    Nginx --> LB
    Nginx --> HC
    
    LB -->|Route to Best Node| Node1
    LB -->|Route to Best Node| Node2
    LB -->|Route to Best Node| Node3
    
    HC -.->|Monitor| Node1[Uptime Kuma Node 1<br>:3001]
    HC -.->|Monitor| Node2[Uptime Kuma Node 2<br>:3002]
    HC -.->|Monitor| Node3[Uptime Kuma Node 3<br>:3003]
    
    Node1 --> DB[(MariaDB Database)]
    Node2 --> DB
    Node3 --> DB
```

---

This project is an intelligent load balancing and health check system based on **Nginx OpenResty**, designed for multi-node cluster deployment of **Uptime Kuma**. The system implements application-level logic through Lua scripts, featuring automatic fault detection, failover, intelligent load distribution, and monitor task rebalancing to ensure high availability (HA) of monitoring services.

---

## ✨ Extended Features

This project provides the following additional features on top of native Uptime Kuma:

- **Multi-node HA cluster**: One OpenResty load balancer with multiple Uptime Kuma nodes sharing a MariaDB database.
- **Two-phase smart load balancing**: Picks the best node based on current monitor count and node status using a two-phase Lua routing design.
- **Automatic failover & monitor migration**: Automatically redistributes monitors from failed nodes to healthy ones and restores them when the node recovers.
- **Fixed-node routing (pin to a node)**: Allows routing all traffic to a specific node via Cookie for development, load testing, or debugging.
- **Observability REST APIs**: Exposes cluster status and operations through JSON APIs for scripting and integration.
- **One-command Docker Compose deployment**: Ships with a ready-to-use `docker-compose-cluster.yaml` and OpenResty configuration to spin up the whole cluster quickly.

---

## 🚀 Quick Start

> 📝 **Start the entire HA cluster in 5 minutes!**

### 📋 Prerequisites

| Requirement | Version | Note |
|:---|:---|:---|
| Docker Desktop | Latest | Includes `docker compose` command |
| Node.js | 18+ | Required for single-node development mode |
| PowerShell | 5.1+ | Windows default is fine |

### 🔧 Step 1: Start Cluster

```powershell
# Run in project root
docker compose -f docker-compose-cluster.yaml up -d --build

# Check container status
docker ps
```

> 💡 **Tip**: With Docker Desktop installed, just use `docker compose` command directly.

### 🖥️ Step 2: Single Node Development

```powershell
# Backend (Node.js)
node start-server.js

# Frontend (Vite)
npm run dev
```

### ✅ Step 3: Verify Installation

Open `set-up.http` with VS Code REST Client to test:

```http
GET http://localhost:8084/lb/ping               # LB alive check
GET http://localhost:8084/lb/health             # Cluster health
GET http://localhost:8084/lb/available-nodes    # Available nodes
```

**Expected Results**:
- ✅ `/lb/ping` returns `pong`
- ✅ `/lb/health` returns node health status JSON
- ✅ `/lb/available-nodes` lists all available nodes

[⬆️ Back to Contents](#toc)

---

## 📘 Usage Guide

> 💡 **This section covers the most commonly used features from a user's perspective**

### 📑 Section Navigation

| # | Feature | Description |
|:---|:---|:---|
| 0️⃣ | [Start Cluster](#0️⃣-start-cluster) | One-command Docker Compose startup |
| 1️⃣ | [Load Balancing](#1️⃣-load-balancing) | How requests are distributed to nodes |
| 2️⃣ | [Fixed Node Routing](#2️⃣-fixed-node-routing) | How to pin traffic during development |
| 3️⃣ | [RESTful API](#3️⃣-using-restful-api) | Common JSON APIs |
| 4️⃣ | [.http Testing](#4️⃣-vs-code-http-tests) | One-click testing with VS Code |
| 5️⃣ | [Failover](#5️⃣-failover--recovery) | Auto migration when node fails |

### 0️⃣ Start Cluster

Use Docker Compose to start the entire HA cluster with one command:

```powershell
# Run in project root
docker compose -f docker-compose-cluster.yaml up -d --build
```

This will start the following services:

| Service | Port | Description |
|:---|:---|:---|
| `openresty` | 8084 | Load balancer entry point (external) |
| `uptime-kuma-node1` | 3001 | Uptime Kuma Node 1 |
| `uptime-kuma-node2` | 3002 | Uptime Kuma Node 2 |
| `uptime-kuma-node3` | 3003 | Uptime Kuma Node 3 |
| `mariadb` | 3306 | Shared database |

```powershell
# Check container status
docker ps

# View real-time logs
docker compose -f docker-compose-cluster.yaml logs -f

# Stop cluster
docker compose -f docker-compose-cluster.yaml down
```

> 💡 **Tip**: First startup requires waiting for MariaDB initialization (about 30 seconds). After that, visit `http://localhost:8084` to use the system.

### 1️⃣ Load Balancing

- All requests entering OpenResty go through Lua **two-phase routing**:
  - Access phase: Query DB, calculate current monitor count per node, select the least busy node.
  - Balancer phase: Set this node's IP:Port as the actual upstream target.
- Quick check of current overall status:

```bash
curl http://localhost:8084/lb/health            # Cluster health overview
curl http://localhost:8084/lb/available-nodes   # Each node's status and monitor count
curl http://localhost:8084/lb/load-balancer-status
```

> For more implementation details, see "🏗️ Architecture" and "🔧 Module Description" sections below.

### 2️⃣ Fixed Node Routing

During development, load testing, or debugging, you often need to "hit only one node". Use fixed node routing:

```bash
# Pin traffic to node1 (can open directly in browser)
http://localhost:8084/lb/fixed-node/node1

# Check current fixed node status
curl http://localhost:8084/lb/fixed-node-status

# Clear setting, restore normal load balancing
http://localhost:8084/lb/clear-fixed-node
```

- This mechanism is implemented via Cookie `KUMA_FIXED_NODE`.
- When the specified node goes offline, the system automatically clears the Cookie and restores load balancing.
- See "🎯 Fixed Node Routing" section below for complete documentation and API list.

### 3️⃣ Using RESTful API

OpenResty provides a set of JSON APIs (unified under `/lb/` path) for scripting or system integration:

```bash
# Comprehensive system status (recommended first look)
curl http://localhost:8084/lb/system-status

# View each Uptime Kuma node's current status
curl http://localhost:8084/lb/node-status

# Manually trigger rebalancing
curl http://localhost:8084/lb/trigger-rebalancing
```

- For complete routes and descriptions, see "🌐 API Endpoints" section below.
- For detailed field and response formats, see `API_DOCUMENTATION.md`.

### 4️⃣ VS Code HTTP Tests

The project root provides several `.http` files for one-click testing with VS Code REST Client:

- `set-up.http`: Basic health checks after startup (health, cluster health, available nodes).
- `check-monitors.http`: Sample API calls for querying and operating monitors.

Usage:

1. Open `.http` file in VS Code.
2. Install/enable "REST Client" extension.
3. Click `Send Request` above each section to send.

### 5️⃣ Failover & Recovery

When an Uptime Kuma node fails, the system automatically detects and performs "monitor task migration":

- **Active Health Check**: Calls each node's `/api/v1/health` every 30 seconds.
- **Failure Detection**: After consecutive failed checks, marks the node as `offline`.
- **Automatic Failover**: Via `redistribute_monitors_from_node()`, evenly distributes that node's monitors to other healthy nodes.
- **Node Recovery**: After node returns `online`, `revert_monitors_to_node()` gradually restores previously moved monitors.

Related implementation is mainly in `lua/health_check.lua`. You can also observe current health check and rebalancing status via:

```bash
curl http://localhost:8084/lb/health-status
curl http://localhost:8084/lb/rebalancing-status
```

---

## 🎯 Fixed Node Routing

This feature allows developers to route all requests to a specific node via Cookie for debugging and testing. Clearing the Cookie restores normal load balancing.

### 🔗 Simple URL Operations

The easiest way: visit the following URLs directly in your browser:

| Action | URL | Description |
| :--- | :--- | :--- |
| Set to node1 | `GET /lb/fixed-node/node1` | Route all requests to node1 |
| Set to node2 | `GET /lb/fixed-node/node2` | Route all requests to node2 |
| Set to node3 | `GET /lb/fixed-node/node3` | Route all requests to node3 |
| **Clear setting** | `GET /lb/clear-fixed-node` | Restore load balancing |

### 📝 Usage Example

```bash
# 1. View available nodes
curl http://localhost:8084/lb/available-nodes

# 2. Set fixed node (visit in browser)
# http://localhost:8084/lb/fixed-node/node2

# 3. Verify setting
curl http://localhost:8084/lb/fixed-node-status

# 4. Clear setting (visit in browser)
# http://localhost:8084/lb/clear-fixed-node
```

### 🔧 API Operations

For programmatic operations, use JSON API:

```bash
# Set fixed node
curl -X POST http://localhost:8084/lb/set-fixed-node \
  -H "Content-Type: application/json" \
  -d '{"node": "node2", "expires": 604800}'

# Clear fixed node
curl -X POST http://localhost:8084/lb/clear-fixed-node

# View status
curl http://localhost:8084/lb/fixed-node-status
```

### 📊 Response Headers

After setting a fixed node, all responses will include these headers:

| Header | Value | Description |
| :--- | :--- | :--- |
| `X-Routed-Via` | `fixed-node` or `load-balancer` | Routing method |
| `X-Routed-To` | `uptime-kuma-node2` | Actual routed node |

### ⚠️ Notes

- Cookie name: `KUMA_FIXED_NODE`
- Default expiry: 7 days (customizable via API)
- If the specified node goes offline, the system will automatically clear the Cookie and restore load balancing
- This feature is mainly for development debugging, use cautiously in production
- Check node status: visit `/lb/available-nodes`
- Clear setting: visit `/lb/clear-fixed-node`

---

You can also switch nodes via Web UI by clicking the current node:
<img width="2560" height="1380" alt="image" src="https://github.com/user-attachments/assets/7e08ce75-1321-4c7b-84c6-27e20bceb9a6" />


## 🌐 API Endpoints

OpenResty provides a series of HTTP APIs for monitoring status and managing the cluster.

### 🔍 Status Monitoring

| Method | Path | Description |
| :--- | :--- | :--- |
| `GET` | `/lb/ping` | Quick check if Nginx load balancer is alive |
| `GET` | `/lb/health` | Returns cluster node health status (from DB query) |
| `GET` | `/lb/health-status` | View heartbeat statistics, failover history |
| `GET` | `/lb/capacity` | Returns monitor count and capacity per node |
| `GET` | `/lb/system-status` | **Recommended**: Returns comprehensive status from all modules |
| `GET` | `/lb/node-status` | Returns detailed status of all backend nodes (Online/Offline/Recovering) |
| `GET` | `/lb/load-balancer-status` | View node load scores, last update time |
| `GET` | `/lb/fault-detection-status` | View fault detection scanner statistics |

### 🎯 Fixed Node Routing API

| Method | Path | Description |
| :--- | :--- | :--- |
| `GET` | `/lb/fixed-node/{node}` | Set fixed node (HTML page) |
| `GET` | `/lb/clear-fixed-node` | Clear fixed node (HTML page) |
| `POST` | `/lb/set-fixed-node` | Set fixed node (JSON API) |
| `POST` | `/lb/clear-fixed-node` | Clear fixed node (JSON API) |
| `GET` | `/lb/fixed-node-status` | View current fixed node status |
| `GET` | `/lb/available-nodes` | List all available nodes |

### ⚙️ Management & Operations

| Method | Path | Description |
| :--- | :--- | :--- |
| `POST` | `/lb/trigger-health-check` | Manually trigger health check |
| `GET` | `/lb/update-loads` | Manually force update load info |
| `GET` | `/lb/trigger-rebalancing` | Manually trigger monitor rebalancing |
| `GET` | `/lb/force-rebalance-all` | **Dangerous**: Force redistribute all monitors |
| `GET` | `/lb/rebalancing-status` | View current rebalancing progress and statistics |
| `GET` | `/lb/debug-config` | View health check debug settings |
| `GET` | `/lb/debug-logs` | View OpenResty debug logs |

---

## 🏗️ Architecture

### Load Balancing Decision Flow

(Two-Phase Lua Routing Architecture)

Due to API limitations in OpenResty's `balancer_by_lua*` phase (cannot use `ngx.socket.tcp()` and other cosocket APIs), the system uses a **two-phase architecture** to implement dynamic routing:

```mermaid
sequenceDiagram
    participant Client
    participant Nginx
    participant Access[access_by_lua]
    participant Balancer[balancer_by_lua]
    participant DNS[Docker DNS]
    participant DB[(MariaDB)]
    participant Node[Uptime Kuma Node]

    Client->>Nginx: HTTP Request
    Nginx->>Access: Enter access phase
    Access->>DB: Query node table for online nodes
    DB-->>Access: Return node list and loads
    Access->>Access: Select least busy node (uptime-kuma-nodeX)
    Access->>DNS: Resolve hostname to IP
    DNS-->>Access: Return IP address
    Access->>Access: Store IP:Port to ngx.ctx
    Access-->>Nginx: Pre-selection complete
    Nginx->>Balancer: Enter balancer phase
    Balancer->>Balancer: Read pre-selected IP:Port from ngx.ctx
    Balancer->>Node: set_current_peer(IP, Port)
    Node-->>Client: HTTP Response
```

#### Phase Description

| Phase | Nginx Directive | Available APIs | Responsibility |
|:---|:---|:---|:---|
| **Access Phase** | `access_by_lua_block` | ✅ Socket, MySQL, DNS resolution | Query DB to select node, resolve DNS to IP, store in `ngx.ctx` |
| **Balancer Phase** | `balancer_by_lua_block` | ❌ Only `ngx.balancer` API | Read pre-selected result from `ngx.ctx`, call `set_current_peer()` |

#### Detailed Flow

1. **Request arrives**: Nginx `location` receives request.
2. **Access Phase - Pre-select node**: `access_by_lua_block` calls `router.preselect_node()`:
   - Query database `node` and `monitor` tables via `pick_node_for_request()`
   - Count active monitors (`active = 1`) for each `status = 'online'` node
   - Select the online node with "least monitors", map to Docker service name `uptime-kuma-nodeX`
   - Use `resty.dns.resolver` to resolve hostname to IP address
   - Store IP and Port in `ngx.ctx.upstream_host` and `ngx.ctx.upstream_port`
3. **Balancer Phase - Set target**: `balancer_by_lua_block` calls `router.get_preselected_node()`:
   - Read pre-selected IP and Port from `ngx.ctx`
   - Set actual upstream node via `ngx.balancer.set_current_peer(ip, port)`
4. **Backend processing**: Request is forwarded to selected Uptime Kuma node and response completes.

#### Why Two Phases?

OpenResty's `balancer_by_lua*` phase runs during Nginx's connection establishment, when these APIs are disabled:
- `ngx.socket.tcp()` - Cannot establish TCP connections (including MySQL connections)
- `ngx.socket.udp()` - Cannot perform UDP communication
- DNS resolution (depends on socket)

Therefore, all operations requiring network I/O (database queries, DNS resolution) must complete in `access_by_lua*` phase, passing results via `ngx.ctx` (request-level context) to `balancer_by_lua*` phase.

---

## 🔧 Module Description

After refactoring, core logic consists of the following 6 Lua modules:

### Module Architecture

```
lua/
├── config.lua         # Centralized config management (env vars, defaults)
├── db.lua             # Shared database connection module
├── logger.lua         # Shared logging module (unified format, categories)
├── middleware.lua     # Middleware (unified access/header_filter handling)
├── health_check.lua   # Health check and node management
└── monitor_router.lua # Routing decision logic
```

### 1. config.lua - Centralized Config Management

All environment variables and defaults managed centrally, avoiding hardcoding:

```lua
local config = require "config"

-- Database config
config.database.host      -- DB_HOST
config.database.port      -- DB_PORT
config.database.user      -- DB_USER
config.database.password  -- DB_PASSWORD
config.database.database  -- DB_NAME

-- Cluster config
config.cluster.node_count              -- CLUSTER_NODE_COUNT (default: 3)
config.cluster.monitor_limit_per_node  -- MONITOR_LIMIT_PER_NODE (default: 1000)

-- Health check config
config.health_check.interval  -- HEALTH_CHECK_INTERVAL (default: 30s)
config.health_check.timeout   -- HEALTH_CHECK_TIMEOUT (default: 5000ms)
```

### 2. db.lua - Shared Database Module

Unified database connection logic, eliminating duplicate code:

```lua
local db = require "db"

-- Create connection
local conn, err = db.connect()

-- Execute query with auto-close
local res, err = db.query("SELECT * FROM node")
```

### 3. logger.lua - Shared Logging Module

Unified log format and categories:

```lua
local logger = require "logger"

-- Categorized logging
logger.health_check("Node 1 is online")
logger.database("Query executed: %s", sql)
logger.router("Selected node: %s", node_id)
logger.debug("CATEGORY", "Debug info: %s", data)
```

### 4. middleware.lua - Middleware Module

Unified handling of access and header_filter phases, reducing nginx.conf duplication:

```lua
local middleware = require "middleware"

-- Access phase: Pre-select node
middleware.preselect_node()

-- Header Filter phase: Add routing headers
middleware.add_routing_headers()
```

### 5. monitor_router.lua - Routing Decision Logic

Responsible for selecting which Uptime Kuma node to forward requests to.

#### Why "Two Phases"?

Because OpenResty's `balancer_by_lua` phase **prohibits network connections**:

```
┌─────────────────┐      ┌──────────────────┐
│  Access Phase   │ ──▶  │  Balancer Phase  │
│  (can query DB) │      │  (can only set   │
├─────────────────┤      │   target)        │
│ 1. Query DB     │      ├──────────────────┤
│ 2. DNS resolve  │      │ Read ngx.ctx     │
│ 3. Store ngx.ctx│      │ Set IP:Port      │
└─────────────────┘      └──────────────────┘
```

#### Main Functions

| Function | Purpose |
|:---|:---|
| `preselect_node()` | [Access Phase] Query DB to select node → DNS resolve → Store in `ngx.ctx` |
| `get_preselected_node()` | [Balancer Phase] Read IP:Port from `ngx.ctx` |
| `pick_node_for_request()` | Query least busy online node |
| `resolve_host()` | Resolve Docker service name to IP |
| `get_cluster_status()` | Get cluster status |
| `get_node_capacity()` | Get node capacity |

### 6. health_check.lua - Health Check Module

Responsible for maintaining cluster stability and fault handling.

#### Core Responsibilities

- **Node Health Check**: Periodically issue HTTP checks to each node's `/api/v1/health`
- **Fault Detection & Failover**: When node fails consecutive checks, mark as `offline` and redistribute monitor tasks
- **Node Recovery**: After node recovers, restore previously transferred monitor tasks

#### Key Functions

| Function | Purpose |
|:---|:---|
| `run_health_check()` | Execute single health check cycle |
| `health_check_worker()` | Periodic health check background worker |
| `redistribute_monitors_from_node()` | Failover: Redistribute monitor tasks |
| `revert_monitors_to_node()` | Node recovery: Restore monitor tasks |
| `get_all_nodes()` | Query all node statuses |
| `update_node_status()` | Update node status to database |

---

## ⚙️ Configuration

### 1. Environment Variables

Ensure the Nginx runtime environment includes these variables (recommended in `nginx.conf` or Docker `env`):

```bash
# Database config (for Lua connecting to MariaDB)
DB_HOST=mariadb
DB_PORT=3306
DB_USER=kuma
DB_PASSWORD=kuma_pass
DB_NAME=kuma

# Local node identifier
UPTIME_KUMA_NODE_ID=nginx-node
UPTIME_KUMA_NODE_HOST=127.0.0.1
```

### 2. Nginx Shared Memory

Define Lua shared dictionaries in `nginx.conf`'s `http` block (excerpt):

```nginx
http {
    # ...

    # Shared memory zones
    lua_shared_dict health_checker 10m;   # Store health check results and stats
    lua_shared_dict monitor_routing 10m;  # Monitor ID -> node routing cache
    lua_shared_dict node_capacity 1m;     # (Reserved) Node capacity info cache

    # ...
}
```

### 3. Timers

Default timer intervals in Lua scripts:

| Task | Interval |
| :--- | :--- |
| Load Update | `30s` |
| Fault Scan | `10s` |
| Heartbeat | `60s` |
| Failover Check | `60s` |

---

## 🚀 Deployment Guide

### Prerequisites

- **Nginx OpenResty** (Recommended version 1.19+)
- **MariaDB/MySQL** (Data storage for Uptime Kuma)
- **Uptime Kuma** (Configured for multi-node mode)

### Step 1: Deploy Lua Scripts

Copy all modules from `lua` folder to OpenResty's library directory:

```bash
cp lua/*.lua /usr/local/openresty/lualib/
# Or copy individually
cp lua/config.lua /usr/local/openresty/lualib/
cp lua/db.lua /usr/local/openresty/lualib/
cp lua/logger.lua /usr/local/openresty/lualib/
cp lua/middleware.lua /usr/local/openresty/lualib/
cp lua/monitor_router.lua /usr/local/openresty/lualib/
cp lua/health_check.lua /usr/local/openresty/lualib/
```

### Step 2: Configure Nginx

Copy and modify `nginx.conf`:

```bash
cp nginx/nginx.conf /usr/local/openresty/nginx/conf/
```

Ensure `upstream` block correctly points to your Uptime Kuma nodes:

```nginx
upstream uptime_kuma_backend {
    zone uptime_kuma_backend 64k;
    ip_hash; # As baseline, Lua will override this decision
    
    server uptime-kuma-node1:3001 max_fails=3 fail_timeout=30s;
    server uptime-kuma-node2:3002 max_fails=3 fail_timeout=30s;
    server uptime-kuma-node3:3003 max_fails=3 fail_timeout=30s;
    
    keepalive 32;
}
```

### Step 3: Start Services

```bash
# Check config syntax
nginx -t

# Start or reload Nginx
nginx -s reload

# Verify system status
curl http://localhost/api/system-status
```

---

## ☸️ Kubernetes Deployment & Auto-Scaling

This project supports Kubernetes deployment with **HorizontalPodAutoscaler (HPA)** auto-scaling capability.

### K8s Auto-Scaling Architecture

```
                    ┌─────────────────────────────────────┐
                    │     HorizontalPodAutoscaler         │
                    │   (CPU > 70% or Memory > 80%)       │
                    └──────────────┬──────────────────────┘
                                   │ scale up/down
                                   ▼
┌──────────────────────────────────────────────────────────────────┐
│                     StatefulSet: uptime-kuma                      │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐          │
│  │ kuma-0   │  │ kuma-1   │  │ kuma-2   │  │ kuma-N   │  ...     │
│  │ (Primary)│  │          │  │          │  │(Dynamically│         │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └──Added)───┘          │
│       │             │             │             │                 │
│       └─────────────┴──────┬──────┴─────────────┘                 │
│                            │                                      │
│              ┌─────────────┼─────────────┐                        │
│              │  NodeLifecycleManager     │                        │
│              │  • Heartbeat (30s)        │                        │
│              │  • Offline Detection (90s)│                        │
│              │  • Auto Monitor Reassign  │                        │
│              └─────────────┬─────────────┘                        │
│                            ▼                                      │
│                    ┌───────────────┐                              │
│                    │   MariaDB     │                              │
│                    │(Node Registry)│                              │
│                    └───────────────┘                              │
└──────────────────────────────────────────────────────────────────┘
```

### How Auto-Scaling Works

| Phase | Description |
|:---|:---|
| **Scale Up** | When CPU > 70% or Memory > 80%, HPA automatically adds Pods |
| **Node Registration** | New Pod registers to database via `initializeFromEnv()` on startup |
| **Dynamic Discovery** | OpenResty's `dynamic_upstream.lua` discovers new nodes from DB every 10s |
| **Traffic Routing** | New node immediately joins load balancing and starts receiving requests |
| **Scale Down** | When load decreases, HPA removes Pods, `NodeLifecycleManager` detects offline and reassigns Monitors |

### K8s Deployment Methods

**Method 1: Using Kustomize**
```bash
cd k8s
kubectl apply -k .
```

**Method 2: Using Helm Chart**
```bash
# Deploy Secret and ConfigMap first
kubectl apply -f k8s-deployment-files/secrets/secret.yaml
kubectl apply -f k8s-deployment-files/configmaps/configmap.yaml

# Deploy Helm Chart
helm install uptime-kuma ./k8s-deployment-files/uptime-kuma -n uptime-kuma
```

### HPA Configuration

```yaml
# k8s/uptime-kuma/hpa.yaml
spec:
  minReplicas: 2          # Minimum replicas
  maxReplicas: 10         # Maximum replicas
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          averageUtilization: 70   # CPU threshold
    - type: Resource
      resource:
        name: memory
        target:
          averageUtilization: 80   # Memory threshold
  behavior:
    scaleDown:
      stabilizationWindowSeconds: 300  # 5 min stabilization for scale down
    scaleUp:
      stabilizationWindowSeconds: 60   # 1 min stabilization for scale up
```

### Key Files

| File | Description |
|:---|:---|
| `k8s/uptime-kuma/hpa.yaml` | HorizontalPodAutoscaler configuration |
| `k8s/uptime-kuma/pdb.yaml` | PodDisruptionBudget (ensures at least 1 Pod available) |
| `server/util/node-lifecycle.js` | Node lifecycle management (heartbeat, cleanup, reassign) |
| `lua/dynamic_upstream.lua` | Dynamic node discovery module |
| `server/util/cluster-env.js` | K8s/Docker Compose environment detection |

### Manual Scaling

```bash
# Manually scale to 5 nodes
kubectl scale statefulset uptime-kuma -n uptime-kuma --replicas=5

# Check HPA status
kubectl get hpa -n uptime-kuma

# Watch node status
kubectl get pods -n uptime-kuma -w
```

---

## 🧪 Testing & Tools

- **OpenResty / API Testing**: Use `set-up.http` file for testing
- Supported tools: VS Code REST Client, IntelliJ HTTP Client, Thunder Client

## 📊 Monitoring & Maintenance

To ensure production stability, monitor the following:

1. **Log Monitoring**:
   - `/usr/local/openresty/nginx/logs/error.log`: Monitor for Lua script errors or database connection errors

2. **API Inspection**:
   - Regularly call `/api/node-status` to ensure no nodes are stuck in `recovering` status

3. **Troubleshooting**:
   - 🔍 **Database Connection**: Ensure DB account permissions are correct
   - 🔍 **Network Latency**: If heartbeats frequently timeout, consider increasing `timeout` setting

---

## 🔒 Security Considerations

- **API Access Control**: Recommend restricting `/api/` path access via `allow/deny` directives
- **Database Credentials**: Avoid hardcoding passwords, always use `os.getenv` to read environment variables
- **Fixed Node Feature**: This feature is mainly for development debugging, use cautiously in production

---

## 📦 Directory Structure

| Directory/File | Description |
| :--- | :--- |
| `docker-compose-cluster.yaml` | Compose file for multi-node Uptime Kuma + OpenResty |
| `nginx/`, `nginx.conf` | OpenResty/Nginx main config and site settings |
| `lua/` | Load balancing and health check Lua scripts |
| `server/` | Kuma server-side logic (auth, scheduling, notifications, etc.) |
| `db/` | Database initialization and migration scripts (Knex) |
| `extra/` | Utility tools and scripts |
| `public/`, `src/` | Frontend resources and code |
| `API_DOCUMENTATION.md` | Detailed HTTP API documentation and examples |

---

## ❓ FAQ

- **API returns 502 / 504**:
  - Check `nginx/logs/error.log` for Lua or database connection errors
  - Verify `DB_*` environment variables are set correctly

- **Node repeatedly recovering/offline (Flapping)**:
  - Adjust health check interval or timeout; check network latency and node load

- **Uneven monitor distribution**:
  - Use `/api/trigger-rebalancing` or `/api/force-rebalance-all` for rebalancing

- **Fixed node not working**:
  - Check if node is online: visit `/lb/available-nodes`
  - Clear Cookie: visit `/lb/clear-fixed-node`

[⬆️ Back to Contents](#toc)

---

## 📚 Related Documents

| Document | Description |
| :--- | :--- |
| `API_DOCUMENTATION.md` | Complete API specification and examples |
| `CLUSTER_DEPLOYMENT_GUIDE.md` | Cluster deployment and operation guide |
| `PUBLIC_STATUS_PAGINATION_PLAN.md` | Public status page pagination plan |
| `SECURITY.md` | Security guidelines |
| `CODE_OF_CONDUCT.md` | Code of conduct |
| `CONTRIBUTING.md` | Contributing guide |

---

## 📄 License

MIT License - see [LICENSE](LICENSE) file for details.
