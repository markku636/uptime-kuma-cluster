<template>
    <div>
        <div class="add-btn">
            <button class="btn btn-primary me-2" type="button" @click="showAddDialog">
                <font-awesome-icon icon="plus" /> {{ $t("Add Node") }}
            </button>
        </div>

        <div>
            <span
                v-if="Object.keys(nodeList).length === 0"
                class="d-flex align-items-center justify-content-center my-3"
            >
                {{ $t("No Nodes") }}
            </span>

            <div
                v-for="(item, index) in nodeList"
                :key="index"
                class="item"
            >
                <div class="left-part">
                    <div class="circle" :class="getStatusClass(item.status)"></div>
                    <div class="info">
                        <div class="header-row">
                            <div class="title-section">
                                <div class="title">{{ item.nodeName }}</div>
                                <div class="node-id-inline">{{ item.nodeId }}</div>
                            </div>
                            <div class="badges">
                                <div v-if="item.isPrimary" class="primary-node-badge">
                                    {{ $t("Primary Node") }}
                                </div>
                                <div v-if="isCurrentNode(item.nodeId)" class="current-node-badge">
                                    {{ $t("Current Node") }}
                                </div>
                            </div>
                        </div>
                        <div class="details-row">
                            <div class="status">
                                <i class="fas fa-circle" :class="getStatusClass(item.status)"></i> 
                                {{ getStatusText(item.status) }}
                            </div>
                            <div class="host" v-if="item.host">
                                <i class="fas fa-server"></i> {{ item.host }}
                            </div>

                            <div class="last-heartbeat" v-if="item.lastHeartbeat">
                                <i class="fas fa-heartbeat"></i> {{ formatDateTime(item.lastHeartbeat) }}
                            </div>
                            <div class="date">
                                <i class="fas fa-calendar"></i> {{ formatDateTime(item.createdDate) }}
                            </div>
                        </div>
                    </div>
                </div>

                <div class="buttons">
                    <div class="btn-group" role="group">
                        <button class="btn btn-normal" @click="showEditDialog(item)">
                            <font-awesome-icon icon="edit" /> {{ $t("Edit") }}
                        </button>

                        <button 
                            class="btn btn-danger" 
                            @click="deleteDialog(item.id)"
                            :disabled="isCurrentNode(item.nodeId)"
                        >
                            <font-awesome-icon icon="trash" /> {{ $t("Delete") }}
                        </button>
                    </div>
                </div>
            </div>
        </div>

        <div class="text-center mt-3" style="font-size: 13px;">
            <p>{{ $t("Node management allows you to organize monitors across multiple Uptime Kuma instances.") }}</p>
        </div>

        <Confirm ref="confirmDelete" btn-style="btn-danger" :yes-text="$t('Yes')" :no-text="$t('No')" @yes="deleteNode">
            {{ $t("Are you sure you want to delete this node?") }}
        </Confirm>

        <!-- Add/Edit Node Dialog -->
        <div ref="nodeModal" class="modal fade" tabindex="-1" data-bs-backdrop="static">
            <div class="modal-dialog">
                <div class="modal-content">
                    <div class="modal-header">
                        <h4 class="modal-title">
                            {{ editingNode ? $t("Edit Node") : $t("Add Node") }}
                        </h4>
                        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                    </div>
                    <div class="modal-body">
                        <form @submit.prevent="saveNode">
                            <div class="mb-3">
                                <label for="nodeId" class="form-label">{{ $t("Node ID") }} *</label>
                                <input
                                    id="nodeId"
                                    v-model="nodeForm.nodeId"
                                    type="text"
                                    class="form-control"
                                    required
                                    :disabled="editingNode !== null"
                                />
                                <div class="form-text">{{ $t("Unique identifier for this node (cannot be changed after creation)") }}</div>
                            </div>

                            <div class="mb-3">
                                <label for="nodeName" class="form-label">{{ $t("Node Name") }} *</label>
                                <input
                                    id="nodeName"
                                    v-model="nodeForm.nodeName"
                                    type="text"
                                    class="form-control"
                                    required
                                />
                                <div class="form-text">{{ $t("Friendly name for this node") }}</div>
                            </div>

                            <div class="mb-3">
                                <label for="nodeHost" class="form-label">{{ $t("Host") }}</label>
                                <input
                                    id="nodeHost"
                                    v-model="nodeForm.host"
                                    type="text"
                                    class="form-control"
                                    placeholder="192.168.1.100 or example.com"
                                />
                                <div class="form-text">{{ $t("Optional host address for this node (IP address or hostname)") }}</div>
                            </div>



                            <div class="mb-3">
                                <div class="form-check">
                                    <input
                                        id="isPrimary"
                                        v-model="nodeForm.isPrimary"
                                        type="checkbox"
                                        class="form-check-input"
                                    />
                                    <label for="isPrimary" class="form-check-label">
                                        {{ $t("Primary Node") }}
                                    </label>
                                    <div class="form-text">{{ $t("Only one node can be set as primary. Setting this will make other nodes secondary.") }}</div>
                                </div>
                            </div>
                        </form>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">
                            {{ $t("Cancel") }}
                        </button>
                        <button type="button" class="btn btn-primary" @click="saveNode">
                            {{ editingNode ? $t("Update") : $t("Add") }}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>

