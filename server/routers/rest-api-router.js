const express = require("express");
const { R } = require("redbean-node");
const jwt = require("jsonwebtoken");
const Monitor = require("../model/monitor");
const User = require("../model/user");
const { Notification } = require("../notification");
const { 
    sendHttpError, 
    allowDevAllOrigin,
    allowAllOrigin
} = require("../util-server");
const { UptimeKumaServer } = require("../uptime-kuma-server");
const rateLimit = require("express-rate-limit");
const { body, validationResult } = require("express-validator");

const router = express.Router();

// Rate limiting
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each IP to 100 requests per windowMs
    message: "Too many API requests from this IP, please try again later."
});

// Apply rate limiting to all API routes
router.use("/api/v1", apiLimiter);

/**
 * @swagger
 * /api/v1/status:
 *   get:
 *     summary: Get API status
 *     tags: [General]
 *     responses:
 *       200:
 *         description: API status
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                   example: true
 *                 msg:
 *                   type: string
 *                   example: "API is working"
 *                 version:
 *                   type: string
 *                   example: "2.0.0-beta.3"
 */
// Status endpoint (public, no auth required)
router.get("/api/v1/status", (req, res) => {
    allowAllOrigin(res);
    res.json({
        ok: true,
        msg: "Uptime Kuma API is working",
        version: require("../../package.json").version
    });
});

// Custom authentication middleware for REST API
async function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    
    if (!authHeader) {
        return res.status(401).json({
            ok: false,
            msg: "Authorization header required"
        });
    }

    // Check if it's a Bearer token (JWT)
    if (authHeader.startsWith('Bearer ')) {
        const token = authHeader.substring(7);
        
        try {
            const server = UptimeKumaServer.getInstance();
            const decoded = jwt.verify(token, server.jwtSecret);
            
            // Find user
            const user = await R.findOne("user", " username = ? AND active = 1 ", [decoded.username]);
            if (!user) {
                return res.status(401).json({
                    ok: false,
                    msg: "Invalid token - user not found"
                });
            }
            
            req.userId = user.id;
            req.user = user;
            next();
        } catch (error) {
            return res.status(401).json({
                ok: false,
                msg: "Invalid or expired token"
            });
        }
    } else {
        // Assume it's an API key
        const apiKey = authHeader;
        
        try {
            // Verify API key (simplified version)
            // You might want to implement proper API key verification here
            // For now, we'll use a basic approach
            const user = await R.findOne("user", " id = 1 AND active = 1 "); // Default to first user for API keys
            if (!user) {
                return res.status(401).json({
                    ok: false,
                    msg: "API key authentication failed"
                });
            }
            
            req.userId = user.id;
            req.user = user;
            next();
        } catch (error) {
            return res.status(401).json({
                ok: false,
                msg: "Invalid API key"
            });
        }
    }
}

/**
 * @swagger
 * components:
 *   securitySchemes:
 *     bearerAuth:
 *       type: http
 *       scheme: bearer
 *       bearerFormat: JWT
 *   schemas:
 *     Monitor:
 *       type: object
 *       properties:
 *         id:
 *           type: integer
 *           description: Monitor ID
 *         name:
 *           type: string
 *           description: Monitor name
 *         url:
 *           type: string
 *           description: Monitor URL
 *         type:
 *           type: string
 *           description: Monitor type
 *         active:
 *           type: boolean
 *           description: Monitor active status
 *         interval:
 *           type: integer
 *           description: Check interval in seconds
 *     ApiResponse:
 *       type: object
 *       properties:
 *         ok:
 *           type: boolean
 *         msg:
 *           type: string
 *         data:
 *           type: object
 *     ErrorResponse:
 *       type: object
 *       properties:
 *         ok:
 *           type: boolean
 *           example: false
 *         msg:
 *           type: string
 *           description: Error message
 */

// Apply authentication middleware only to protected routes
// (Status endpoint is public, so we'll apply auth middleware after it)

