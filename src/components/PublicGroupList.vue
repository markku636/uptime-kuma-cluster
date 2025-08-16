<template>
    <!-- Group List -->
    <Draggable
        :list="filteredGroupList"
        :disabled="!editMode || activeTab !== 'all'"
        item-key="id"
        :animation="100"
        @change="handleDragChange"
    >
        <template #item="group">
            <div class="mb-5" data-testid="group">
                <!-- Group Title -->
                <h2 v-if="shouldShowGroupTitle" class="group-title">
                    <font-awesome-icon v-if="editMode && showGroupDrag" icon="arrows-alt-v" class="action drag me-3" />
                    <font-awesome-icon v-if="editMode" icon="times" class="action remove me-3" @click="removeGroup(group.index)" />
                    <Editable v-model="group.element.name" :contenteditable="editMode" tag="span" data-testid="group-name" />
                </h2>

                <div class="shadow-box monitor-list mt-4 position-relative">
                                         <div v-if="getPaginatedMonitorsForGroup(group).length === 0" class="text-center no-monitor-msg">
                         {{ $t("No Monitors") }}
                     </div>

                    <!-- Monitor List -->
                    <!-- animation is not working, no idea why -->
                                         <Draggable
                         :list="getPaginatedMonitorsForGroup(group)"
                         class="monitor-list"
                         group="same-group"
                         :disabled="!editMode"
                         :animation="100"
                         item-key="id"
                     >
                        <template #item="monitor">
                            <div class="item" data-testid="monitor">
                                <div class="row">
                                    <div class="col-6 small-padding">
                                        <div class="info">
                                            <font-awesome-icon v-if="editMode" icon="arrows-alt-v" class="action drag me-3" />
                                            <font-awesome-icon v-if="editMode" icon="times" class="action remove me-3" @click="removeMonitor(group.index, monitor.index)" />

                                            <Uptime :monitor="monitor.element" type="24" :pill="true" />
                                            <a
                                                v-if="showLink(monitor)"
                                                :href="monitor.element.url"
                                                class="item-name"
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                data-testid="monitor-name"
                                            >
                                                {{ monitor.element.name }}
                                            </a>
                                            <p v-else class="item-name" data-testid="monitor-name"> {{ monitor.element.name }} </p>

                                            <span
                                                title="Setting"
                                            >
                                                <font-awesome-icon
                                                    v-if="editMode"
                                                    :class="{'link-active': true, 'btn-link': true}"
                                                    icon="cog" class="action me-3"
                                                    data-testid="monitor-settings"
                                                    @click="$refs.monitorSettingDialog.show(group, monitor)"
                                                />
                                            </span>
                                        </div>
                                        <div class="extra-info">
                                            <div v-if="showCertificateExpiry && monitor.element.certExpiryDaysRemaining">
                                                <Tag :item="{name: $t('Cert Exp.'), value: formattedCertExpiryMessage(monitor), color: certExpiryColor(monitor)}" :size="'sm'" />
                                            </div>
                                            <div v-if="showTags">
                                                <Tag v-for="tag in monitor.element.tags" :key="tag" :item="tag" :size="'sm'" data-testid="monitor-tag" />
                                            </div>
                                        </div>
                                    </div>
                                    <div :key="$root.userHeartbeatBar" class="col-6">
                                        <HeartbeatBar size="mid" :monitor-id="monitor.element.id" />
                                    </div>
                                </div>
                            </div>
                        </template>
                    </Draggable>
                </div>
            </div>
        </template>
    </Draggable>
    <MonitorSettingDialog ref="monitorSettingDialog" />
</template>

<script>
import MonitorSettingDialog from "./MonitorSettingDialog.vue";
import Draggable from "vuedraggable";
import HeartbeatBar from "./HeartbeatBar.vue";
import Uptime from "./Uptime.vue";
import Tag from "./Tag.vue";

