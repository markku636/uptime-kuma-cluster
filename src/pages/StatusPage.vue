<template>
    <div v-if="loadedTheme" class="container mt-3">
        <!-- Sidebar for edit mode -->
        <div v-if="enableEditMode" class="sidebar" data-testid="edit-sidebar">
            <div class="sidebar-body">
                <div class="my-3">
                    <label for="slug" class="form-label">{{ $t("Slug") }}</label>
                    <div class="input-group">
                        <span id="basic-addon3" class="input-group-text">/status/</span>
                        <input id="slug" v-model="config.slug" type="text" class="form-control">
                    </div>
                </div>

                <div class="my-3">
                    <label for="title" class="form-label">{{ $t("Title") }}</label>
                    <input id="title" v-model="config.title" type="text" class="form-control">
                </div>

                <!-- Description -->
                <div class="my-3">
                    <label for="description" class="form-label">{{ $t("Description") }}</label>
                    <textarea id="description" v-model="config.description" class="form-control" data-testid="description-input"></textarea>
                    <div class="form-text">
                        {{ $t("markdownSupported") }}
                    </div>
                </div>

                <!-- Footer Text -->
                <div class="my-3">
                    <label for="footer-text" class="form-label">{{ $t("Footer Text") }}</label>
                    <textarea id="footer-text" v-model="config.footerText" class="form-control" data-testid="footer-text-input"></textarea>
                    <div class="form-text">
                        {{ $t("markdownSupported") }}
                    </div>
                </div>

                <div class="my-3">
                    <label for="auto-refresh-interval" class="form-label">{{ $t("Refresh Interval") }}</label>
                    <input id="auto-refresh-interval" v-model="config.autoRefreshInterval" type="number" class="form-control" :min="5" data-testid="refresh-interval-input">
                    <div class="form-text">
                        {{ $t("Refresh Interval Description", [config.autoRefreshInterval]) }}
                    </div>
                </div>

                <div class="my-3">
                    <label for="switch-theme" class="form-label">{{ $t("Theme") }}</label>
                    <select id="switch-theme" v-model="config.theme" class="form-select" data-testid="theme-select">
                        <option value="auto">{{ $t("Auto") }}</option>
                        <option value="light">{{ $t("Light") }}</option>
                        <option value="dark">{{ $t("Dark") }}</option>
                    </select>
                </div>

                <div class="my-3 form-check form-switch">
                    <input id="showTags" v-model="config.showTags" class="form-check-input" type="checkbox" data-testid="show-tags-checkbox">
                    <label class="form-check-label" for="showTags">{{ $t("Show Tags") }}</label>
                </div>

                <!-- Show Powered By -->
                <div class="my-3 form-check form-switch">
                    <input id="show-powered-by" v-model="config.showPoweredBy" class="form-check-input" type="checkbox" data-testid="show-powered-by-checkbox">
                    <label class="form-check-label" for="show-powered-by">{{ $t("Show Powered By") }}</label>
                </div>

                <!-- Show certificate expiry -->
                <div class="my-3 form-check form-switch">
                    <input id="show-certificate-expiry" v-model="config.showCertificateExpiry" class="form-check-input" type="checkbox" data-testid="show-certificate-expiry-checkbox">
                    <label class="form-check-label" for="show-certificate-expiry">{{ $t("showCertificateExpiry") }}</label>
                </div>

                <div v-if="false" class="my-3">
                    <label for="password" class="form-label">{{ $t("Password") }} <sup>{{ $t("Coming Soon") }}</sup></label>
                    <input id="password" v-model="config.password" disabled type="password" autocomplete="new-password" class="form-control">
                </div>

                <!-- Domain Name List -->
                <div class="my-3">
                    <label class="form-label">
                        {{ $t("Domain Names") }}
                        <button class="p-0 bg-transparent border-0" :aria-label="$t('Add a domain')" @click="addDomainField">
                            <font-awesome-icon icon="plus-circle" class="action text-primary" />
                        </button>
                    </label>

                    <ul class="list-group domain-name-list">
                        <li v-for="(domain, index) in config.domainNameList" :key="index" class="list-group-item">
                            <input v-model="config.domainNameList[index]" type="text" class="no-bg domain-input" placeholder="example.com" />
                            <button class="p-0 bg-transparent border-0" :aria-label="$t('Remove domain', [ domain ])" @click="removeDomain(index)">
                                <font-awesome-icon icon="times" class="action remove ms-2 me-3 text-danger" />
                            </button>
                        </li>
                    </ul>
                </div>

                <!-- Google Analytics -->
                <div class="my-3">
                    <label for="googleAnalyticsTag" class="form-label">{{ $t("Google Analytics ID") }}</label>
                    <input id="googleAnalyticsTag" v-model="config.googleAnalyticsId" type="text" class="form-control" data-testid="google-analytics-input">
                </div>

                <!-- Custom CSS -->
                <div class="my-3">
                    <div class="mb-1">{{ $t("Custom CSS") }}</div>
                    <prism-editor v-model="config.customCSS" class="css-editor" data-testid="custom-css-input" :highlight="highlighter" line-numbers></prism-editor>
                </div>

                <div class="danger-zone">
                    <button class="btn btn-danger me-2" @click="deleteDialog">
                        <font-awesome-icon icon="trash" />
                        {{ $t("Delete") }}
                    </button>
                </div>
            </div>

            <!-- Sidebar Footer -->
            <div class="sidebar-footer">
                <button class="btn btn-success me-2" :disabled="loading" data-testid="save-button" @click="save">
                    <font-awesome-icon icon="save" />
                    {{ $t("Save") }}
                </button>

                <button class="btn btn-danger me-2" @click="discard">
                    <font-awesome-icon icon="undo" />
                    {{ $t("Discard") }}
                </button>
            </div>
        </div>

        <!-- Main Status Page -->
        <div :class="{ edit: enableEditMode}" class="main">
            <!-- Logo & Title -->
            <h1 class="mb-4 title-flex">
                <!-- Logo -->
                <span class="logo-wrapper" @click="showImageCropUploadMethod">
                    <img :src="logoURL" alt class="logo me-2" :class="logoClass" />
                    <font-awesome-icon v-if="enableEditMode" class="icon-upload" icon="upload" />
                </span>

                <!-- Uploader -->
                <!--    url="/api/status-page/upload-logo" -->
                <ImageCropUpload
                    v-model="showImageCropUpload"
                    field="img"
                    :width="128"
                    :height="128"
                    :langType="$i18n.locale"
                    img-format="png"
                    :noCircle="true"
                    :noSquare="false"
                    @crop-success="cropSuccess"
                />

                <!-- Title -->
                <Editable v-model="config.title" tag="span" :contenteditable="editMode" :noNL="true" />
            </h1>

            <!-- Admin functions -->
            <div v-if="hasToken" class="mb-4">
                <div v-if="!enableEditMode">
                    <button class="btn btn-primary me-2" data-testid="edit-button" @click="edit">
                        <font-awesome-icon icon="edit" />
                        {{ $t("Edit Status Page") }}
                    </button>

                    <a href="/manage-status-page" class="btn btn-primary">
                        <font-awesome-icon icon="tachometer-alt" />
                        {{ $t("Go to Dashboard") }}
                    </a>
                </div>

                <div v-else>
                    <button class="btn btn-primary btn-add-group me-2" data-testid="create-incident-button" @click="createIncident">
                        <font-awesome-icon icon="bullhorn" />
                        {{ $t("Create Incident") }}
                    </button>
                </div>
            </div>

            <!-- Incident -->
            <div v-if="incident !== null" class="shadow-box alert mb-4 p-4 incident" role="alert" :class="incidentClass" data-testid="incident">
                <strong v-if="editIncidentMode">{{ $t("Title") }}:</strong>
                <Editable v-model="incident.title" tag="h4" :contenteditable="editIncidentMode" :noNL="true" class="alert-heading" data-testid="incident-title" />

                <strong v-if="editIncidentMode">{{ $t("Content") }}:</strong>
                <Editable v-if="editIncidentMode" v-model="incident.content" tag="div" :contenteditable="editIncidentMode" class="content" data-testid="incident-content-editable" />
                <div v-if="editIncidentMode" class="form-text">
                    {{ $t("markdownSupported") }}
                </div>
                <!-- eslint-disable-next-line vue/no-v-html-->
                <div v-if="! editIncidentMode" class="content" data-testid="incident-content" v-html="incidentHTML"></div>

                <!-- Incident Date -->
                <div class="date mt-3">
                    {{ $t("Date Created") }}: {{ $root.datetime(incident.createdDate) }} ({{ dateFromNow(incident.createdDate) }})<br />
                    <span v-if="incident.lastUpdatedDate">
                        {{ $t("Last Updated") }}: {{ $root.datetime(incident.lastUpdatedDate) }} ({{ dateFromNow(incident.lastUpdatedDate) }})
                    </span>
                </div>

                <div v-if="editMode" class="mt-3">
                    <button v-if="editIncidentMode" class="btn btn-light me-2" data-testid="post-incident-button" @click="postIncident">
                        <font-awesome-icon icon="bullhorn" />
                        {{ $t("Post") }}
                    </button>

                    <button v-if="!editIncidentMode && incident.id" class="btn btn-light me-2" @click="editIncident">
                        <font-awesome-icon icon="edit" />
                        {{ $t("Edit") }}
                    </button>

                    <button v-if="editIncidentMode" class="btn btn-light me-2" @click="cancelIncident">
                        <font-awesome-icon icon="times" />
                        {{ $t("Cancel") }}
                    </button>

                    <div v-if="editIncidentMode" class="dropdown d-inline-block me-2">
                        <button id="dropdownMenuButton1" class="btn btn-secondary dropdown-toggle" type="button" data-bs-toggle="dropdown" aria-expanded="false">
                            {{ $t("Style") }}: {{ $t(incident.style) }}
                        </button>
                        <ul class="dropdown-menu" aria-labelledby="dropdownMenuButton1">
                            <li><a class="dropdown-item" href="#" @click="incident.style = 'info'">{{ $t("info") }}</a></li>
                            <li><a class="dropdown-item" href="#" @click="incident.style = 'warning'">{{ $t("warning") }}</a></li>
                            <li><a class="dropdown-item" href="#" @click="incident.style = 'danger'">{{ $t("danger") }}</a></li>
                            <li><a class="dropdown-item" href="#" @click="incident.style = 'primary'">{{ $t("primary") }}</a></li>
                            <li><a class="dropdown-item" href="#" @click="incident.style = 'light'">{{ $t("light") }}</a></li>
                            <li><a class="dropdown-item" href="#" @click="incident.style = 'dark'">{{ $t("dark") }}</a></li>
                        </ul>
                    </div>

                    <button v-if="!editIncidentMode && incident.id" class="btn btn-light me-2" @click="unpinIncident">
                        <font-awesome-icon icon="unlink" />
                        {{ $t("Delete") }}
                    </button>
                </div>
            </div>

            <!-- Overall Status -->
            <div class="shadow-box list  p-4 overall-status mb-4">
                <div v-if="Object.keys($root.publicMonitorList).length === 0 && loadedData">
                    <font-awesome-icon icon="question-circle" class="ok" />
                    {{ $t("No Services") }}
                </div>

                <template v-else>
                    <div v-if="allUp">
                        <font-awesome-icon icon="check-circle" class="ok" />
                        {{ $t("All Systems Operational") }}
                    </div>

                    <div v-else-if="partialDown">
                        <font-awesome-icon icon="exclamation-circle" class="warning" />
                        {{ $t("Partially Degraded Service") }}
                    </div>

                    <div v-else-if="allDown">
                        <font-awesome-icon icon="times-circle" class="danger" />
                        {{ $t("Degraded Service") }}
                    </div>

                    <div v-else-if="isMaintenance">
                        <font-awesome-icon icon="wrench" class="status-maintenance" />
                        {{ $t("maintenanceStatus-under-maintenance") }}
                    </div>

                    <div v-else>
                        <font-awesome-icon icon="question-circle" style="color: #efefef;" />
                    </div>
                </template>
            </div>

            <!-- Maintenance -->
            <template v-if="maintenanceList.length > 0">
                <div
                    v-for="maintenance in maintenanceList" :key="maintenance.id"
                    class="shadow-box alert mb-4 p-3 bg-maintenance mt-4 position-relative" role="alert"
                >
                    <h4 class="alert-heading">{{ maintenance.title }}</h4>
                    <!-- eslint-disable-next-line vue/no-v-html-->
                    <div class="content" v-html="maintenanceHTML(maintenance.description)"></div>
                    <MaintenanceTime :maintenance="maintenance" />
                </div>
            </template>

            <!-- Description -->
            <strong v-if="editMode">{{ $t("Description") }}:</strong>
            <Editable v-if="enableEditMode" v-model="config.description" :contenteditable="editMode" tag="div" class="mb-4 description" data-testid="description-editable" />
            <!-- eslint-disable-next-line vue/no-v-html-->
            <div v-if="! enableEditMode" class="alert-heading p-2" data-testid="description" v-html="descriptionHTML"></div>

            <div v-if="editMode" class="mb-4">
                <div>
                    <button class="btn btn-primary btn-add-group me-2" data-testid="add-group-button" @click="addGroup">
                        <font-awesome-icon icon="plus" />
                        {{ $t("Add Group") }}
                    </button>
                </div>

                <div class="mt-3">
                    <div v-if="sortedMonitorList.length > 0 && loadedData">
                        <label>{{ $t("Add a monitor") }}:</label>
                        <VueMultiselect
                            v-model="selectedMonitor"
                            :options="sortedMonitorList"
                            :multiple="false"
                            :searchable="true"
                            :placeholder="$t('Add a monitor')"
                            label="name"
                            trackBy="name"
                            class="mt-3"
                            data-testid="monitor-select"
                        >
                            <template #option="{ option }">
                                <div class="d-inline-flex">
                                    <span>{{ option.pathName }} <Tag v-for="tag in option.tags" :key="tag" :item="tag" :size="'sm'" /></span>
                                </div>
                            </template>
                        </VueMultiselect>
                    </div>
                    <div v-else class="text-center">
                        {{ $t("No monitors available.") }}  <router-link to="/add">{{ $t("Add one") }}</router-link>
                    </div>
                </div>
            </div>

            <div class="mb-4">
                <div v-if="$root.publicGroupList.length === 0 && loadedData" class="text-center">
                    <!-- 👀 Nothing here, please add a group or a monitor. -->
                    👀 {{ $t("statusPageNothing") }}
                </div>

                <!-- Group Tabs (only show if not in edit mode and has groups) -->
                <div v-show="!enableEditMode && groupTabs && groupTabs.length > 0 && !loading && initialLoadComplete" class="mb-4">
                    <div class="kuma-tabs">
                        <button 
                            v-for="tab in groupTabs" 
                            :key="tab.id" 
                            class="kuma-tab"
                            :class="{ active: activeTab === tab.id }"
                            @click="switchTab(tab.id)"
                            data-testid="group-tab"
                        >
                            <span class="tab-name">{{ tab.name }}</span>
                            <span class="tab-count">{{ tab.count }}</span>
                        </button>
                    </div>
                </div>

                                 <PublicGroupList 
                     :edit-mode="enableEditMode" 
                     :show-tags="config?.showTags || false" 
                     :show-certificate-expiry="config?.showCertificateExpiry || false"
                     :active-tab="activeTab"
                     :page="page"
                     :per-page="perPage"
                     :paginated-data="paginatedData"
                 />

                                 <!-- Pagination (only show if not in edit mode and has data) -->
                 <div v-show="!enableEditMode && !loading && initialLoadComplete && totalRecords > 0" class="d-flex justify-content-center mt-4">
                     <pagination
                         v-if="showPagination"
                         ref="pagination"
                         :key="`pagination-${activeTab}-${perPage}`"
                         v-model="page"
                         :records="totalRecords"
                         :per-page="perPage"
                         :options="paginationConfig"
                         data-testid="status-page-pagination"
                     />

                 </div>
            </div>

            <footer class="mt-5 mb-4">
                <div class="custom-footer-text text-start">
                    <strong v-if="enableEditMode">{{ $t("Custom Footer") }}:</strong>
                </div>
                <Editable v-if="enableEditMode" v-model="config.footerText" tag="div" :contenteditable="enableEditMode" :noNL="false" class="alert-heading p-2" data-testid="custom-footer-editable" />
                <!-- eslint-disable-next-line vue/no-v-html-->
                <div v-if="! enableEditMode" class="alert-heading p-2" data-testid="footer-text" v-html="footerHTML"></div>

                <p v-if="config.showPoweredBy" data-testid="powered-by">
                    {{ $t("Powered by") }} <a target="_blank" rel="noopener noreferrer" href="https://github.com/louislam/uptime-kuma">{{ $t("Uptime Kuma" ) }}</a>
                </p>

                                 <div class="refresh-info mb-2">
                     <div>{{ $t("Last Updated") }}:  {{ lastUpdateTimeDisplay }}</div>
                     <div data-testid="update-countdown-text">{{ $tc("statusPageRefreshIn", [ updateCountdownText]) }}</div>
                 </div>
                 

            </footer>
        </div>

        <Confirm ref="confirmDelete" btn-style="btn-danger" :yes-text="$t('Yes')" :no-text="$t('No')" @yes="deleteStatusPage">
            {{ $t("deleteStatusPageMsg") }}
        </Confirm>

        <component is="style" v-if="config.customCSS" type="text/css">
            {{ config.customCSS }}
        </component>
    </div>
