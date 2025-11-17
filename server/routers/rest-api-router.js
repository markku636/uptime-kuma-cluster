const express = require("express");
const { R } = require("redbean-node");
const jwt = require("jsonwebtoken");
const Monitor = require("../model/monitor");
const User = require("../model/user");
const StatusPage = require("../model/status_page");
const Database = require("../database");
const { Notification } = require("../notification");
const {
    sendHttpError,
    allowDevAllOrigin,
    allowAllOrigin
} = require("../util-server");
const { UptimeKumaServer } = require("../uptime-kuma-server");
const rateLimit = require("express-rate-limit");
const { reconcileMonitors } = require("../monitor-reconciler");
const { body, validationResult } = require("express-validator");

const router = express.Router();

// Rate limiting
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each IP to 100 requests per windowMs
    message: "Too many API requests from this IP, please try again later."
});

// Apply rate limiting to all API routes except health check
router.use("/api/v1", (req, res, next) => {
    // Skip rate limiting for health check endpoint
    if (req.path === "/health") {
        return next();
    }
    // Apply rate limiting to all other API routes
    return apiLimiter(req, res, next);
});
/**
 * Trigger reconcile monitors on this node
 */
router.post("/api/v1/reconcile-monitors", authenticateToken, async (req, res) => {
    try {
        await reconcileMonitors();
        res.json({ ok: true,
            msg: "Reconcile triggered" });
    } catch (e) {
        sendHttpError(res, e.message);
    }
});

/**
 * @swagger
 * /api/v1/status:
 *   get:
 *     summary: Get API status
 *     tags: [General]
 *     security: []
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
/**
 * @param req
 * @param res
 * @param next
 */