<script>
import Confirm from "../Confirm.vue";
import { Modal } from "bootstrap";
import dayjs from "dayjs";

export default {
    components: {
        Confirm,
    },
    data() {
        return {
            selectedNodeId: null,
            editingNode: null,
            nodeForm: {
                nodeId: "",
                nodeName: "",
                host: "",
                isPrimary: false,
            },
            modal: null,
        };
    },
    computed: {
        nodeList() {
            return Object.values(this.$root.nodeList || {});
        },
    },
    mounted() {
        this.modal = new Modal(this.$refs.nodeModal);
        this.loadNodes();
    },
    methods: {
        /**
         * Load nodes from server
         */
        loadNodes() {
            this.$root.getSocket().emit("getNodeList", (res) => {
                if (res.ok) {
                    this.$root.nodeList = {};
                    res.nodes.forEach(node => {
                        // 使用 nodeId 作為鍵值，與 socket mixin 保持一致
                        this.$root.nodeList[node.nodeId] = node;
                    });
                }
            });
        },

        /**
         * Check if this is the current node
         * @param {string} nodeId Node ID to check
         * @returns {boolean} True if this is the current node
         */
        isCurrentNode(nodeId) {
            return this.$root.info && this.$root.info.currentNodeId === nodeId;
        },

        /**
         * Format date time
         * @param {string} dateTime DateTime string
         * @returns {string} Formatted date time
         */
        formatDateTime(dateTime) {
            return dayjs(dateTime).format("YYYY-MM-DD HH:mm:ss");
        },

        /**
         * Show add node dialog
         */
        showAddDialog() {
            this.editingNode = null;
            this.nodeForm = {
                nodeId: "",
                nodeName: "",
                host: "",
                isPrimary: false,
            };
            this.modal.show();
        },

        /**
         * Show edit node dialog
         * @param {object} node Node to edit
         */
        showEditDialog(node) {
            this.editingNode = node;
            this.nodeForm = {
                id: node.id,
                nodeId: node.nodeId,
                nodeName: node.nodeName,
                host: node.host || "",
                isPrimary: node.isPrimary || false,
            };
            this.modal.show();
        },

        /**
         * Save node (add or update)
         */
        saveNode() {
            if (this.editingNode) {
                // Update existing node
                this.$root.getSocket().emit("updateNode", this.nodeForm, (res) => {
                    this.$root.toastRes(res);
                    if (res.ok) {
                        this.modal.hide();
                        // Reload nodes to show updated primary status
                        this.loadNodes();
                    }
                });
            } else {
                // Add new node
                this.$root.getSocket().emit("addNode", this.nodeForm, (res) => {
                    this.$root.toastRes(res);
                    if (res.ok) {
                        this.modal.hide();
                        // Reload nodes to show new node
                        this.loadNodes();
                    }
                });
            }
        },

        /**
         * Show dialog to confirm deletion
         * @param {number} nodeId ID of node that is being deleted
         */
        deleteDialog(nodeId) {
            this.selectedNodeId = nodeId;
            this.$refs.confirmDelete.show();
        },

        /**
         * Delete a node
         */
        deleteNode() {
            this.$root.getSocket().emit("deleteNode", this.selectedNodeId, (res) => {
                this.$root.toastRes(res);
            });
        },

        /**
         * Get status CSS class for node
         * @param {string} status Node status
         * @returns {string} CSS class
         */
        getStatusClass(status) {
            switch (status) {
                case "online":
                    return "status-online";
                case "offline":
                    return "status-offline";
                default:
                    return "status-unknown";
            }
        },

        /**
         * Get status text for node
         * @param {string} status Node status
         * @returns {string} Status text
         */
        getStatusText(status) {
            switch (status) {
                case "online":
                    return this.$t("Online");
                case "offline":
                    return this.$t("Offline");
                default:
                    return this.$t("Unknown");
            }
        },
    },
};
</script>

