"use strict";
/**
 * Localize Sidekick – Figma Plugin (V1)
 *
 * Plugin controller that runs in the Figma sandbox.
 * Responsibilities:
 *  - Open the UI panel.
 *  - Scan the current selection for TEXT nodes with bound string variables.
 *  - Send variable data (id, name, collection name, modes, values) to the UI.
 *  - Listen for apply/close/refresh messages from the UI.
 *  - Write updated variable values back to Figma.
 */
// ---------------------------------------------------------------------------
// Plugin entry point
// ---------------------------------------------------------------------------
let lastCollectionId;
let activeTab = "bound";
let scanAllUnbound = false;
let collectionFilterVal;
let autoApplyVal;
async function initPlugin() {
    const size = await figma.clientStorage.getAsync("pluginSize");
    const width = (size === null || size === void 0 ? void 0 : size.width) || 560;
    const height = (size === null || size === void 0 ? void 0 : size.height) || 720;
    const savedActiveTab = await figma.clientStorage.getAsync("activeTab");
    const savedNegativeList = await figma.clientStorage.getAsync("negativeList");
    const savedCollectionFilter = await figma.clientStorage.getAsync("collectionFilter");
    const savedAutoApply = await figma.clientStorage.getAsync("autoApply");
    if (savedActiveTab === "bound" || savedActiveTab === "unbound") {
        activeTab = savedActiveTab;
    }
    if (Array.isArray(savedNegativeList)) {
        negativeList = savedNegativeList;
    }
    if (savedCollectionFilter) {
        collectionFilterVal = savedCollectionFilter;
    }
    if (typeof savedAutoApply === "boolean") {
        autoApplyVal = savedAutoApply;
    }
    figma.showUI(__html__, {
        width,
        height,
        themeColors: true,
        title: "Localize Sidekick",
    });
    // Scan on open
    await scanSelection();
    let currentSelectionIds = "";
    // Re-scan whenever selection changes
    figma.on("selectionchange", () => {
        const selection = figma.currentPage.selection;
        const ids = selection.map(n => n.id).join(",");
        if (ids === currentSelectionIds)
            return;
        currentSelectionIds = ids;
        scanSelection();
    });
}
initPlugin();
// Handle messages from the UI
figma.ui.onmessage = async (rawMsg) => {
    const msg = rawMsg;
    if (msg.type === "close") {
        figma.closePlugin();
        return;
    }
    if (msg.type === "resize") {
        figma.ui.resize(msg.width, msg.height);
        return;
    }
    if (msg.type === "save-resize") {
        await figma.clientStorage.setAsync("pluginSize", { width: msg.width, height: msg.height });
        return;
    }
    if (msg.type === "load-more") {
        await fetchAndSendNextBatch(false);
        return;
    }
    if (msg.type === "switch-tab") {
        activeTab = msg.tabId;
        await figma.clientStorage.setAsync("activeTab", activeTab);
        return;
    }
    if (msg.type === "load-more-unbound") {
        scanAllUnbound = true;
        await scanSelection();
        return;
    }
    if (msg.type === "select-node") {
        const node = await figma.getNodeByIdAsync(msg.nodeId);
        if (node && node.type === "TEXT") {
            figma.currentPage.selection = [node];
            figma.viewport.scrollAndZoomIntoView([node]);
        }
        return;
    }
    if (msg.type === "select-multiple-nodes") {
        const nodes = await Promise.all(msg.nodeIds.map(id => figma.getNodeByIdAsync(id)));
        const textNodes = nodes.filter(n => n && n.type === "TEXT");
        if (textNodes.length > 0) {
            figma.currentPage.selection = textNodes;
            figma.viewport.scrollAndZoomIntoView(textNodes);
        }
        return;
    }
    if (msg.type === "refresh") {
        await scanSelection();
        return;
    }
    if (msg.type === "update-negative-list") {
        negativeList = msg.list;
        await figma.clientStorage.setAsync("negativeList", negativeList);
        await scanSelection();
        return;
    }
    if (msg.type === "update-collection-filter") {
        collectionFilterVal = msg.filter;
        await figma.clientStorage.setAsync("collectionFilter", collectionFilterVal);
        return;
    }
    if (msg.type === "update-auto-apply") {
        autoApplyVal = msg.value;
        await figma.clientStorage.setAsync("autoApply", autoApplyVal);
        return;
    }
    if (msg.type === "apply-multiple") {
        let hasChanges = false;
        for (const update of msg.updates) {
            try {
                const variable = await figma.variables.getVariableByIdAsync(update.variableId);
                if (variable && variable.resolvedType === "STRING") {
                    variable.setValueForMode(update.modeId, update.value);
                    hasChanges = true;
                }
            }
            catch (err) {
                console.error("Error applying variable", update.variableId, err);
            }
        }
        if (hasChanges && !msg.skipScan) {
            await scanSelection();
        }
        return;
    }
    if (msg.type === "rename-variable") {
        try {
            const variable = await figma.variables.getVariableByIdAsync(msg.variableId);
            if (variable && variable.resolvedType === "STRING") {
                variable.name = msg.newName;
                await scanSelection();
            }
        }
        catch (err) {
            console.error("Error renaming variable", msg.variableId, err);
            let errMsg = String(err);
            if (errMsg.includes("already exists"))
                errMsg = "Name already exists";
            sendToUI({ type: "rename-error", variableId: msg.variableId, message: errMsg });
        }
        return;
    }
    if (msg.type === "delete-variable") {
        try {
            const variable = await figma.variables.getVariableByIdAsync(msg.variableId);
            if (variable && variable.resolvedType === "STRING") {
                // Detach selected text nodes bound to this variable
                const selectedTextNodes = [];
                for (const node of figma.currentPage.selection) {
                    collectTextNodes(node, selectedTextNodes);
                }
                for (const textNode of selectedTextNodes) {
                    if (getTextBoundVariableId(textNode) === msg.variableId) {
                        await figma.loadFontAsync(textNode.fontName);
                        textNode.setBoundVariable("characters", null);
                    }
                }
                variable.remove();
                sendToUI({ type: "status", message: "Variable deleted and detached" });
                await scanSelection();
            }
            else {
                sendToUI({ type: "status", message: "Variable not found" });
            }
        }
        catch (err) {
            console.error("Error deleting variable", msg.variableId, err);
            sendToUI({ type: "status", message: "Failed to delete variable: " + err });
        }
        return;
    }
    if (msg.type === "create-bind-variable") {
        try {
            lastCollectionId = msg.collectionId;
            await figma.clientStorage.setAsync("lastCollectionId", msg.collectionId);
            const node = await figma.getNodeByIdAsync(msg.nodeId);
            if (node && node.type === "TEXT") {
                await figma.loadFontAsync(node.fontName);
                const collection = await figma.variables.getVariableCollectionByIdAsync(msg.collectionId);
                if (!collection) {
                    throw new Error("Collection not found");
                }
                const variable = figma.variables.createVariable(msg.variableName, collection, "STRING");
                for (const mode of collection.modes) {
                    const val = msg.modeValues[mode.modeId] || "";
                    variable.setValueForMode(mode.modeId, val);
                }
                node.setBoundVariable("characters", variable);
                await scanSelection();
            }
        }
        catch (err) {
            console.error("Error creating variable", err);
            let errMsg = String(err);
            if (errMsg.includes("already exists"))
                errMsg = "Name already exists";
            sendToUI({ type: "create-error", message: errMsg });
        }
        return;
    }
};
// ---------------------------------------------------------------------------
// Core: scan the current Figma selection
// ---------------------------------------------------------------------------
let activeVariableIds = [];
let loadedVariableCount = 0;
const BATCH_SIZE = 20;
const collectionCache = new Map();
const getCachedCollection = (collectionId) => {
    if (!collectionCache.has(collectionId)) {
        const promise = figma.variables.getVariableCollectionByIdAsync(collectionId);
        collectionCache.set(collectionId, promise);
    }
    return collectionCache.get(collectionId);
};
let activeUnboundNode;
let activeLocalCollections;
let activeUnboundNodesList = [];
let hasMoreUnboundNodes = false;
let negativeList = [];
function isNodeIgnored(node) {
    if (negativeList.length === 0)
        return false;
    let curr = node;
    while (curr && curr.type !== "DOCUMENT" && curr.type !== "PAGE") {
        if (negativeList.includes(curr.name))
            return true;
        curr = curr.parent;
    }
    return false;
}
let chunkStartTime = Date.now();
async function yieldIfNeeded() {
    if (Date.now() - chunkStartTime > 12) {
        await new Promise(resolve => setTimeout(resolve, 10));
        chunkStartTime = Date.now();
    }
}
async function scanSelection() {
    const selection = figma.currentPage.selection;
    if (selection.length === 0) {
        activeVariableIds = [];
        sendToUI({ type: "scan-result", variables: [], hasMore: false, negativeList, unboundNodes: [], isSelectionEmpty: true, collectionFilter: collectionFilterVal, autoApply: autoApplyVal });
        return;
    }
    sendToUI({ type: "loading-start" });
    await new Promise(resolve => setTimeout(resolve, 30));
    const textNodes = [];
    for (const node of selection) {
        await collectTextNodes(node, textNodes);
    }
    if (textNodes.length === 0) {
        activeVariableIds = [];
        sendToUI({ type: "scan-result", variables: [], hasMore: false, negativeList, unboundNodes: [], isSelectionEmpty: false, collectionFilter: collectionFilterVal, autoApply: autoApplyVal });
        return;
    }
    const variableIds = new Set();
    const allUnboundNodes = [];
    for (let i = 0; i < textNodes.length; i++) {
        if (i % 20 === 0)
            await yieldIfNeeded();
        const textNode = textNodes[i];
        const boundId = getTextBoundVariableId(textNode) || getTextBoundVariableIdFromComponentProperty(textNode);
        if (boundId) {
            variableIds.add(boundId);
        }
        else {
            allUnboundNodes.push({
                id: textNode.id,
                name: textNode.name,
                text: textNode.characters
            });
        }
    }
    activeUnboundNode = undefined;
    activeLocalCollections = undefined;
    if (textNodes.length === 1 && variableIds.size === 0) {
        activeUnboundNode = allUnboundNodes[0];
        const collections = await figma.variables.getLocalVariableCollectionsAsync();
        activeLocalCollections = collections.map(c => ({
            id: c.id,
            name: c.name,
            modes: c.modes.map(m => ({ modeId: m.modeId, name: m.name }))
        }));
    }
    if (!scanAllUnbound && allUnboundNodes.length > 100) {
        activeUnboundNodesList = allUnboundNodes.slice(0, 100);
        hasMoreUnboundNodes = true;
    }
    else {
        activeUnboundNodesList = allUnboundNodes;
        hasMoreUnboundNodes = false;
    }
    activeVariableIds = Array.from(variableIds);
    loadedVariableCount = 0;
    await fetchAndSendNextBatch(true);
}
async function fetchAndSendNextBatch(isInitial) {
    const idsToFetch = activeVariableIds.slice(loadedVariableCount, loadedVariableCount + BATCH_SIZE);
    if (idsToFetch.length === 0) {
        if (isInitial) {
            sendToUI({
                type: "scan-result",
                variables: [],
                hasMore: false,
                unboundNode: activeUnboundNode,
                localCollections: activeLocalCollections,
                lastCollectionId: lastCollectionId,
                unboundNodes: activeUnboundNodesList,
                hasMoreUnbound: hasMoreUnboundNodes,
                activeTab: activeTab,
                negativeList: negativeList
            });
        }
        return;
    }
    // Fetch only this batch
    const fetchPromises = idsToFetch.map(async (id) => {
        try {
            const variable = await figma.variables.getVariableByIdAsync(id);
            if (!variable || variable.resolvedType !== "STRING")
                return null;
            const collection = await getCachedCollection(variable.variableCollectionId);
            if (!collection)
                return null;
            const isRemote = variable.remote;
            const modes = collection.modes.map((mode) => {
                const raw = variable.valuesByMode[mode.modeId];
                let value = "";
                if (typeof raw === "string") {
                    value = raw;
                }
                else if (raw && typeof raw === "object" && "type" in raw && raw.type === "VARIABLE_ALIAS") {
                    value = "{alias}";
                }
                return {
                    modeId: mode.modeId,
                    modeName: mode.name,
                    value,
                };
            });
            return {
                variableId: variable.id,
                variableName: variable.name,
                collectionName: collection.name + (isRemote ? " (Library)" : ""),
                modes,
                isRemote,
            };
        }
        catch (err) {
            console.warn("Failed to fetch variable or collection", id, err);
            return null;
        }
    });
    const fetchedVariables = await Promise.all(fetchPromises);
    const result = fetchedVariables.filter((v) => v !== null);
    loadedVariableCount += idsToFetch.length;
    const hasMore = loadedVariableCount < activeVariableIds.length;
    const payload = {
        type: isInitial ? "scan-result" : "load-more-result",
        variables: result,
        hasMore
    };
    if (isInitial) {
        if (activeUnboundNode) {
            payload.unboundNode = activeUnboundNode;
            payload.localCollections = activeLocalCollections;
            payload.lastCollectionId = lastCollectionId;
        }
        payload.unboundNodes = activeUnboundNodesList;
        payload.hasMoreUnbound = hasMoreUnboundNodes;
        payload.activeTab = activeTab;
        payload.negativeList = negativeList;
        payload.isSelectionEmpty = false;
        payload.collectionFilter = collectionFilterVal;
        if (autoApplyVal !== undefined)
            payload.autoApply = autoApplyVal;
    }
    sendToUI(payload);
}
// ---------------------------------------------------------------------------
// Helpers: traverse nodes, extract variable binding
// ---------------------------------------------------------------------------
/**
 * Collects TEXT nodes from selected nodes. Uses native findAllWithCriteria for performance.
 */
