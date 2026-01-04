/**
 * 集群環境偵測工具
 * 支援 Docker Compose 和 Kubernetes 雙環境
 * 
 * @module server/util/cluster-env
 */

const { log } = require("../../src/util");

class ClusterEnv {
    constructor() {
        this._detectEnvironment();
        this._logEnvironmentInfo();
    }

    /**
     * 偵測當前運行環境
     * @private
     */
    _detectEnvironment() {
        // 偵測 K8s 環境的標誌
        // KUBERNETES_SERVICE_HOST 是 K8s 自動注入的環境變數
        this.isK8s = !!(
            process.env.KUBERNETES_SERVICE_HOST ||
            process.env.K8S_MODE === "true" ||
            process.env.NAMESPACE
        );

        // 偵測 Docker Compose 環境
        this.isDockerCompose = !this.isK8s && !!(
            process.env.UPTIME_KUMA_NODE_HOST?.includes("uptime-kuma-node") ||
            process.env.COMPOSE_PROJECT_NAME ||
            // 檢查 node_id 格式是否為 docker-compose 格式 (node1, node2...)
            this._isDockerComposeNodeIdFormat(process.env.UPTIME_KUMA_NODE_ID)
        );

        // 本地開發環境
        this.isLocal = !this.isK8s && !this.isDockerCompose;

        // 環境名稱
        this.environmentName = this.isK8s ? "kubernetes" :
            this.isDockerCompose ? "docker-compose" : "local";
    }

    /**
     * 檢查 node_id 是否為 Docker Compose 格式
     * @private
     * @param {string} nodeId 
     * @returns {boolean}
     */
    _isDockerComposeNodeIdFormat(nodeId) {
        if (!nodeId) return false;
        return /^node\d+$/.test(nodeId);
    }

    /**
     * 記錄環境資訊
     * @private
     */
    _logEnvironmentInfo() {
        log.info("cluster-env", "========================================");
        log.info("cluster-env", "Cluster Environment Detection");
        log.info("cluster-env", "========================================");
        log.info("cluster-env", `Environment: ${this.environmentName}`);
        log.info("cluster-env", `Is K8s: ${this.isK8s}`);
        log.info("cluster-env", `Is Docker Compose: ${this.isDockerCompose}`);
        log.info("cluster-env", `Is Local: ${this.isLocal}`);

        if (this.isK8s) {
            log.info("cluster-env", `Namespace: ${process.env.NAMESPACE || "default"}`);
            log.info("cluster-env", `K8s Service Host: ${process.env.KUBERNETES_SERVICE_HOST || "N/A"}`);
        }

        log.info("cluster-env", "========================================");
    }

    /**
     * 取得環境名稱
     * @returns {'kubernetes' | 'docker-compose' | 'local'}
     */
    getEnvironmentName() {
        return this.environmentName;
    }

    /**
     * 偵測 Node ID 格式
     * @param {string} nodeId 
     * @returns {'k8s-statefulset' | 'docker-compose' | 'custom'}
     */
    detectNodeIdFormat(nodeId) {
        if (!nodeId) return "custom";

        // K8s StatefulSet 格式: xxx-0, xxx-1, uptime-kuma-0
        if (/^[\w-]+-\d+$/.test(nodeId)) {
            return "k8s-statefulset";
        }

        // Docker Compose 格式: node1, node2
        if (/^node\d+$/.test(nodeId)) {
            return "docker-compose";
        }

        return "custom";
    }

    /**
     * 從 Node ID 提取索引
     * @param {string} nodeId 
     * @returns {number|null}
     */
    extractNodeIndex(nodeId) {
        if (!nodeId) return null;

        // K8s 格式: uptime-kuma-0 -> 0
        const k8sMatch = nodeId.match(/-(\d+)$/);
        if (k8sMatch) return parseInt(k8sMatch[1], 10);

        // Docker Compose 格式: node1 -> 0 (1-indexed to 0-indexed)
        const dockerMatch = nodeId.match(/^node(\d+)$/);
        if (dockerMatch) return parseInt(dockerMatch[1], 10) - 1;

        return null;
    }