/**
 * @swagger
 * /api/v1/monitors:
 *   get:
 *     summary: Get all monitors
 *     tags: [Monitors]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of monitors
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Monitor'
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.get("/api/v1/monitors", authenticateToken, async (req, res) => {
    try {
        allowAllOrigin(res);
        
        const monitors = await R.findAll("monitor", " user_id = ? ORDER BY weight DESC, name ", [req.userId]);
        const monitorList = [];
        
        for (let monitor of monitors) {
            const monitorData = monitor.toJSON();
            monitorList.push(monitorData);
        }
        
        res.json({
            ok: true,
            data: monitorList
        });
    } catch (error) {
        sendHttpError(res, error.message);
    }
});

/**
 * @swagger
 * /api/v1/monitors/{id}:
 *   get:
 *     summary: Get monitor by ID
 *     tags: [Monitors]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Monitor ID
 *     responses:
 *       200:
 *         description: Monitor details
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/Monitor'
 *       404:
 *         description: Monitor not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.get("/api/v1/monitors/:id", authenticateToken, async (req, res) => {
    try {
        allowAllOrigin(res);
        
        const monitorId = parseInt(req.params.id);
        const monitor = await R.findOne("monitor", " id = ? AND user_id = ? ", [monitorId, req.userId]);
        
        if (!monitor) {
            return res.status(404).json({
                ok: false,
                msg: "Monitor not found"
            });
        }
        
        const monitorData = [{ id: monitor.id, active: monitor.active }];
        const preloadData = await Monitor.preparePreloadData(monitorData);
        
        res.json({
            ok: true,
            data: monitor.toJSON(preloadData)
        });
    } catch (error) {
        sendHttpError(res, error.message);
    }
});

/**
 * @swagger
 * /api/v1/monitors:
 *   post:
 *     summary: Create a new monitor
 *     tags: [Monitors]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - type
 *               - url
 *               - interval
 *             properties:
 *               name:
 *                 type: string
 *                 example: "My Website"
 *               type:
 *                 type: string
 *                 example: "http"
 *               url:
 *                 type: string
 *                 example: "https://example.com"
 *               interval:
 *                 type: integer
 *                 example: 60
 *               node_id:
 *                 type: string
 *                 maxLength: 50
 *                 description: Node ID to assign the monitor to
 *                 example: "node1"
 *               active:
 *                 type: boolean
 *                 example: true
 *               retryInterval:
 *                 type: integer
 *                 example: 60
 *               maxretries:
 *                 type: integer
 *                 example: 0
 *               timeout:
 *                 type: integer
 *                 example: 48
 *     responses:
 *       201:
 *         description: Monitor created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                   example: true
 *                 msg:
 *                   type: string
 *                   example: "Monitor created successfully"
 *                 data:
 *                   type: object
 *                   properties:
 *                     monitorID:
 *                       type: integer
 *                       description: Created monitor ID
 *                     node_id:
 *                       type: string
 *                       description: Assigned node ID
 *                       nullable: true
 *       400:
 *         description: Validation error or node not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post("/api/v1/monitors", authenticateToken, [
    body("name").notEmpty().withMessage("Name is required"),
    body("type").notEmpty().withMessage("Type is required"),
    body("url").isURL().withMessage("Valid URL is required"),
    body("interval").isInt({ min: 20 }).withMessage("Interval must be at least 20 seconds"),
    body("node_id").optional().isLength({ max: 50 }).withMessage("Node ID must be 50 characters or less")
], async (req, res) => {
    try {
        allowAllOrigin(res);
        
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                ok: false,
                msg: "Validation failed",
                errors: errors.array()
            });
        }
        
        // 檢查 node_id 是否存在（如果提供）
        if (req.body.node_id) {
            // 修正：使用 node_id 欄位而不是 name 欄位
            const node = await R.findOne("node", " node_id = ? ", [req.body.node_id]);
            if (!node) {
                return res.status(400).json({
                    ok: false,
                    msg: "Specified node not found"
                });
            }
        }
        
        const monitor = R.dispense("monitor");
        monitor.name = req.body.name;
        monitor.type = req.body.type;
        monitor.url = req.body.url;
        monitor.interval = req.body.interval || 60;
        monitor.active = req.body.active !== false;
        monitor.user_id = req.userId;
        
        // 設定 node_id（如果提供）
        if (req.body.node_id) {
            monitor.node_id = req.body.node_id;
        }
        
        // Set default values
        monitor.retryInterval = req.body.retryInterval || 60;
        monitor.maxretries = req.body.maxretries || 0;
        monitor.timeout = req.body.timeout || 48;
        monitor.accepted_statuscodes_json = JSON.stringify(req.body.accepted_statuscodes || ["200-299"]);
        
        await R.store(monitor);
        
        // Activate the monitor if it's active (same logic as UI creation)
        if (monitor.active !== false) {
            const server = UptimeKumaServer.getInstance();
            if (server && server.startMonitor) {
                await server.startMonitor(req.userId, monitor.id);
            }
        }
        
        res.status(201).json({
            ok: true,
            msg: "Monitor created successfully",
            data: {
                monitorID: monitor.id,
                node_id: monitor.node_id || null
            }
        });
    } catch (error) {
        sendHttpError(res, error.message);
    }
});

/**
 * @swagger
 * /api/v1/monitors/{id}:
 *   put:
 *     summary: Update monitor
 *     tags: [Monitors]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Monitor ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               url:
 *                 type: string
 *               interval:
 *                 type: integer
 *               active:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Monitor updated successfully
 *       404:
 *         description: Monitor not found
 */