</template>

<style scoped>
/* Uptime Kuma Style Tabs */
.kuma-tabs {
    display: flex;
    gap: 8px;
    padding: 0;
    margin: 0;
    border-bottom: 2px solid var(--bs-border-color);
    overflow-x: auto;
    scrollbar-width: thin;
    scrollbar-color: var(--bs-border-color) transparent;
}

.kuma-tabs::-webkit-scrollbar {
    height: 4px;
}

.kuma-tabs::-webkit-scrollbar-track {
    background: transparent;
}

.kuma-tabs::-webkit-scrollbar-thumb {
    background-color: var(--bs-border-color);
    border-radius: 2px;
}

.kuma-tab {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 20px;
    background: transparent;
    border: none;
    border-bottom: 3px solid transparent;
    color: var(--bs-body-color);
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s ease;
    white-space: nowrap;
    position: relative;
    min-width: fit-content;
}

.kuma-tab:hover {
    background-color: var(--bs-light);
    color: var(--bs-primary);
    border-bottom-color: var(--bs-primary);
}

.kuma-tab.active {
    color: var(--bs-primary);
    border-bottom-color: var(--bs-primary);
    background-color: rgba(var(--bs-primary-rgb), 0.05);
}

.kuma-tab .tab-name {
    font-weight: 600;
}