<style lang="scss" scoped>
@import "../../assets/vars.scss";

.mobile {
    .item {
        flex-direction: column;
        align-items: flex-start;
        margin-bottom: 20px;
    }
}

.add-btn {
    padding-top: 20px;
    padding-bottom: 20px;
}

.item {
    display: flex;
    align-items: center;
    gap: 10px;
    text-decoration: none;
    border-radius: 10px;
    transition: all ease-in-out 0.15s;
    justify-content: space-between;
    padding: 10px;
    min-height: 90px;
    margin-bottom: 5px;

    &:hover {
        background-color: $highlight-white;
    }

    .circle {
        width: 25px;
        height: 25px;
        border-radius: 50%;
        background-color: $primary;
        margin-right: 15px;
        transition: background-color 0.2s;

        &.status-online {
            background-color: #28a745;
        }

        &.status-offline {
            background-color: #dc3545;
        }

        &.status-unknown {
            background-color: #6c757d;
        }
    }

    .left-part {
        display: flex;
        gap: 15px;
        align-items: center;
        flex-grow: 1;

        .info {
            flex-grow: 1;

            .header-row {
                display: flex;
                justify-content: space-between;
                align-items: flex-start;
                margin-bottom: 8px;
            }

            .title-section {
                flex-grow: 1;
            }

            .title {
                font-weight: bold;
                font-size: 20px;
                margin-bottom: 2px;
            }

            .node-id-inline {
                font-family: monaco, "Cascadia Code", "Roboto Mono", Courier, monospace;
                color: $secondary-text;
                font-size: 13px;
                background-color: rgba(0, 0, 0, 0.05);
                padding: 2px 6px;
                border-radius: 4px;
                display: inline-block;
            }

            .details-row {
                display: flex;
                gap: 15px;
                color: $secondary-text;
                font-size: 13px;
                align-items: center;
                flex-wrap: wrap;

                .ip, .date, .status, .last-heartbeat {
                    display: flex;
                    align-items: center;
                    gap: 5px;
                }

                .status .fas.fa-circle {
                    font-size: 8px;
                    
                    &.status-online {
                        color: #28a745;
                    }

                    &.status-offline {
                        color: #dc3545;
                    }

                    &.status-unknown {
                        color: #6c757d;
                    }
                }
            }

            .badges {
                display: flex;
                gap: 6px;
                flex-wrap: wrap;
                flex-shrink: 0;
            }

            .current-node-badge {
                display: inline-block;
                background-color: $primary;
                color: white;
                padding: 4px 8px;
                border-radius: 12px;
                font-size: 11px;
                font-weight: 500;
            }

            .primary-node-badge {
                display: inline-block;
                background-color: #007bff;
                color: white;
                padding: 4px 8px;
                border-radius: 12px;
                font-size: 11px;
                font-weight: 500;
            }
        }
    }

    .buttons {
        flex-shrink: 0;
    }
}

.dark {
    .item {
        &:hover {
            background-color: $dark-bg2;
        }
        
        .node-id-inline {
            background-color: rgba(255, 255, 255, 0.1);
            color: $dark-font-color2;
        }
    }
    
    .modal-content {
        background-color: $dark-bg;
        border: 1px solid $dark-border-color;
    }
    
    .modal-header {
        border-bottom: 1px solid $dark-border-color;
    }
    
    .modal-footer {
        border-top: 1px solid $dark-border-color;
    }
    
    .form-control {
        background-color: $dark-bg2;
        border-color: $dark-border-color;
        color: $dark-font-color;
        
        &:focus {
            background-color: $dark-bg2;
            border-color: $primary;
            color: $dark-font-color;
            box-shadow: 0 0 0 0.2rem rgba(0, 123, 255, 0.25);
        }
        
        &:disabled {
            background-color: $dark-bg;
            opacity: 0.6;
        }
    }
    
    .form-label {
        color: $dark-font-color;
    }
    
    .form-text {
        color: $dark-font-color2;
    }
    
    .form-check-label {
        color: $dark-font-color;
    }
}
</style> 