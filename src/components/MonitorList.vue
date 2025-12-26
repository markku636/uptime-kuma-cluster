<template>
    <div class="shadow-box mb-3" :style="boxStyle">
        <div class="list-header">
            <div class="header-top">
                <button class="btn btn-outline-normal ms-2" :class="{ 'active': selectMode }" type="button" @click="selectMode = !selectMode">
                    {{ $t("Select") }}
                </button>

                <!-- Node Display Toggle - Moved to header-top for better visibility -->
                <div v-if="$root.info && $root.info.currentNodeId" class="node-toggle-section">
                    <div class="node-filter-indicator">
                        <button
                            type="button"
                            class="btn btn-link btn-sm node-switch-trigger"
                            @click="openNodeSwitchDialog"
                        >
                            <small class="text-muted">                            
                                {{ $t("Node") }}: {{ showAllNodes ? $t("All Nodes") : $root.info.currentNodeId }}
                            </small>
                        </button>
                    </div>
                    
                    <div class="form-check form-switch node-toggle">
                        <input 
                            id="showAllNodes" 
                            v-model="showAllNodes" 
                            class="form-check-input" 
                            type="checkbox"
                            @change="handleNodeToggle"
                        >
                        <label class="form-check-label" for="showAllNodes">
                            <small>{{ $t("Show All Nodes") }}</small>
                        </label>
                    </div>
                    
                    <!-- Performance Warning -->
                    <div v-if="showAllNodes && monitorCount > 50" class="performance-warning">
                        <small class="text-warning">
                            <font-awesome-icon icon="exclamation-triangle" />
                            {{ $t("Large dataset may affect performance") }}
                        </small>
                    </div>
                </div>

                <div class="placeholder"></div>
                <div class="search-wrapper">
                    <a v-if="searchText == ''" class="search-icon">
                        <font-awesome-icon icon="search" />
                    </a>
                    <a v-if="searchText != ''" class="search-icon" @click="clearSearchText">
                        <font-awesome-icon icon="times" />
                    </a>
                    <form>
                        <input
                            v-model="searchText"
                            class="form-control search-input"
                            :placeholder="$t('Search...')"
                            :aria-label="$t('Search monitored sites')"
                            autocomplete="off"
                        />
                    </form>
                </div>
            </div>
            <div class="header-filter">
                <MonitorListFilter :filterState="filterState" @update-filter="updateFilter" />
                
                <!-- 列標題 -->
                <div class="column-headers">
                    <div class="row">
                        <div class="col-5">
                            <small class="text-muted">{{ $t("Monitor") }}</small>
                        </div>
                        <div class="col-2 text-center">
                            <small class="text-muted">{{ $t("Node") }}</small>
                        </div>
                        <div class="col-5">
                            <small class="text-muted">{{ $t("Status") }}</small>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Selection Controls -->
            <div v-if="selectMode" class="selection-controls px-2 pt-2">
                <input
                    v-model="selectAll"
                    class="form-check-input select-input"
                    type="checkbox"
                />

                <button class="btn-outline-normal" @click="pauseDialog"><font-awesome-icon icon="pause" size="sm" /> {{ $t("Pause") }}</button>
                <button class="btn-outline-normal" @click="resumeSelected"><font-awesome-icon icon="play" size="sm" /> {{ $t("Resume") }}</button>

                <span v-if="selectedMonitorCount > 0">
                    {{ $t("selectedMonitorCount", [ selectedMonitorCount ]) }}
                </span>
            </div>
        </div>
        <div ref="monitorList" class="monitor-list" :class="{ scrollbar: scrollbar }" :style="monitorListStyle" data-testid="monitor-list">
            <div v-if="Object.keys($root.monitorList).length === 0" class="text-center mt-3">
                {{ $t("No Monitors, please") }} <router-link to="/add">{{ $t("add one") }}</router-link>
            </div>

            <MonitorListItem
                v-for="(item, index) in sortedMonitorList"
                :key="index"
                :monitor="item"
                :isSelectMode="selectMode"
                :isSelected="isSelected"
                :select="select"
                :deselect="deselect"
                :filter-func="filterFunc"
                :sort-func="sortFunc"
            />
        </div>
    </div>

    <Confirm ref="confirmPause" :yes-text="$t('Yes')" :no-text="$t('No')" @yes="pauseSelected">
        {{ $t("pauseMonitorMsg") }}
    </Confirm>

    <!-- OpenResty Fixed Node Switcher -->
    <div v-if="showNodeSwitchDialog" class="node-switch-backdrop" @click.self="closeNodeSwitchDialog">
        <div class="node-switch-modal">
            <div class="modal-header">
                <h5 class="modal-title">Select Node</h5>
                <button type="button" class="btn-close" aria-label="Close" @click="closeNodeSwitchDialog"></button>
            </div>
            <div class="modal-body">
                <p class="mb-2 small text-muted">
                    Choose which backend node OpenResty should route you to.
                </p>

                <div v-if="lbLoading" class="text-center py-3">
                    <span>{{ $t("Loading") }}...</span>
                </div>

                <div v-else>
                    <div v-if="lbError" class="alert alert-danger py-2 px-3 small">
                        {{ lbError }}
                    </div>

                    <div v-if="lbNodes && lbNodes.length > 0">
                        <button
                            v-for="node in lbNodes"
                            :key="node.node_id"
                            type="button"
                            class="btn w-100 mb-2 node-option-btn"
                            :class="getNodeButtonClass(node)"
                            @click="switchToNode(node.node_id)"
                        >
                            <div class="d-flex justify-content-between align-items-center">
                                <div>
                                    <strong>{{ node.node_id }}</strong>
                                    <span
                                        v-if="lbStatus && lbStatus.current_node === node.node_id"
                                        class="badge bg-light text-dark ms-2"
                                    >
                                        Current
                                    </span>
                                </div>
                                <small class="text-muted">
                                    Monitors: {{ node.monitor_count }}
                                </small>
                            </div>
                        </button>
                    </div>

                    <div v-else-if="!lbError" class="text-muted small">
                        No nodes available from load balancer.
                    </div>
                </div>
            </div>
            <div class="modal-footer d-flex justify-content-between">
                <button type="button" class="btn btn-outline-secondary btn-sm" @click="clearFixedNode">
                    Use Load Balancer (auto)
                </button>
                <button type="button" class="btn btn-secondary btn-sm" @click="closeNodeSwitchDialog">
                    {{ $t("Cancel") }}
                </button>
            </div>
        </div>
    </div>
