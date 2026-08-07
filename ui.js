
    /**
     * @typedef {{ modeId: string, modeName: string, value: string }} ModeValue
     * @typedef {{ variableId: string, variableName: string, collectionName: string, modes: ModeValue[] }} BoundVariable
     */

    let currentVariables = [];
    const dirtyValues = new Map();
    const expandedCards = new Set();
    let hasMoreFromPlugin = false;
    let isLoadingMore = false;

    let unboundNode = null;
    let allUnbound = false;
    let allUnboundNodeIds = [];
    let localCollections = [];
    let externalCollections = [];
    let lastCollectionId = null;
    let bindCollectionFilter = "all"; // Persisted via clientStorage
    let defaultCreateCollectionId = null;
    let disabledCollections = [];
    let lastBoundVariableName = null;
    let currentUnboundNodes = [];
    let hasMoreUnbound = false;
    let currentNegativeList = [];
    let isSelectionEmpty = true;
    let availableModes = [];
    let selectedPreviewMode = null;
    let activeUnboundBindNodes = null;

    const tabsContainer = document.getElementById("tabsContainer");
    const tabBtns = document.querySelectorAll(".tab-btn");
    const tabContents = document.querySelectorAll(".tab-content");
    const unboundList = document.getElementById("unboundList");
    const unboundEmptyState = document.getElementById("unboundEmptyState");
    const scanAllUnboundBtn = document.getElementById("scanAllUnboundBtn");
    const unboundBindContainer = document.getElementById("unboundBindContainer");

    const mainContent = document.getElementById("mainContent");
    const applyBtn    = document.getElementById("applyBtn");
    const undoBtn     = document.getElementById("undoBtn");
    const refreshBtn  = document.getElementById("refreshBtn");
    const refreshIcon = document.getElementById("refreshIcon");
    const autoApplyToggle = document.getElementById("autoApplyToggle");
    const toast       = document.getElementById("toast");
    const toastMsg    = document.getElementById("toastMsg");

    const collectionFilter = document.getElementById("collectionFilter");
    const searchInput = document.getElementById("searchInput");
    const toggleExpandBtn = document.getElementById("toggleExpandBtn");
    const activeCollectionsList = document.getElementById("activeCollectionsList");
    const checkAllColsBtn = document.getElementById("checkAllColsBtn");
    const uncheckAllColsBtn = document.getElementById("uncheckAllColsBtn");

    let toastTimeout = null;
    function showToast(message, isError = false) {
      toastMsg.textContent = message;
      if (isError) {
        toast.classList.add("error");
      } else {
        toast.classList.remove("error");
      }
      toast.classList.add("visible");
      if (toastTimeout) clearTimeout(toastTimeout);
      toastTimeout = setTimeout(() => {
        toast.classList.remove("visible");
      }, 2000);
    }

    // -----------------------------------------------------------------------
    // Message handling from plugin controller
    // -----------------------------------------------------------------------
    let loadingTimeout = null;

    window.onmessage = (event) => {
      const msg = event.data.pluginMessage;
      if (!msg) return;

      if (msg.type === "loading-start") {
        const loaderHTML = `
          <div class="loading-state" style="opacity: 0; animation: fadeIn 0.2s ease-in forwards;">
            <div class="spinner"></div>
            <div>Scanning selection...</div>
          </div>
        `;
        if (document.querySelector('.tab-btn[data-tab="bound"]').classList.contains('active')) {
          mainContent.innerHTML = loaderHTML;
        } else {
          const unboundEmptyState = document.getElementById('unboundEmptyState');
          const unboundListActions = document.getElementById('unboundListActions');
          const unboundList = document.getElementById('unboundList');
          if (unboundEmptyState) unboundEmptyState.style.display = "none";
          if (unboundListActions) unboundListActions.style.display = "none";
          if (unboundList) unboundList.innerHTML = loaderHTML;
        }
        return;
      }

      if (msg.type === "external-collections-loaded") {
        if (msg.externalCollections) {
          externalCollections = msg.externalCollections;
          if (msg.disabledCollections) disabledCollections = msg.disabledCollections;
          renderCollectionsSettings();
          updateSettingsDropdown();
          
          const linkVarCollectionFilter = document.getElementById("linkVarCollectionFilter");
          if (linkVarCollectionFilter) {
            const currentVal = linkVarCollectionFilter.value;
            // Repopulate options for Bind Variable page filter
            let defaultVal = "all";
            let optionsHtml = `
              <option value="all" ${defaultVal === "all" ? "selected" : ""}>All collections</option>
              <option value="local" ${defaultVal === "local" ? "selected" : ""}>Local collections only</option>
              <option value="external" ${defaultVal === "external" ? "selected" : ""}>Libraries only</option>
              <option disabled>──────────</option>
            `;
            localCollections.forEach(c => {
              if (disabledCollections.includes(c.id)) return;
              optionsHtml += `<option value="${c.id}" ${defaultVal === c.id ? "selected" : ""}>${escHtml(c.name)}</option>`;
            });
            if (externalCollections.length > 0) {
              let hasEnabledExternal = false;
              let externalHtml = "";
              externalCollections.forEach(c => {
                if (disabledCollections.includes(c.id)) return;
                hasEnabledExternal = true;
                externalHtml += `<option value="${c.id}" ${defaultVal === c.id ? "selected" : ""}>${escHtml(c.name)}</option>`;
              });
              if (hasEnabledExternal) {
                optionsHtml += `<option disabled>──────────</option>` + externalHtml;
              }
            }
            linkVarCollectionFilter.innerHTML = optionsHtml;
            if (linkVarCollectionFilter.querySelector(`option[value="${currentVal}"]`)) {
              linkVarCollectionFilter.value = currentVal;
            }
          }
        }
        return;
      }

      if (msg.type === "scan-result" || msg.type === "load-more-result") {
        const activeEl = document.activeElement;
        let focusedVarId = null;
        let focusedModeId = null;
        let selectionStart = null;
        let selectionEnd = null;

        if (activeEl && activeEl.classList.contains("mode-textarea")) {
          focusedVarId = activeEl.dataset.varId;
          focusedModeId = activeEl.dataset.modeId;
          selectionStart = activeEl.selectionStart;
          selectionEnd = activeEl.selectionEnd;
        }

        if (msg.type === "scan-result") {
          currentVariables = msg.variables;
          unboundNode = msg.unboundNode || null;
          if (msg.localCollections) {
            localCollections = msg.localCollections;
          }
          if (msg.externalCollections) {
            externalCollections = msg.externalCollections;
          }
          if (msg.disabledCollections) {
            disabledCollections = msg.disabledCollections;
          }
          if (msg.availableModes) {
            availableModes = msg.availableModes;
            if (selectedPreviewMode === null && availableModes.length > 0) {
              selectedPreviewMode = availableModes[0];
            } else if (selectedPreviewMode === null) {
              selectedPreviewMode = "";
            }
          }
          if (msg.bindCollectionFilter) bindCollectionFilter = msg.bindCollectionFilter;
          if (msg.lastCollectionId) lastCollectionId = msg.lastCollectionId;
          if (msg.defaultCreateCollectionId !== undefined) {
            defaultCreateCollectionId = msg.defaultCreateCollectionId;
          }
          renderCollectionsSettings();
          updateSettingsDropdown();
          
          if (msg.unboundNodes) {
            currentUnboundNodes = msg.unboundNodes;
          }
          allUnbound = msg.allUnbound === true;
          allUnboundNodeIds = allUnbound && currentUnboundNodes.length > 0 ? currentUnboundNodes.map(n => n.id) : [];
          if (msg.hasMoreUnbound !== undefined) hasMoreUnbound = msg.hasMoreUnbound;
          if (msg.isSelectionEmpty !== undefined) isSelectionEmpty = msg.isSelectionEmpty;
          if (msg.activeTab) switchTab(msg.activeTab, false);
          if (msg.collectionFilter) collectionFilter.dataset.savedValue = msg.collectionFilter;
          
          if (msg.autoApply !== undefined) {
            autoApplyToggle.checked = msg.autoApply;
            const footer = document.querySelector(".footer");
            if (msg.autoApply) {
              footer.classList.add("auto-apply-on");
            } else {
              footer.classList.remove("auto-apply-on");
            }
          }
          
          if (msg.negativeList !== undefined) {
            if (JSON.stringify(currentNegativeList) !== JSON.stringify(msg.negativeList)) {
              currentNegativeList = msg.negativeList;
              renderNegativeListPills();
            }
          }

          dirtyValues.clear();
          expandedCards.clear();
          currentVariables.forEach(v => expandedCards.add(v.variableId));
          
          const toggleExpandBtn = document.getElementById("toggleExpandBtn");
          toggleExpandBtn.dataset.state = "expanded";
          toggleExpandBtn.title = "Collapse all";
          document.getElementById("icon-collapse").style.display = "block";
          document.getElementById("icon-expand").style.display = "none";
        } else {
          currentVariables = currentVariables.concat(msg.variables);
          msg.variables.forEach(v => expandedCards.add(v.variableId));
        }

        hasMoreFromPlugin = msg.hasMore;
        isLoadingMore = false;

        const oldScrollTop = mainContent.scrollTop;

        updateDropdownOptions();
        renderContent();
        
        if (msg.type === "scan-result") {
          mainContent.scrollTop = 0;
        } else if (msg.type === "load-more-result" && msg.variables.length > 0) {
          mainContent.scrollTop = oldScrollTop;
          // Smooth scroll to the first new variable
          const firstNewVarId = msg.variables[0].variableId;
          const firstNewCard = document.querySelector(`.var-card[data-var-id="${firstNewVarId}"]`);
          if (firstNewCard) {
            firstNewCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        }
        
        updateFooterState();
        stopRefreshSpin();

        // Restore focus
        if (focusedVarId && focusedModeId) {
          const taToFocus = document.querySelector(`.mode-textarea[data-var-id="${focusedVarId}"][data-mode-id="${focusedModeId}"]`);
          if (taToFocus) {
            taToFocus.focus();
            if (selectionStart !== null && selectionEnd !== null) {
              taToFocus.setSelectionRange(selectionStart, selectionEnd);
            }
          }
        }
      } else if (msg.type === "search-link-variables-result") {
        const linkVarResults = document.getElementById("linkVarResults");
        if (linkVarResults) {
          linkVarResults.innerHTML = "";
          if (msg.results.length === 0) {
            linkVarResults.innerHTML = `<div style="padding: 12px; text-align: center; color: var(--text-muted); font-size: 11px;">No variables found</div>`;
          } else {
            const currentSearchInput = document.getElementById("linkVarSearch");
            const currentQuery = currentSearchInput ? currentSearchInput.value.trim() : "";
            
            const highlightMatch = (text, q) => {
              if (!q) return escHtml(text);
              const escapedText = escHtml(text);
              const escapedQuery = escHtml(q);
              const regex = new RegExp(`(${escapedQuery.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')})`, "gi");
              return escapedText.replace(regex, `<mark style="background-color: rgba(250, 204, 21, 0.4); color: var(--text-primary); border-radius: 2px; padding: 0 1px; margin: 0 -1px;">$1</mark>`);
            };

            msg.results.forEach(res => {
              const item = document.createElement("div");
              item.style.padding = "8px 12px";
              item.style.borderRadius = "4px";
              item.style.cursor = "pointer";
              item.style.display = "flex";
              item.style.flexDirection = "column";
              item.style.gap = "4px";
              item.style.transition = "background-color 0.1s";
              item.onmouseenter = () => item.style.backgroundColor = "var(--bg-hover)";
              item.onmouseleave = () => item.style.backgroundColor = "transparent";
              
              item.innerHTML = `
                <div style="font-size: 11px; font-weight: 500; color: var(--text-primary); word-break: break-all;">${highlightMatch(res.name, currentQuery)}</div>
                <div style="font-size: 10px; color: var(--text-secondary); display: flex; justify-content: space-between;">
                  <span>${escHtml(res.collectionName)}</span>
                  <span style="color: var(--text-muted); font-style: italic; max-width: 150px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${escHtml(res.value)}">${highlightMatch(res.value, currentQuery)}</span>
                </div>
              `;
              
              item.onclick = () => {
                const btn = document.getElementById("createBindBtn");
                if (btn) btn.disabled = true;
                const msg = { type: "bind-existing-variable", variableId: res.id, isExternal: res.isExternal, key: res.key };
                if (allUnbound && allUnboundNodeIds.length > 0) msg.nodeIds = allUnboundNodeIds;
                parent.postMessage({ pluginMessage: msg }, "*");
              };
              
              linkVarResults.appendChild(item);
            });
          }
        }
      } else if (msg.type === "create-error") {
        const createBindBtn = document.getElementById("createBindBtn");
        if (createBindBtn) {
          createBindBtn.textContent = "Create & Bind Variable";
          createBindBtn.disabled = false;
        }
        const nameInput = document.getElementById("newVarName");
        if (nameInput) {
          nameInput.style.borderColor = "var(--danger)";
          nameInput.style.backgroundColor = "rgba(242, 72, 34, 0.1)";
          showToast(msg.message, true);
          const resetError = () => {
            nameInput.style.borderColor = "var(--border-focus)";
            nameInput.style.backgroundColor = "var(--bg-input)";
            nameInput.removeEventListener("input", resetError);
          };
          nameInput.addEventListener("input", resetError);
        }
      } else if (msg.type === "rename-error") {
        const card = document.querySelector(`.var-card[data-var-id="${msg.variableId}"]`);
        if (card) {
          const nameInput = card.querySelector(".rename-input");
          if (nameInput) {
            nameInput.style.borderColor = "var(--danger)";
            nameInput.style.backgroundColor = "rgba(242, 72, 34, 0.1)";
            showToast(msg.message, true);
            const resetError = () => {
              nameInput.style.borderColor = "var(--border-focus)";
              nameInput.style.backgroundColor = "var(--bg-input)";
              nameInput.removeEventListener("input", resetError);
            };
            nameInput.addEventListener("input", resetError);
          }
        }
      } else if (msg.type === "status") {
        showToast(msg.message, true);
      }
    };

    // -----------------------------------------------------------------------
    // Tabs & Unbound Actions
    // -----------------------------------------------------------------------
    tabBtns.forEach(btn => {
      btn.addEventListener("click", () => {
        const tabId = btn.dataset.tab;
        switchTab(tabId, true);
      });
    });

    function switchTab(tabId, notifyPlugin = false) {
      tabBtns.forEach(btn => btn.classList.toggle("active", btn.dataset.tab === tabId));
      
      tabBtns.forEach(btn => {
        if (btn.dataset.tab === tabId) {
          btn.style.color = "var(--text-primary)";
          btn.style.borderBottomColor = "var(--accent)";
        } else {
          btn.style.color = "var(--text-secondary)";
          btn.style.borderBottomColor = "transparent";
        }
      });

      tabContents.forEach(content => {
        if (content.id === `tab${tabId.charAt(0).toUpperCase() + tabId.slice(1)}`) {
          content.classList.add("active");
          content.style.display = "flex";
        } else {
          content.classList.remove("active");
          content.style.display = "none";
        }
      });
      
      if (notifyPlugin) {
        parent.postMessage({ pluginMessage: { type: "switch-tab", tabId } }, "*");
      }
      
      if (tabId === "unbound") {
        renderUnboundContent();
      }
    }

    scanAllUnboundBtn.addEventListener("click", () => {
      scanAllUnboundBtn.textContent = "Scanning...";
      scanAllUnboundBtn.disabled = true;
      parent.postMessage({ pluginMessage: { type: "load-more-unbound" } }, "*");
    });

    function renderUnboundContent() {
      const uContent = document.getElementById("unboundContent");
      const uActions = document.getElementById("unboundListActions");
      const uFooter = document.getElementById("unboundFooter");
      
      if (activeUnboundBindNodes) {
        if (uContent) uContent.style.display = "none";
        if (uActions) uActions.style.display = "none";
        if (uFooter) uFooter.style.display = "none";
        unboundBindContainer.style.display = "flex";
        unboundBindContainer.innerHTML = "";
        
        const isMulti = activeUnboundBindNodes.length > 1;
        const targetIds = activeUnboundBindNodes.map(n => n.id);
        const node = activeUnboundBindNodes[0];
        
        const onBack = () => {
          activeUnboundBindNodes = null;
          renderUnboundContent();
        };
        
        const section = createBindVariableSection(
          isMulti, 
          isMulti ? `<span style="font-size: 11px; color: var(--text-secondary); margin-top: 2px;">${targetIds.length} labels selected</span>` : "",
          targetIds,
          node.text,
          node.name,
          onBack
        );
        unboundBindContainer.appendChild(section);
        return;
      } else {
        if (uContent) uContent.style.display = "flex";
        if (uActions) uActions.style.display = "flex";
        if (uFooter) uFooter.style.display = "flex";
        unboundBindContainer.style.display = "none";
      }

      unboundList.innerHTML = "";
      
      const listActions = document.getElementById("unboundListActions");
      if (currentUnboundNodes.length === 0) {
        unboundEmptyState.style.display = "flex";
        scanAllUnboundBtn.style.display = "none";
        if (listActions) listActions.style.display = "none";
        
        const emptyTitle = unboundEmptyState.querySelector(".empty-title");
        if (emptyTitle) {
          if (isSelectionEmpty) {
            emptyTitle.textContent = "Select layers to find text labels not yet linked to variables";
          } else {
            emptyTitle.textContent = "No unbound text labels in selection";
          }
        }
        return;
      }
      
      unboundEmptyState.style.display = "none";
      if (listActions) listActions.style.display = "flex";
      scanAllUnboundBtn.style.display = hasMoreUnbound ? "block" : "none";
      scanAllUnboundBtn.textContent = "Scan all labels (the rest)";
      scanAllUnboundBtn.disabled = false;
      
      currentUnboundNodes.forEach(node => {
        const item = document.createElement("div");
        item.className = "var-card";
        item.style.cursor = "pointer";
        item.style.transition = "background var(--transition), border-color var(--transition)";
        item.title = "Click to isolate this text node and create a variable";
        
        item.innerHTML = `
          <div class="var-header" style="display: flex; justify-content: space-between; align-items: center; padding-right: 12px;">
            <div class="var-name-wrap" style="flex: 1; overflow: hidden;">
              <div class="var-icon" style="pointer-events: none;">T</div>
              <div class="var-name" style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 11px; color: var(--text-secondary); pointer-events: none;">${escHtml(node.name)}</div>
              <a class="bind-link" style="font-size: 11px; color: var(--accent); text-decoration: none; font-weight: 500; cursor: pointer;">Bind</a>
            </div>
            <a class="ignore-link" style="font-size: 11px; color: var(--accent); text-decoration: none; font-weight: 500; cursor: pointer;">Ignore</a>
          </div>
          <div class="var-body" style="padding: 0 12px 12px 12px; pointer-events: none;">
            <div style="font-size: 12px; color: var(--text-primary); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;">
              ${escHtml(node.text)}
            </div>
          </div>
        `;
        
        item.addEventListener("mouseenter", () => {
          item.style.background = "var(--bg-hover)";
          item.style.borderColor = "var(--border-focus)";
        });
        item.addEventListener("mouseleave", () => {
          item.style.background = "var(--bg-card)";
          item.style.borderColor = "var(--border)";
        });
        
        item.addEventListener("click", () => {
          parent.postMessage({ pluginMessage: { type: "select-node", nodeId: node.id } }, "*");
        });

        const bindLink = item.querySelector(".bind-link");
        if (bindLink) {
          bindLink.addEventListener("click", (e) => {
            e.stopPropagation();
            activeUnboundBindNodes = [node];
            renderUnboundContent();
          });
        }
        
        const ignoreLink = item.querySelector(".ignore-link");
        if (ignoreLink) {
          ignoreLink.addEventListener("click", (e) => {
            e.stopPropagation();
            if (!currentNegativeList.includes(node.name)) {
              currentNegativeList.push(node.name);
              renderNegativeListPills();
              parent.postMessage({ pluginMessage: { type: "update-negative-list", list: currentNegativeList } }, "*");
            }
          });
        }
        
        unboundList.appendChild(item);
      });
    }
    // -----------------------------------------------------------------------
    // Actions & Event Listeners
    // -----------------------------------------------------------------------
    refreshBtn.addEventListener("click", () => {
      parent.postMessage({ pluginMessage: { type: "refresh" } }, "*");
    });

    collectionFilter.addEventListener("change", () => {
      parent.postMessage({ pluginMessage: { type: "update-collection-filter", filter: collectionFilter.value } }, "*");
      renderContent();
    });



    defaultCreateCollectionSelect.addEventListener("change", () => {
      parent.postMessage({ pluginMessage: { type: "update-default-create-collection", collectionId: defaultCreateCollectionSelect.value } }, "*");
    });

    if (checkAllColsBtn) {
      checkAllColsBtn.addEventListener("click", (e) => {
        e.preventDefault();
        disabledCollections = [];
        parent.postMessage({ pluginMessage: { type: "update-disabled-collections", disabledCollections } }, "*");
        renderCollectionsSettings();
        updateSettingsDropdown();
        updateDropdownOptions();
      });
    }

    if (uncheckAllColsBtn) {
      uncheckAllColsBtn.addEventListener("click", (e) => {
        e.preventDefault();
        const allCols = [];
        localCollections.forEach(c => allCols.push(c.id));
        externalCollections.forEach(c => allCols.push(c.id));
        disabledCollections = allCols;
        defaultCreateCollectionId = null;
        parent.postMessage({ pluginMessage: { type: "update-default-create-collection", collectionId: "" } }, "*");
        parent.postMessage({ pluginMessage: { type: "update-disabled-collections", disabledCollections } }, "*");
        renderCollectionsSettings();
        updateSettingsDropdown();
        updateDropdownOptions();
      });
    }

    function renderCollectionsSettings() {
      if (!activeCollectionsList) return;
      activeCollectionsList.innerHTML = "";
      
      const allCols = [];
      localCollections.forEach(c => allCols.push({ id: c.id, name: c.name, type: "local" }));
      externalCollections.forEach(c => allCols.push({ id: c.id, name: c.name, type: "external" }));
      
      if (allCols.length === 0) {
        activeCollectionsList.innerHTML = `<div style="font-size: 11px; color: var(--text-secondary);">No collections found.</div>`;
        return;
      }
      
      allCols.forEach(c => {
        const row = document.createElement("label");
        row.style.display = "flex";
        row.style.alignItems = "center";
        row.style.gap = "8px";
        row.style.fontSize = "12px";
        row.style.color = "var(--text-primary)";
        row.style.cursor = "pointer";
        
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.checked = !disabledCollections.includes(c.id);
        cb.style.margin = "0";
        cb.style.accentColor = "var(--text-brand)";
        
        cb.addEventListener("change", (e) => {
          if (e.target.checked) {
            disabledCollections = disabledCollections.filter(id => id !== c.id);
          } else {
            if (!disabledCollections.includes(c.id)) {
              disabledCollections.push(c.id);
            }
            if (defaultCreateCollectionId === c.id) {
              defaultCreateCollectionId = null;
              parent.postMessage({ pluginMessage: { type: "update-default-create-collection", collectionId: "" } }, "*");
            }
          }
          parent.postMessage({ pluginMessage: { type: "update-disabled-collections", disabledCollections } }, "*");
          updateSettingsDropdown();
          updateDropdownOptions();
        });
        
        row.appendChild(cb);
        row.appendChild(document.createTextNode(c.name + (c.type === "external" ? " (Library)" : "")));
        activeCollectionsList.appendChild(row);
      });
    }

    function updateSettingsDropdown() {
      if (!defaultCreateCollectionSelect) return;
      
      defaultCreateCollectionSelect.innerHTML = `<option value="">No default collection</option>`;
      localCollections.forEach(c => {
        if (disabledCollections.includes(c.id)) return;
        const opt = document.createElement("option");
        opt.value = c.id;
        opt.textContent = c.name;
        if (c.id === defaultCreateCollectionId) {
          opt.selected = true;
        }
        defaultCreateCollectionSelect.appendChild(opt);
      });
    }

    searchInput.addEventListener("input", () => {
      renderContent();
    });

    const negativeListInput = document.getElementById("negativeListInput");
    const negativeListPills = document.getElementById("negativeListPills");
    
    function renderNegativeListPills() {
      if (!negativeListPills) return;
      negativeListPills.innerHTML = "";
      currentNegativeList.forEach(name => {
        const pill = document.createElement("div");
        pill.className = "pill";
        pill.innerHTML = `
          <span>${escHtml(name)}</span>
          <div class="remove-btn" title="Remove">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" width="10" height="10">
              <line x1="4" y1="4" x2="12" y2="12" />
              <line x1="4" y1="12" x2="12" y2="4" />
            </svg>
          </div>
        `;
        pill.querySelector(".remove-btn").addEventListener("click", () => {
          currentNegativeList = currentNegativeList.filter(n => n !== name);
          renderNegativeListPills();
          parent.postMessage({ pluginMessage: { type: "update-negative-list", list: currentNegativeList } }, "*");
        });
        negativeListPills.appendChild(pill);
      });
    }

    if (negativeListInput) {
      negativeListInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          const val = negativeListInput.value.trim();
          if (val && !currentNegativeList.includes(val)) {
            currentNegativeList.push(val);
            renderNegativeListPills();
            parent.postMessage({ pluginMessage: { type: "update-negative-list", list: currentNegativeList } }, "*");
          }
          negativeListInput.value = "";
        }
      });
    }

    const selectAllUnboundBtn = document.getElementById("selectAllUnboundBtn");
    if (selectAllUnboundBtn) {
      selectAllUnboundBtn.addEventListener("click", () => {
        if (currentUnboundNodes.length > 0) {
          parent.postMessage({ 
            pluginMessage: { 
              type: "select-multiple-nodes", 
              nodeIds: currentUnboundNodes.map(n => n.id) 
            } 
          }, "*");
        }
      });
    }
    
    const clearNegativeListBtn = document.getElementById("clearNegativeListBtn");
    if (clearNegativeListBtn) {
      clearNegativeListBtn.addEventListener("click", () => {
        if (currentNegativeList.length > 0) {
          currentNegativeList = [];
          renderNegativeListPills();
          parent.postMessage({ pluginMessage: { type: "update-negative-list", list: currentNegativeList } }, "*");
        }
      });
    }

    const ignoreAllUnboundBtn = document.getElementById("ignoreAllUnboundBtn");
    if (ignoreAllUnboundBtn) {
      ignoreAllUnboundBtn.addEventListener("click", () => {
        if (currentUnboundNodes.length > 0) {
          let added = false;
          currentUnboundNodes.forEach(node => {
            if (!currentNegativeList.includes(node.name)) {
              currentNegativeList.push(node.name);
              added = true;
            }
          });
          if (added) {
            renderNegativeListPills();
            parent.postMessage({ pluginMessage: { type: "update-negative-list", list: currentNegativeList } }, "*");
          }
        }
      });
    }

    toggleExpandBtn.addEventListener("click", () => {
      const isExpanded = toggleExpandBtn.dataset.state === "expanded";
      if (isExpanded) {
        toggleExpandBtn.dataset.state = "collapsed";
        toggleExpandBtn.title = "Expand all";
        document.getElementById("icon-collapse").style.display = "none";
        document.getElementById("icon-expand").style.display = "block";
        expandedCards.clear();
      } else {
        toggleExpandBtn.dataset.state = "expanded";
        toggleExpandBtn.title = "Collapse all";
        document.getElementById("icon-collapse").style.display = "block";
        document.getElementById("icon-expand").style.display = "none";
        currentVariables.forEach(v => expandedCards.add(v.variableId));
      }
      
      // Animate by toggling classes instead of re-rendering everything
      document.querySelectorAll(".var-card").forEach(card => {
        const chevron = card.querySelector(".chevron");
        if (isExpanded) {
          card.classList.add("collapsed");
          if (chevron) chevron.title = "Expand variable";
        } else {
          card.classList.remove("collapsed");
          if (chevron) chevron.title = "Collapse variable";
          card.querySelectorAll(".mode-textarea").forEach(ta => autoHeight(ta, ta.value));
        }
      });

      document.querySelectorAll(".collection-header").forEach(header => {
        header.title = isExpanded ? "Expand collection" : "Collapse collection";
        header.querySelector("svg").style.transform = isExpanded ? "rotate(0)" : "rotate(180deg)";
      });
    });

    function updateDropdownOptions() {
      const currentVal = collectionFilter.value;
      collectionFilter.innerHTML = `
        <option value="all">All collections</option>
        <option value="local">Local collections only</option>
        <option value="external">Libraries only</option>
        <option disabled>──────────</option>
      `;
      const uniqueCollections = new Set(currentVariables.map(v => v.collectionName));
      localCollections.forEach(c => {
        if (!disabledCollections.includes(c.id)) uniqueCollections.add(c.name);
      });
      externalCollections.forEach(c => {
        if (!disabledCollections.includes(c.id)) uniqueCollections.add(c.name);
      });
      const uniqueCollectionsArr = [...uniqueCollections];
      
      const targetVal = collectionFilter.dataset.savedValue || currentVal;
      if (collectionFilter.dataset.savedValue) {
        collectionFilter.dataset.savedValue = "";
      }

      if (targetVal !== "all" && targetVal !== "local" && targetVal !== "external" && !uniqueCollectionsArr.includes(targetVal)) {
        uniqueCollectionsArr.push(targetVal);
      }

      const localColsArr = uniqueCollectionsArr.filter(name => name.startsWith("Local /"));
      const externalColsArr = uniqueCollectionsArr.filter(name => !name.startsWith("Local /"));

      localColsArr.sort((a, b) => a.localeCompare(b));
      externalColsArr.sort((a, b) => a.localeCompare(b));

      localColsArr.forEach(val => {
        const opt = document.createElement("option");
        opt.value = val;
        opt.textContent = val;
        if (val === targetVal) opt.selected = true;
        collectionFilter.appendChild(opt);
      });

      if (externalColsArr.length > 0) {
        const sep = document.createElement("option");
        sep.disabled = true;
        sep.textContent = "──────────";
        collectionFilter.appendChild(sep);
        
        externalColsArr.forEach(val => {
          const opt = document.createElement("option");
          opt.value = val;
          opt.textContent = val;
          if (val === targetVal) opt.selected = true;
          collectionFilter.appendChild(opt);
        });
      }
      
      if (collectionFilter.querySelector(`option[value="${targetVal}"]`)) {
        collectionFilter.value = targetVal;
      } else {
        collectionFilter.value = "all";
      }
    }

    // -----------------------------------------------------------------------
    // Render
    // -----------------------------------------------------------------------
            
    function createBindVariableSection(isMultiBind, bindSubtitle, targetNodeIds, singleNodeText, singleNodeName, onBack) {
      const section = document.createElement("div");

        section.className = "unbound-section";
        section.innerHTML = `
          <!-- BIND VARIABLE SECTION -->
          <div id="bindVariableView" style="display: flex; flex-direction: column; flex: 1; width: 100%; text-align: left; align-items: flex-start; min-height: 0; box-sizing: border-box;">
            
            <!-- STICKY HEADER -->
            <div style="position: sticky; top: 0; background: var(--bg-page); z-index: 10; width: 100%; padding: 16px 16px 8px 16px; box-sizing: border-box; border-bottom: 1px solid var(--border);">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; width: 100%;">
                <div style="display: flex; flex-direction: column; gap: 2px;">
                  <div style="display: flex; align-items: center; gap: 8px;">
    ${onBack ? `<button id="inlineBackBtn" class="icon-btn" style="padding: 2px; margin-left: -6px; background: none; border: none; cursor: pointer; color: var(--text-secondary);" title="Back"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" width="16" height="16"><path d="M10 12L6 8L10 4" stroke-linecap="round" stroke-linejoin="round"/></svg></button>` : ""}
    <div style="font-size: 13px; font-weight: 600; color: var(--text-primary);">Bind Variable</div>
  </div>
                  ${bindSubtitle}
                </div>
                ${isMultiBind ? "" : `<a href="#" id="showCreateViewBtn" style="font-size: 11px; color: #18A0FB; text-decoration: none; cursor: pointer;">New Variable</a>`}
              </div>
              <div style="display: flex; gap: 8px; width: 100%;">
                <div class="search-wrap" style="flex: 1; position: relative;">
                  <svg class="search-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" style="position: absolute; left: 8px; top: 50%; transform: translateY(-50%); width: 14px; height: 14px; color: var(--text-muted);">
                    <circle cx="7" cy="7" r="4.5" />
                    <line x1="10.5" y1="10.5" x2="14" y2="14" />
                  </svg>
                  <input type="text" id="linkVarSearch" class="search-input" placeholder="Search variables & values" spellcheck="false" style="width: 100%; padding: 6px 28px 6px 28px; box-sizing: border-box; font-size: 11px;" />
                  <button id="linkVarSearchClear" type="button" title="Clear" style="position: absolute; right: 6px; top: 50%; transform: translateY(-50%); background: none; border: none; cursor: pointer; padding: 2px; display: none; align-items: center; color: var(--text-muted); opacity: 0.6; transition: opacity 150ms;" onmouseover="this.style.opacity='1'" onmouseout="this.style.opacity='0.6'">
                    <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" width="12" height="12"><line x1="2" y1="2" x2="10" y2="10"/><line x1="10" y1="2" x2="2" y2="10"/></svg>
                  </button>
                </div>
                <select id="linkVarCollectionFilter" class="select-dropdown" style="width: 180px; margin-bottom: 0;">
                  <!-- Populated later from externalCollections and localCollections -->
                </select>
              </div>
            </div>

            <!-- SCROLLABLE RESULTS -->
            <div id="linkVarResults" style="display: flex; flex-direction: column; gap: 4px; width: 100%; flex: 1; overflow-y: scroll; padding: 8px 16px 16px 16px; box-sizing: border-box;">
              <div style="padding: 12px; text-align: center; color: var(--text-muted); font-size: 11px;">Search for a variable to bind</div>
            </div>
          </div>

          <!-- NEW VARIABLE SECTION -->
          <div id="createVariableView" style="display: none; flex-direction: column; flex: 1; width: 100%; text-align: left; align-items: flex-start; min-height: 0; padding: 16px; box-sizing: border-box;">
            <div style="display: flex; align-items: center; margin-bottom: 12px; width: 100%; gap: 8px;">
              <button id="backToBindViewBtn" class="icon-btn" style="padding: 2px; margin-left: -6px; background: none; border: none; cursor: pointer; color: var(--text-secondary);" title="Back">
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" width="16" height="16">
                  <path d="M10 12L6 8L10 4" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              </button>
              <div style="font-size: 13px; font-weight: 600; color: var(--text-primary);">New Variable</div>
            </div>
            
            <div style="display: flex; gap: 8px; flex-direction: column; width: 100%;">
              <label style="font-size: 11px; font-weight: 500;">Collection</label>
              <select id="newVarCollection" class="select-dropdown" style="width: 100%; margin-bottom: 4px;">
                ${localCollections.filter(c => !disabledCollections.includes(c.id)).map(c => `<option value="${c.id}" ${c.id === (defaultCreateCollectionId || lastCollectionId) ? "selected" : ""}>${escHtml(c.name)}</option>`).join("")}
              </select>
              
              <label style="font-size: 11px; font-weight: 500;">Variable Name</label>
              <div style="position: relative; width: 100%; margin-bottom: 8px;">
                <input type="text" id="newVarName" class="rename-input" style="width: 100%; margin-right: 0; padding: 6px 28px 6px 8px; font-size: 11.5px; height: 28px; box-sizing: border-box;" placeholder="Copy variable names to automatically paste here">
                <button class="clear-input-btn" type="button" title="Clear" style="position: absolute; right: 6px; top: 50%; transform: translateY(-50%); background: none; border: none; cursor: pointer; padding: 2px; display: flex; align-items: center; color: var(--text-muted); opacity: 0.6; transition: opacity 150ms;" onmouseover="this.style.opacity='1'" onmouseout="this.style.opacity='0.6'">
                  <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" width="12" height="12"><line x1="2" y1="2" x2="10" y2="10"/><line x1="10" y1="2" x2="2" y2="10"/></svg>
                </button>
              </div>

              <div id="newVarModes" style="display: flex; flex-direction: column; gap: 8px; width: 100%; margin-bottom: 8px;"></div>
              
              <button id="createBindBtn" class="btn-primary" style="margin-top: 12px; align-self: flex-start;">Create & Bind Variable</button>
            </div>
          </div>
        `;
        
        mainContent.appendChild(section);

        // --- Link Variable Wiring ---
        const inlineBackBtn = section.querySelector("#inlineBackBtn");
        if (inlineBackBtn && onBack) {
          inlineBackBtn.addEventListener("click", onBack);
        }
        const linkVarSearch = section.querySelector("#linkVarSearch");
        const linkVarCollectionFilter = section.querySelector("#linkVarCollectionFilter");
        const linkVarResults = section.querySelector("#linkVarResults");

        let previewModeSelect = null;
        if (bindVariableGlobalFooter) {
          previewModeSelect = bindVariableGlobalFooter.querySelector("#previewModeSelect");
          if (previewModeSelect) {
            const newSelect = previewModeSelect.cloneNode(true);
            previewModeSelect.parentNode.replaceChild(newSelect, previewModeSelect);
            previewModeSelect = newSelect;
          }
        }

        let linkVarTimeout;
        // Compute the node's text once for use in both pre-fill and search sorting
        const singleUnboundNodeText = singleNodeText;
        const triggerSearch = () => {
          clearTimeout(linkVarTimeout);
          linkVarTimeout = setTimeout(() => {
            const query = linkVarSearch.value.trim();
            const collectionId = linkVarCollectionFilter.value;
            const previewModeName = previewModeSelect ? previewModeSelect.value : selectedPreviewMode;
            // Pass the node's original text so the backend can sort by value match (only when search is empty)
            const nodeText = (!query) ? singleUnboundNodeText : "";
            
            linkVarResults.innerHTML = `<div style="padding: 12px; text-align: center; color: var(--text-muted); font-size: 11px;">Searching...</div>`;
            parent.postMessage({ pluginMessage: { type: "search-link-variables", query, collectionId, previewModeName, nodeText } }, "*");
          }, 300);
        };

        if (linkVarSearch) {
          linkVarSearch.addEventListener("input", () => {
            const clearBtn = section.querySelector("#linkVarSearchClear");
            if (clearBtn) clearBtn.style.display = linkVarSearch.value ? "flex" : "none";
            triggerSearch();
          });
        }

        const linkVarSearchClear = section.querySelector("#linkVarSearchClear");
        if (linkVarSearchClear) {
          linkVarSearchClear.addEventListener("click", () => {
            linkVarSearch.value = "";
            linkVarSearchClear.style.display = "none";
            linkVarSearch.focus();
            triggerSearch();
          });
        }
        if (linkVarCollectionFilter) {
          linkVarCollectionFilter.addEventListener("change", triggerSearch);
        }
        if (previewModeSelect) {
          previewModeSelect.addEventListener("change", () => {
            selectedPreviewMode = previewModeSelect.value;
            triggerSearch();
          });
        }

        const showCreateViewBtn = section.querySelector("#showCreateViewBtn");
        const backToBindViewBtn = section.querySelector("#backToBindViewBtn");
        const bindVariableView = section.querySelector("#bindVariableView");
        const createVariableView = section.querySelector("#createVariableView");
        
        if (showCreateViewBtn && createVariableView && bindVariableView) {
          showCreateViewBtn.addEventListener("click", (e) => {
            e.preventDefault();
            bindVariableView.style.display = "none";
            createVariableView.style.display = "flex";
            if (bindVariableGlobalFooter) bindVariableGlobalFooter.style.display = "none";
          });
        }
        
        if (backToBindViewBtn && createVariableView && bindVariableView) {
          backToBindViewBtn.addEventListener("click", () => {
            createVariableView.style.display = "none";
            bindVariableView.style.display = "flex";
            if (bindVariableGlobalFooter) bindVariableGlobalFooter.style.display = "flex";
          });
        }

        if (linkVarCollectionFilter) {
          // Populate options — restore last-used filter from clientStorage
          const savedFilter = bindCollectionFilter || "all";
          let defaultVal = savedFilter;
          
          let optionsHtml = `
            <option value="all" ${defaultVal === "all" ? "selected" : ""}>All collections</option>
            <option value="local" ${defaultVal === "local" ? "selected" : ""}>Local collections only</option>
            <option value="external" ${defaultVal === "external" ? "selected" : ""}>Libraries only</option>
            <option disabled>──────────</option>
          `;
          
          localCollections.forEach(c => {
            if (disabledCollections.includes(c.id)) return;
            optionsHtml += `<option value="${c.id}" ${defaultVal === c.id ? "selected" : ""}>${escHtml(c.name)}</option>`;
          });
          if (externalCollections.length > 0) {
            let hasEnabledExternal = false;
            let externalHtml = "";
            externalCollections.forEach(c => {
              if (disabledCollections.includes(c.id)) return;
              hasEnabledExternal = true;
              externalHtml += `<option value="${c.id}" ${defaultVal === c.id ? "selected" : ""}>${escHtml(c.name)}</option>`;
            });
            if (hasEnabledExternal) {
              optionsHtml += `<option disabled>──────────</option>` + externalHtml;
            }
          }
          
          linkVarCollectionFilter.innerHTML = optionsHtml;

          // Restore saved value; fall back to "all" if it no longer exists
          linkVarCollectionFilter.value = savedFilter;
          if (linkVarCollectionFilter.value !== savedFilter) {
            linkVarCollectionFilter.value = "all";
          }

          linkVarCollectionFilter.addEventListener("change", () => {
            bindCollectionFilter = linkVarCollectionFilter.value;
            parent.postMessage({ pluginMessage: { type: "save-bind-collection-filter", value: linkVarCollectionFilter.value } }, "*");
            triggerSearch();
          });
        }

        // Pre-fill search with the single unbound node's text for immediate relevant results
        if (singleUnboundNodeText) {
          linkVarSearch.value = singleUnboundNodeText;
          if (linkVarSearchClear) linkVarSearchClear.style.display = "flex";
        }
        triggerSearch();
        // --- End Link Variable Wiring ---

        // Prefill variable name from last selected bound variable
        const newVarNameInput = section.querySelector("#newVarName");
        if (newVarNameInput && lastBoundVariableName) {
          newVarNameInput.value = lastBoundVariableName;
        }
        // Wire clear button for variable name
        const newVarNameClearBtn = section.querySelector(".clear-input-btn");
        if (newVarNameClearBtn) {
          newVarNameClearBtn.addEventListener("click", () => {
            newVarNameInput.value = "";
            newVarNameInput.focus();
          });
        }

        const collectionSelect = section.querySelector("#newVarCollection");
        const modesContainer = section.querySelector("#newVarModes");
        
        const renderModes = () => {
          const collectionId = collectionSelect.value;
          const col = localCollections.find(c => c.id === collectionId);
          modesContainer.innerHTML = "";
          if (col && col.modes) {
            col.modes.forEach(mode => {
              const row = document.createElement("div");
              row.className = "mode-row";
              row.innerHTML = `
                <div class="mode-label" style="font-size: 11px; margin-bottom: 4px; display: flex; justify-content: space-between;">
                  <span>${escHtml(mode.name)}</span>
                  <span style="color: var(--text-muted); font-size: 10px;">(Leave blank to auto-translate)</span>
                </div>
                <div style="position: relative; width: 100%;">
                  <textarea class="mode-textarea create-mode-input" data-mode-id="${mode.modeId}" data-mode-name="${escHtml(mode.name)}" style="min-height: 28px; height: 28px; padding: 5px 28px 5px 8px; margin-bottom: 0; width: 100%; box-sizing: border-box;" placeholder="Text for ${escHtml(mode.name)}"></textarea>
                  <button class="clear-input-btn" type="button" title="Clear" style="position: absolute; right: 6px; top: 8px; background: none; border: none; cursor: pointer; padding: 2px; display: flex; align-items: center; color: var(--text-muted); opacity: 0.6; transition: opacity 150ms;" onmouseover="this.style.opacity='1'" onmouseout="this.style.opacity='0.6'">
                    <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" width="12" height="12"><line x1="2" y1="2" x2="10" y2="10"/><line x1="10" y1="2" x2="2" y2="10"/></svg>
                  </button>
                </div>
              `;
              const ta = row.querySelector("textarea");
              if (ta && singleNodeText) {
                ta.value = singleNodeText;
                ta.style.height = "28px";
                ta.style.height = ta.scrollHeight + "px";
              }
              // Wire clear button for this mode textarea
              const clearBtn = row.querySelector(".clear-input-btn");
              if (clearBtn && ta) {
                clearBtn.addEventListener("click", () => {
                  ta.value = "";
                  ta.style.height = "28px";
                  ta.focus();
                });
              }
              modesContainer.appendChild(row);
            });
            modesContainer.querySelectorAll("textarea").forEach(ta => {
              ta.addEventListener("input", () => {
                ta.style.height = "28px";
                ta.style.height = ta.scrollHeight + "px";
              });
            });
          }
        };

        collectionSelect.addEventListener("change", renderModes);
        renderModes();

        const createBindBtn = section.querySelector("#createBindBtn");
        createBindBtn.onclick = async () => {
          let name = section.querySelector("#newVarName").value.trim();
          if (!name) name = singleNodeName;
          
          const collectionId = collectionSelect.value;
          
          createBindBtn.textContent = "Processing...";
          createBindBtn.disabled = true;

          const inputs = Array.from(modesContainer.querySelectorAll(".create-mode-input"));
          const filledInput = inputs.find(i => i.value.trim() !== "");
          
          const modeValues = {};
          
          if (!filledInput) {
            // All blank, use raw text
            inputs.forEach(i => {
              modeValues[i.dataset.modeId] = singleNodeText;
            });
          } else {
            const sourceText = filledInput.value.trim();
            for (const input of inputs) {
              if (input.value.trim() !== "") {
                modeValues[input.dataset.modeId] = input.value.trim();
              } else {
                try {
                  const targetLang = input.dataset.modeName.toLowerCase().trim();
                  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${encodeURIComponent(targetLang)}&dt=t&q=${encodeURIComponent(sourceText)}`;
                  const res = await fetch(url);
                  const json = await res.json();
                  if (json && json[0] && json[0][0] && json[0][0][0]) {
                    modeValues[input.dataset.modeId] = json[0][0][0];
                  } else {
                    modeValues[input.dataset.modeId] = sourceText;
                  }
                } catch (e) {
                  console.error("Translation failed", e);
                  modeValues[input.dataset.modeId] = sourceText;
                }
              }
            }
          }

          createBindBtn.textContent = "Creating...";

          parent.postMessage({
            pluginMessage: {
              type: "create-bind-variable",
              nodeIds: targetNodeIds,
              collectionId: collectionId,
              variableName: name,
              modeValues: modeValues
            }
          }, "*");
        };
      return section;
    }

    function renderContent() {
      mainContent.innerHTML = "";

      const filterVal = collectionFilter.value;
      const searchQuery = searchInput.value.toLowerCase().trim();

      const topHeader = document.querySelector(".top-header");
      const unboundFooter = document.getElementById("unboundFooter");
      const globalFooter = document.getElementById("globalFooter");
      const bindVariableGlobalFooter = document.getElementById("bindVariableGlobalFooter");
      
      if (topHeader) topHeader.style.display = "flex";
      if (unboundFooter) unboundFooter.style.display = "flex";
      if (globalFooter) globalFooter.style.display = "flex";
      if (bindVariableGlobalFooter) bindVariableGlobalFooter.style.display = "none";

      if ((unboundNode || allUnbound) && localCollections.length > 0) {
        if (topHeader) topHeader.style.display = "none";
        if (unboundFooter) unboundFooter.style.display = "none";
        if (globalFooter) globalFooter.style.display = "none";
        if (bindVariableGlobalFooter) {
          bindVariableGlobalFooter.style.display = "flex";
          const previewModeSelect = bindVariableGlobalFooter.querySelector("#previewModeSelect");
          if (previewModeSelect) {
            previewModeSelect.innerHTML = `<option value="">Default (First Mode)</option>` + availableModes.map(m => `<option value="${escHtml(m)}" ${m === selectedPreviewMode ? "selected" : ""}>${escHtml(m)}</option>`).join("");
          }
        }

        const isMultiBind = allUnbound && !unboundNode;
        const bindSubtitle = isMultiBind ? `<span style="font-size: 11px; color: var(--text-secondary); margin-top: 2px;">${allUnboundNodeIds.length} labels selected</span>` : "";

        const targetNodeIds = isMultiBind ? allUnboundNodeIds : (unboundNode ? [unboundNode.id] : []);
        const singleNodeText = unboundNode ? (unboundNode.text || "") : (allUnbound && currentUnboundNodes.length === 1 ? (currentUnboundNodes[0].text || "") : "");
        const singleNodeName = unboundNode ? unboundNode.name : "";
        
        const section = createBindVariableSection(isMultiBind, bindSubtitle, targetNodeIds, singleNodeText, singleNodeName, null);
        mainContent.appendChild(section);
      }

      let filteredVariables = currentVariables.filter(v => {
        if (filterVal === "local" && v.isRemote) return false;
        if (filterVal === "external" && !v.isRemote) return false;
        if (filterVal !== "all" && filterVal !== "local" && filterVal !== "external" && v.collectionName !== filterVal) return false;
        
        if (searchQuery) {
          if (!v.variableName.toLowerCase().includes(searchQuery)) {
            return false;
          }
        }
        
        return true;
      });

      if (filteredVariables.length === 0) {
        if (!unboundNode && !allUnbound) {
          renderEmptyState();
        }
        return;
      }

      // Group by collection name
      const collections = new Map();
      for (const v of filteredVariables) {
        if (!collections.has(v.collectionName)) {
          collections.set(v.collectionName, []);
        }
        collections.get(v.collectionName).push(v);
      }

      const sortedCollectionNames = [...collections.keys()].sort((a, b) => a.localeCompare(b));

      // Render sections
      for (const colName of sortedCollectionNames) {
        const vars = collections.get(colName);
        const section = document.createElement("div");

        // A collection is considered collapsed if ALL its variables are collapsed
        let allCollapsed = true;
        for (const v of vars) {
          if (expandedCards.has(v.variableId)) {
            allCollapsed = false;
            break;
          }
        }
        let isCollapsed = allCollapsed;

        const header = document.createElement("div");
        header.className = "collection-header";
        header.style.cursor = "pointer";
        header.title = isCollapsed ? "Expand collection" : "Collapse collection";
        header.innerHTML = `
          <span>${escHtml(colName)}</span>
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" width="16" height="16" style="transition: transform 0.2s; transform: ${isCollapsed ? 'rotate(0)' : 'rotate(180deg)'};">
            <polyline points="3 6 8 11 13 6" />
          </svg>
        `;
        section.appendChild(header);

        const list = document.createElement("div");
        list.className = "variable-list";
        for (const v of vars) {
          list.appendChild(buildCard(v));
        }
        section.appendChild(list);

        header.addEventListener("click", () => {
          if (isCollapsed) {
            // Expand all
            header.title = "Collapse collection";
            header.querySelector("svg").style.transform = "rotate(180deg)";
            for (const v of vars) {
              expandedCards.add(v.variableId);
            }
            const cards = list.querySelectorAll(".var-card");
            cards.forEach(card => {
              card.classList.remove("collapsed");
              const chevron = card.querySelector(".chevron");
              if (chevron) chevron.title = "Collapse variable";
              card.querySelectorAll(".mode-textarea").forEach(ta => autoHeight(ta, ta.value));
            });
            isCollapsed = false;
          } else {
            // Collapse all
            header.title = "Expand collection";
            header.querySelector("svg").style.transform = "rotate(0)";
            for (const v of vars) {
              expandedCards.delete(v.variableId);
            }
            const cards = list.querySelectorAll(".var-card");
            cards.forEach(card => {
              card.classList.add("collapsed");
              const chevron = card.querySelector(".chevron");
              if (chevron) chevron.title = "Expand variable";
            });
            isCollapsed = true;
          }
        });

        mainContent.appendChild(section);
      }

      if (hasMoreFromPlugin) {
        const loadMoreBtn = document.createElement("button");
        loadMoreBtn.className = "load-more-btn";
        loadMoreBtn.textContent = isLoadingMore ? "Loading..." : "Load more variables...";
        loadMoreBtn.disabled = isLoadingMore;
        loadMoreBtn.addEventListener("click", () => {
          if (isLoadingMore) return;
          isLoadingMore = true;
          loadMoreBtn.textContent = "Loading...";
          loadMoreBtn.disabled = true;
          parent.postMessage({ pluginMessage: { type: "load-more" } }, "*");
        });
        mainContent.appendChild(loadMoreBtn);
      }

      // Now that elements are in the DOM, we can accurately measure scrollHeight for word-wrapped text
      const allTextareas = mainContent.querySelectorAll(".mode-textarea");
      allTextareas.forEach(ta => autoHeight(ta, ta.value));
    }

    function renderEmptyState() {
      mainContent.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="3"/>
              <path d="M9 12h6M9 8h6M9 16h3"/>
            </svg>
          </div>
          <div class="empty-title">Select a text layer bound to string variables</div>
        </div>
      `;
    }

    function buildCard(variable) {
      const card = document.createElement("div");
      const isExpanded = expandedCards.has(variable.variableId);
      card.className = "var-card" + (isExpanded ? "" : " collapsed"); // Maintain expanded state across renders
      card.dataset.varId = variable.variableId;

      // Check if this variable is dirty
      const isDirty = [...dirtyValues.keys()].some(k => k.startsWith(`${variable.variableId}::`));
      const dotOpacity = isDirty ? "1" : "0";

      // Header
      const header = document.createElement("div");
      header.className = "var-header";
      header.innerHTML = `
        <div class="var-icon">T</div>
        <div class="var-name-wrap">
          <div class="var-name" title="${escHtml(variable.variableName)}">${escHtml(variable.variableName)}</div>
          <div class="dirty-dot" id="dot-${escHtml(variable.variableId)}" style="opacity: ${dotOpacity}"></div>
        </div>
        <div class="var-header-right">
          <button class="icon-btn unbind-var-btn" title="Unbind variable">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="14" height="14">
              <path d="M6.5 9.5L4 12a2.121 2.121 0 01-3-3l2.5-2.5"/>
              <path d="M9.5 6.5L12 4a2.121 2.121 0 013 3l-2.5 2.5"/>
              <line x1="2" y1="2" x2="14" y2="14"/>
            </svg>
          </button>
          <button class="icon-btn copy-var-btn" title="Copy variable name">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="14" height="14">
              <rect x="5" y="5" width="8" height="8" rx="1.5"/>
              <path d="M4 11H3.5a1.5 1.5 0 01-1.5-1.5V3.5A1.5 1.5 0 013.5 2h6A1.5 1.5 0 0111 3.5V4"/>
            </svg>
          </button>
          ${!variable.isRemote ? `
          <button class="icon-btn edit-var-btn" title="Rename variable">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="14" height="14">
              <path d="M11 3.5l1.5 1.5-7.5 7.5-2.5 1 1-2.5 7.5-7.5z"/>
            </svg>
          </button>
          ` : ""}
          <span class="chevron" title="${isExpanded ? 'Collapse variable' : 'Expand variable'}">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="4 6 8 10 12 6"/>
            </svg>
          </span>
        </div>
      `;

      // Body
      const bodyWrapper = document.createElement("div");
      bodyWrapper.className = "var-body-wrapper";

      const body = document.createElement("div");
      body.className = "var-body";

      const bodyInner = document.createElement("div");
      bodyInner.className = "var-body-inner";

      // One row per mode
      for (const mode of variable.modes) {
        const row = document.createElement("div");
        row.className = "mode-row";

        const label = document.createElement("div");
        label.className = "mode-label";
        label.textContent = mode.modeName;

        const ta = document.createElement("textarea");
        ta.className = "mode-textarea";
        ta.rows = 1;
        
        const key = `${variable.variableId}::${mode.modeId}`;
        const hasDirty = dirtyValues.has(key);
        
        ta.value = hasDirty ? dirtyValues.get(key) : mode.value;
        if (hasDirty) ta.classList.add("changed");
        
        ta.dataset.varId = variable.variableId;
        ta.dataset.modeId = mode.modeId;
        ta.setAttribute("spellcheck", "false");
        ta.placeholder = "Missing value...";

        if (ta.value.trim() === "") {
          ta.classList.add("empty");
        }

        if (variable.isRemote) {
          ta.readOnly = true;
          ta.title = "This variable is from a published library and cannot be edited locally.";
        } else {
          ta.addEventListener("input", () => {
            onTextareaChange(ta, variable.variableId, mode.modeId, mode.value);
            autoHeight(ta, ta.value);
          });
        }

        row.appendChild(label);
        row.appendChild(ta);
        bodyInner.appendChild(row);
      }

      let deleteRow = null;
      if (!variable.isRemote) {
        deleteRow = document.createElement("div");
        deleteRow.style = "margin-top: 8px; display: none; align-items: center; gap: 8px;";
        
        const deleteLink = document.createElement("span");
        deleteLink.className = "delete-link";
        deleteLink.textContent = "Delete Variable";
        deleteLink.style = "color: var(--danger); font-size: 11px; cursor: pointer; display: inline-block; transition: opacity 150ms;";

        const confirmWrap = document.createElement("span");
        confirmWrap.className = "confirm-wrap";
        confirmWrap.style = "display: none; align-items: center; gap: 4px; font-size: 11px;";

        const cancelBtn = document.createElement("span");
        cancelBtn.textContent = "Cancel";
        cancelBtn.style = "color: var(--text-secondary); cursor: pointer;";
        cancelBtn.style.transition = "color 150ms";

        const sep = document.createElement("span");
        sep.textContent = "|";
        sep.style = "color: var(--text-muted);";

        const confirmBtn = document.createElement("span");
        confirmBtn.textContent = "Delete";
        confirmBtn.style = "color: var(--danger); cursor: pointer; font-weight: 600;";
        confirmBtn.style.transition = "color 150ms";

        confirmWrap.appendChild(cancelBtn);
        confirmWrap.appendChild(sep);
        confirmWrap.appendChild(confirmBtn);

        const enterConfirmMode = () => {
          deleteLink.style.opacity = "0.35";
          deleteLink.style.pointerEvents = "none";
          confirmWrap.style.display = "inline-flex";
        };
        const exitConfirmMode = () => {
          deleteLink.style.opacity = "1";
          deleteLink.style.pointerEvents = "auto";
          confirmWrap.style.display = "none";
        };

        deleteLink.addEventListener("mousedown", (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          enterConfirmMode();
        });

        cancelBtn.addEventListener("mousedown", (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          exitConfirmMode();
        });

        confirmBtn.addEventListener("mousedown", (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          showToast("Deleting...");
          parent.postMessage({ pluginMessage: { type: "delete-variable", variableId: variable.variableId } }, "*");
        });

        deleteRow.appendChild(deleteLink);
        deleteRow.appendChild(confirmWrap);
        bodyInner.appendChild(deleteRow);
      }

      body.appendChild(bodyInner);
      bodyWrapper.appendChild(body);
      
      card.appendChild(header);
      card.appendChild(bodyWrapper);

      // Interactions
      const unbindBtn = card.querySelector(".unbind-var-btn");
      if (unbindBtn) {
        unbindBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          parent.postMessage({ pluginMessage: { type: "unbind-variable", variableId: variable.variableId } }, "*");
        });
      }

      const copyBtn = card.querySelector(".copy-var-btn");
      if (copyBtn) {
        copyBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          lastBoundVariableName = variable.variableName;
          const textArea = document.createElement("textarea");
          textArea.value = variable.variableName;
          document.body.appendChild(textArea);
          textArea.select();
          document.execCommand("copy");
          document.body.removeChild(textArea);
          showToast('Copied "' + variable.variableName + '"');
        });
      }

      if (!variable.isRemote) {
        const editBtn = header.querySelector(".edit-var-btn");
        if (editBtn) {
          editBtn.onclick = (e) => {
            e.stopPropagation(); // prevent card collapse
            
            const nameWrap = header.querySelector(".var-name-wrap");
            const nameDiv = nameWrap.querySelector(".var-name");
            const dirtyDot = nameWrap.querySelector(".dirty-dot");
            
            nameDiv.style.display = "none";
            if (dirtyDot) dirtyDot.style.display = "none";
            editBtn.style.display = "none";
            if (deleteRow) deleteRow.style.display = "flex";
            
            const input = document.createElement("input");
            input.type = "text";
            input.value = variable.variableName;
            input.className = "rename-input";
            
            const submitRename = () => {
              const newName = input.value.trim();
              if (newName && newName !== variable.variableName) {
                parent.postMessage({
                  pluginMessage: {
                    type: "rename-variable",
                    variableId: variable.variableId,
                    newName: newName
                  }
                }, "*");
              } else {
                input.remove();
                nameDiv.style.display = "";
                if (dirtyDot) dirtyDot.style.display = "";
                editBtn.style.display = "";
                if (deleteRow) {
                  deleteRow.style.display = "none";
                  const cWrap = deleteRow.querySelector(".confirm-wrap");
                  const dLink = deleteRow.querySelector(".delete-link");
                  if (cWrap && dLink) {
                    dLink.style.opacity = "1";
                    dLink.style.pointerEvents = "auto";
                    cWrap.style.display = "none";
                  }
                }
              }
            };

            input.onblur = submitRename;
            input.onkeydown = (ev) => {
              ev.stopPropagation(); // prevent other hotkeys
              if (ev.key === "Enter") {
                input.blur();
              } else if (ev.key === "Escape") {
                input.value = variable.variableName; // Revert
                input.blur();
              }
            };
            
            nameWrap.insertBefore(input, nameDiv);
            input.focus();
            input.select();
          };
        }
      }
      const chevron = header.querySelector(".chevron");
      if (chevron) {
        chevron.addEventListener("click", (e) => {
          e.stopPropagation();
          const isCollapsed = card.classList.toggle("collapsed");
          if (!isCollapsed) {
            expandedCards.add(variable.variableId);
            chevron.title = "Collapse variable";
            // Trigger height recalculation when expanded
            card.querySelectorAll(".mode-textarea").forEach(ta => autoHeight(ta, ta.value));
          } else {
            expandedCards.delete(variable.variableId);
            chevron.title = "Expand variable";
          }
        });
      }

      return card;
    }

    // -----------------------------------------------------------------------
    // Interaction logic
    // -----------------------------------------------------------------------
    function autoHeight(ta, text) {
      ta.style.height = "1px";
      const lines = (text.match(/\n/g) || []).length + 1;
      const minH = lines <= 1 ? 36 : Math.min(lines * 18 + 18, 160);
      ta.style.height = `${Math.max(minH, ta.scrollHeight + 2)}px`;
    }

    function onTextareaChange(textarea, variableId, modeId, originalValue) {
      const key = `${variableId}::${modeId}`;
      if (textarea.value !== originalValue) {
        dirtyValues.set(key, textarea.value);
        textarea.classList.add("changed");
      } else {
        dirtyValues.delete(key);
        textarea.classList.remove("changed");
      }

      if (textarea.value.trim() === "") {
        textarea.classList.add("empty");
      } else {
        textarea.classList.remove("empty");
      }
      
      updateCardDirtyState(variableId);
      updateFooterState();

      if (autoApplyToggle.checked) {
        clearTimeout(autoApplyTimeout);
        autoApplyTimeout = setTimeout(() => {
          triggerAutoApply();
        }, 400);
      }
    }

    let autoApplyTimeout = null;

    function triggerAutoApply() {
      if (dirtyValues.size === 0) return;
      const updates = [];
      for (const [key, value] of dirtyValues.entries()) {
        const [variableId, modeId] = key.split("::");
        updates.push({ variableId, modeId, value });
        
        // Update local memory so we don't revert if auto-apply is on
        const variable = currentVariables.find(v => v.variableId === variableId);
        if (variable) {
          const mode = variable.modes.find(m => m.modeId === modeId);
          if (mode) mode.value = value;
        }
      }
      
      dirtyValues.clear();
      document.querySelectorAll(".dirty-dot").forEach(el => el.style.opacity = "0");
      document.querySelectorAll(".mode-textarea.changed").forEach(el => el.classList.remove("changed"));
      updateFooterState();
      
      parent.postMessage({ pluginMessage: { type: "apply-multiple", updates, skipScan: true } }, "*");
    }

    function updateCardDirtyState(variableId) {
      const isDirty = [...dirtyValues.keys()].some(k => k.startsWith(`${variableId}::`));
      const dot = document.getElementById(`dot-${variableId}`);
      if (dot) {
        dot.style.opacity = isDirty ? "1" : "0";
      }
    }

    function updateFooterState() {
      const hasChanges = dirtyValues.size > 0;
      applyBtn.disabled = !hasChanges;
      undoBtn.disabled = !hasChanges;
    }

    // -----------------------------------------------------------------------
    // Footer actions
    // -----------------------------------------------------------------------
    autoApplyToggle.addEventListener("change", () => {
      const footer = document.querySelector(".footer");
      if (autoApplyToggle.checked) {
        footer.classList.add("auto-apply-on");
        triggerAutoApply(); // immediately apply pending
      } else {
        footer.classList.remove("auto-apply-on");
      }
      parent.postMessage({ pluginMessage: { type: "update-auto-apply", value: autoApplyToggle.checked } }, "*");
    });

    applyBtn.addEventListener("click", () => {
      if (dirtyValues.size === 0) return;

      const updates = [];
      for (const [key, value] of dirtyValues.entries()) {
        const [variableId, modeId] = key.split("::");
        updates.push({ variableId, modeId, value });
      }

      // Optimistically clean UI
      dirtyValues.clear();
      document.querySelectorAll(".dirty-dot").forEach(el => el.style.opacity = "0");
      document.querySelectorAll(".mode-textarea.changed").forEach(el => el.classList.remove("changed"));
      updateFooterState();

      parent.postMessage({ pluginMessage: { type: "apply-multiple", updates } }, "*");
      showToast("Changes applied successfully.");
    });

    undoBtn.addEventListener("click", () => {
      document.querySelectorAll(".mode-textarea").forEach(el => {
        const varId = el.dataset.varId;
        const modeId = el.dataset.modeId;
        const variable = currentVariables.find(v => v.variableId === varId);
        if (variable) {
          const mode = variable.modes.find(m => m.modeId === modeId);
          if (mode) {
            el.value = mode.value;
            el.classList.remove("changed");
            autoHeight(el, el.value);
          }
        }
      });
      dirtyValues.clear();
      document.querySelectorAll(".dirty-dot").forEach(el => el.style.opacity = "0");
      updateFooterState();
    });

    refreshBtn.addEventListener("click", () => {
      refreshIcon.classList.add("spinning");
      refreshBtn.disabled = true;
      parent.postMessage({ pluginMessage: { type: "refresh" } }, "*");
    });

    function stopRefreshSpin() {
      refreshIcon.classList.remove("spinning");
      refreshBtn.disabled = false;
    }

    // -----------------------------------------------------------------------
    // Utilities
    // -----------------------------------------------------------------------
    let toastTimer = 0;
    function showToast(message, isError = false) {
      toastMsg.textContent = message;
      toast.classList.toggle("error", isError);
      toast.classList.add("visible");
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => toast.classList.remove("visible"), 2800);
    }

    function escHtml(str) {
      return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    }

    // -----------------------------------------------------------------------
    // Resize Handle Logic
    // -----------------------------------------------------------------------
    const resizeHandle = document.getElementById("resizeHandle");
    let isResizing = false;
    let offsetX = 0;
    let offsetY = 0;

    resizeHandle.addEventListener("pointerdown", (e) => {
      isResizing = true;
      offsetX = window.innerWidth - e.clientX;
      offsetY = window.innerHeight - e.clientY;
      document.body.style.userSelect = "none";
      try { resizeHandle.setPointerCapture(e.pointerId); } catch (err) {}
    });

    window.addEventListener("pointermove", (e) => {
      if (!isResizing) return;
      
      let newW = Math.round(e.clientX + offsetX);
      let newH = Math.round(e.clientY + offsetY);
      
      if (newW < 400) newW = 400;
      if (newH < 300) newH = 300;

      parent.postMessage({ pluginMessage: { type: "resize", width: newW, height: newH } }, "*");
    });

    const stopResize = (e) => {
      if (!isResizing) return;
      isResizing = false;
      document.body.style.userSelect = "";
      try { resizeHandle.releasePointerCapture(e.pointerId); } catch (err) {}
      
      parent.postMessage({ pluginMessage: { type: "save-resize", width: window.innerWidth, height: window.innerHeight } }, "*");
    };

    window.addEventListener("pointerup", stopResize);
    window.addEventListener("pointercancel", stopResize);

    // Enforce minimum window dimensions on native resize
    window.addEventListener("resize", () => {
      if (isResizing) return; // Ignore if we are driving the resize
      let w = window.innerWidth;
      let h = window.innerHeight;
      let changed = false;
      if (w < 400) { w = 400; changed = true; }
      if (h < 300) { h = 300; changed = true; }
      if (changed) {
        parent.postMessage({ pluginMessage: { type: "resize", width: w, height: h } }, "*");
      }
    });
  