async function authenticateToken(req, res, next) {
    const authHeader = req.headers["authorization"];

    if (!authHeader) {
        return res.status(401).json({
            ok: false,
            msg: "Authorization header required"
        });
    }

    // Check if it's a Bearer token (JWT)
    if (authHeader.startsWith("Bearer ")) {
        const token = authHeader.substring(7);

        try {
            const server = UptimeKumaServer.getInstance();
            const decoded = jwt.verify(token, server.jwtSecret);

            // Find user
            const user = await R.findOne("user", " username = ? AND active = 1 ", [ decoded.username ]);
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
 *     apiKeyAuth:
 *       type: apiKey
 *       in: header
 *       name: Authorization
 *       description: API key authorization header. Example: "Authorization: {api_key}"
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

        const monitors = await R.findAll("monitor", " AND user_id = ? ORDER BY weight DESC, name ", [ req.userId ]);
        const monitorList = [];

        // Prepare preload data to avoid n+1 queries and undefined map errors
        const monitorData = monitors.map((m) => ({ id: m.id,
            active: m.active }));
        const preloadData = await Monitor.preparePreloadData(monitorData);

        for (let monitor of monitors) {
            monitorList.push(monitor.toJSON(preloadData));
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
        const monitor = await R.findOne("monitor", " id = ? AND user_id = ? ", [ monitorId, req.userId ]);

        if (!monitor) {
            return res.status(404).json({
                ok: false,
                msg: "Monitor not found"
            });
        }

        const monitorData = [{ id: monitor.id,
            active: monitor.active }];
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
            const node = await R.findOne("node", " node_id = ? ", [ req.body.node_id ]);
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
        monitor.description = req.body.description || "";

        // 設定 node_id（如果提供）
        if (req.body.node_id) {
            monitor.node_id = req.body.node_id;
        }

        // Set default values
        monitor.retryInterval = req.body.retryInterval || 60;
        monitor.maxretries = req.body.maxretries || 0;
        monitor.timeout = req.body.timeout || 48;
        monitor.accepted_statuscodes_json = JSON.stringify(req.body.accepted_statuscodes || [ "200-299" ]);

        // Set headers if provided
        if (req.body.headers) {
            monitor.headers = typeof req.body.headers === "string" ? req.body.headers : JSON.stringify(req.body.headers);
        }

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
                monitor_id: monitor.id,
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
        const monitor = await R.findOne("monitor", " id = ? AND user_id = ? ", [ monitorId, req.userId ]);

        if (!monitor) {
            return res.status(404).json({
                ok: false,
                msg: "Monitor not found"
            });
        }

        // Update monitor properties
        if (req.body.name) {
            monitor.name = req.body.name;
        }
        if (req.body.url) {
            monitor.url = req.body.url;
        }
        if (req.body.interval) {
            monitor.interval = req.body.interval;
        }
        if (req.body.active !== undefined) {
            monitor.active = req.body.active;
        }

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
        const monitor = await R.findOne("monitor", " id = ? AND user_id = ? ", [ monitorId, req.userId ]);

        if (!monitor) {
            return res.status(404).json({
                ok: false,
                msg: "Monitor not found"
            });
        }

        await R.exec("DELETE FROM monitor WHERE id = ? AND user_id = ?", [ monitorId, req.userId ]);

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

        const monitor = await R.findOne("monitor", " id = ? AND user_id = ? ", [ monitorId, req.userId ]);

        if (!monitor) {
            return res.status(404).json({
                ok: false,
                msg: "Monitor not found"
            });
        }

        const sqlHourOffset = Database.sqlHourOffset();
        const heartbeats = await R.getAll(`
            SELECT * FROM heartbeat 
            WHERE time > ${sqlHourOffset} AND monitor_id = ?
            ORDER BY time DESC 
            LIMIT 100
        `, [ -period, monitorId ]);

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

        const notifications = await R.find("notification", " user_id = ? ", [ req.userId ]);

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
                host,
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

        const node = await R.findOne("node", " node_id = ? ", [ nodeId ]);

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
 *               host:
 *                 type: string
 *                 description: Node host address
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

        const { node_id, node_name, host, is_primary } = req.body;

        // Validation
        if (!node_id) {
            return res.status(400).json({
                ok: false,
                msg: "Node ID is required"
            });
        }

        // Check if node_id already exists
        const existingNode = await R.findOne("node", " node_id = ? ", [ node_id ]);
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
        node.host = host || "";
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
 *               host:
 *                 type: string
 *                 description: Node host address
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
        const { node_name, host, is_primary, status } = req.body;

        const node = await R.findOne("node", " node_id = ? ", [ nodeId ]);

        if (!node) {
            return res.status(404).json({
                ok: false,
                msg: "Node not found"
            });
        }

        // Update node
        if (node_name !== undefined) {
            node.node_name = node_name;
        }
        if (host !== undefined) {
            node.host = host;
        }
        if (is_primary !== undefined) {
            node.is_primary = is_primary;
        }
        if (status) {
            node.status = status;
        }

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

        const node = await R.findOne("node", " node_id = ? ", [ nodeId ]);

        if (!node) {
            return res.status(404).json({
                ok: false,
                msg: "Node not found"
            });
        }

        // Check if node is assigned to any monitors
        const assignedMonitors = await R.findOne("monitor", " node_id = ? ", [ nodeId ]);
        if (assignedMonitors) {
            return res.status(400).json({
                ok: false,
                msg: "Cannot delete node that is assigned to monitors"
            });
        }

        // Hard delete (since there's no active field)
        await R.exec("DELETE FROM node WHERE node_id = ?", [ nodeId ]);

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

        const node = await R.findOne("node", " node_id = ? ", [ nodeId ]);

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
        `, [ nodeId ]);

        res.json({
            ok: true,
            data: monitors
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
 
 *       - apiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - type
 *             properties:
 *               name:
 *                 type: string
 *                 description: Monitor name
 *               type:
 *                 type: string
 *                 enum: [http, ping, dns, port, push, steam, gamedig, docker, sqlserver, postgres, mysql, radius, redis, kafka-producer, grpc-keyword, json-query, keyword, manual]
 *                 description: Monitor type
 *               url:
 *                 type: string
 *                 description: Monitor URL (required for http, keyword, json-query)
 *               hostname:
 *                 type: string
 *                 description: Hostname (required for ping, dns, port, radius)
 *               port:
 *                 type: integer
 *                 description: Port number (for port monitors)
 *               interval:
 *                 type: integer
 *                 default: 60
 *                 description: Check interval in seconds
 *               active:
 *                 type: boolean
 *                 default: true
 *                 description: Monitor active status
 *               retryInterval:
 *                 type: integer
 *                 default: 30
 *                 description: Retry interval in seconds
 *               timeout:
 *                 type: integer
 *                 default: 10
 *                 description: Request timeout in seconds
 *               method:
 *                 type: string
 *                 default: GET
 *                 description: HTTP method (for http monitors)
 *               node_id:
 *                 type: string
 *                 description: Node ID for load balancing
 *               keyword:
 *                 type: string
 *                 description: Keyword to search for (keyword monitors)
 *               invertKeyword:
 *                 type: boolean
 *                 default: false
 *                 description: Invert keyword match
 *               headers:
 *                 type: string
 *                 description: HTTP headers as JSON string
 *               body:
 *                 type: string
 *                 description: HTTP request body
 *               basic_auth_user:
 *                 type: string
 *                 description: Basic auth username
 *               basic_auth_pass:
 *                 type: string
 *                 description: Basic auth password
 *               maxretries:
 *                 type: integer
 *                 default: 0
 *                 description: Maximum retries
 *               upsideDown:
 *                 type: boolean
 *                 default: false
 *                 description: Invert status (down = up)
 *               ignoreTls:
 *                 type: boolean
 *                 default: false
 *                 description: Ignore TLS errors
 *               description:
 *                 type: string
 *                 description: Monitor description
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
 *                     id:
 *                       type: integer
 *                       description: Monitor ID
 *                     name:
 *                       type: string
 *                       description: Monitor name
 *       400:
 *         description: Invalid input
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post("/api/v1/monitors", authenticateToken, async (req, res) => {
    try {
        allowAllOrigin(res);

        // Validate required fields
        if (!req.body.name || !req.body.type) {
            return res.status(400).json({
                ok: false,
                msg: "Missing required fields: name and type"
            });
        }

        // Create new monitor
        const monitor = R.dispense("monitor");
        monitor.user_id = req.userId;
        monitor.name = req.body.name.trim();
        monitor.type = req.body.type;

        // Set default values
        monitor.interval = req.body.interval || 60;
        monitor.active = req.body.active !== undefined ? req.body.active : true;
        monitor.retryInterval = req.body.retryInterval || 30;
        monitor.timeout = req.body.timeout || 10;
        monitor.maxretries = req.body.maxretries || 0;
        monitor.upsideDown = req.body.upsideDown || false;
        monitor.ignoreTls = req.body.ignoreTls || false;

        // Set type-specific fields
        if (req.body.url) {
            monitor.url = req.body.url;
        }
        if (req.body.hostname) {
            monitor.hostname = req.body.hostname;
        }
        if (req.body.port) {
            monitor.port = req.body.port;
        }
        if (req.body.method) {
            monitor.method = req.body.method;
        }
        if (req.body.keyword) {
            monitor.keyword = req.body.keyword;
        }
        if (req.body.invertKeyword !== undefined) {
            monitor.invertKeyword = req.body.invertKeyword;
        }
        if (req.body.headers) {
            console.log("[REST API] Received headers:", req.body.headers);
            console.log("[REST API] Headers type:", typeof req.body.headers);
            monitor.headers = typeof req.body.headers === "string" ? req.body.headers : JSON.stringify(req.body.headers);
            console.log("[REST API] Stored headers:", monitor.headers);
        }
        if (req.body.body) {
            monitor.body = req.body.body;
        }
        if (req.body.basic_auth_user) {
            monitor.basic_auth_user = req.body.basic_auth_user;
        }
        if (req.body.basic_auth_pass) {
            monitor.basic_auth_pass = req.body.basic_auth_pass;
        }
        if (req.body.node_id) {
            monitor.node_id = req.body.node_id;
        }
        if (req.body.description) {
            console.log("[REST API POST] Received description:", req.body.description);
            monitor.description = req.body.description;
            console.log("[REST API POST] Set monitor.description:", monitor.description);
        }

        // Validate monitor configuration
        try {
            monitor.validate();
        } catch (error) {
            return res.status(400).json({
                ok: false,
                msg: error.message
            });
        }

        console.log("[REST API] Before store - monitor.headers:", monitor.headers);
        console.log("[REST API] Before store - monitor.description:", monitor.description);
        await R.store(monitor);
        console.log("[REST API] After store - monitor.id:", monitor.id, "monitor.headers:", monitor.headers);
        console.log("[REST API] After store - monitor.description:", monitor.description);

        // Verify the stored data
        const storedMonitor = await R.findOne("monitor", " id = ? ", [ monitor.id ]);
        console.log("[REST API] Verification - stored headers in DB:", storedMonitor.headers);
        console.log("[REST API] Verification - stored description in DB:", storedMonitor.description);

        res.status(201).json({
            ok: true,
            msg: "Monitor created successfully",
            data: {
                id: monitor.id,
                name: monitor.name,
                type: monitor.type,
                active: monitor.active
            }
        });

    } catch (error) {
        console.error(error);
        sendHttpError(res, error.message);
    }
});

/**
 * @swagger
 * /api/v1/monitors/{id}:
 *   put:
 *     summary: Update monitor by ID
 *     tags: [Monitors]
 
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
 *                 description: Monitor name
 *               url:
 *                 type: string
 *                 description: Monitor URL
 *               hostname:
 *                 type: string
 *                 description: Hostname
 *               port:
 *                 type: integer
 *                 description: Port number
 *               interval:
 *                 type: integer
 *                 description: Check interval in seconds
 *               active:
 *                 type: boolean
 *                 description: Monitor active status
 *               retryInterval:
 *                 type: integer
 *                 description: Retry interval in seconds
 *               timeout:
 *                 type: integer
 *                 description: Request timeout in seconds
 *               method:
 *                 type: string
 *                 description: HTTP method
 *               keyword:
 *                 type: string
 *                 description: Keyword to search for
 *               invertKeyword:
 *                 type: boolean
 *                 description: Invert keyword match
 *               headers:
 *                 type: string
 *                 description: HTTP headers as JSON string
 *               body:
 *                 type: string
 *                 description: HTTP request body
 *               basic_auth_user:
 *                 type: string
 *                 description: Basic auth username
 *               basic_auth_pass:
 *                 type: string
 *                 description: Basic auth password
 *               maxretries:
 *                 type: integer
 *                 description: Maximum retries
 *               upsideDown:
 *                 type: boolean
 *                 description: Invert status
 *               ignoreTls:
 *                 type: boolean
 *                 description: Ignore TLS errors
 *               description:
 *                 type: string
 *                 description: Monitor description
 *               node_id:
 *                 type: string
 *                 description: Node ID for load balancing
 *     responses:
 *       200:
 *         description: Monitor updated successfully
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
 *                   example: "Monitor updated successfully"
 *                 data:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: integer
 *                       description: Monitor ID
 *                     name:
 *                       type: string
 *                       description: Monitor name
 *       404:
 *         description: Monitor not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.put("/api/v1/monitors/:id", authenticateToken, async (req, res) => {
    try {
        console.log("========================================");
        console.log("[REST API PUT] Starting monitor update");
        console.log("[REST API PUT] Monitor ID:", req.params.id);
        console.log("[REST API PUT] Request body:", JSON.stringify(req.body, null, 2));
        console.log("========================================");

        allowAllOrigin(res);

        const monitorId = parseInt(req.params.id);
        const monitor = await R.findOne("monitor", " id = ? AND user_id = ? ", [ monitorId, req.userId ]);

        if (!monitor) {
            return res.status(404).json({
                ok: false,
                msg: "Monitor not found"
            });
        }

        // Update fields if provided
        if (req.body.name !== undefined) {
            monitor.name = req.body.name.trim();
        }
        if (req.body.url !== undefined) {
            monitor.url = req.body.url;
        }
        if (req.body.hostname !== undefined) {
            monitor.hostname = req.body.hostname;
        }
        if (req.body.port !== undefined) {
            monitor.port = req.body.port;
        }
        if (req.body.interval !== undefined) {
            monitor.interval = req.body.interval;
        }
        if (req.body.active !== undefined) {
            monitor.active = req.body.active;
        }
        if (req.body.retryInterval !== undefined) {
            monitor.retryInterval = req.body.retryInterval;
        }
        if (req.body.timeout !== undefined) {
            monitor.timeout = req.body.timeout;
        }
        if (req.body.method !== undefined) {
            monitor.method = req.body.method;
        }
        if (req.body.keyword !== undefined) {
            monitor.keyword = req.body.keyword;
        }
        if (req.body.invertKeyword !== undefined) {
            monitor.invertKeyword = req.body.invertKeyword;
        }
        if (req.body.headers !== undefined) {
            console.log("[REST API PUT] Received headers:", req.body.headers);
            console.log("[REST API PUT] Headers type:", typeof req.body.headers);
            console.log("[REST API PUT] Before update - monitor.headers:", monitor.headers);
            monitor.headers = typeof req.body.headers === "string" ? req.body.headers : JSON.stringify(req.body.headers);
            console.log("[REST API PUT] After update - monitor.headers:", monitor.headers);
        }
        if (req.body.body !== undefined) {
            console.log("[REST API PUT] Received body:", req.body.body);
            console.log("[REST API PUT] Body type:", typeof req.body.body);
            monitor.body = typeof req.body.body === "string" ? req.body.body : JSON.stringify(req.body.body);
            console.log("[REST API PUT] After update - monitor.body:", monitor.body);
        }
        if (req.body.basic_auth_user !== undefined) {
            monitor.basic_auth_user = req.body.basic_auth_user;
        }
        if (req.body.basic_auth_pass !== undefined) {
            monitor.basic_auth_pass = req.body.basic_auth_pass;
        }
        if (req.body.maxretries !== undefined) {
            monitor.maxretries = req.body.maxretries;
        }
        if (req.body.upsideDown !== undefined) {
            monitor.upsideDown = req.body.upsideDown;
        }
        if (req.body.ignoreTls !== undefined) {
            monitor.ignoreTls = req.body.ignoreTls;
        }
        if (req.body.description !== undefined) {
            console.log("[REST API PUT] Received description:", req.body.description);
            console.log("[REST API PUT] Before update - monitor.description:", monitor.description);
            monitor.description = req.body.description;
            console.log("[REST API PUT] After update - monitor.description:", monitor.description);
        }
        if (req.body.node_id !== undefined) {
            monitor.node_id = req.body.node_id;
        }

        // Validate monitor configuration
        try {
            monitor.validate();
        } catch (error) {
            return res.status(400).json({
                ok: false,
                msg: error.message
            });
        }

        console.log("[REST API PUT] Before store - monitor.headers:", monitor.headers);
        console.log("[REST API PUT] Before store - monitor.body:", monitor.body);
        console.log("[REST API PUT] Before store - monitor.description:", monitor.description);
        await R.store(monitor);
        console.log("[REST API PUT] After store - monitor.id:", monitor.id);

        // Verify the stored data
        const storedMonitor = await R.findOne("monitor", " id = ? ", [ monitor.id ]);
        console.log("[REST API PUT] Verification - stored headers in DB:", storedMonitor.headers);
        console.log("[REST API PUT] Verification - stored body in DB:", storedMonitor.body);
        console.log("[REST API PUT] Verification - stored description in DB:", storedMonitor.description);

        res.json({
            ok: true,
            msg: "Monitor updated successfully",
            data: {
                id: monitor.id,
                name: monitor.name,
                type: monitor.type,
                active: monitor.active
            }
        });

    } catch (error) {
        console.error(error);
        sendHttpError(res, error.message);
    }
});

/**
 * @swagger
 * /api/v1/status-pages:
 *   get:
 *     summary: Get all status pages
 *     tags: [Status Pages]
 
 *       - apiKeyAuth: []
 *     responses:
 *       200:
 *         description: List of all status pages
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
 *                       slug:
 *                         type: string
 *                       title:
 *                         type: string
 *                       description:
 *                         type: string
 *                       icon:
 *                         type: string
 *                       theme:
 *                         type: string
 *                       published:
 *                         type: boolean
 *                       created_date:
 *                         type: string
 *                       modified_date:
 *                         type: string
 */
router.get("/api/v1/status-pages", authenticateToken, async (req, res) => {
    try {
        allowAllOrigin(res);

        const statusPages = await R.findAll("status_page", " ORDER BY created_date DESC ");
        const statusPageList = [];

        for (let statusPage of statusPages) {
            statusPageList.push(await statusPage.toJSON());
        }

        res.json({
            ok: true,
            data: statusPageList
        });
    } catch (error) {
        sendHttpError(res, error.message);
    }
});

/**
 * @swagger
 * /api/v1/status-pages:
 *   post:
 *     summary: Create a new status page
 *     tags: [Status Pages]
 
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - title
 *               - slug
 *             properties:
 *               title:
 *                 type: string
 *                 description: Status page title
 *                 example: "My Status Page"
 *               slug:
 *                 type: string
 *                 description: Status page slug (URL-friendly identifier)
 *                 example: "my-status-page"
 *               description:
 *                 type: string
 *                 description: Status page description
 *                 example: "Status page for my services"
 *               theme:
 *                 type: string
 *                 description: Status page theme
 *                 example: "auto"
 *               autoRefreshInterval:
 *                 type: integer
 *                 description: Auto refresh interval in seconds
 *                 example: 300
 *               published:
 *                 type: boolean
 *                 default: true
 *                 description: Whether the status page is published
 *               search_engine_index:
 *                 type: boolean
 *                 default: true
 *                 description: Whether to allow search engine indexing
 *               show_tags:
 *                 type: boolean
 *                 default: false
 *                 description: Whether to show tags
 *               show_powered_by:
 *                 type: boolean
 *                 default: true
 *                 description: Whether to show powered by text
 *               show_certificate_expiry:
 *                 type: boolean
 *                 default: false
 *                 description: Whether to show certificate expiry
 *               publicGroupList:
 *                 type: array
 *                 description: List of public groups with monitors to create
 *                 items:
 *                   type: object
 *                   properties:
 *                     name:
 *                       type: string
 *                       description: Group name
 *                       example: "Web Services"
 *                     monitorList:
 *                       type: array
 *                       description: List of monitors to add to this group
 *                       items:
 *                         type: object
 *                         properties:
 *                           id:
 *                             type: integer
 *                             description: Monitor ID
 *                             example: 1
 *                           sendUrl:
 *                             type: boolean
 *                             description: Whether to send URL
 *                             example: true
 *                           url:
 *                             type: string
 *                             description: Custom URL for the monitor
 *                             example: "https://custom.example.com"
 *     responses:
 *       201:
 *         description: Status page created successfully
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
 *                   example: "Status page created successfully"
 *                 data:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: integer
 *                       description: Created status page ID
 *                     slug:
 *                       type: string
 *                       description: Status page slug
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post("/api/v1/status-pages", authenticateToken, [
    body("title").notEmpty().withMessage("Title is required"),
    body("slug").notEmpty().withMessage("Slug is required")
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

        let title = req.body.title?.trim();
        let slug = req.body.slug?.trim();

        // Check empty
        if (!title || !slug) {
            return res.status(400).json({
                ok: false,
                msg: "Please input all fields"
            });
        }

        // Make sure slug is string
        if (typeof slug !== "string") {
            return res.status(400).json({
                ok: false,
                msg: "Slug - Accept string only"
            });
        }

        // lower case only
        slug = slug.toLowerCase();

        // Check slug format (a-z, 0-9, - only, no consecutive dashes)
        if (!slug.match(/^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/)) {
            return res.status(400).json({
                ok: false,
                msg: "Invalid slug format. Only a-z, 0-9, - allowed, no consecutive dashes"
            });
        }

        // Check if slug already exists
        const existingStatusPage = await R.findOne("status_page", " slug = ? ", [ slug ]);
        if (existingStatusPage) {
            return res.status(400).json({
                ok: false,
                msg: "Slug already exists"
            });
        }

        let statusPage = R.dispense("status_page");
        statusPage.slug = slug;
        statusPage.title = title;
        statusPage.description = req.body.description || "";
        statusPage.theme = req.body.theme || "auto";
        statusPage.icon = req.body.icon || "";
        statusPage.autoRefreshInterval = req.body.autoRefreshInterval || 300;
        statusPage.published = req.body.published !== undefined ? req.body.published : true;
        statusPage.search_engine_index = req.body.search_engine_index !== undefined ? req.body.search_engine_index : true;
        statusPage.show_tags = req.body.show_tags !== undefined ? req.body.show_tags : false;
        statusPage.show_powered_by = req.body.show_powered_by !== undefined ? req.body.show_powered_by : true;
        statusPage.show_certificate_expiry = req.body.show_certificate_expiry !== undefined ? req.body.show_certificate_expiry : false;

        await R.store(statusPage);

        // Handle publicGroupList if provided
        if (req.body.publicGroupList && Array.isArray(req.body.publicGroupList)) {
            let groupOrder = 1;

            for (let group of req.body.publicGroupList) {
                const groupBean = R.dispense("group");
                groupBean.status_page_id = statusPage.id;
                groupBean.name = group.name;
                groupBean.public = true;
                groupBean.weight = groupOrder++;

                await R.store(groupBean);

                let monitorOrder = 1;

                if (group.monitorList && Array.isArray(group.monitorList)) {
                    for (let monitor of group.monitorList) {
                        // Verify monitor exists
                        const monitorBean = await R.findOne("monitor", " id = ? ", [ monitor.id ]);
                        if (monitorBean) {
                            const relationBean = R.dispense("monitor_group");
                            relationBean.weight = monitorOrder++;
                            relationBean.group_id = groupBean.id;
                            relationBean.monitor_id = monitor.id;

                            if (monitor.sendUrl !== undefined) {
                                relationBean.send_url = monitor.sendUrl;
                            }

                            if (monitor.url !== undefined) {
                                relationBean.custom_url = monitor.url;
                            }

                            await R.store(relationBean);
                        }
                    }
                }
            }
        }

        res.status(201).json({
            ok: true,
            msg: "Status page created successfully",
            data: {
                id: statusPage.id,
                slug: statusPage.slug,
                title: statusPage.title
            }
        });

    } catch (error) {
        console.error(error);
        sendHttpError(res, error.message);
    }
});

/**
 * @swagger
 * /api/v1/status-pages/{slug}:
 *   get:
 *     summary: Get status page by slug
 *     tags: [Status Pages]
 
 *     parameters:
 *       - in: path
 *         name: slug
 *         required: true
 *         schema:
 *           type: string
 *         description: Status page slug
 *     responses:
 *       200:
 *         description: Status page details
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: integer
 *                     slug:
 *                       type: string
 *                     title:
 *                       type: string
 *                     description:
 *                       type: string
 *                     icon:
 *                       type: string
 *                     theme:
 *                       type: string
 *                     published:
 *                       type: boolean
 *                     created_date:
 *                       type: string
 *                     modified_date:
 *                       type: string
 *       404:
 *         description: Status page not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
/**
 * @swagger
 * /api/v1/status-pages/{slug}:
 *   get:
 *     summary: Get status page by slug
 *     tags: [Status Pages]
 
 *     parameters:
 *       - in: path
 *         name: slug
 *         required: true
 *         schema:
 *           type: string
 *         description: Status page slug
 *       - in: query
 *         name: includeGroups
 *         required: false
 *         schema:
 *           type: boolean
 *         description: Whether to include public groups with monitors
 *     responses:
 *       200:
 *         description: Status page retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/StatusPage'
 *       404:
 *         description: Status page not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.get("/api/v1/status-pages/:slug", authenticateToken, async (req, res) => {
    try {
        allowAllOrigin(res);

        const slug = req.params.slug.toLowerCase();
        const statusPage = await R.findOne("status_page", " slug = ? ", [ slug ]);

        if (!statusPage) {
            return res.status(404).json({
                ok: false,
                msg: "Status page not found"
            });
        }

        // Get basic status page data
        const basicData = await statusPage.toJSON();

        // Get public groups with monitors if requested
        let publicGroupList = [];
        if (req.query.includeGroups === "true") {
            const list = await R.find("group", " public = 1 AND status_page_id = ? ORDER BY weight ", [
                statusPage.id
            ]);

            for (let groupBean of list) {
                let monitorGroup = await groupBean.toPublicJSON(false, false);
                publicGroupList.push(monitorGroup);
            }
        }

        const responseData = {
            ...basicData,
            ...(req.query.includeGroups === "true" && { publicGroupList })
        };

        res.json({
            ok: true,
            data: responseData
        });
    } catch (error) {
        sendHttpError(res, error.message);
    }
});

/**
 * @swagger
 * /api/v1/status-pages/{slug}:
 *   put:
 *     summary: Update status page by slug
 *     tags: [Status Pages]
 
 *       - apiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: slug
 *         required: true
 *         schema:
 *           type: string
 *         description: Status page slug
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               title:
 *                 type: string
 *                 description: Status page title
 *               description:
 *                 type: string
 *                 description: Status page description
 *               theme:
 *                 type: string
 *                 description: Status page theme
 *               icon:
 *                 type: string
 *                 description: Status page icon
 *               autoRefreshInterval:
 *                 type: integer
 *                 description: Auto refresh interval in seconds
 *               published:
 *                 type: boolean
 *                 description: Whether the status page is published
 *               search_engine_index:
 *                 type: boolean
 *                 description: Whether to allow search engine indexing
 *               show_tags:
 *                 type: boolean
 *                 description: Whether to show tags
 *               show_powered_by:
 *                 type: boolean
 *                 description: Whether to show powered by text
 *               show_certificate_expiry:
 *                 type: boolean
 *                 description: Whether to show certificate expiry
 *               publicGroupList:
 *                 type: array
 *                 description: List of public groups with monitors
 *                 items:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: integer
 *                       description: Group ID (optional for new groups)
 *                     name:
 *                       type: string
 *                       description: Group name
 *                     public:
 *                       type: boolean
 *                       description: Whether the group is public
 *                     monitorList:
 *                       type: array
 *                       description: List of monitors in this group
 *                       items:
 *                         type: object
 *                         properties:
 *                           id:
 *                             type: integer
 *                             description: Monitor ID
 *                           sendUrl:
 *                             type: boolean
 *                             description: Whether to send URL
 *                           url:
 *                             type: string
 *                             description: Custom URL for the monitor
 *     responses:
 *       200:
 *         description: Status page updated successfully
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
 *                   example: "Status page updated successfully"
 *                 data:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: integer
 *                       description: Updated status page ID
 *                     slug:
 *                       type: string
 *                       description: Status page slug
 *       404:
 *         description: Status page not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.put("/api/v1/status-pages/:slug", authenticateToken, async (req, res) => {
    try {
        allowAllOrigin(res);

        const slug = req.params.slug.toLowerCase();
        const statusPage = await R.findOne("status_page", " slug = ? ", [ slug ]);

        if (!statusPage) {
            return res.status(404).json({
                ok: false,
                msg: "Status page not found"
            });
        }

        // Update fields if provided
        if (req.body.title !== undefined) {
            statusPage.title = req.body.title.trim();
        }
        if (req.body.description !== undefined) {
            statusPage.description = req.body.description;
        }
        if (req.body.theme !== undefined) {
            statusPage.theme = req.body.theme;
        }
        if (req.body.icon !== undefined) {
            statusPage.icon = req.body.icon;
        }
        if (req.body.autoRefreshInterval !== undefined) {
            statusPage.autoRefreshInterval = req.body.autoRefreshInterval;
        }
        if (req.body.published !== undefined) {
            statusPage.published = req.body.published;
        }
        if (req.body.search_engine_index !== undefined) {
            statusPage.search_engine_index = req.body.search_engine_index;
        }
        if (req.body.show_tags !== undefined) {
            statusPage.show_tags = req.body.show_tags;
        }
        if (req.body.show_powered_by !== undefined) {
            statusPage.show_powered_by = req.body.show_powered_by;
        }
        if (req.body.show_certificate_expiry !== undefined) {
            statusPage.show_certificate_expiry = req.body.show_certificate_expiry;
        }

        statusPage.modified_date = R.isoDateTime();

        await R.store(statusPage);

        // Handle publicGroupList if provided
        if (req.body.publicGroupList && Array.isArray(req.body.publicGroupList)) {
            const groupIDList = [];
            let groupOrder = 1;

            for (let group of req.body.publicGroupList) {
                let groupBean;
                if (group.id) {
                    groupBean = await R.findOne("group", " id = ? AND public = 1 AND status_page_id = ? ", [
                        group.id,
                        statusPage.id
                    ]);
                } else {
                    groupBean = R.dispense("group");
                }

                groupBean.status_page_id = statusPage.id;
                groupBean.name = group.name;
                groupBean.public = true;
                groupBean.weight = groupOrder++;

                await R.store(groupBean);

                // Clear existing monitor relationships for this group
                await R.exec("DELETE FROM monitor_group WHERE group_id = ? ", [
                    groupBean.id
                ]);

                let monitorOrder = 1;

                for (let monitor of group.monitorList) {
                    let relationBean = R.dispense("monitor_group");
                    relationBean.weight = monitorOrder++;
                    relationBean.group_id = groupBean.id;
                    relationBean.monitor_id = monitor.id;

                    if (monitor.sendUrl !== undefined) {
                        relationBean.send_url = monitor.sendUrl;
                    }

                    if (monitor.url !== undefined) {
                        relationBean.custom_url = monitor.url;
                    }

                    await R.store(relationBean);
                }

                groupIDList.push(groupBean.id);
                group.id = groupBean.id;
            }

            // Delete groups that are not in the list
            if (groupIDList.length === 0) {
                await R.exec("DELETE FROM `group` WHERE status_page_id = ?", [ statusPage.id ]);
            } else {
                const slots = groupIDList.map(() => "?").join(",");
                const data = [
                    ...groupIDList,
                    statusPage.id
                ];
                await R.exec(`DELETE FROM \`group\` WHERE id NOT IN (${slots}) AND status_page_id = ?`, data);
            }
        }

        res.json({
            ok: true,
            msg: "Status page updated successfully",
            data: {
                id: statusPage.id,
                slug: statusPage.slug,
                title: statusPage.title
            }
        });

    } catch (error) {
        console.error(error);
        sendHttpError(res, error.message);
    }
});