</template>

<script>
import Confirm from "../components/Confirm.vue";
import MonitorListItem from "../components/MonitorListItem.vue";
import MonitorListFilter from "./MonitorListFilter.vue";
import { getMonitorRelativeURL } from "../util.ts";

export default {
    components: {
        Confirm,
        MonitorListItem,
        MonitorListFilter,
    },
    props: {
        /** Should the scrollbar be shown */
        scrollbar: {
            type: Boolean,
        },
    },
    data() {
        return {
            searchText: "",
            selectMode: false,
            selectAll: false,
            disableSelectAllWatcher: false,
            selectedMonitors: {},
            windowTop: 0,
            filterState: {
                status: null,
                active: null,
                tags: null,
            },
            showAllNodes: false,
            monitorCount: 0,
            originalMonitorList: null,
            // OpenResty fixed-node switcher state
            showNodeSwitchDialog: false,
            lbNodes: [],
            lbStatus: null,
            lbLoading: false,
            lbError: null
        };
    },
    computed: {
        /**
         * Improve the sticky appearance of the list by increasing its
         * height as user scrolls down.
         * Not used on mobile.
         * @returns {object} Style for monitor list
         */
        boxStyle() {
            if (window.innerWidth > 550) {
                return {
                    height: `calc(100vh - 160px + ${this.windowTop}px)`,
                };
            } else {
                return {
                    height: "calc(100vh - 160px)",
                };
            }

        },

        /**
         * Returns a sorted list of monitors based on the applied filters and search text.
         * @returns {Array} The sorted list of monitors.
         */
        sortedMonitorList() {
            let result = Object.values(this.$root.monitorList);

            result = result.filter(monitor => {
                // The root list does not show children
                if (monitor.parent !== null) {
                    return false;
                }
                return true;
            });

            result = result.filter(this.filterFunc);

            result.sort(this.sortFunc);

            return result;
        },

        isDarkTheme() {
            return document.body.classList.contains("dark");
        },

        monitorListStyle() {
            let listHeaderHeight = 107;

            if (this.selectMode) {
                listHeaderHeight += 42;
            }

            return {
                "height": `calc(100% - ${listHeaderHeight}px)`
            };
        },

        selectedMonitorCount() {
            return Object.keys(this.selectedMonitors).length;
        },

        /**
         * Determines if any filters are active.
         * @returns {boolean} True if any filter is active, false otherwise.
         */
        filtersActive() {
            const nodeFilterActive = this.$root.info && this.$root.info.currentNodeId;
            return this.filterState.status != null || this.filterState.active != null || this.filterState.tags != null || this.searchText !== "" || nodeFilterActive;
        }
    },
    watch: {
        searchText() {
            for (let monitor of this.sortedMonitorList) {
                if (!this.selectedMonitors[monitor.id]) {
                    if (this.selectAll) {
                        this.disableSelectAllWatcher = true;
                        this.selectAll = false;
                    }
                    break;
                }
            }
        },
        selectAll() {
            if (!this.disableSelectAllWatcher) {
                this.selectedMonitors = {};

                if (this.selectAll) {
                    this.sortedMonitorList.forEach((item) => {
                        this.selectedMonitors[item.id] = true;
                    });
                }
            } else {
                this.disableSelectAllWatcher = false;
            }
        },
        selectMode() {
            if (!this.selectMode) {
                this.selectAll = false;
                this.selectedMonitors = {};
            }
        },
        showAllNodes() {
            this.handleNodeToggle();
            // Save the showAllNodes preference to localStorage
            localStorage.setItem("uptimeKumaShowAllNodes", JSON.stringify(this.showAllNodes));
        },
    },
    mounted() {
        window.addEventListener("scroll", this.onScroll);
        this.monitorCount = Object.keys(this.$root.monitorList).length;
        
        // Save the initial monitor list for potential restoration
        if (this.$root.monitorList && Object.keys(this.$root.monitorList).length > 0) {
            this.originalMonitorList = { ...this.$root.monitorList };
        }
        
        // Load saved showAllNodes preference from localStorage
        const savedShowAllNodes = localStorage.getItem("uptimeKumaShowAllNodes");
        if (savedShowAllNodes !== null) {
            const shouldShowAllNodes = JSON.parse(savedShowAllNodes);
            if (shouldShowAllNodes) {
                // Set the flag and request all monitors without triggering the watcher
                this.showAllNodes = true;
                // Directly request all monitors to avoid watcher issues
                this.requestAllMonitors();
            }
        }
    },
    beforeUnmount() {
        window.removeEventListener("scroll", this.onScroll);
    },
    methods: {
        /**
         * Handle user scroll
         * @returns {void}
         */
        onScroll() {
            if (window.top.scrollY <= 133) {
                this.windowTop = window.top.scrollY;
            } else {
                this.windowTop = 133;
            }
        },
        /**
         * Get URL of monitor
         * @param {number} id ID of monitor
         * @returns {string} Relative URL of monitor
         */
        monitorURL(id) {
            return getMonitorRelativeURL(id);
        },
        /**
         * Clear the search bar
         * @returns {void}
         */
        clearSearchText() {
            this.searchText = "";
        },
        /**
         * Update the MonitorList Filter
         * @param {object} newFilter Object with new filter
         * @returns {void}
         */
        updateFilter(newFilter) {
            this.filterState = newFilter;
        },
        /**
         * Deselect a monitor
         * @param {number} id ID of monitor
         * @returns {void}
         */
        deselect(id) {
            delete this.selectedMonitors[id];
        },
        /**
         * Select a monitor
         * @param {number} id ID of monitor
         * @returns {void}
         */
        select(id) {
            this.selectedMonitors[id] = true;
        },
        /**
         * Determine if monitor is selected
         * @param {number} id ID of monitor
         * @returns {bool} Is the monitor selected?
         */
        isSelected(id) {
            return id in this.selectedMonitors;
        },
        /**
         * Disable select mode and reset selection
         * @returns {void}
         */
        cancelSelectMode() {
            this.selectMode = false;
            this.selectedMonitors = {};
        },
        /**
         * Show dialog to confirm pause
         * @returns {void}
         */
        pauseDialog() {
            this.$refs.confirmPause.show();
        },
        /**
         * Pause each selected monitor
         * @returns {void}
         */
        pauseSelected() {
            Object.keys(this.selectedMonitors)
                .filter(id => this.$root.monitorList[id].active)
                .forEach(id => this.$root.getSocket().emit("pauseMonitor", id, () => {}));

            this.cancelSelectMode();
        },
        /**
         * Resume each selected monitor
         * @returns {void}
         */
        resumeSelected() {
            Object.keys(this.selectedMonitors)
                .filter(id => !this.$root.monitorList[id].active)
                .forEach(id => this.$root.getSocket().emit("resumeMonitor", id, () => {}));

            this.cancelSelectMode();
        },
        /**
         * Whether a monitor should be displayed based on the filters
         * @param {object} monitor Monitor to check
         * @returns {boolean} Should the monitor be displayed
         */
        filterFunc(monitor) {
            // Group monitors bypass filter if at least 1 of children matched
            if (monitor.type === "group") {
                const children = Object.values(this.$root.monitorList).filter(m => m.parent === monitor.id);
                if (children.some((child, index, children) => this.filterFunc(child))) {
                    return true;
                }
            }

            // 節點過濾邏輯已移至後端處理，前端不再需要額外的節點過濾
            let nodeMatch = true;

            // filter by search text
            // finds monitor name, tag name or tag value
            let searchTextMatch = true;
            if (this.searchText !== "") {
                const loweredSearchText = this.searchText.toLowerCase();
                searchTextMatch =
                    monitor.name.toLowerCase().includes(loweredSearchText)
                    || monitor.tags.find(tag => tag.name.toLowerCase().includes(loweredSearchText)
                        || tag.value?.toLowerCase().includes(loweredSearchText));
            }

            // filter by status
            let statusMatch = true;
            if (this.filterState.status != null && this.filterState.status.length > 0) {
                if (monitor.id in this.$root.lastHeartbeatList && this.$root.lastHeartbeatList[monitor.id]) {
                    monitor.status = this.$root.lastHeartbeatList[monitor.id].status;
                }
                statusMatch = this.filterState.status.includes(monitor.status);
            }

            // filter by active
            let activeMatch = true;
            if (this.filterState.active != null && this.filterState.active.length > 0) {
                activeMatch = this.filterState.active.includes(monitor.active);
            }

            // filter by tags
            let tagsMatch = true;
            if (this.filterState.tags != null && this.filterState.tags.length > 0) {
                tagsMatch = monitor.tags.map(tag => tag.tag_id) // convert to array of tag IDs
                    .filter(monitorTagId => this.filterState.tags.includes(monitorTagId)) // perform Array Intersaction between filter and monitor's tags
                    .length > 0;
            }

            return nodeMatch && searchTextMatch && statusMatch && activeMatch && tagsMatch;
        },
        /**
         * Function used in Array.sort to order monitors in a list.
         * @param {*} m1 monitor 1
         * @param {*} m2 monitor 2
         * @returns {number} -1, 0 or 1
         */
        sortFunc(m1, m2) {
            if (m1.active !== m2.active) {
                if (m1.active === false) {
                    return 1;
                }

                if (m2.active === false) {
                    return -1;
                }
            }

            if (m1.weight !== m2.weight) {
                if (m1.weight > m2.weight) {
                    return -1;
                }

                if (m1.weight < m2.weight) {
                    return 1;
                }
            }

            return m1.name.localeCompare(m2.name);
        },
        /**
         * Request all monitors from all nodes without triggering the watcher
         * This method is used during component initialization
         */
        requestAllMonitors() {
            this.$root.getSocket().emit("getAllMonitors", (res) => {
                if (res.ok) {
                    // Update monitor list with all monitors
                    this.$root.monitorList = res.data;
                    this.monitorCount = Object.keys(res.data).length;
                    
                    // Show performance warning if too many monitors
                    if (this.monitorCount > 100) {
                        this.$root.toastWarning(this.$t("Large dataset loaded. Performance may be affected."));
                    }
                } else {
                    this.$root.toastError(res.msg);
                    this.showAllNodes = false; // Revert toggle on error
                }
            });
        },
        handleNodeToggle() {
            this.monitorCount = Object.keys(this.$root.monitorList).length;
            
            if (this.showAllNodes) {
                // Save current monitor list before requesting all monitors
                if (!this.originalMonitorList) {
                    this.originalMonitorList = { ...this.$root.monitorList };
                }
                
                // Request all monitors from all nodes
                this.requestAllMonitors();
            } else {
                // Restore original monitor list or request current node monitors
                if (this.originalMonitorList) {
                    this.$root.monitorList = this.originalMonitorList;
                    this.originalMonitorList = null;
                } else {
                    // If no original list exists, request current node monitors
                    // This happens when user first loads the page and toggles showAllNodes
                    this.$root.getSocket().emit("getMonitorList");
                    // The monitorList event will be handled by the socket mixin
                }
                this.monitorCount = Object.keys(this.$root.monitorList).length;
            }
        },

        /**
         * Open the OpenResty fixed-node switch dialog
         */
        openNodeSwitchDialog() {
            this.showNodeSwitchDialog = true;
            this.lbError = null;
            this.lbLoading = true;

            Promise.all([
                fetch("/lb/available-nodes", {
                    credentials: "same-origin",
                }).then((res) => {
                    if (!res.ok) {
                        throw new Error("Failed to load available nodes");
                    }
                    return res.json();
                }),
                fetch("/lb/fixed-node-status", {
                    credentials: "same-origin",
                }).then((res) => {
                    if (!res.ok) {
                        throw new Error("Failed to load fixed node status");
                    }
                    return res.json();
                }),
            ]).then(([nodesRes, statusRes]) => {
                this.lbNodes = nodesRes.available_nodes || [];
                this.lbStatus = statusRes || null;
            }).catch((err) => {
                console.error(err);
                this.lbError = err.message || "Failed to load load balancer status";
            }).finally(() => {
                this.lbLoading = false;
            });
        },

        /**
         * Close the node switch dialog
         */
        closeNodeSwitchDialog() {
            if (this.lbLoading) {
                return;
            }
            this.showNodeSwitchDialog = false;
        },

        /**
         * Get button class for a node option
         * @param {object} node
         * @returns {string}
         */
        getNodeButtonClass(node) {
            const isCurrent = this.lbStatus && this.lbStatus.current_node === node.node_id;
            return isCurrent ? "btn-primary" : "btn-outline-primary";
        },

        /**
         * Switch OpenResty fixed node via /lb/set-fixed-node
         * @param {string} nodeId
         */
        async switchToNode(nodeId) {
            try {
                this.lbError = null;
                this.lbLoading = true;

                const res = await fetch("/lb/set-fixed-node", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    credentials: "same-origin",
                    body: JSON.stringify({ node: nodeId }),
                });

                if (!res.ok) {
                    const text = await res.text();
                    throw new Error(text || `Failed to switch to ${nodeId}`);
                }

                if (this.$root.toastSuccess) {
                    this.$root.toastSuccess(`Switched to ${nodeId}`);
                }

                // Reload page so subsequent requests go to the new node
                window.location.reload();
            } catch (err) {
                console.error(err);
                this.lbError = err.message || "Failed to switch node";
                if (this.$root.toastError) {
                    this.$root.toastError(this.lbError);
                }
            } finally {
                this.lbLoading = false;
            }
        },

        /**
         * Clear fixed node cookie and return to normal load balancing
         */
        async clearFixedNode() {
            try {
                this.lbError = null;
                this.lbLoading = true;

                const res = await fetch("/lb/clear-fixed-node", {
                    method: "GET",
                    credentials: "same-origin",
                });

                if (!res.ok) {
                    const text = await res.text();
                    throw new Error(text || "Failed to clear fixed node");
                }

                if (this.$root.toastSuccess) {
                    this.$root.toastSuccess("Using automatic load balancing");
                }

                window.location.reload();
            } catch (err) {
                console.error(err);
                this.lbError = err.message || "Failed to clear fixed node";
                if (this.$root.toastError) {
                    this.$root.toastError(this.lbError);
                }
            } finally {
                this.lbLoading = false;
            }
        },
    },
};
</script>