async function collectTextNodes(node, acc) {
    if (isNodeIgnored(node))
        return;
    if (node.type === "TEXT") {
        acc.push(node);
    }
    else if ("children" in node) {
        const children = node.children;
        for (let i = 0; i < children.length; i++) {
            if (i % 20 === 0)
                await yieldIfNeeded();
            await collectTextNodes(children[i], acc);
        }
    }
}
/**
 * Returns the variable ID bound to the `characters` field of a TextNode,
 * or null if there is no string variable binding.
 *
 * Figma stores variable bindings on `node.boundVariables`. The shape is
 * { [fieldName]: VariableAlias | VariableAlias[] }. We defensively check
 * multiple possible structures because the Figma typings have varied
 * between plugin API versions.
 */
function getTextBoundVariableId(node) {
    const bv = node.boundVariables;
    if (!bv)
        return null;
    // Primary path: bv.characters is a VariableAlias
    const alias = bv["characters"];
    if (!alias)
        return null;
    // It can be a single alias object or an array
    if (Array.isArray(alias)) {
        const first = alias[0];
        if (first && typeof first === "object" && "id" in first) {
            return first.id;
        }
    }
    else if (typeof alias === "object" &&
        alias !== null &&
        "id" in alias) {
        return alias.id;
    }
    return null;
}
/**
 * Fallback: detect text variable bindings that are set via a component TEXT
 * property rather than directly on the TextNode's boundVariables.characters.
 *
 * When a component author exposes a text layer as a component property, the
 * binding lives on the parent InstanceNode's componentProperties, not on the
 * TextNode itself. We detect this by:
 *   1. Reading textNode.componentPropertyReferences?.characters  → property key
 *   2. Walking up to the nearest InstanceNode ancestor
 *   3. Checking instanceNode.componentProperties[key].boundVariables?.value
 */
function getTextBoundVariableIdFromComponentProperty(node) {
    const refs = node.componentPropertyReferences;
    if (!refs || !refs["characters"])
        return null;
    const propKey = refs["characters"];
    // Walk up the parent chain to find the nearest InstanceNode
    let parent = node.parent;
    while (parent) {
        if (parent.type === "INSTANCE") {
            const instance = parent;
            const props = instance.componentProperties;
            const prop = props === null || props === void 0 ? void 0 : props[propKey];
            if (prop && prop.type === "TEXT") {
                const bv = prop.boundVariables;
                if (bv) {
                    const valueAlias = bv["value"];
                    if (valueAlias && typeof valueAlias === "object" && "id" in valueAlias) {
                        return valueAlias.id;
                    }
                }
            }
            break; // Only check the nearest instance
        }
        parent = parent.parent;
    }
    return null;
}
// ---------------------------------------------------------------------------
// Util
// ---------------------------------------------------------------------------
function sendToUI(msg) {
    figma.ui.postMessage(msg);
}
