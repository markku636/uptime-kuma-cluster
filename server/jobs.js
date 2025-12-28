const { UptimeKumaServer } = require("./uptime-kuma-server");
const { reconcileMonitors } = require("./monitor-reconciler");
const { clearOldData } = require("./jobs/clear-old-data");
const { incrementalVacuum } = require("./jobs/incremental-vacuum");
const Cron = require("croner");

// Reconciliation interval - 預設 30 秒，可透過環境變數調整
const RECONCILE_INTERVAL_SEC = parseInt(process.env.RECONCILE_INTERVAL_SEC) || 30;

const jobs = [
    {
        name: "clear-old-data",
        interval: "14 03 * * *",
        jobFunc: clearOldData,
        croner: null,
    },
    {
        name: "incremental-vacuum",
        interval: "*/5 * * * *",
        jobFunc: incrementalVacuum,
        croner: null,
    }
    ,
    {
        name: "reconcile-monitors",
        // 使用環境變數 RECONCILE_INTERVAL_SEC，預設每 30 秒執行一次
        interval: `*/${RECONCILE_INTERVAL_SEC} * * * * *`,
        jobFunc: async () => {
            try {
                await reconcileMonitors();
            } catch (e) {
                // Avoid throwing from job
            }
        },
        croner: null,
    }
];

/**
 * Initialize background jobs
 * @returns {Promise<void>}
 */
const initBackgroundJobs = async function () {
    const timezone = await UptimeKumaServer.getInstance().getTimezone();

    for (const job of jobs) {
        const cornerJob = new Cron(
            job.interval,
            {
                name: job.name,
                timezone,
            },
            job.jobFunc,
        );
        job.croner = cornerJob;
    }

};

/**
 * Stop all background jobs if running
 * @returns {void}
 */
const stopBackgroundJobs = function () {
    for (const job of jobs) {
        if (job.croner) {
            job.croner.stop();
            job.croner = null;
        }
    }
};

module.exports = {
    initBackgroundJobs,
    stopBackgroundJobs
};