/**
 * @swagger
 * /api/v1/status-pages/{slug}:
 *   delete:
 *     summary: Delete status page by slug
 *     tags: [Status Pages]
 
 *     parameters:
 *       - in: path
 *         name: slug
 *         required: true
 *         schema:
 *           type: string
 *         description: Status page slug
 *     responses:
 *       200:
 *         description: Status page deleted successfully
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
 *                   example: "Status page deleted successfully"
 *       404:
 *         description: Status page not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.delete("/api/v1/status-pages/:slug", authenticateToken, async (req, res) => {
    try {
        allowAllOrigin(res);

        const slug = req.params.slug.toLowerCase();
        const statusPageID = await StatusPage.slugToID(slug);

        if (!statusPageID) {
            return res.status(404).json({
                ok: false,
                msg: "Status page not found"
            });
        }

        // Delete related records
        await R.exec("DELETE FROM incident WHERE status_page_id = ? ", [ statusPageID ]);
        await R.exec("DELETE FROM `group` WHERE status_page_id = ? ", [ statusPageID ]);
        await R.exec("DELETE FROM status_page WHERE id = ? ", [ statusPageID ]);

        res.json({
            ok: true,
            msg: "Status page deleted successfully"
        });

    } catch (error) {
        console.error(error);
        sendHttpError(res, error.message);
    }
});

/**
 * @swagger
 * /api/v1/groups:
 *   post:
 *     summary: Create a new group
 *     tags: [Groups]
 
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - status_page_id
 *             properties:
 *               name:
 *                 type: string
 *                 description: Group name
 *               status_page_id:
 *                 type: integer
 *                 description: Status page ID this group belongs to
 *               public:
 *                 type: boolean
 *                 default: true
 *                 description: Whether the group is public
 *               weight:
 *                 type: integer
 *                 default: 1
 *                 description: Group display order
 *               monitorList:
 *                 type: array
 *                 description: List of monitors to add to this group
 *                 items:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: integer
 *                       description: Monitor ID
 *                     sendUrl:
 *                       type: boolean
 *                       description: Whether to send URL
 *                     url:
 *                       type: string
 *                       description: Custom URL for the monitor
 *                     weight:
 *                       type: integer
 *                       description: Monitor order in group
 *     responses:
 *       201:
 *         description: Group created successfully
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
 *                   example: "Group created successfully"
 *                 data:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: integer
 *                       description: Group ID
 *                     name:
 *                       type: string
 *                       description: Group name
 *       400:
 *         description: Invalid input
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post("/api/v1/groups", authenticateToken, async (req, res) => {
    try {
        allowAllOrigin(res);

        // Validate required fields
        if (!req.body.name || !req.body.status_page_id) {
            return res.status(400).json({
                ok: false,
                msg: "Missing required fields: name and status_page_id"
            });
        }

        // Verify status page exists
        const statusPage = await R.findOne("status_page", " id = ? ", [ req.body.status_page_id ]);
        if (!statusPage) {
            return res.status(404).json({
                ok: false,
                msg: "Status page not found"
            });
        }

        // Create new group
        const group = R.dispense("group");
        group.name = req.body.name.trim();
        group.status_page_id = req.body.status_page_id;
        group.public = req.body.public !== undefined ? req.body.public : true;
        group.weight = req.body.weight || 1;

        await R.store(group);

        // Handle monitor list if provided
        if (req.body.monitorList && Array.isArray(req.body.monitorList)) {
            let monitorOrder = 1;

            for (let monitor of req.body.monitorList) {
                // Verify monitor exists and belongs to user
                const monitorBean = await R.findOne("monitor", " id = ? AND user_id = ? ", [ monitor.id, req.userId ]);
                if (monitorBean) {
                    const relationBean = R.dispense("monitor_group");
                    relationBean.weight = monitor.weight || monitorOrder++;
                    relationBean.group_id = group.id;
                    relationBean.monitor_id = monitor.id;

                    if (monitor.sendUrl !== undefined) {
                        relationBean.send_url = monitor.sendUrl;
                    }

                    if (monitor.url !== undefined) {
                        relationBean.custom_url = monitor.url;
                    }

                    await R.store(relationBean);
                }
            }
        }

        res.status(201).json({
            ok: true,
            msg: "Group created successfully",
            data: {
                id: group.id,
                name: group.name,
                status_page_id: group.status_page_id,
                public: group.public,
                weight: group.weight
            }
        });

    } catch (error) {
        console.error(error);
        sendHttpError(res, error.message);
    }
});

/**
 * @swagger
 * /api/v1/groups/{id}:
 *   put:
 *     summary: Update group by ID
 *     tags: [Groups]
 
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Group ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *                 description: Group name
 *               public:
 *                 type: boolean
 *                 description: Whether the group is public
 *               weight:
 *                 type: integer
 *                 description: Group display order
 *               monitorList:
 *                 type: array
 *                 description: List of monitors in this group
 *                 items:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: integer
 *                       description: Monitor ID
 *                     sendUrl:
 *                       type: boolean
 *                       description: Whether to send URL
 *                     url:
 *                       type: string
 *                       description: Custom URL for the monitor
 *                     weight:
 *                       type: integer
 *                       description: Monitor order in group
 *     responses:
 *       200:
 *         description: Group updated successfully
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
 *                   example: "Group updated successfully"
 *                 data:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: integer
 *                       description: Group ID
 *                     name:
 *                       type: string
 *                       description: Group name
 *       404:
 *         description: Group not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.put("/api/v1/groups/:id", authenticateToken, async (req, res) => {
    try {
        allowAllOrigin(res);

        const groupId = parseInt(req.params.id);
        const group = await R.findOne("group", " id = ? ", [ groupId ]);

        if (!group) {
            return res.status(404).json({
                ok: false,
                msg: "Group not found"
            });
        }

        // Update fields if provided
        if (req.body.name !== undefined) {
            group.name = req.body.name.trim();
        }
        if (req.body.public !== undefined) {
            group.public = req.body.public;
        }
        if (req.body.weight !== undefined) {
            group.weight = req.body.weight;
        }

        await R.store(group);

        // Handle monitor list if provided
        if (req.body.monitorList && Array.isArray(req.body.monitorList)) {
            // Clear existing monitor relationships for this group
            await R.exec("DELETE FROM monitor_group WHERE group_id = ? ", [ group.id ]);

            let monitorOrder = 1;

            for (let monitor of req.body.monitorList) {
                // Verify monitor exists and belongs to user
                const monitorBean = await R.findOne("monitor", " id = ? AND user_id = ? ", [ monitor.id, req.userId ]);
                if (monitorBean) {
                    const relationBean = R.dispense("monitor_group");
                    relationBean.weight = monitor.weight || monitorOrder++;
                    relationBean.group_id = group.id;
                    relationBean.monitor_id = monitor.id;

                    if (monitor.sendUrl !== undefined) {
                        relationBean.send_url = monitor.sendUrl;
                    }

                    if (monitor.url !== undefined) {
                        relationBean.custom_url = monitor.url;
                    }

                    await R.store(relationBean);
                }
            }
        }

        res.json({
            ok: true,
            msg: "Group updated successfully",
            data: {
                id: group.id,
                name: group.name,
                public: group.public,
                weight: group.weight
            }
        });

    } catch (error) {
        console.error(error);
        sendHttpError(res, error.message);
    }
});

/**
 * @swagger
 * /api/v1/groups/{id}:
 *   get:
 *     summary: Get group by ID
 *     tags: [Groups]
 
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Group ID
 *     responses:
 *       200:
 *         description: Group details
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: integer
 *                     name:
 *                       type: string
 *                     status_page_id:
 *                       type: integer
 *                     public:
 *                       type: boolean
 *                     weight:
 *                       type: integer
 *                     monitorList:
 *                       type: array
 *                       items:
 *                         type: object
 *       404:
 *         description: Group not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.get("/api/v1/groups/:id", authenticateToken, async (req, res) => {
    try {
        allowAllOrigin(res);

        const groupId = parseInt(req.params.id);
        const group = await R.findOne("group", " id = ? ", [ groupId ]);

        if (!group) {
            return res.status(404).json({
                ok: false,
                msg: "Group not found"
            });
        }

        // Get group with monitors
        const groupBean = await R.load("group", groupId);
        const groupData = await groupBean.toPublicJSON();

        res.json({
            ok: true,
            data: {
                id: group.id,
                name: group.name,
                status_page_id: group.status_page_id,
                public: group.public,
                weight: group.weight,
                monitorList: groupData.monitorList || []
            }
        });

    } catch (error) {
        console.error(error);
        sendHttpError(res, error.message);
    }
});

/**
 * @swagger
 * /api/v1/health:
 *   get:
 *     summary: Get system health status (no rate limiting)
 *     tags: [General]
 *     security: []
 *     description: This endpoint is exempt from rate limiting for monitoring purposes
 *     responses:
 *       200:
 *         description: System health status
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                   example: true
 *                 status:
 *                   type: string
 *                   example: "healthy"
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *                   example: "2025-08-20T14:00:00.000Z"
 *                 uptime:
 *                   type: number
 *                   description: Server uptime in seconds
 *                   example: 3600
 *                 version:
 *                   type: string
 *                   example: "2.0.0-beta.3"
 *                 checks:
 *                   type: object
 *                   properties:
 *                     database:
 *                       type: object
 *                       properties:
 *                         status:
 *                           type: string
 *                           example: "healthy"
 *                         responseTime:
 *                           type: number
 *                           description: Database response time in milliseconds
 *                           example: 5
 *                     server:
 *                       type: object
 *                       properties:
 *                         status:
 *                           type: string
 *                           example: "healthy"
 *                         memory:
 *                           type: object
 *                           properties:
 *                             used:
 *                               type: number
 *                               description: Used memory in bytes
 *                               example: 52428800
 *                             total:
 *                               type: number
 *                               description: Total memory in bytes
 *                               example: 1073741824
 *                             percentage:
 *                               type: number
 *                               description: Memory usage percentage
 *                               example: 4.88
 *       503:
 *         description: System unhealthy
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                   example: false
 *                 status:
 *                   type: string
 *                   example: "unhealthy"
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *                   example: "2025-08-20T14:00:00.000Z"
 *                 checks:
 *                   type: object
 *                   properties:
 *                     database:
 *                       type: object
 *                       properties:
 *                         status:
 *                           type: string
 *                           example: "unhealthy"
 *                         error:
 *                           type: string
 *                           example: "Database connection failed"
 */