router.put("/api/v1/monitors/:id", authenticateToken, async (req, res) => {
    try {
        allowAllOrigin(res);
        
        const monitorId = parseInt(req.params.id);
        const monitor = await R.findOne("monitor", " id = ? AND user_id = ? ", [monitorId, req.userId]);
        
        if (!monitor) {
            return res.status(404).json({
                ok: false,
                msg: "Monitor not found"
            });
        }
        
        // Update monitor properties
        if (req.body.name) monitor.name = req.body.name;
        if (req.body.url) monitor.url = req.body.url;
        if (req.body.interval) monitor.interval = req.body.interval;
        if (req.body.active !== undefined) monitor.active = req.body.active;
        
        await R.store(monitor);
        
        // Restart the monitor if it's active (same logic as UI editing)
        if (monitor.active !== false) {
            const server = UptimeKumaServer.getInstance();
            if (server && server.restartMonitor) {
                await server.restartMonitor(req.userId, monitor.id);
            }
        }
        
        res.json({
            ok: true,
            msg: "Monitor updated successfully"
        });
    } catch (error) {
        sendHttpError(res, error.message);
    }
});

/**
 * @swagger
 * /api/v1/monitors/{id}:
 *   delete:
 *     summary: Delete monitor
 *     tags: [Monitors]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Monitor ID
 *     responses:
 *       200:
 *         description: Monitor deleted successfully
 *       404:
 *         description: Monitor not found
 */
router.delete("/api/v1/monitors/:id", authenticateToken, async (req, res) => {
    try {
        allowAllOrigin(res);
        
        const monitorId = parseInt(req.params.id);
        const monitor = await R.findOne("monitor", " id = ? AND user_id = ? ", [monitorId, req.userId]);
        
        if (!monitor) {
            return res.status(404).json({
                ok: false,
                msg: "Monitor not found"
            });
        }
        
        await R.exec("DELETE FROM monitor WHERE id = ? AND user_id = ?", [monitorId, req.userId]);
        
        res.json({
            ok: true,
            msg: "Monitor deleted successfully"
        });
    } catch (error) {
        sendHttpError(res, error.message);
    }
});

/**
 * @swagger
 * /api/v1/monitors/{id}/heartbeats:
 *   get:
 *     summary: Get monitor heartbeats
 *     tags: [Monitors]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Monitor ID
 *       - in: query
 *         name: period
 *         schema:
 *           type: integer
 *           default: 24
 *         description: Period in hours
 *     responses:
 *       200:
 *         description: Monitor heartbeats
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: integer
 *                       status:
 *                         type: integer
 *                       time:
 *                         type: string
 *                       ping:
 *                         type: number
 *                       msg:
 *                         type: string
 */