.kuma-tab .tab-count {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 20px;
    height: 20px;
    padding: 2px 6px;
    background-color: var(--bs-secondary);
    color: white;
    font-size: 11px;
    font-weight: 600;
    border-radius: 10px;
    line-height: 1;
}

.kuma-tab.active .tab-count {
    background-color: var(--bs-primary);
}

/* Dark theme support */
.dark .kuma-tabs {
    border-bottom-color: var(--bs-dark-border-color);
}

.dark .kuma-tab {
    color: var(--bs-dark-font-color);
}

.dark .kuma-tab:hover {
    background-color: rgba(255, 255, 255, 0.05);
}

.dark .kuma-tab.active {
    background-color: rgba(var(--bs-primary-rgb), 0.1);
}

/* Mobile responsive */
@media (max-width: 768px) {
    .kuma-tabs {
        gap: 4px;
        padding-bottom: 4px;
    }
    
    .kuma-tab {
        padding: 10px 16px;
        font-size: 13px;
        min-width: auto;
        flex: 1;
        justify-content: center;
    }
    
    .kuma-tab .tab-count {
        min-width: 18px;
        height: 18px;
        font-size: 10px;
        padding: 1px 5px;
    }
}

/* Pagination styling */
.kuma_pagination {
    margin-top: 1rem;
}
</style>

<script>
import axios from "axios";
import dayjs from "dayjs";
import duration from "dayjs/plugin/duration";
import Favico from "favico.js";
// import highlighting library (you can use any library you want just return html string)
import { highlight, languages } from "prismjs/components/prism-core";
import "prismjs/components/prism-css";
import "prismjs/themes/prism-tomorrow.css"; // import syntax highlighting styles
import ImageCropUpload from "vue-image-crop-upload";
// import Prism Editor
import { PrismEditor } from "vue-prism-editor";
import "vue-prism-editor/dist/prismeditor.min.css"; // import the styles somewhere
import { useToast } from "vue-toastification";
import { marked } from "marked";
import DOMPurify from "dompurify";
import Confirm from "../components/Confirm.vue";
import PublicGroupList from "../components/PublicGroupList.vue";
import MaintenanceTime from "../components/MaintenanceTime.vue";
import { getResBaseURL } from "../util-frontend";
import { STATUS_PAGE_ALL_DOWN, STATUS_PAGE_ALL_UP, STATUS_PAGE_MAINTENANCE, STATUS_PAGE_PARTIAL_DOWN, UP, MAINTENANCE } from "../util.ts";
import Tag from "../components/Tag.vue";
import VueMultiselect from "vue-multiselect";
import Pagination from "v-pagination-3";

const toast = useToast();
dayjs.extend(duration);

const leavePageMsg = "Do you really want to leave? you have unsaved changes!";

// eslint-disable-next-line no-unused-vars
let feedInterval;

const favicon = new Favico({
    animation: "none"
});