// Health check endpoint (public, no auth required, no rate limiting)
router.get("/api/v1/health", async (req, res) => {
    allowAllOrigin(res);

    const startTime = Date.now();
    const healthCheck = {
        ok: true,
        status: "healthy",
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        version: require("../../package.json").version,
        checks: {}
    };

    try {
        // Check database health
        const dbStartTime = Date.now();
        try {
            // Try to execute a simple query to check database connectivity
            await R.exec("SELECT 1");
            const dbResponseTime = Date.now() - dbStartTime;

            healthCheck.checks.database = {
                status: "healthy",
                responseTime: dbResponseTime
            };
        } catch (dbError) {
            healthCheck.checks.database = {
                status: "unhealthy",
                error: dbError.message,
                responseTime: Date.now() - dbStartTime
            };
            healthCheck.ok = false;
            healthCheck.status = "unhealthy";
        }

        // Check server health
        const memoryUsage = process.memoryUsage();
        const totalMemory = require("os").totalmem();
        const usedMemory = memoryUsage.heapUsed;
        const memoryPercentage = (usedMemory / totalMemory) * 100;

        healthCheck.checks.server = {
            status: "healthy",
            memory: {
                used: usedMemory,
                total: totalMemory,
                percentage: Math.round(memoryPercentage * 100) / 100
            }
        };

        // Check if memory usage is too high (optional threshold)
        if (memoryPercentage > 90) {
            healthCheck.checks.server.status = "warning";
            healthCheck.checks.server.memory.warning = "High memory usage detected";
        }

        // Check disk space if available (optional)
        try {
            const fs = require("fs");
            const path = require("path");
            const dataDir = process.env.DATA_DIR || "./data/";

            if (fs.existsSync(dataDir)) {
                const stats = fs.statSync(dataDir);
                healthCheck.checks.disk = {
                    status: "healthy",
                    dataDir: dataDir,
                    exists: true
                };
            }
        } catch (diskError) {
            // Disk check is optional, don't fail the health check
            healthCheck.checks.disk = {
                status: "unknown",
                error: diskError.message
            };
        }

        // Check if any critical checks failed
        const criticalChecks = [ "database" ];
        const hasCriticalFailures = criticalChecks.some(check =>
            healthCheck.checks[check] && healthCheck.checks[check].status === "unhealthy"
        );

        if (hasCriticalFailures) {
            healthCheck.status = "unhealthy";
            res.status(503);
        }

        const totalResponseTime = Date.now() - startTime;
        healthCheck.responseTime = totalResponseTime;

        res.json(healthCheck);

    } catch (error) {
        // If health check itself fails, return error
        healthCheck.ok = false;
        healthCheck.status = "error";
        healthCheck.error = error.message;
        healthCheck.responseTime = Date.now() - startTime;

        res.status(503).json(healthCheck);
    }
});

module.exports = router;