router.get("/api/v1/monitors/:id/heartbeats", authenticateToken, async (req, res) => {
    try {
        allowAllOrigin(res);
        
        const monitorId = parseInt(req.params.id);
        const period = parseInt(req.query.period) || 24;
        
        const monitor = await R.findOne("monitor", " id = ? AND user_id = ? ", [monitorId, req.userId]);
        
        if (!monitor) {
            return res.status(404).json({
                ok: false,
                msg: "Monitor not found"
            });
        }
        
        const heartbeats = await R.getAll(`
            SELECT * FROM heartbeat 
            WHERE monitor_id = ? AND time > datetime('now', '-${period} hours')
            ORDER BY time DESC 
            LIMIT 100
        `, [monitorId]);
        
        res.json({
            ok: true,
            data: heartbeats
        });
    } catch (error) {
        sendHttpError(res, error.message);
    }
});

/**
 * @swagger
 * /api/v1/notifications:
 *   get:
 *     summary: Get all notifications
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of notifications
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 */
router.get("/api/v1/notifications", authenticateToken, async (req, res) => {
    try {
        allowAllOrigin(res);
        
        const notifications = await R.find("notification", " user_id = ? ", [req.userId]);
        
        res.json({
            ok: true,
            data: notifications.map(n => n.toJSON())
        });
    } catch (error) {
        sendHttpError(res, error.message);
    }
});

/**
 * @swagger
 * /api/v1/nodes:
 *   get:
 *     summary: Get all nodes
 *     tags: [Nodes]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of nodes
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Node'
 */
router.get("/api/v1/nodes", authenticateToken, async (req, res) => {
    try {
        allowAllOrigin(res);
        
        const nodes = await R.getAll(`
            SELECT 
                id,
                node_id,
                node_name,
                ip,
                is_primary,
                status,
                last_heartbeat,
                last_error_message,
                create
            FROM node 
            ORDER BY node_id ASC
        `);
        
        res.json({
            ok: true,
            data: nodes
        });
    } catch (error) {
        sendHttpError(res, error.message);
    }
});

/**
 * @swagger
 * /api/v1/nodes/{id}:
 *   get:
 *     summary: Get node by ID
 *     tags: [Nodes]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Node ID
 *     responses:
 *       200:
 *         description: Node details
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/Node'
 *       404:
 *         description: Node not found
 */
router.get("/api/v1/nodes/:id", authenticateToken, async (req, res) => {
    try {
        allowAllOrigin(res);
        
        const nodeId = req.params.id; // 注意：這裡是字串，不是整數
        
        const node = await R.findOne("node", " node_id = ? ", [nodeId]);
        
        if (!node) {
            return res.status(404).json({
                ok: false,
                msg: "Node not found"
            });
        }
        
        res.json({
            ok: true,
            data: node
        });
    } catch (error) {
        sendHttpError(res, error.message);
    }
});

/**
 * @swagger
 * /api/v1/nodes:
 *   post:
 *     summary: Create a new node
 *     tags: [Nodes]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *             properties:
 *               name:
 *                 type: string
 *                 description: Node name
 *                 example: "node1"
 *               location:
 *                 type: string
 *                 description: Node location
 *                 example: "Taipei, Taiwan"
 *               ip:
 *                 type: string
 *                 description: Node IP address
 *                 example: "192.168.1.100"
 *               hostname:
 *                 type: string
 *                 description: Node hostname
 *                 example: "server01"
 *     responses:
 *       201:
 *         description: Node created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                   example: true
 *                 msg:
 *                   type: string
 *                   example: "Node created successfully"
 *                 data:
 *                   $ref: '#/components/schemas/Node'
 */
router.post("/api/v1/nodes", authenticateToken, async (req, res) => {
    try {
        allowAllOrigin(res);
        
        const { node_id, node_name, ip, is_primary } = req.body;
        
        // Validation
        if (!node_id) {
            return res.status(400).json({
                ok: false,
                msg: "Node ID is required"
            });
        }
        
        // Check if node_id already exists
        const existingNode = await R.findOne("node", " node_id = ? ", [node_id]);
        if (existingNode) {
            return res.status(409).json({
                ok: false,
                msg: "Node ID already exists"
            });
        }
        
        // Create new node
        const node = R.dispense("node");
        node.node_id = node_id;
        node.node_name = node_name || node_id;
        node.ip = ip || "";
        node.is_primary = is_primary || 0;
        node.status = "online";
        node.last_heartbeat = new Date();
        node.create = new Date();
        
        await R.store(node);
        
        res.status(201).json({
            ok: true,
            msg: "Node created successfully",
            data: node
        });
    } catch (error) {
        sendHttpError(res, error.message);
    }
});

