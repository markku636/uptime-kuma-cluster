const swaggerJsdoc = require("swagger-jsdoc");
const swaggerUi = require("swagger-ui-express");
const packageInfo = require("../package.json");
const path = require("path");

const options = {
    definition: {
        openapi: "3.0.0",
        info: {
            title: "Uptime Kuma API",
            version: packageInfo.version,
            description: "Uptime Kuma REST API for monitoring management",
            contact: {
                name: "Uptime Kuma",
                url: "https://github.com/louislam/uptime-kuma"
            },           
        },
        servers: [
            {
                url: "/",
                description: "Uptime Kuma REST API v1 (Development)"
            },          
        ],
        components: {
            securitySchemes: {
                bearerAuth: {
                    type: "http",
                    scheme: "bearer",
                    bearerFormat: "JWT",
                    description: "JWT authorization header using the Bearer scheme. Example: \"Authorization: Bearer {token}\""
                },
                apiKeyAuth: {
                    type: "apiKey",
                    in: "header",
                    name: "Authorization",
                    description: "API key authorization header. Example: \"Authorization: {api_key}\""
                }                             
            }
        },
        security: [
            {
                bearerAuth: []
            },
            {
                apiKeyAuth: []
            }
        ],
        tags: [
            {
                name: "General",
                description: "General API endpoints"
            },
            {
                name: "Monitors",
                description: "Monitor management endpoints"
            },
            {
                name: "Notifications",
                description: "Notification management endpoints"
            },
            {
                name: "Status Pages",
                description: "Status page endpoints"
            },
            {
                name: "Heartbeats",
                description: "Monitor heartbeat data endpoints"
            },
            {
                name: "Push",
                description: "Push monitor endpoints"
            },
            {
                name: "Badges",
                description: "Badge generation endpoints"
            }
        ]
    },
    apis: [
        path.resolve(__dirname, "routers", "rest-api-router.js"),
        path.resolve(__dirname, "routers", "api-router.js"),
        path.resolve(__dirname, "routers", "status-page-router.js"),
        // path.resolve(__dirname, "swagger.js")
    ]
};

let specs;
try {
    specs = swaggerJsdoc(options);
    console.log("Swagger specs loaded successfully");
    console.log("Total paths found:", Object.keys(specs.paths || {}).length);
    console.log("Paths:", Object.keys(specs.paths || {}));
} catch (error) {
    console.error("Error loading Swagger specs:", error);
    specs = {
        openapi: "3.0.0",
        info: {
            title: "Uptime Kuma API",
            version: packageInfo.version,
            description: "API documentation failed to load"
        },
        paths: {}
    };
}

const swaggerOptions = {
    explorer: true, // 啟用 Explorer bar
    customSiteTitle: "Uptime Kuma API Documentation",
    customfavIcon: "/favicon.ico",
    swaggerOptions: {
        persistAuthorization: true,
        displayRequestDuration: true,
        filter: true,
        showExtensions: true,
        showCommonExtensions: true,
        docExpansion: "list",
        defaultModelsExpandDepth: 2,
        defaultModelExpandDepth: 2,
        tryItOutEnabled: true,
        supportedSubmitMethods: ['get', 'post', 'put', 'delete', 'patch'],
        operationsSorter: 'alpha',
        tagsSorter: 'alpha',
        validatorUrl: null, // Disable validator to prevent external requests
        plugins: [],
        layout: "BaseLayout", // Use standalone layout to prevent external loading
        url: "/api-docs.json", // 設定預設的 JSON 端點
        urls: undefined // Explicitly prevent default URLs loading
    },
    customCss: `
        .swagger-ui .topbar { display: none !important; }
        .swagger-ui .info .title { color: #5cdd8b !important; }
        .swagger-ui .scheme-container { background: #1f2937 !important; }
        .swagger-ui .info .description { color: #9ca3af !important; }
        .swagger-ui .info { margin: 20px 0 !important; }
        .swagger-ui .btn.authorize { 
            background-color: #5cdd8b !important; 
            border-color: #5cdd8b !important; 
            color: white !important;
        }
        .swagger-ui .btn.authorize:hover { 
            background-color: #4ade80 !important; 
            border-color: #4ade80 !important; 
        }
    `
};

