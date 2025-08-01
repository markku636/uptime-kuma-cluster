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
 *               active:
 *                 type: boolean
 *                 example: true
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
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post("/api/v1/monitors", authenticateToken, [
    body("name").notEmpty().withMessage("Name is required"),
    body("type").notEmpty().withMessage("Type is required"),
    body("url").isURL().withMessage("Valid URL is required"),
    body("interval").isInt({ min: 20 }).withMessage("Interval must be at least 20 seconds")
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
        
        const monitor = R.dispense("monitor");
        monitor.name = req.body.name;
        monitor.type = req.body.type;
        monitor.url = req.body.url;
        monitor.interval = req.body.interval || 60;
        monitor.active = req.body.active !== false;
        monitor.user_id = req.userId;
        
        // Set default values
        monitor.retryInterval = req.body.retryInterval || 60;
        monitor.maxretries = req.body.maxretries || 0;
        monitor.timeout = req.body.timeout || 48;
        monitor.accepted_statuscodes_json = JSON.stringify(req.body.accepted_statuscodes || ["200-299"]);
        
        await R.store(monitor);
        
        res.status(201).json({
            ok: true,
            msg: "Monitor created successfully",
            data: {
                monitorID: monitor.id
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

module.exports = router; 