export default {

    components: {
        PublicGroupList,
        ImageCropUpload,
        Confirm,
        PrismEditor,
        MaintenanceTime,
        Tag,
        VueMultiselect,
        Pagination
    },

    // Leave Page for vue route change
    beforeRouteLeave(to, from, next) {
        if (this.editMode) {
            const answer = window.confirm(leavePageMsg);
            if (answer) {
                next();
            } else {
                next(false);
            }
        }
        next();
    },

    props: {
        /** Override for the status page slug */
        overrideSlug: {
            type: String,
            required: false,
            default: null,
        },
    },

    data() {
        return {
            slug: null,
            enableEditMode: false,
            enableEditIncidentMode: false,
            hasToken: false,
            config: {},
            selectedMonitor: null,
            incident: null,
            previousIncident: null,
            showImageCropUpload: false,
            imgDataUrl: "/icon.svg",
            loadedTheme: false,
            loadedData: false,
            baseURL: "",
            clickedEditButton: false,
            maintenanceList: [],
            lastUpdateTime: dayjs(),
            updateCountdown: null,
            updateCountdownText: null,
            loading: true,
            // Pagination and Tab related properties
            activeTab: 'all',
            page: 1,
            perPage: 10,
            pagination: null,
            groupTabs: [],
            tabsInitialized: false,
            initialLoadComplete: false,
            showPagination: true,
            paginationConfig: {
                hideCount: false,
                chunksNavigation: "scroll",
                maxItems: 5,
                edgeNavigation: true,
                firstText: "«",
                lastText: "»",
                prevText: "‹",
                nextText: "›",
                chunk: 10,  // Explicitly set chunk to match perPage
                format: true
            }
        };
    },
    computed: {

        logoURL() {
            if (this.imgDataUrl.startsWith("data:")) {
                return this.imgDataUrl;
            } else {
                return this.baseURL + this.imgDataUrl;
            }
        },

        /**
         * If the monitor is added to public list, which will not be in this list.
         * @returns {object[]} List of monitors
         */
        sortedMonitorList() {
            let result = [];

            if (this.$root.monitorList && this.$root.publicMonitorList) {
                for (let id in this.$root.monitorList) {
                    if (this.$root.monitorList[id] && ! (id in this.$root.publicMonitorList)) {
                        let monitor = this.$root.monitorList[id];
                        result.push(monitor);
                    }
                }
            }

            result.sort((m1, m2) => {
                if (!m1 || !m2) return 0;

                if (m1.active !== m2.active) {
                    if (m1.active === 0) {
                        return 1;
                    }

                    if (m2.active === 0) {
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

                if (m1.pathName && m2.pathName) {
                    return m1.pathName.localeCompare(m2.pathName);
                }
                return 0;
            });

            return result;
        },

        editMode() {
            return this.enableEditMode && this.$root.socket.connected;
        },

        editIncidentMode() {
            return this.enableEditIncidentMode;
        },

        isPublished() {
            return this.config.published;
        },

        logoClass() {
            if (this.editMode) {
                return {
                    "edit-mode": true,
                };
            }
            return {};
        },

        incidentClass() {
            return "bg-" + this.incident.style;
        },

        maintenanceClass() {
            return "bg-maintenance";
        },

        overallStatus() {

            if (!this.$root.publicLastHeartbeatList || Object.keys(this.$root.publicLastHeartbeatList).length === 0) {
                return -1;
            }

            let status = STATUS_PAGE_ALL_UP;
            let hasUp = false;

            for (let id in this.$root.publicLastHeartbeatList) {
                let beat = this.$root.publicLastHeartbeatList[id];
                if (beat && beat.status !== undefined) {
                    if (beat.status === MAINTENANCE) {
                        return STATUS_PAGE_MAINTENANCE;
                    } else if (beat.status === UP) {
                        hasUp = true;
                    } else {
                        status = STATUS_PAGE_PARTIAL_DOWN;
                    }
                }
            }

            if (! hasUp) {
                status = STATUS_PAGE_ALL_DOWN;
            }

            return status;
        },

        allUp() {
            return this.overallStatus === STATUS_PAGE_ALL_UP;
        },

        partialDown() {
            return this.overallStatus === STATUS_PAGE_PARTIAL_DOWN;
        },

        allDown() {
            return this.overallStatus === STATUS_PAGE_ALL_DOWN;
        },

        isMaintenance() {
            return this.overallStatus === STATUS_PAGE_MAINTENANCE;
        },

        incidentHTML() {
            if (this.incident.content != null) {
                return DOMPurify.sanitize(marked(this.incident.content));
            } else {
                return "";
            }
        },

        descriptionHTML() {
            if (this.config.description != null) {
                return DOMPurify.sanitize(marked(this.config.description));
            } else {
                return "";
            }
        },

        footerHTML() {
            if (this.config.footerText != null) {
                return DOMPurify.sanitize(marked(this.config.footerText));
            } else {
                return "";
            }
        },

        lastUpdateTimeDisplay() {
            return this.$root.datetime(this.lastUpdateTime);
        },
        
                         /**
         * Calculate total records for pagination
         * @returns {number} Total number of records
         */
        totalRecords() {
            console.log('totalRecords calculation triggered:', {
                hasPublicGroupList: !!this.$root.publicGroupList,
                publicGroupListLength: this.$root.publicGroupList ? this.$root.publicGroupList.length : 0,
                activeTab: this.activeTab,
                page: this.page,
                hasPagination: !!this.pagination,
                paginationTotal: this.pagination ? this.pagination.total : null
            });
            
            // If we have backend pagination data, use it as the source of truth
            if (this.pagination && this.pagination.total !== undefined) {
                // Find the corresponding group tab count
                if (this.groupTabs && this.groupTabs.length > 0) {
                    const groupTab = this.groupTabs.find(tab => tab.id == this.activeTab);
                    if (groupTab && groupTab.count !== undefined) {
                        console.log(`Using backend data for group ${groupTab.name}: ${groupTab.count} total monitors`);
                        return groupTab.count;
                    }
                }
            }
            
            // Fallback to frontend calculation if no backend pagination data
            if (!this.$root.publicGroupList || this.$root.publicGroupList.length === 0) {
                console.log('totalRecords: No publicGroupList available, fallback calculation');
                return 0;
            }
            
            let total = 0;
            
            // For specific group tab, return count of monitors in that group only
            const selectedGroup = this.$root.publicGroupList.find(group => group.id == this.activeTab);
            if (selectedGroup && selectedGroup.monitorList) {
                total = selectedGroup.monitorList.length;
                console.log(`Group ${selectedGroup.name} tab total (fallback): ${total} monitors`);
            } else {
                console.log(`No group found for tab ID: ${this.activeTab} (fallback)`);
                total = 0;
            }
             
            console.log(`totalRecords calculated (fallback): ${total} for tab: ${this.activeTab}`);
            return total;
        },
        
        /**
         * Get paginated data for current tab and page
         * @returns {Array} Paginated data
         */
        paginatedData() {
            console.log(`paginatedData calculation: activeTab=${this.activeTab}, page=${this.page}, perPage=${this.perPage}`);
            
            // If we have backend pagination data, use it directly
            if (this.pagination && this.pagination.total > 0) {
                console.log(`Using backend pagination data: total=${this.pagination.total}, currentPage=${this.pagination.currentPage}, perPage=${this.pagination.perPage}`);
                
                // Check if the current page matches the backend data
                if (this.page === this.pagination.currentPage) {
                    // Use the data from publicGroupList (which contains the current page data)
                    if (this.$root.publicGroupList && this.$root.publicGroupList.length > 0) {
                        let allMonitors = [];
                        
                        // For specific group tab, get monitors from that group
                        const selectedGroup = this.$root.publicGroupList.find(group => group.id == this.activeTab);
                        if (selectedGroup && selectedGroup.monitorList) {
                            allMonitors = selectedGroup.monitorList;
                            console.log(`Backend pagination: page ${this.page}, monitors: ${allMonitors.length}`);
                            return allMonitors;
                        }
                    }
                } else {
                    console.log(`Page mismatch: frontend page=${this.page}, backend page=${this.pagination.currentPage}`);
                    // Page mismatch - need to reload data
                    this.loadStatusPageData();
                    return [];
                }
            }
            
            // Fallback to frontend pagination if no backend data
            if (!this.$root.publicGroupList || this.$root.publicGroupList.length === 0) {
                console.log('paginatedData: No publicGroupList available, fallback calculation');
                return [];
            }
            
            console.log(`Using frontend pagination fallback`);
            
            // For pagination, we need to handle the data differently based on the tab
            // No more "All" tab logic
            // For specific group tab, get monitors from that group and apply pagination
            const selectedGroup = this.$root.publicGroupList.find(group => group.id == this.activeTab);
            if (selectedGroup && selectedGroup.monitorList) {
                const allMonitors = selectedGroup.monitorList;
                const startIndex = (this.page - 1) * this.perPage;
                const endIndex = startIndex + this.perPage;
                
                console.log(`Group ${selectedGroup.name} pagination (fallback): page ${this.page}, perPage ${this.perPage}, startIndex ${startIndex}, endIndex ${endIndex}, total ${allMonitors.length}`);
                
                const paginatedMonitors = allMonitors.slice(startIndex, endIndex);
                console.log(`Group ${selectedGroup.name} result (fallback): ${paginatedMonitors.length} monitors for page ${this.page}`);
                
                return paginatedMonitors;
            } else {
                console.log(`No group found for tab ID: ${this.activeTab}, available groups:`, this.$root.publicGroupList.map(g => ({ id: g.id, name: g.name })));
            }
            
            return [];
        },
        
        /**
         * Check if there's data to show (for pagination display)
         * @returns {boolean} Whether there's data to show
         */
        hasDataToShow() {
            const hasData = this.totalRecords > 0;
            console.log('hasDataToShow check:', {
                totalRecords: this.totalRecords,
                hasData: hasData,
                publicGroupList: this.$root.publicGroupList ? this.$root.publicGroupList.length : 0,
                activeTab: this.activeTab
            });
            return hasData;
        }
    },
    watch: {

        /**
         * If connected to the socket and logged in, request private data of this statusPage
         * @param {boolean} loggedIn Is the client logged in?
         * @returns {void}
         */
        "$root.loggedIn"(loggedIn) {
            if (loggedIn) {
                this.$root.getSocket().emit("getStatusPage", this.slug, (res) => {
                    if (res.ok) {
                        this.config = res.config;

                        if (!this.config.customCSS) {
                            this.config.customCSS = "body {\n" +
                                "  \n" +
                                "}\n";
                        }

                    } else {
                        this.$root.toastError(res.msg);
                    }
                });
            }
        },

        /**
         * Selected a monitor and add to the list.
         * @param {object} monitor Monitor to add
         * @returns {void}
         */
        selectedMonitor(monitor) {
            if (monitor) {
                if (!this.$root.publicGroupList || this.$root.publicGroupList.length === 0) {
                    this.addGroup();
                }

                const firstGroup = this.$root.publicGroupList[0];
                if (firstGroup && firstGroup.monitorList) {
                    firstGroup.monitorList.push(monitor);
                }
                this.selectedMonitor = null;
            }
        },

        // Set Theme
        "config.theme"() {
            this.$root.statusPageTheme = this.config.theme;
            this.loadedTheme = true;
        },

        "config.title"(title) {
            document.title = title;
        },

        "$root.monitorList"() {
            let count = Object.keys(this.$root.monitorList).length;

            // Since publicGroupList is getting from public rest api, monitors' tags may not present if showTags = false
            if (count > 0 && this.$root.publicGroupList && Array.isArray(this.$root.publicGroupList)) {
                for (let group of this.$root.publicGroupList) {
                    if (group && group.monitorList && Array.isArray(group.monitorList)) {
                        for (let monitor of group.monitorList) {
                            if (monitor && monitor.tags === undefined && this.$root.monitorList[monitor.id]) {
                                monitor.tags = this.$root.monitorList[monitor.id].tags;
                            }
                        }
                    }
                }
            }
        },

                 /**
          * Watch for page changes to reload data
          * @returns {void}
          */
         page() {
             if (!this.enableEditMode) {
                 console.log('Page changed to:', this.page, 'reloading data...');
                 // Force recalculation of paginatedData
                 this.$forceUpdate();
                 this.loadStatusPageData();
             }
         }

    },
    async created() {
        this.hasToken = ("token" in this.$root.storage());

        // Browser change page
        // https://stackoverflow.com/questions/7317273/warn-user-before-leaving-web-page-with-unsaved-changes
        window.addEventListener("beforeunload", (e) => {
            if (this.editMode) {
                (e || window.event).returnValue = leavePageMsg;
                return leavePageMsg;
            } else {
                return null;
            }
        });

        // Special handle for dev
        this.baseURL = getResBaseURL();
    },
    async mounted() {
        this.slug = this.overrideSlug || this.$route.params.slug;

        if (!this.slug) {
            this.slug = "default";
        }

        this.getData(false).then((res) => {
            this.config = res.data?.config || {};

            if (!this.config.domainNameList) {
                this.config.domainNameList = [];
            }
            
            // Ensure config properties have default values
            if (this.config.showTags === undefined) {
                this.config.showTags = false;
            }
            if (this.config.showCertificateExpiry === undefined) {
                this.config.showCertificateExpiry = false;
            }

            if (this.config.icon) {
                this.imgDataUrl = this.config.icon;
            }

            this.incident = res.data.incident;
            this.maintenanceList = res.data.maintenanceList;
            
            // Check if we should load all data without pagination
            // For now, always load paginated data in normal mode, edit mode will handle its own data loading
            const shouldLoadAllData = false;
            
            if (shouldLoadAllData) {
                // Load all data without pagination (edit mode or config setting)
                if (res.data && res.data.publicGroupList) {
                    this.$root.publicGroupList = res.data.publicGroupList;
                    this.generateTabsFromData();
                    this.loadedData = true;
                    this.tabsInitialized = true;
                }
                
                this.loading = false;
                this.$nextTick(() => {
                    setTimeout(() => {
                        this.initialLoadComplete = true;
                        console.log('All data load complete (no pagination)');
                    }, 100);
                });
            } else {
                // Load paginated data
                this.page = 1;
                
                this.loadStatusPageData().then(() => {
                    this.loading = false;
                    // Use nextTick to ensure DOM is updated before showing tabs
                    this.$nextTick(() => {
                        // Add a small delay to prevent flash during initial load
                        setTimeout(() => {
                            // Auto-select the first group tab if available
                            if (this.groupTabs && this.groupTabs.length > 0) {
                                const firstGroupTab = this.groupTabs.find(tab => tab.id !== 'all');
                                if (firstGroupTab) {
                                    this.activeTab = firstGroupTab.id;
                                    console.log(`Auto-selected first group tab: ${firstGroupTab.name} (ID: ${firstGroupTab.id})`);
                                }
                            }
                            
                            this.initialLoadComplete = true;
                            console.log('Initial load complete, showing tabs and pagination');
                            console.log('Pagination should be visible now:', {
                                enableEditMode: this.enableEditMode,
                                loading: this.loading,
                                initialLoadComplete: this.initialLoadComplete,
                                totalRecords: this.totalRecords,
                                activeTab: this.activeTab
                            });
                        }, 100);
                    });
                });
            }

            // Configure auto-refresh loop
            feedInterval = setInterval(() => {
                this.updateHeartbeatList();
            }, (this.config.autoRefreshInterval + 10) * 1000);

            this.updateUpdateTimer();
        }).catch( function (error) {
            if (error.response && error.response.status === 404) {
                location.href = "/page-not-found";
            }
            console.log('Error loading status page data:', error);
        });

        this.updateHeartbeatList();

        // Go to edit page if ?edit present
        // null means ?edit present, but no value
        if (this.$route.query.edit || this.$route.query.edit === null) {
            this.edit();
        }
    },
    methods: {

        /**
         * Get status page data
         * It should be preloaded in window.preloadData
         * @param {boolean} noPagination - If true, load all data without pagination
         * @returns {Promise<any>} Status page data
         */
        getData: function (noPagination = false) {
            if (window.preloadData) {
                return new Promise(resolve => resolve({
                    data: window.preloadData
                }));
            } else {
                const params = new URLSearchParams();
                if (noPagination) {
                    params.append('no_pagination', 'true');
                }
                const url = `/api/status-page/${this.slug}${params.toString() ? '?' + params.toString() : ''}`;
                return axios.get(url);
            }
        },

        /**
         * Load status page data with pagination and tab support
         * @param {boolean} noPagination - If true, load all data without pagination
         * @returns {Promise<void>}
         */
        async loadStatusPageData(noPagination = false) {
            if (this.enableEditMode) {
                return Promise.resolve(); // Don't load paginated data in edit mode
            }

            try {
                // Build API parameters for backend pagination
                const params = new URLSearchParams();
                
                if (noPagination) {
                    // Request all data without pagination
                    params.append('no_pagination', 'true');
                } else {
                    // Use pagination
                    if (this.activeTab !== 'all') {
                        params.append('group', this.activeTab);
                    }
                    params.append('page', this.page);
                    params.append('limit', this.perPage);
                }
                
                // Add interval time for data freshness
                if (this.config.autoRefreshInterval) {
                    params.append('interval', this.config.autoRefreshInterval);
                }

                const url = `/api/status-page/${this.slug}${params.toString() ? '?' + params.toString() : ''}`;
                console.log('Loading paginated data from:', url);
                
                const response = await axios.get(url);
                
                if (response.data) {
                    // Only update publicGroupList if the response contains it
                    // This prevents clearing existing data when backend doesn't return it
                    if (response.data.publicGroupList && response.data.publicGroupList.length > 0) {
                        this.$root.publicGroupList = response.data.publicGroupList;
                        console.log('Updated publicGroupList from API response:', this.$root.publicGroupList.length, 'groups');
                    } else {
                        console.log('API response does not contain publicGroupList, keeping existing data');
                    }
                    
                    if (noPagination) {
                        // When no pagination, clear pagination data and show all data
                        this.pagination = null;
                        this.showPagination = false;
                        console.log('No pagination mode: showing all data');
                    } else {
                        // Set pagination data if available from backend
                        if (response.data.pagination) {
                            this.pagination = response.data.pagination;
                            this.showPagination = true;
                            console.log('Backend pagination data:', this.pagination);
                        }
                    }
                    
                    // Set group tabs if available, otherwise keep existing ones
                    if (response.data.groupTabs && response.data.groupTabs.length > 0) {
                        this.groupTabs = response.data.groupTabs;
                    } else if (!this.groupTabs || this.groupTabs.length === 0) {
                        // Fallback: generate tabs from publicGroupList
                        this.generateTabsFromData();
                    }
                    
                    // No need to ensure "All" tab exists anymore
                    
                    // Update tab counts based on actual data
                    this.updateTabCounts();
                    
                    // Mark data as loaded
                    this.loadedData = true;
                    this.tabsInitialized = true;
                    
                    console.log('Loaded data:', {
                        noPagination,
                        groupTabs: this.groupTabs,
                        pagination: this.pagination,
                        showPagination: this.showPagination,
                        totalRecords: this.totalRecords,
                        currentPage: this.page,
                        activeTab: this.activeTab,
                        publicGroupListLength: this.$root.publicGroupList ? this.$root.publicGroupList.length : 0,
                        loading: this.loading
                    });
                }
                
                return Promise.resolve();
            } catch (error) {
                console.error('Error loading status page data:', error);
                // Fallback to original method
                return this.getData(false).then((res) => {
                    if (res.data && res.data.publicGroupList) {
                        this.$root.publicGroupList = res.data.publicGroupList;
                        // Generate tabs from existing data
                        this.generateTabsFromData();
                        this.loadedData = true;
                        this.tabsInitialized = true;
                        this.initialLoadComplete = true;
                        
                        // Update tab counts
                        this.updateTabCounts();
                    }
                });
            }
        },

        /**
         * Generate tabs from existing publicGroupList data (fallback)
         * @returns {void}
         */
        generateTabsFromData() {
            this.groupTabs = [];

            // 檢查 publicGroupList 是否存在且為陣列
            if (this.$root.publicGroupList && Array.isArray(this.$root.publicGroupList)) {
                for (const group of this.$root.publicGroupList) {
                    if (group && group.monitorList) {
                        this.groupTabs.push({
                            id: group.id,
                            name: group.name,
                            count: group.monitorList.length || 0
                        });
                    }
                }
            }

            // Update tab counts based on actual data
            this.updateTabCounts();
            
            // Mark data as loaded
            this.loadedData = true;
            this.tabsInitialized = true;
            
            console.log('Generated tabs from data:', {
                tabs: this.groupTabs,
                activeTab: this.activeTab,
                totalGroups: this.$root.publicGroupList ? this.$root.publicGroupList.length : 0
            });
        },
        
        /**
         * Update tab counts based on current data
         * @returns {void}
         */
        updateTabCounts() {
            if (!this.groupTabs || this.groupTabs.length === 0) {
                return;
            }
            
            // No need to update "All" tab count anymore
            
            // Update individual group tab counts only if not set by backend
            if (this.$root.publicGroupList && Array.isArray(this.$root.publicGroupList)) {
                for (const group of this.$root.publicGroupList) {
                    if (group && group.id) {
                        const groupTab = this.groupTabs.find(tab => tab.id === group.id);
                        if (groupTab) {
                            if (groupTab.count === undefined) {
                                const groupCount = group.monitorList ? group.monitorList.length : 0;
                                groupTab.count = groupCount;
                                console.log(`updateTabCounts - Group ${group.name} tab count set to: ${groupCount} (frontend fallback)`);
                            } else {
                                console.log(`updateTabCounts - Group ${group.name} tab count already set by backend: ${groupTab.count}`);
                            }
                        }
                    }
                }
            }
            
            console.log('Final tab counts after update:', this.groupTabs);
        },

                         /**
         * Switch to a different tab
         * @param {string|number} tabId - Tab ID to switch to
         * @returns {void}
         */
        switchTab(tabId) {
            if (this.activeTab === tabId) {
                return; // Don't reload if clicking the same tab
            }
            
            console.log('Switching tab from', this.activeTab, 'to', tabId);
            console.log('Before tab switch - perPage:', this.perPage, 'page:', this.page);
            
            this.activeTab = tabId;
            this.page = 1; // Reset to first page when switching tabs
            
            // Ensure perPage is maintained
            const currentPerPage = this.perPage;
            console.log('Maintaining perPage value:', currentPerPage);
            
            // Temporarily hide pagination to force re-render
            this.showPagination = false;
            
            // Force recalculation of totalRecords and paginatedData
            this.$forceUpdate();
            
            // Reload data for the new tab
            this.loadStatusPageData().then(() => {
                console.log('Tab switch complete for tab:', tabId);
                console.log('After tab switch - totalRecords:', this.totalRecords, 'paginatedData length:', this.paginatedData.length);
                console.log('After tab switch - perPage:', this.perPage, 'page:', this.page);
                
                            // Force pagination component to update
            this.$nextTick(() => {
                if (this.$refs.pagination) {
                    this.$refs.pagination.$forceUpdate();
                    console.log('Pagination component force updated');
                }
                
                // Ensure perPage is still correct
                if (this.perPage !== currentPerPage) {
                    console.warn('perPage was changed during tab switch, restoring:', currentPerPage);
                    this.perPage = currentPerPage;
                }
                
                // Force another update to ensure pagination is fully recalculated
                this.$nextTick(() => {
                    this.$forceUpdate();
                    console.log('Component fully updated after tab switch');
                    
                    // Re-show pagination component
                    this.showPagination = true;
                    console.log('Pagination component re-shown');
                });
            });
            });
        },

        /**
         * Provide syntax highlighting for CSS
         * @param {string} code Text to highlight
         * @returns {string} Highlighted CSS
         */
        highlighter(code) {
            return highlight(code, languages.css);
        },

        /**
         * Update the heartbeat list and update favicon if necessary
         * @returns {void}
         */
        updateHeartbeatList() {
            // If editMode, it will use the data from websocket.
            if (! this.editMode) {
                // Build API parameters including interval time
                const params = new URLSearchParams();
                if (this.config.autoRefreshInterval) {
                    params.append('interval', this.config.autoRefreshInterval);
                }
                
                const url = `/api/status-page/heartbeat/${this.slug}${params.toString() ? '?' + params.toString() : ''}`;
                
                axios.get(url).then((res) => {
                    if (res.data) {
                        const { heartbeatList, uptimeList } = res.data;

                        this.$root.heartbeatList = heartbeatList || {};
                        this.$root.uptimeList = uptimeList || {};

                        if (heartbeatList && typeof heartbeatList === 'object') {
                            const heartbeatIds = Object.keys(heartbeatList);
                            const downMonitors = heartbeatIds.reduce((downMonitorsAmount, currentId) => {
                                const monitorHeartbeats = heartbeatList[currentId];
                                if (monitorHeartbeats && Array.isArray(monitorHeartbeats)) {
                                    const lastHeartbeat = monitorHeartbeats.at(-1);
                                    if (lastHeartbeat && lastHeartbeat.status === 0) {
                                        return downMonitorsAmount + 1;
                                    }
                                }
                                return downMonitorsAmount;
                            }, 0);

                            favicon.badge(downMonitors);
                        }

                        this.loadedData = true;
                        this.lastUpdateTime = dayjs();
                        this.updateUpdateTimer();
                    }
                }).catch((error) => {
                    console.error('Error updating heartbeat list:', error);
                });
            }
        },

        /**
         * Setup timer to display countdown to refresh
         * @returns {void}
         */
        updateUpdateTimer() {
            clearInterval(this.updateCountdown);

            this.updateCountdown = setInterval(() => {
                if (this.lastUpdateTime && this.config && this.config.autoRefreshInterval) {
                    const countdown = dayjs.duration(this.lastUpdateTime.add(this.config.autoRefreshInterval, "seconds").add(10, "seconds").diff(dayjs()));
                    if (countdown.as("seconds") < 0) {
                        clearInterval(this.updateCountdown);
                    } else {
                        this.updateCountdownText = countdown.format("mm:ss");
                    }
                } else {
                    clearInterval(this.updateCountdown);
                }
            }, 1000);
        },

        /**
         * Enable editing mode
         * @returns {void}
         */
        edit() {
            if (this.hasToken) {
                try {
                    this.$root.initSocketIO(true);
                    this.enableEditMode = true;
                    this.clickedEditButton = true;

                    // Try to fix #1658
                    this.loadedData = true;
                    
                    // Load all groups and monitors for edit mode
                    this.loadAllDataForEditMode();
                } catch (error) {
                    console.error('Error enabling edit mode:', error);
                    this.$root.toastError("Failed to enable edit mode");
                }
            }
        },

        /**
         * Load all groups and monitors for edit mode (no pagination)
         * @returns {Promise<void>}
         */
        async loadAllDataForEditMode() {
            try {
                console.log('Loading all data for edit mode...');
                
                // Build API parameters for loading all data without pagination
                const params = new URLSearchParams();
                params.append('no_pagination', 'true');
                // Add interval time for data freshness
                if (this.config.autoRefreshInterval) {
                    params.append('interval', this.config.autoRefreshInterval);
                }

                const url = `/api/status-page/${this.slug}${params.toString() ? '?' + params.toString() : ''}`;
                console.log('Loading all data from:', url);
                
                const response = await axios.get(url);
                
                if (response.data) {
                    // Update publicGroupList with all data
                    if (response.data.publicGroupList && response.data.publicGroupList.length > 0) {
                        this.$root.publicGroupList = response.data.publicGroupList;
                        console.log('Updated publicGroupList for edit mode:', this.$root.publicGroupList.length, 'groups');
                        
                        // Log total monitors across all groups
                        const totalMonitors = this.$root.publicGroupList.reduce((sum, group) => {
                            return sum + (group.monitorList ? group.monitorList.length : 0);
                        }, 0);
                        console.log('Total monitors loaded for edit mode:', totalMonitors);
                    }
                    
                    // Set group tabs for edit mode
                    if (response.data.groupTabs && response.data.groupTabs.length > 0) {
                        this.groupTabs = response.data.groupTabs;
                        console.log('Updated groupTabs for edit mode:', this.groupTabs);
                    } else {
                        // Generate tabs from loaded data
                        this.generateTabsFromData();
                    }
                    
                    // Mark data as loaded
                    this.loadedData = true;
                    this.tabsInitialized = true;
                    
                    console.log('Edit mode data loading complete');
                }
                
                return Promise.resolve();
            } catch (error) {
                console.error('Error loading all data for edit mode:', error);
                // Fallback to original method
                return this.getData(true).then((res) => {
                    if (res.data && res.data.publicGroupList) {
                        this.$root.publicGroupList = res.data.publicGroupList;
                        this.generateTabsFromData();
                        this.loadedData = true;
                        this.tabsInitialized = true;
                    }
                });
            }
        },

        /**
         * Save the status page
         * @returns {void}
         */
        save() {
            this.loading = true;
            let startTime = new Date();
            
            if (this.config && this.config.slug) {
                this.config.slug = this.config.slug.trim().toLowerCase();
            }

            try {
                this.$root.getSocket().emit("saveStatusPage", this.slug, this.config, this.imgDataUrl, this.$root.publicGroupList || [], (res) => {
                    if (res && res.ok) {
                        this.enableEditMode = false;
                        // Update with complete data from server, not filtered by tab
                        this.$root.publicGroupList = res.publicGroupList || [];
                        
                        // Reset to first group tab instead of 'all'
                        this.page = 1;

                        // Add some delay, so that the side menu animation would be better
                        let endTime = new Date();
                        let time = 100 - (endTime - startTime) / 1000;

                        if (time < 0) {
                            time = 0;
                        }

                        setTimeout(() => {
                            this.loading = false;
                            location.href = "/status/" + this.config.slug;
                        }, time);

                    } else {
                        this.loading = false;
                        if (res && res.msg) {
                            toast.error(res.msg);
                        } else {
                            toast.error("Save failed");
                        }
                    }
                });
            } catch (error) {
                console.error('Error saving status page:', error);
                this.loading = false;
                toast.error("Save failed");
            }
        },

        /**
         * Show dialog confirming deletion
         * @returns {void}
         */
        deleteDialog() {
            this.$refs.confirmDelete.show();
        },

        /**
         * Request deletion of this status page
         * @returns {void}
         */
        deleteStatusPage() {
            this.$root.getSocket().emit("deleteStatusPage", this.slug, (res) => {
                if (res && res.ok) {
                    this.enableEditMode = false;
                    location.href = "/manage-status-page";
                } else {
                    this.$root.toastError(res && res.msg ? res.msg : "Delete failed");
                }
            });
        },

        /**
         * Returns label for a specified monitor
         * @param {object} monitor Object representing monitor
         * @returns {string} Monitor label
         */
        monitorSelectorLabel(monitor) {
            if (!monitor || !monitor.name) {
                return "Unknown Monitor";
            }
            return `${monitor.name}`;
        },

        /**
         * Add a group to the status page
         * @returns {void}
         */
        addGroup() {
            let groupName = this.$t("Untitled Group");

            if (!this.$root.publicGroupList || this.$root.publicGroupList.length === 0) {
                groupName = this.$t("Services");
            }

            if (!this.$root.publicGroupList) {
                this.$root.publicGroupList = [];
            }
            
            this.$root.publicGroupList.unshift({
                name: groupName,
                monitorList: [],
            });
        },

        /**
         * Add a domain to the status page
         * @returns {void}
         */
        addDomainField() {
            if (!this.config.domainNameList) {
                this.config.domainNameList = [];
            }
            this.config.domainNameList.push("");
        },

        /**
         * Discard changes to status page
         * @returns {void}
         */
        discard() {
            if (this.slug) {
                location.href = "/status/" + this.slug;
            } else {
                location.href = "/manage-status-page";
            }
        },

        /**
         * Set URL of new image after successful crop operation
         * @param {string} imgDataUrl URL of image in data:// format
         * @returns {void}
         */
        cropSuccess(imgDataUrl) {
            if (imgDataUrl) {
                this.imgDataUrl = imgDataUrl;
            }
        },

        /**
         * Show image crop dialog if in edit mode
         * @returns {void}
         */
        showImageCropUploadMethod() {
            if (this.editMode && this.enableEditMode) {
                this.showImageCropUpload = true;
            }
        },

        /**
         * Create an incident for this status page
         * @returns {void}
         */
        createIncident() {
            this.enableEditIncidentMode = true;

            if (this.incident) {
                this.previousIncident = Object.assign({}, this.incident);
            }

            this.incident = {
                title: "",
                content: "",
                style: "primary",
            };
        },

        /**
         * Post the incident to the status page
         * @returns {void}
         */
        postIncident() {
            if (!this.incident || this.incident.title === "" || this.incident.content === "") {
                this.$root.toastError("Please input title and content");
                return;
            }

            this.$root.getSocket().emit("postIncident", this.slug, this.incident, (res) => {

                if (res.ok) {
                    this.enableEditIncidentMode = false;
                    this.incident = res.incident || {};
                } else {
                    this.$root.toastError(res.msg);
                }

            });

        },

        /**
         * Click Edit Button
         * @returns {void}
         */
        editIncident() {
            this.enableEditIncidentMode = true;
            if (this.incident) {
                this.previousIncident = Object.assign({}, this.incident);
            }
        },

        /**
         * Cancel creation or editing of incident
         * @returns {void}
         */
        cancelIncident() {
            this.enableEditIncidentMode = false;

            if (this.previousIncident) {
                this.incident = this.previousIncident;
                this.previousIncident = null;
            }
        },

        /**
         * Unpin the incident
         * @returns {void}
         */
        unpinIncident() {
            this.$root.getSocket().emit("unpinIncident", this.slug, () => {
                this.incident = null;
            });
        },

        /**
         * Get the relative time difference of a date from now
         * @param {any} date Date to get time difference
         * @returns {string} Time difference
         */
        dateFromNow(date) {
            return dayjs.utc(date).fromNow();
        },

        /**
         * Remove a domain from the status page
         * @param {number} index Index of domain to remove
         * @returns {void}
         */
        removeDomain(index) {
            this.config.domainNameList.splice(index, 1);
        },

        /**
         * Generate sanitized HTML from maintenance description
         * @param {string} description Text to sanitize
         * @returns {string} Sanitized HTML
         */
        maintenanceHTML(description) {
            if (description) {
                return DOMPurify.sanitize(marked(description));
            } else {
                return "";
            }
        },

    }
};
</script>

<style lang="scss" scoped>
@import "../assets/vars.scss";

.overall-status {
    font-weight: bold;
    font-size: 25px;

    .ok {
        color: $primary;
    }

    .warning {
        color: $warning;
    }

    .danger {
        color: $danger;
    }
}

h1 {
    font-size: 30px;

    img {
        vertical-align: middle;
        height: 60px;
        width: 60px;
    }
}

.main {
    transition: all ease-in-out 0.1s;

    &.edit {
        margin-left: 300px;
    }
}

.sidebar {
    position: fixed;
    left: 0;
    top: 0;
    width: 300px;
    height: 100vh;

    border-right: 1px solid #ededed;

    .danger-zone {
        border-top: 1px solid #ededed;
        padding-top: 15px;
    }

    .sidebar-body {
        padding: 0 10px 10px 10px;
        overflow-x: hidden;
        overflow-y: auto;
        height: calc(100% - 70px);
    }

    .sidebar-footer {
        border-top: 1px solid #ededed;
        border-right: 1px solid #ededed;
        padding: 10px;
        width: 300px;
        height: 70px;
        position: fixed;
        left: 0;
        bottom: 0;
        background-color: white;
        display: flex;
        align-items: center;
    }
}

footer {
    text-align: center;
    font-size: 14px;
}

.description span {
    min-width: 50px;
}

.title-flex {
    display: flex;
    align-items: center;
    gap: 10px;
}

.logo-wrapper {
    display: inline-block;
    position: relative;

    &:hover {
        .icon-upload {
            transform: scale(1.2);
        }
    }

    .icon-upload {
        transition: all $easing-in 0.2s;
        position: absolute;
        bottom: 6px;
        font-size: 20px;
        left: -14px;
        background-color: white;
        padding: 5px;
        border-radius: 10px;
        cursor: pointer;
        box-shadow: 0 15px 70px rgba(0, 0, 0, 0.9);
    }
}

.logo {
    transition: all $easing-in 0.2s;

    &.edit-mode {
        cursor: pointer;

        &:hover {
            transform: scale(1.2);
        }
    }
}

.incident {
    .content {
        &[contenteditable="true"] {
            min-height: 60px;
        }
    }

    .date {
        font-size: 12px;
    }
}

.maintenance-bg-info {
    color: $maintenance;
}

.maintenance-icon {
    font-size: 35px;
    vertical-align: middle;
}

.dark .shadow-box {
    background-color: #0d1117;
}

.status-maintenance {
    color: $maintenance;
    margin-right: 5px;
}

.mobile {
    h1 {
        font-size: 22px;
    }

    .overall-status {
        font-size: 20px;
    }
}

.dark {
    .sidebar {
        background-color: $dark-header-bg;
        border-right-color: $dark-border-color;

        .danger-zone {
            border-top-color: $dark-border-color;
        }

        .sidebar-footer {
            border-right-color: $dark-border-color;
            border-top-color: $dark-border-color;
            background-color: $dark-header-bg;
        }
    }
}

.domain-name-list {
    li {
        display: flex;
        align-items: center;
        padding: 10px 0 10px 10px;

        .domain-input {
            flex-grow: 1;
            background-color: transparent;
            border: none;
            color: $dark-font-color;
            outline: none;

            &::placeholder {
                color: #1d2634;
            }
        }
    }
}

.bg-maintenance {
    .alert-heading {
        font-weight: bold;
    }
}

 .refresh-info {
     opacity: 0.7;
 }
 
 /* Debug Information Styling */
 .debug-info {
     font-family: 'Courier New', monospace;
     font-size: 0.85em;
     background-color: #f8f9fa !important;
     border-color: #dee2e6 !important;
 }
 
 .debug-info h6 {
     color: #6c757d;
     font-weight: 600;
 }
 
 .debug-info strong {
     color: #495057;
 }
 
 .dark .debug-info {
     background-color: #2d3748 !important;
     border-color: #4a5568 !important;
     color: #e2e8f0;
 }
 
 .dark .debug-info h6 {
     color: #a0aec0;
 }
 
 .dark .debug-info strong {
     color: #cbd5e0;
 }

</style>