/**
 * @swagger
 * components:
 *   schemas:
 *     Monitor:
 *       type: object
 *       required:
 *         - name
 *         - type
 *         - url
 *         - interval
 *       properties:
 *         id:
 *           type: integer
 *           description: Unique identifier for the monitor
 *           example: 1
 *         name:
 *           type: string
 *           description: Monitor display name
 *           example: "My Website"
 *         type:
 *           type: string
 *           description: Type of monitor
 *           enum: [http, port, ping, keyword, dns, docker, push, steam, gamedig, mqtt, sqlserver, postgres, mysql, mongodb, radius, redis, group, grpc, json-query, real-browser, tailscale-ping, kafka-producer, manual]
 *           example: "http"
 *         url:
 *           type: string
 *           description: URL to monitor
 *           example: "https://example.com"
 *         interval:
 *           type: integer
 *           description: Check interval in seconds
 *           minimum: 20
 *           example: 60
 *         active:
 *           type: boolean
 *           description: Whether the monitor is active
 *           example: true
 *         timeout:
 *           type: integer
 *           description: Request timeout in seconds
 *           example: 48
 *         retryInterval:
 *           type: integer
 *           description: Retry interval in seconds
 *           example: 60
 *         maxretries:
 *           type: integer
 *           description: Maximum number of retries
 *           example: 0
 *         weight:
 *           type: integer
 *           description: Monitor weight for ordering
 *           example: 2000
 *         upsideDown:
 *           type: boolean
 *           description: Invert status (up becomes down)
 *           example: false
 *         description:
 *           type: string
 *           description: Monitor description
 *           example: "Main website monitoring"
 *     
 *     Heartbeat:
 *       type: object
 *       properties:
 *         id:
 *           type: integer
 *           description: Heartbeat ID
 *           example: 12345
 *         monitor_id:
 *           type: integer
 *           description: Associated monitor ID
 *           example: 1
 *         status:
 *           type: integer
 *           description: Status code (0=DOWN, 1=UP, 2=PENDING, 3=MAINTENANCE)
 *           enum: [0, 1, 2, 3]
 *           example: 1
 *         time:
 *           type: string
 *           format: date-time
 *           description: Timestamp of the heartbeat
 *           example: "2023-12-01T10:30:00.000Z"
 *         ping:
 *           type: number
 *           description: Response time in milliseconds
 *           example: 245.6
 *         msg:
 *           type: string
 *           description: Status message
 *           example: "200 - OK"
 *         important:
 *           type: boolean
 *           description: Whether this heartbeat represents a status change
 *           example: false
 *         duration:
 *           type: integer
 *           description: Duration since last heartbeat in seconds
 *           example: 60
 *     
 *     Notification:
 *       type: object
 *       properties:
 *         id:
 *           type: integer
 *           description: Notification ID
 *           example: 1
 *         name:
 *           type: string
 *           description: Notification name
 *           example: "Email Alerts"
 *         type:
 *           type: string
 *           description: Notification type
 *           example: "smtp"
 *         isDefault:
 *           type: boolean
 *           description: Whether this is the default notification
 *           example: false
 *         active:
 *           type: boolean
 *           description: Whether the notification is active
 *           example: true
 *     
 *     ApiResponse:
 *       type: object
 *       properties:
 *         ok:
 *           type: boolean
 *           description: Whether the request was successful
 *           example: true
 *         msg:
 *           type: string
 *           description: Response message
 *           example: "Success"
 *         data:
 *           type: object
 *           description: Response data
 *     
 *     ErrorResponse:
 *       type: object
 *       properties:
 *         ok:
 *           type: boolean
 *           example: false
 *         msg:
 *           type: string
 *           description: Error message
 *           example: "Resource not found"
 *         errors:
 *           type: array
 *           description: Validation errors (if applicable)
 *           items:
 *             type: object
 *             properties:
 *               field:
 *                 type: string
 *                 description: Field name with error
 *                 example: "email"
 *               message:
 *                 type: string
 *                 description: Error message for the field
 *                 example: "Email is required"
 */

module.exports = {
    specs,
    swaggerUi,
    swaggerOptions
}; 