<style lang="scss" scoped>
@import "../assets/vars.scss";

.shadow-box {
    height: calc(100vh - 150px);
    position: sticky;
    top: 10px;
}

.node-switch-trigger {
    padding: 0;
    border: 0;
    color: inherit;
    text-decoration: none;
}

.node-switch-backdrop {
    position: fixed;
    inset: 0;
    background-color: rgba(0, 0, 0, 0.5);
    z-index: 1050;
    display: flex;
    align-items: center;
    justify-content: center;
    backdrop-filter: blur(2px);
}

.node-switch-modal {
    background-color: #ffffff;
    border-radius: 12px;
    min-width: 320px;
    max-width: 420px;
    width: 100%;
    box-shadow: 0 18px 45px rgba(0, 0, 0, 0.55);
    overflow: hidden;
}

.node-switch-modal .modal-header {
    padding: 12px 16px;
    border-bottom: 1px solid rgba(0, 0, 0, 0.06);
}

.node-switch-modal .modal-title {
    font-size: 15px;
    font-weight: 600;
}

.node-switch-modal .modal-body {
    padding: 12px 16px 8px;
}

.node-switch-modal .modal-footer {
    padding: 8px 16px 12px;
    border-top: 1px solid rgba(0, 0, 0, 0.06);
}