    /**
     * 判斷是否為主節點
     * @param {string} nodeId 
     * @returns {boolean}
     */
    isPrimaryNode(nodeId) {
        // 環境變數明確指定
        if (process.env.UPTIME_KUMA_PRIMARY === "1" ||
            process.env.UPTIME_KUMA_PRIMARY === "true") {
            return true;
        }

        // 根據索引判斷（index 0 為主節點）
        const index = this.extractNodeIndex(nodeId);
        return index === 0;
    }

    /**
     * 構建 Node Host
     * @param {string} nodeId 
     * @returns {string}
     */
    buildNodeHost(nodeId) {
        // 如果環境變數已指定，直接使用
        if (process.env.UPTIME_KUMA_NODE_HOST) {
            return process.env.UPTIME_KUMA_NODE_HOST;
        }

        const port = process.env.UPTIME_KUMA_PORT || "3001";

        if (this.isK8s) {
            // K8s Headless Service DNS 格式
            // <pod-name>.<headless-service>.<namespace>.svc.cluster.local
            const namespace = process.env.NAMESPACE || "default";
            const serviceName = process.env.HEADLESS_SERVICE_NAME || "uptime-kuma-headless";
            return `${nodeId}.${serviceName}.${namespace}.svc.cluster.local:${port}`;
        }

        if (this.isDockerCompose) {
            // Docker Compose 格式
            const format = this.detectNodeIdFormat(nodeId);
            if (format === "docker-compose") {
                // node1 -> uptime-kuma-node1
                return `uptime-kuma-${nodeId}:${port}`;
            }
            // 自定義格式，假設 container name = nodeId
            return `${nodeId}:${port}`;
        }

        // 本地開發
        return `127.0.0.1:${port}`;
    }

    /**
     * 取得 DNS 伺服器
     * @returns {string[]}
     */
    getDnsServers() {
        // 如果有環境變數指定，使用之
        if (process.env.DNS_SERVERS) {
            return process.env.DNS_SERVERS.split(",").map(s => s.trim());
        }

        if (this.isK8s) {
            // K8s CoreDNS - 通常使用 /etc/resolv.conf
            // 但可以透過環境變數覆寫
            return process.env.K8S_DNS_SERVER ?
                [process.env.K8S_DNS_SERVER] : ["10.96.0.10"];
        }

        if (this.isDockerCompose) {
            // Docker 內建 DNS
            return ["127.0.0.11"];
        }

        // 本地環境
        return ["8.8.8.8", "8.8.4.4"];
    }

    /**
     * 取得完整的節點配置
     * @param {string} nodeId 
     * @returns {Object}
     */
    getNodeConfig(nodeId) {
        return {
            nodeId: nodeId,
            nodeName: process.env.UPTIME_KUMA_NODE_NAME || nodeId,
            nodeHost: this.buildNodeHost(nodeId),
            isPrimary: this.isPrimaryNode(nodeId),
            nodeFormat: this.detectNodeIdFormat(nodeId),
            nodeIndex: this.extractNodeIndex(nodeId),
            environment: this.environmentName
        };
    }

    /**
     * 驗證節點配置
     * @param {string} nodeId 
     * @returns {{valid: boolean, errors: string[]}}
     */
    validateNodeConfig(nodeId) {
        const errors = [];

        if (!nodeId) {
            errors.push("Node ID is required");
        }

        const format = this.detectNodeIdFormat(nodeId);

        // 在 K8s 環境中，建議使用 StatefulSet 格式
        if (this.isK8s && format === "docker-compose") {
            log.warn("cluster-env", `Node ID '${nodeId}' uses Docker Compose format in K8s environment. Consider using StatefulSet format (e.g., uptime-kuma-0)`);
        }

        // 在 Docker Compose 環境中，建議使用 node1 格式
        if (this.isDockerCompose && format === "k8s-statefulset") {
            log.warn("cluster-env", `Node ID '${nodeId}' uses K8s format in Docker Compose environment. Consider using docker-compose format (e.g., node1)`);
        }

        return {
            valid: errors.length === 0,
            errors: errors
        };
    }
}

// 單例模式
let instance = null;

/**
 * 取得 ClusterEnv 實例
 * @returns {ClusterEnv}
 */
function getClusterEnv() {
    if (!instance) {
        instance = new ClusterEnv();
    }
    return instance;
}

// 匯出單例
module.exports = getClusterEnv();

// 也匯出類別供測試使用
module.exports.ClusterEnv = ClusterEnv;