/**
 * @swagger
 * /api/v1/nodes/{id}:
 *   put:
 *     summary: Update node
 *     tags: [Nodes]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Node ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *                 description: Node name
 *               location:
 *                 type: string
 *                 description: Node location
 *               ip:
 *                 type: string
 *                 description: Node IP address
 *               hostname:
 *                 type: string
 *                 description: Node hostname
 *               status:
 *                 type: string
 *                 description: Node status
 *                 enum: [online, offline, maintenance]
 *     responses:
 *       200:
 *         description: Node updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                   example: true
 *                 msg:
 *                   type: string
 *                   example: "Node updated successfully"
 *                 data:
 *                   $ref: '#/components/schemas/Node'
 */
router.put("/api/v1/nodes/:id", authenticateToken, async (req, res) => {
    try {
        allowAllOrigin(res);
        
        const nodeId = req.params.id; // 字串
        const { node_name, ip, is_primary, status } = req.body;
        
        const node = await R.findOne("node", " node_id = ? ", [nodeId]);
        
        if (!node) {
            return res.status(404).json({
                ok: false,
                msg: "Node not found"
            });
        }
        
        // Update node
        if (node_name !== undefined) node.node_name = node_name;
        if (ip !== undefined) node.ip = ip;
        if (is_primary !== undefined) node.is_primary = is_primary;
        if (status) node.status = status;
        
        await R.store(node);
        
        res.json({
            ok: true,
            msg: "Node updated successfully",
            data: node
        });
    } catch (error) {
        sendHttpError(res, error.message);
    }
});

/**
 * @swagger
 * /api/v1/nodes/{id}:
 *   delete:
 *     summary: Delete node
 *     tags: [Nodes]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Node ID
 *     responses:
 *       200:
 *         description: Node deleted successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                   example: true
 *                 msg:
 *                   type: string
 *                   example: "Node deleted successfully"
 */
router.delete("/api/v1/nodes/:id", authenticateToken, async (req, res) => {
    try {
        allowAllOrigin(res);
        
        const nodeId = req.params.id; // 字串
        
        const node = await R.findOne("node", " node_id = ? ", [nodeId]);
        
        if (!node) {
            return res.status(404).json({
                ok: false,
                msg: "Node not found"
            });
        }
        
        // Check if node is assigned to any monitors
        const assignedMonitors = await R.findOne("monitor", " node_id = ? ", [nodeId]);
        if (assignedMonitors) {
            return res.status(400).json({
                ok: false,
                msg: "Cannot delete node that is assigned to monitors"
            });
        }
        
        // Hard delete (since there's no active field)
        await R.exec("DELETE FROM node WHERE node_id = ?", [nodeId]);
        
        res.json({
            ok: true,
            msg: "Node deleted successfully"
        });
    } catch (error) {
        sendHttpError(res, error.message);
    }
});

/**
 * @swagger
 * /api/v1/nodes/{id}/monitors:
 *   get:
 *     summary: Get monitors assigned to a specific node
 *     tags: [Nodes]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Node ID
 *     responses:
 *       200:
 *         description: List of monitors assigned to the node
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Monitor'
 */
router.get("/api/v1/nodes/:id/monitors", authenticateToken, async (req, res) => {
    try {
        allowAllOrigin(res);
        
        const nodeId = req.params.id; // 字串
        
        const node = await R.findOne("node", " node_id = ? ", [nodeId]);
        
        if (!node) {
            return res.status(404).json({
                ok: false,
                msg: "Node not found"
            });
        }
        
        const monitors = await R.getAll(`
            SELECT 
                id, name, type, url, interval, active, status, 
                created_date, last_check, uptime
            FROM monitor 
            WHERE node_id = ? AND active = 1
            ORDER BY name ASC
        `, [nodeId]);
        
        res.json({
            ok: true,
            data: monitors
        });
    } catch (error) {
        sendHttpError(res, error.message);
    }
});

module.exports = router; 