.node-option-btn {
    text-align: left;
    border-radius: 999px;
    border-width: 1px;
    padding: 8px 14px;
    font-size: 13px;
}

.node-option-btn.btn-primary {
    background: linear-gradient(90deg, $primary, $highlight);
    border-color: transparent;
    color: #000;
}

.node-option-btn.btn-outline-primary {
    border-color: rgba(124, 232, 164, 0.4);
    color: inherit;
}

.node-option-btn .badge {
    font-size: 10px;
}

.dark {
    .node-switch-modal {
        background-color: $dark-bg2;
        border: 1px solid $dark-border-color;
    }

    .node-switch-modal .modal-header {
        border-bottom-color: $dark-border-color;
    }

    .node-switch-modal .modal-footer {
        border-top-color: $dark-border-color;
    }

    .node-option-btn.btn-outline-primary {
        border-color: rgba(124, 232, 164, 0.35);
    }

    .node-option-btn.btn-primary {
        color: #020b05;
    }
}

.small-padding {
    padding-left: 5px !important;
    padding-right: 5px !important;
}

.list-header {
    border-bottom: 1px solid #dee2e6;
    border-radius: 10px 10px 0 0;
    margin: -10px;
    margin-bottom: 10px;
    padding: 10px;

    .dark & {
        background-color: $dark-header-bg;
        border-bottom: 0;
    }
}