export default {
    components: {
        MonitorSettingDialog,
        Draggable,
        HeartbeatBar,
        Uptime,
        Tag,
    },
    props: {
        /** Are we in edit mode? */
        editMode: {
            type: Boolean,
            required: true,
        },
        /** Should tags be shown? */
        showTags: {
            type: Boolean,
        },
        /** Should expiry be shown? */
        showCertificateExpiry: {
            type: Boolean,
        },
        /** Active tab for filtering groups */
        activeTab: {
            type: [String, Number],
            default: 'all'
        },
                 /** Current page for pagination */
         page: {
             type: Number,
             default: 1
         },
         /** Items per page */
         perPage: {
             type: Number,
             default: 10
         },
         /** Paginated data from parent */
         paginatedData: {
             type: Array,
             default: () => []
         }
    },
    data() {
        return {

        };
    },
    computed: {
        showGroupDrag() {
            return (this.$root.publicGroupList.length >= 2);
        },
        
        /**
         * Filter groups based on active tab
         * @returns {Array} Filtered group list
         */
        filteredGroupList() {
            if (!this.$root.publicGroupList) {
                return [];
            }
            
            // In edit mode, show all groups
            if (this.editMode) {
                return this.$root.publicGroupList;
            }
            
            // If activeTab is 'all', show all groups
            if (this.activeTab === 'all') {
                return this.$root.publicGroupList;
            }
            
            // Filter to show only the selected group
            const selectedGroup = this.$root.publicGroupList.find(group => group.id == this.activeTab);
            if (selectedGroup) {
                console.log(`Filtering to show group: ${selectedGroup.name} (ID: ${selectedGroup.id}) with ${selectedGroup.monitorList ? selectedGroup.monitorList.length : 0} monitors`);
                return [selectedGroup];
            }
            
            console.log(`No group found for activeTab: ${this.activeTab}`);
            // If no matching group found, return empty array
            return [];
        },
        
        /**
         * Get paginated monitor list for the current group
         * @returns {Array} Paginated monitor list
         */
        paginatedMonitorList() {
            if (!this.$root.publicGroupList) {
                return [];
            }
            
            let allMonitors = [];
            
            if (this.activeTab === 'all') {
                // Collect all monitors from all groups
                this.$root.publicGroupList.forEach(group => {
                    if (group.monitorList && Array.isArray(group.monitorList)) {
                        allMonitors = allMonitors.concat(group.monitorList);
                    }
                });
            } else {
                // Get monitors from selected group
                const selectedGroup = this.$root.publicGroupList.find(group => group.id == this.activeTab);
                if (selectedGroup && selectedGroup.monitorList) {
                    allMonitors = selectedGroup.monitorList;
                }
            }
            
            // Apply pagination
            const startIndex = (this.page - 1) * this.perPage;
            const endIndex = startIndex + this.perPage;
            
            console.log(`Pagination: page ${this.page}, perPage ${this.perPage}, startIndex ${startIndex}, endIndex ${endIndex}, total ${allMonitors.length}`);
            
            return allMonitors.slice(startIndex, endIndex);
        },
        
        /**
         * Check if we should show group title
         * @returns {boolean} Should show group title
         */
        shouldShowGroupTitle() {
            // Always show in edit mode
            if (this.editMode) {
                return true;
            }
            
            // Show when displaying all groups
            if (this.activeTab === 'all') {
                return true;
            }
            
            // Hide when showing single group (since the tab already indicates which group)
            return false;
        }
    },
    created() {

    },
    methods: {
        /**
         * Handle drag and drop changes
         * @param {object} event Drag event
         * @returns {void}
         */
        handleDragChange(event) {
            // Only allow drag changes when showing all groups
            if (this.activeTab === 'all' && this.editMode) {
                if (event.moved) {
                    // Update the original publicGroupList
                    const item = this.$root.publicGroupList.splice(event.moved.oldIndex, 1)[0];
                    this.$root.publicGroupList.splice(event.moved.newIndex, 0, item);
                }
            }
        },

        /**
         * Remove the specified group
         * @param {number} index Index of group to remove
         * @returns {void}
         */
        removeGroup(index) {
            this.$root.publicGroupList.splice(index, 1);
        },

        /**
         * Remove a monitor from a group
         * @param {number} groupIndex Index of group to remove monitor
         * from
         * @param {number} index Index of monitor to remove
         * @returns {void}
         */
        removeMonitor(groupIndex, index) {
            this.$root.publicGroupList[groupIndex].monitorList.splice(index, 1);
        },

        /**
         * Should a link to the monitor be shown?
         * Attempts to guess if a link should be shown based upon if
         * sendUrl is set and if the URL is default or not.
         * @param {object} monitor Monitor to check
         * @param {boolean} ignoreSendUrl Should the presence of the sendUrl
         * property be ignored. This will only work in edit mode.
         * @returns {boolean} Should the link be shown
         */
        showLink(monitor, ignoreSendUrl = false) {
            // We must check if there are any elements in monitorList to
            // prevent undefined errors if it hasn't been loaded yet
            if (this.$parent.editMode && ignoreSendUrl && Object.keys(this.$root.monitorList).length) {
                return this.$root.monitorList[monitor.element.id].type === "http" || this.$root.monitorList[monitor.element.id].type === "keyword" || this.$root.monitorList[monitor.element.id].type === "json-query";
            }
            return monitor.element.sendUrl && monitor.element.url && monitor.element.url !== "https://";
        },

        /**
         * Returns formatted certificate expiry or Bad cert message
         * @param {object} monitor Monitor to show expiry for
         * @returns {string} Certificate expiry message
         */
        formattedCertExpiryMessage(monitor) {
            if (monitor?.element?.validCert && monitor?.element?.certExpiryDaysRemaining) {
                return monitor.element.certExpiryDaysRemaining + " " + this.$tc("day", monitor.element.certExpiryDaysRemaining);
            } else if (monitor?.element?.validCert === false) {
                return this.$t("noOrBadCertificate");
            } else {
                return this.$t("Unknown") + " " + this.$tc("day", 2);
            }
        },

                 /**
          * Returns certificate expiry color based on days remaining
          * @param {object} monitor Monitor to show expiry for
          * @returns {string} Color for certificate expiry
          */
         certExpiryColor(monitor) {
             if (monitor?.element?.validCert && monitor.element.certExpiryDaysRemaining > 7) {
                 return "#059669";
             }
             return "#DC2626";
         },
         
                   /**
           * Get paginated monitors for a specific group
           * @param {object} group Group object
           * @returns {Array} Paginated monitor list
           */
          getPaginatedMonitorsForGroup(group) {
              if (!group || !group.element || !group.element.monitorList) {
                  console.log(`getPaginatedMonitorsForGroup: Invalid group or no monitorList`);
                  return [];
              }
              
              // In edit mode, show all monitors
              if (this.editMode) {
                  console.log(`Group ${group.element.name}: Edit mode, showing all ${group.element.monitorList.length} monitors`);
                  return group.element.monitorList;
              }
              
              console.log(`getPaginatedMonitorsForGroup called for group: ${group.element.name}, activeTab: ${this.activeTab}, page: ${this.page}`);
              
              // For specific group tab, apply pagination directly to that group's monitors
              if (this.activeTab == group.element.id) {
                  const startIndex = (this.page - 1) * this.perPage;
                  const endIndex = startIndex + this.perPage;
                  const monitorsToShow = group.element.monitorList.slice(startIndex, endIndex);
                  
                  console.log(`Group ${group.element.name}: specific tab, page ${this.page}, perPage ${this.perPage}, showing ${monitorsToShow.length}/${group.element.monitorList.length} monitors`);
                  return monitorsToShow;
              }
              
              // For 'all' tab or when showing other groups, we need to handle pagination across all groups
              if (this.activeTab === 'all') {
                  // Calculate which monitors from this group should be shown on the current page
                  const monitorsBeforeThisGroup = this.getMonitorsBeforeGroup(group);
                  const groupStartIndex = Math.max(0, (this.page - 1) * this.perPage - monitorsBeforeThisGroup);
                  const groupEndIndex = Math.min(group.element.monitorList.length, this.page * this.perPage - monitorsBeforeThisGroup);
                  
                  if (groupStartIndex < groupEndIndex && groupStartIndex >= 0) {
                      const monitorsToShow = group.element.monitorList.slice(groupStartIndex, groupEndIndex);
                      console.log(`Group ${group.element.name}: all tab, page ${this.page}, showing ${monitorsToShow.length}/${group.element.monitorList.length} monitors (start: ${groupStartIndex}, end: ${groupEndIndex})`);
                      return monitorsToShow;
                  } else {
                      console.log(`Group ${group.element.name}: all tab, page ${this.page}, no monitors to show for this page`);
                      return [];
                  }
              }
              
              // For other cases, return empty array
              console.log(`Group ${group.element.name}: no matching tab logic, returning empty array`);
              return [];
          },
         
                   /**
           * Calculate how many monitors come before this group in the flattened list
           * @param {object} group Group object
           * @returns {number} Number of monitors before this group
           */
          getMonitorsBeforeGroup(group) {
              if (!this.$root.publicGroupList) {
                  console.log('getMonitorsBeforeGroup: No publicGroupList available');
                  return 0;
              }
              
              let monitorCount = 0;
              for (const g of this.$root.publicGroupList) {
                  if (g.id === group.element.id) {
                      break;
                  }
                  if (g.monitorList && Array.isArray(g.monitorList)) {
                      monitorCount += g.monitorList.length;
                      console.log(`Group ${g.name}: adding ${g.monitorList.length} monitors, total before: ${monitorCount}`);
                  }
              }
              
              console.log(`Total monitors before group ${group.element.name}: ${monitorCount}`);
              return monitorCount;
          },
    }
};
</script>

<style lang="scss" scoped>
@import "../assets/vars";

.extra-info {
    display: flex;
    margin-bottom: 0.5rem;
}

.extra-info > div > div:first-child {
    margin-left: 0 !important;
}

.no-monitor-msg {
    position: absolute;
    width: 100%;
    top: 20px;
    left: 0;
}

.monitor-list {
    min-height: 46px;
}

.item-name {
    padding-left: 5px;
    padding-right: 5px;
    margin: 0;
    display: inline-block;
}

.btn-link {
    color: #bbbbbb;
    margin-left: 5px;
}

.link-active {
    color: $primary;
}

.flip-list-move {
    transition: transform 0.5s;
}

.no-move {
    transition: transform 0s;
}

.drag {
    color: #bbb;
    cursor: grab;
}

.remove {
    color: $danger;
}

.group-title {
    span {
        display: inline-block;
        min-width: 15px;
    }
}

.mobile {
    .item {
        padding: 13px 0 10px;
    }
}

.bg-maintenance {
    background-color: $maintenance;
}

</style>