.header-top {
    display: flex;
    justify-content: space-between;
    align-items: center;
}

.header-filter {
    display: flex;
    align-items: center;
}

@media (max-width: 770px) {
    .list-header {
        margin: -20px;
        margin-bottom: 10px;
        padding: 5px;
    }
}

.search-wrapper {
    display: flex;
    align-items: center;
}

.search-icon {
    padding: 10px;
    color: #c0c0c0;

    // Clear filter button (X)
    svg[data-icon="times"] {
        cursor: pointer;
        transition: all ease-in-out 0.1s;

        &:hover {
            opacity: 0.5;
        }
    }
}

.search-input {
    max-width: 15em;
}

.monitor-item {
    width: 100%;
}

.tags {
    margin-top: 4px;
    padding-left: 67px;
    display: flex;
    flex-wrap: wrap;
    gap: 0;
}

.bottom-style {
    padding-left: 67px;
    margin-top: 5px;
}

.selection-controls {
    margin-top: 5px;
    display: flex;
    align-items: center;
    gap: 10px;
}

.node-filter-indicator {
    margin-left: 10px;
    padding: 4px 8px;
    background-color: rgba(0, 123, 255, 0.1);
    border: 1px solid rgba(0, 123, 255, 0.2);
    border-radius: 4px;
    
    .dark & {
        background-color: rgba(108, 117, 125, 0.2);
        border-color: rgba(108, 117, 125, 0.3);
    }
    
    svg {
        margin-right: 4px;
    }
}

.node-toggle-section {
    display: flex;
    align-items: center;
    gap: 10px;
}

.form-check {
    display: flex;
    align-items: center;
}

.form-check-input {
    margin-right: 5px;
}

.form-check-label {
    margin-right: 10px;
}

.performance-warning {
    margin-left: 10px;
    padding: 4px 8px;
    background-color: rgba(255, 215, 0, 0.1);
    border: 1px solid rgba(255, 215, 0, 0.2);
    border-radius: 4px;
    
    .dark & {
        background-color: rgba(108, 117, 125, 0.2);
        border-color: rgba(108, 117, 125, 0.3);
    }
    
    svg {
        margin-right: 4px;
    }
}

.column-headers {
    margin-top: 10px;
    padding: 8px 0;
    border-bottom: 1px solid rgba(0, 0, 0, 0.1);
    
    .dark & {
        border-bottom-color: rgba(255, 255, 255, 0.1);
    }
    
    .text-center {
        text-align: center;
    }
    
    small {
        font-weight: 500;
        text-transform: uppercase;
        letter-spacing: 0.5px;
    }
}
</style>
