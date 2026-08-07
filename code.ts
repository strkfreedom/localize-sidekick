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
// Types shared between code.ts and ui.html (duplicated to avoid bundler deps)
// ---------------------------------------------------------------------------

interface ModeValue {
  modeId: string;
  modeName: string;
  value: string;
}

interface BoundVariable {
  variableId: string;
  variableName: string;
  collectionName: string;
  modes: ModeValue[];
  isRemote?: boolean;
}

interface UnboundNodeInfo {
  id: string;
  name: string;
  text: string;
}

interface CollectionModeInfo {
  modeId: string;
  name: string;
}

interface CollectionInfo {
  id: string;
  name: string;
  modes: CollectionModeInfo[];
}

interface ScanResult {
  type: "scan-result";
  variables: BoundVariable[];
  hasMore: boolean;
  unboundNode?: UnboundNodeInfo;
  localCollections?: CollectionInfo[];
  lastCollectionId?: string;
  defaultCreateCollectionId?: string;
  defaultBindCollectionId?: string;
  unboundNodes?: UnboundNodeInfo[];
  hasMoreUnbound?: boolean;
  activeTab?: "bound" | "unbound";
  negativeList?: string[];
  isSelectionEmpty?: boolean;
  collectionFilter?: string;
  autoApply?: boolean;
  externalCollections?: { id: string, name: string }[];
  disabledCollections?: string[];
  availableModes?: string[];
  allUnbound?: boolean;
}

interface LoadMoreResult {
  type: "load-more-result";
  variables: BoundVariable[];
  hasMore: boolean;
}

interface StatusMessage {
  type: "status";
  message: string;
}

interface CreateErrorMessage {
  type: "create-error";
  message?: string;
}

interface RenameErrorMessage {
  type: "rename-error";
  variableId: string;
  message: string;
}

interface LoadingStartMessage {
  type: "loading-start";
}

interface SearchLinkVariablesResultMessage {
  type: "search-link-variables-result";
  results: { id: string, name: string, collectionName: string, value: string, isExternal: boolean, key?: string }[];
}

interface ExternalCollectionsLoadedMessage {
  type: "external-collections-loaded";
  externalCollections: { id: string, name: string }[];
}

type PluginToUI = ScanResult | LoadMoreResult | CreateErrorMessage | RenameErrorMessage | StatusMessage | LoadingStartMessage | SearchLinkVariablesResultMessage | ExternalCollectionsLoadedMessage;

interface ApplyMultipleMessage {
  type: "apply-multiple";
  updates: { variableId: string; modeId: string; value: string }[];
  skipScan?: boolean;
}

interface RefreshMessage {
  type: "refresh";
}

interface CloseMessage {
  type: "close";
}

interface LoadMoreMessage {
  type: "load-more";
}

interface ResizeMessage {
  type: "resize";
  width: number;
  height: number;
}

interface SaveResizeMessage {
  type: "save-resize";
  width: number;
  height: number;
}

interface RenameVariableMessage {
  type: "rename-variable";
  variableId: string;
  newName: string;
}

interface DeleteVariableMessage {
  type: "delete-variable";
  variableId: string;
}

interface CreateBindVariableMessage {
  type: "create-bind-variable";
  nodeId: string;
  collectionId: string;
  variableName: string;
  modeValues: Record<string, string>;
}

interface SwitchTabMessage {
  type: "switch-tab";
  tabId: "bound" | "unbound";
}

interface LoadMoreUnboundMessage {
  type: "load-more-unbound";
}

interface SelectNodeMessage {
  type: "select-node";
  nodeId: string;
}

interface SelectMultipleNodesMessage {
  type: "select-multiple-nodes";
  nodeIds: string[];
}

interface UpdateNegativeListMessage {
  type: "update-negative-list";
  list: string[];
}

interface UpdateCollectionFilterMessage {
  type: "update-collection-filter";
  filter: string;
}

interface UpdateAutoApplyMessage {
  type: "update-auto-apply";
  value: boolean;
}

interface UpdateDefaultCollectionMessage {
  type: "update-default-create-collection" | "update-default-bind-collection";
  collectionId: string;
}

interface UpdateDisabledCollectionsMessage {
  type: "update-disabled-collections";
  disabledCollections: string[];
}

type UIToPlugin =
  | RefreshMessage
  | CloseMessage
  | LoadMoreMessage
  | ResizeMessage
  | SaveResizeMessage
  | RenameVariableMessage
  | DeleteVariableMessage
  | CreateBindVariableMessage
  | SwitchTabMessage
  | LoadMoreUnboundMessage
  | SelectNodeMessage
  | SelectMultipleNodesMessage
  | UpdateNegativeListMessage
  | UpdateCollectionFilterMessage
  | UpdateAutoApplyMessage
  | UpdateDefaultCollectionMessage
  | ApplyMultipleMessage
  | SearchLinkVariablesMessage
  | BindExistingVariableMessage
  | UpdateDisabledCollectionsMessage
  | UnbindVariableMessage;

interface SearchLinkVariablesMessage {
  type: "search-link-variables";
  query: string;
  collectionId: string;
  previewModeName?: string;
  nodeText?: string;
}

interface BindExistingVariableMessage {
  type: "bind-existing-variable";
  variableId: string;
  isExternal: boolean;
  key?: string;
  nodeIds?: string[];
}

interface UnbindVariableMessage {
  type: "unbind-variable";
  variableId: string;
}

// ---------------------------------------------------------------------------
// Plugin entry point
// ---------------------------------------------------------------------------

let lastCollectionId: string | undefined;
let defaultCreateCollectionId: string | undefined;
let defaultBindCollectionId: string | undefined;
let activeTab: "bound" | "unbound" = "bound";
let scanAllUnbound = false;
let collectionFilterVal: string | undefined;
let autoApplyVal: boolean | undefined;

let disabledCollections: string[] = [];

async function initPlugin() {
  const size = await figma.clientStorage.getAsync("pluginSize");
  const width = size?.width || 560;
  const height = size?.height || 720;

  const savedActiveTab = await figma.clientStorage.getAsync("activeTab");
  const savedNegativeList = await figma.clientStorage.getAsync("negativeList");
  const savedCollectionFilter = await figma.clientStorage.getAsync("collectionFilter");
  const savedAutoApply = await figma.clientStorage.getAsync("autoApply");
  const savedDefaultCreateCollectionId = await figma.clientStorage.getAsync("defaultCreateCollectionId");
  const savedDefaultBindCollectionId = await figma.clientStorage.getAsync("defaultBindCollectionId");
  
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
  if (typeof savedDefaultCreateCollectionId === "string") {
    defaultCreateCollectionId = savedDefaultCreateCollectionId;
  }
  if (typeof savedDefaultBindCollectionId === "string") {
    defaultBindCollectionId = savedDefaultBindCollectionId;
  }
  
  const savedDisabledCollections = await figma.clientStorage.getAsync("disabledCollections");
  disabledCollections = Array.isArray(savedDisabledCollections) ? savedDisabledCollections : [];

  figma.showUI(__html__, {
    width,
    height,
    themeColors: true,
    title: "Localize Sidekick",
  });

  // Scan on open
  await scanSelection();

  // Load libraries in background and notify UI
  ensureLibraryMaps().then(() => {
    sendToUI({ type: "external-collections-loaded", externalCollections: availableExternalCollections });
  });

  let currentSelectionIds = "";

  // Re-scan whenever selection changes
  figma.on("selectionchange", () => {
    const selection = figma.currentPage.selection;
    const ids = selection.map(n => n.id).join(",");
    if (ids === currentSelectionIds) return;
    
    currentSelectionIds = ids;
    scanSelection();
  });
}

initPlugin();

// Handle messages from the UI
figma.ui.onmessage = async (rawMsg: unknown) => {
  const msg = rawMsg as UIToPlugin;

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
      figma.currentPage.selection = [node as SceneNode];
      figma.viewport.scrollAndZoomIntoView([node as SceneNode]);
    }
    return;
  }

  if (msg.type === "select-multiple-nodes") {
    const nodes = await Promise.all(msg.nodeIds.map(id => figma.getNodeByIdAsync(id)));
    const textNodes = nodes.filter(n => n && n.type === "TEXT") as SceneNode[];
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

  if (msg.type === "update-default-create-collection") {
    defaultCreateCollectionId = msg.collectionId;
    await figma.clientStorage.setAsync("defaultCreateCollectionId", defaultCreateCollectionId);
    return;
  }
  if (msg.type === "update-default-bind-collection") {
    defaultBindCollectionId = msg.collectionId;
    await figma.clientStorage.setAsync("defaultBindCollectionId", defaultBindCollectionId);
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
      } catch (err) {
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
    } catch (err) {
      console.error("Error renaming variable", msg.variableId, err);
      let errMsg = String(err);
      if (errMsg.includes("already exists")) errMsg = "Name already exists";
      sendToUI({ type: "rename-error", variableId: msg.variableId, message: errMsg });
    }
    return;
  }

  if (msg.type === "delete-variable") {
    try {
      const variable = await figma.variables.getVariableByIdAsync(msg.variableId);
      if (variable && variable.resolvedType === "STRING") {
        // Detach selected text nodes bound to this variable
        const selectedTextNodes: TextNode[] = [];
        for (const node of figma.currentPage.selection) {
          collectTextNodes(node, selectedTextNodes);
        }
        for (const textNode of selectedTextNodes) {
          if (getTextBoundVariableId(textNode) === msg.variableId) {
            await figma.loadFontAsync(textNode.fontName as FontName);
            textNode.setBoundVariable("characters", null);
          }
        }
        variable.remove();
        sendToUI({ type: "status", message: "Variable deleted and detached" });
        await scanSelection();
      } else {
        sendToUI({ type: "status", message: "Variable not found" });
      }
    } catch (err) {
      console.error("Error deleting variable", msg.variableId, err);
      sendToUI({ type: "status", message: "Failed to delete variable: " + err });
    }
    return;
  }

  if (msg.type === "update-disabled-collections") {
    disabledCollections = msg.disabledCollections;
    await figma.clientStorage.setAsync("disabledCollections", disabledCollections);
    return;
  }

  if (msg.type === "search-link-variables") {
    const query = (msg.query || "").toLowerCase();
    const collectionId = msg.collectionId || "all";
    
    let results: { id: string, name: string, collectionName: string, value: string, isExternal: boolean, key?: string }[] = [];
    
    // 1. Search local variables
    if (collectionId !== "external") {
      const localVars = await figma.variables.getLocalVariablesAsync("STRING");
      for (const v of localVars) {
        if (disabledCollections.includes(v.variableCollectionId)) continue;
        if (collectionId !== "all" && collectionId !== "local" && v.variableCollectionId !== collectionId) continue;
        if (collectionId === "all" || collectionId === "local" || v.variableCollectionId === collectionId) {
          const col = await getCachedCollection(v.variableCollectionId);
          let val = "";
          if (col && col.modes.length > 0) {
            let targetModeId = col.modes[0].modeId;
            if (msg.previewModeName) {
              const foundMode = col.modes.find(m => getStandardLanguageName(m.name) === msg.previewModeName);
              if (foundMode) targetModeId = foundMode.modeId;
            }
            const modeVal = v.valuesByMode[targetModeId];
            if (typeof modeVal === "string") val = modeVal;
          }
          
          if (v.name.toLowerCase().includes(query) || val.toLowerCase().includes(query)) {
            results.push({
              id: v.id,
              name: v.name,
              collectionName: `Local / ${col ? col.name : "Unknown"}`,
              value: val,
              isExternal: false
            });
          }
        }
      }
    }

    // 2. Search external variables
    if (collectionId !== "local") {
      // FAST PATH: skip expensive external import if query is empty and we already have local results
      const skipExternal = (query === "" && collectionId === "all" && results.length > 0);
           if (!skipExternal) {
        // Base filter: collection only (no name filter yet — we need to import to check values)
        const extCandidates = availableExternalVariables.filter(v => {
          if (disabledCollections.includes(v.collectionId)) return false;
          if (collectionId !== "all" && collectionId !== "external" && v.collectionId !== collectionId) return false;
          return true;
        });

        // Prioritise name matches so they always appear first; add non-name-matches for value search
        const nameMatches = query ? extCandidates.filter(v => v.name.toLowerCase().includes(query)) : extCandidates;
        const nonNameMatches = query ? extCandidates.filter(v => !v.name.toLowerCase().includes(query)) : [];

        // When searching with a query: import all candidates (name matches first), capped at 300 to avoid freezing.
        // Without a query: only show the first 20 as a default preview.
        const cap = query ? 300 : 20;
        const toImport = query
          ? [...nameMatches, ...nonNameMatches].slice(0, cap)
          : nameMatches.slice(0, cap);

        for (const extVar of toImport) {
          try {
            // Lazily import to get value
            const importedVar = await figma.variables.importVariableByKeyAsync(extVar.key);
            const col = await figma.variables.getVariableCollectionByIdAsync(importedVar.variableCollectionId);
            let val = "";
            if (col && col.modes.length > 0) {
              let targetModeId = col.modes[0].modeId;
              if (msg.previewModeName) {
                const foundMode = col.modes.find(m => getStandardLanguageName(m.name) === msg.previewModeName);
                if (foundMode) targetModeId = foundMode.modeId;
              }
              const modeVal = importedVar.valuesByMode[targetModeId];
              if (typeof modeVal === "string") val = modeVal;
            }

            // Post-import filter: must match query by name OR value
            if (query && !extVar.name.toLowerCase().includes(query) && !val.toLowerCase().includes(query)) {
              continue;
            }

            results.push({
              id: importedVar.id,
              name: extVar.name,
              collectionName: extVar.collectionName,
              value: val,
              isExternal: true,
              key: extVar.key
            });
          } catch (e) {
            console.warn("Failed to import variable for preview", e);
          }
        }
      } // close !skipExternal
    }

    // Sort: if nodeText provided, exact value match first, partial match next, then alphabetical
    const nodeText = (msg.nodeText || "").toLowerCase().trim();
    if (nodeText && results.length > 0) {
      const hasAnyMatch = results.some(r => r.value.toLowerCase().includes(nodeText));
      if (hasAnyMatch) {
        // Sort: exact match → partial match → rest (alphabetical within each group)
        results.sort((a, b) => {
          const aVal = a.value.toLowerCase();
          const bVal = b.value.toLowerCase();
          const aScore = aVal === nodeText ? 0 : (aVal.includes(nodeText) ? 1 : 2);
          const bScore = bVal === nodeText ? 0 : (bVal.includes(nodeText) ? 1 : 2);
          if (aScore !== bScore) return aScore - bScore;
          return a.name.localeCompare(b.name);
        });
      } else {
        // No value matches — fall back to default top-10 alphabetical list
        results.sort((a, b) => a.name.localeCompare(b.name));
        results = results.slice(0, 10);
      }
    } else {
      results.sort((a, b) => a.name.localeCompare(b.name));
      if (query === "") {
        results = results.slice(0, 10);
      }
    }

    sendToUI({ type: "search-link-variables-result", results });
    return;
  }

  if (msg.type === "unbind-variable") {
    try {
      const textNodes: TextNode[] = [];
      for (const node of figma.currentPage.selection) {
        await collectTextNodes(node, textNodes);
      }
      let unbound = 0;
      for (const textNode of textNodes) {
        const boundId = getTextBoundVariableId(textNode) || getTextBoundVariableIdFromComponentProperty(textNode);
        if (boundId === msg.variableId) {
          await figma.loadFontAsync(textNode.fontName as FontName);
          textNode.setBoundVariable("characters", null);
          unbound++;
        }
      }
      if (unbound > 0) {
        sendToUI({ type: "status", message: "Unbound variable" });
        await scanSelection();
      } else {
        sendToUI({ type: "status", message: "No matching label found in selection" });
      }
    } catch (e) {
      console.error("Error unbinding variable", e);
      sendToUI({ type: "status", message: "Failed to unbind: " + e });
    }
    return;
  }

  if (msg.type === "bind-existing-variable") {
    try {
      let varId = msg.variableId;
      if (msg.isExternal && msg.key) {
        const importedVar = await figma.variables.importVariableByKeyAsync(msg.key);
        varId = importedVar.id;
      }
      const variable = await figma.variables.getVariableByIdAsync(varId);
      if (!variable) throw new Error("Variable not found");

      // Multi-node binding (all selected items unbound)
      const nodeIds: string[] = msg.nodeIds && msg.nodeIds.length > 0
        ? msg.nodeIds
        : activeUnboundNode ? [activeUnboundNode.id] : [];

      let boundCount = 0;
      for (const nodeId of nodeIds) {
        const node = await figma.getNodeByIdAsync(nodeId) as TextNode;
        if (node && node.type === "TEXT") {
          await figma.loadFontAsync(node.fontName as FontName);
          node.setBoundVariable("characters", variable);
          boundCount++;
        }
      }

      if (boundCount > 0) {
        const label = boundCount === 1 ? "Linked variable successfully" : `Linked variable to ${boundCount} labels`;
        sendToUI({ type: "status", message: label });
        await scanSelection();
      }
    } catch (e) {
      console.error("Error binding existing variable", e);
      sendToUI({ type: "status", message: "Failed to link variable: " + e });
      sendToUI({ type: "create-error" });
    }
    return;
  }

  if (msg.type === "create-bind-variable") {
    try {
      lastCollectionId = msg.collectionId;
      await figma.clientStorage.setAsync("lastCollectionId", msg.collectionId);

      const node = await figma.getNodeByIdAsync(msg.nodeId) as TextNode;
      if (node && node.type === "TEXT") {
        await figma.loadFontAsync(node.fontName as FontName);
        
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
    } catch (err) {
      console.error("Error creating variable", err);
      let errMsg = String(err);
      if (errMsg.includes("already exists")) errMsg = "Name already exists";
      sendToUI({ type: "create-error", message: errMsg });
    }
    return;
  }
};

// ---------------------------------------------------------------------------
// Core: scan the current Figma selection
// ---------------------------------------------------------------------------
let activeVariableIds: string[] = [];
let loadedVariableCount = 0;
let activeAllUnbound = false;
const BATCH_SIZE = 20;

const collectionCache = new Map<string, Promise<VariableCollection | null>>();
const getCachedCollection = (collectionId: string) => {
  if (!collectionCache.has(collectionId)) {
    const promise = figma.variables.getVariableCollectionByIdAsync(collectionId);
    collectionCache.set(collectionId, promise);
  }
  return collectionCache.get(collectionId)!;
};

let libraryVarToLibNameMap: Map<string, string> | null = null;
let libraryColKeyToLibNameMap: Map<string, string> | null = null;
let libraryColNameToLibNameMap: Map<string, string> | null = null;
let ensureLibraryMapsPromise: Promise<void> | null = null;

let availableExternalCollections: { id: string, name: string }[] = [];
let availableExternalVariables: (LibraryVariable & { collectionName: string, libraryName: string, collectionId: string })[] = [];

async function ensureLibraryMaps() {
  if (ensureLibraryMapsPromise) return ensureLibraryMapsPromise;

  ensureLibraryMapsPromise = (async () => {
    libraryVarToLibNameMap = new Map();
    libraryColKeyToLibNameMap = new Map();
    libraryColNameToLibNameMap = new Map();
    availableExternalCollections = [];
    availableExternalVariables = [];

    try {
      const libs = await figma.teamLibrary.getAvailableLibraryVariableCollectionsAsync();
      for (const libCol of libs) {
        if (libCol.key) libraryColKeyToLibNameMap.set(libCol.key, libCol.libraryName);
        if (libCol.name) libraryColNameToLibNameMap.set(libCol.name, libCol.libraryName);

        availableExternalCollections.push({
          id: libCol.key,
          name: `${libCol.libraryName} / ${libCol.name}`
        });

        try {
          const vars = await figma.teamLibrary.getVariablesInLibraryCollectionAsync(libCol.key);
          for (const v of vars) {
            if (v.key) {
              libraryVarToLibNameMap.set(v.key, libCol.libraryName);
            }
            if (v.resolvedType === "STRING") {
              availableExternalVariables.push({
                ...v,
                collectionName: `${libCol.libraryName} / ${libCol.name}`,
                libraryName: libCol.libraryName,
                collectionId: libCol.key
              });
            }
          }
        } catch (e) {
          // Ignored
        }
      }
    } catch (e) {
      console.warn("Failed to fetch available library variable collections", e);
    }
  })();

  return ensureLibraryMapsPromise;
}

async function getLibraryNameForVariable(variable: Variable, collection: VariableCollection): Promise<string> {
  if (!variable.remote && !collection.remote) return "Local";

  const directLibName = (collection as any).libraryName || (variable as any).libraryName || (collection as any).fileName;
  if (directLibName && typeof directLibName === "string") return directLibName;

  await ensureLibraryMaps();

  if (variable.key && libraryVarToLibNameMap?.has(variable.key)) {
    return libraryVarToLibNameMap.get(variable.key)!;
  }

  if (collection.key && libraryColKeyToLibNameMap?.has(collection.key)) {
    return libraryColKeyToLibNameMap.get(collection.key)!;
  }

  if (collection.name && libraryColNameToLibNameMap?.has(collection.name)) {
    return libraryColNameToLibNameMap.get(collection.name)!;
  }

  return "Library";
}

let activeUnboundNode: UnboundNodeInfo | undefined;
let activeLocalCollections: CollectionInfo[] | undefined;
let activeUnboundNodesList: UnboundNodeInfo[] = [];
let hasMoreUnboundNodes = false;
let negativeList: string[] = [];

function isNodeIgnored(node: SceneNode): boolean {
  if (negativeList.length === 0) return false;
  let curr: BaseNode | null = node;
  while (curr && curr.type !== "DOCUMENT" && curr.type !== "PAGE") {
    if (negativeList.includes(curr.name)) return true;
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

  const collections = await figma.variables.getLocalVariableCollectionsAsync();
  activeLocalCollections = collections.map(c => ({
    id: c.id,
    name: `Local / ${c.name}`,
    modes: c.modes.map(m => ({ modeId: m.modeId, name: m.name }))
  }));

  if (selection.length === 0) {
    let availableModes = new Set<string>();
    collections.forEach(c => {
      if (!disabledCollections.includes(c.id)) {
        c.modes.forEach(m => availableModes.add(getStandardLanguageName(m.name)));
      }
    });
    sendToUI({ type: "scan-result", variables: [], hasMore: false, negativeList, unboundNodes: [], isSelectionEmpty: true, collectionFilter: collectionFilterVal, autoApply: autoApplyVal, defaultCreateCollectionId, defaultBindCollectionId, localCollections: activeLocalCollections, externalCollections: availableExternalCollections, disabledCollections, availableModes: Array.from(availableModes) });
    return;
  }
  sendToUI({ type: "loading-start" });
  await new Promise(resolve => setTimeout(resolve, 30));

  const textNodes: TextNode[] = [];
  for (const node of selection) {
    await collectTextNodes(node, textNodes);
  }

  if (textNodes.length === 0) {
    activeVariableIds = [];
    sendToUI({ type: "scan-result", variables: [], hasMore: false, negativeList, unboundNodes: [], isSelectionEmpty: false, collectionFilter: collectionFilterVal, autoApply: autoApplyVal, defaultCreateCollectionId, defaultBindCollectionId, localCollections: activeLocalCollections, externalCollections: availableExternalCollections, disabledCollections });
    return;
  }

  const variableIds = new Set<string>();
  const allUnboundNodes: UnboundNodeInfo[] = [];

  for (let i = 0; i < textNodes.length; i++) {
    if (i % 20 === 0) await yieldIfNeeded();
    const textNode = textNodes[i];
    const boundId = getTextBoundVariableId(textNode) || getTextBoundVariableIdFromComponentProperty(textNode);
    if (boundId) {
      variableIds.add(boundId);
    } else {
      allUnboundNodes.push({
        id: textNode.id,
        name: textNode.name,
        text: textNode.characters
      });
    }
  }

  activeUnboundNode = undefined;

  if (textNodes.length === 1 && variableIds.size === 0) {
    activeUnboundNode = allUnboundNodes[0];
  }

  const allUnbound = variableIds.size === 0 && allUnboundNodes.length > 0;

  if (!scanAllUnbound && allUnboundNodes.length > 100) {
    activeUnboundNodesList = allUnboundNodes.slice(0, 100);
    hasMoreUnboundNodes = true;
  } else {
    activeUnboundNodesList = allUnboundNodes;
    hasMoreUnboundNodes = false;
  }

  activeVariableIds = Array.from(variableIds);
  loadedVariableCount = 0;
  activeAllUnbound = allUnbound;

  await fetchAndSendNextBatch(true);
}

function getStandardLanguageName(name: string): string {
  const n = name.trim().toLowerCase();
  if (["th", "thai", "th-th"].includes(n)) return "Thai";
  if (["en", "eng", "english", "en-us", "en-gb"].includes(n)) return "English";
  if (["fr", "fre", "french", "fr-fr"].includes(n)) return "French";
  if (["de", "ger", "german", "de-de"].includes(n)) return "German";
  if (["ja", "jpn", "japanese", "ja-jp"].includes(n)) return "Japanese";
  if (["zh", "zho", "chi", "chinese", "zh-cn", "zh-tw"].includes(n)) return "Chinese";
  if (["es", "spa", "spanish", "es-es", "es-mx"].includes(n)) return "Spanish";
  if (["it", "ita", "italian", "it-it"].includes(n)) return "Italian";
  if (["ko", "kor", "korean", "ko-kr"].includes(n)) return "Korean";
  if (["pt", "por", "portuguese", "pt-br", "pt-pt"].includes(n)) return "Portuguese";
  if (["ru", "rus", "russian", "ru-ru"].includes(n)) return "Russian";
  if (["vi", "vie", "vietnamese", "vi-vn"].includes(n)) return "Vietnamese";
  if (["id", "ind", "indonesian", "id-id"].includes(n)) return "Indonesian";
  if (["ms", "may", "malay", "ms-my"].includes(n)) return "Malay";
  
  // Convert something like "Mode 1" to "Mode 1" (keep original case)
  return name.trim();
}

async function fetchAndSendNextBatch(isInitial: boolean) {
  const idsToFetch = activeVariableIds.slice(loadedVariableCount, loadedVariableCount + BATCH_SIZE);

  if (idsToFetch.length === 0) {
    if (isInitial) {
      let availableModes = new Set<string>();
      const collections = await figma.variables.getLocalVariableCollectionsAsync();
      collections.forEach(c => {
        if (!disabledCollections.includes(c.id)) {
          c.modes.forEach(m => availableModes.add(getStandardLanguageName(m.name)));
        }
      });
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
        negativeList: negativeList,
        externalCollections: availableExternalCollections,
        disabledCollections,
        availableModes: Array.from(availableModes),
        allUnbound: activeAllUnbound
      });
    }
    return;
  }

  // Fetch only this batch
  const fetchPromises = idsToFetch.map(async (id) => {
    try {
      const variable = await figma.variables.getVariableByIdAsync(id);
      if (!variable || variable.resolvedType !== "STRING") return null;

      const collection = await getCachedCollection(variable.variableCollectionId);
      if (!collection) return null;

      const isRemote = variable.remote;

      const modes: ModeValue[] = collection.modes.map((mode) => {
        const raw = variable.valuesByMode[mode.modeId];
        let value = "";
        if (typeof raw === "string") {
          value = raw;
        } else if (raw && typeof raw === "object" && "type" in raw && raw.type === "VARIABLE_ALIAS") {
          value = "{alias}";
        }

        return {
          modeId: mode.modeId,
          modeName: mode.name,
          value,
        };
      });
      const libName = await getLibraryNameForVariable(variable, collection);

      return {
        variableId: variable.id,
        variableName: variable.name,
        collectionName: `${libName} / ${collection.name}`,
        modes,
        isRemote,
      } as BoundVariable;
    } catch (err) {
      console.warn("Failed to fetch variable or collection", id, err);
      return null;
    }
  });

  const fetchedVariables = await Promise.all(fetchPromises);
  const result: BoundVariable[] = fetchedVariables.filter((v): v is BoundVariable => v !== null);

  loadedVariableCount += idsToFetch.length;
  const hasMore = loadedVariableCount < activeVariableIds.length;

  const payload: PluginToUI = { 
    type: isInitial ? "scan-result" : "load-more-result", 
    variables: result, 
    hasMore 
  };

  if (isInitial) {
    if (activeUnboundNode) {
      (payload as ScanResult).unboundNode = activeUnboundNode;
      (payload as ScanResult).lastCollectionId = lastCollectionId;
    }
    (payload as ScanResult).localCollections = activeLocalCollections;
    (payload as ScanResult).unboundNodes = activeUnboundNodesList;
    (payload as ScanResult).hasMoreUnbound = hasMoreUnboundNodes;
    (payload as ScanResult).activeTab = activeTab;
    (payload as ScanResult).negativeList = negativeList;
    (payload as ScanResult).externalCollections = availableExternalCollections;
    (payload as ScanResult).disabledCollections = disabledCollections;
    (payload as ScanResult).isSelectionEmpty = false;
    (payload as ScanResult).collectionFilter = collectionFilterVal;
    (payload as ScanResult).defaultCreateCollectionId = defaultCreateCollectionId;
    (payload as ScanResult).defaultBindCollectionId = defaultBindCollectionId;
    if (autoApplyVal !== undefined) (payload as ScanResult).autoApply = autoApplyVal;
    (payload as ScanResult).allUnbound = activeAllUnbound;

    let availableModes = new Set<string>();
    const collections = await figma.variables.getLocalVariableCollectionsAsync();
    collections.forEach(c => {
      if (!disabledCollections.includes(c.id)) {
        c.modes.forEach(m => availableModes.add(getStandardLanguageName(m.name)));
      }
    });
    (payload as ScanResult).availableModes = Array.from(availableModes);
  }

  sendToUI(payload);
}

// ---------------------------------------------------------------------------
// Helpers: traverse nodes, extract variable binding
// ---------------------------------------------------------------------------

/**
 * Collects TEXT nodes from selected nodes. Uses native findAllWithCriteria for performance.
 */
async function collectTextNodes(node: SceneNode, acc: TextNode[]): Promise<void> {
  if (isNodeIgnored(node)) return;

  if (node.type === "TEXT") {
    acc.push(node);
  } else if ("children" in node) {
    const children = (node as any).children;
    for (let i = 0; i < children.length; i++) {
      if (i % 20 === 0) await yieldIfNeeded();
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
function getTextBoundVariableId(node: TextNode): string | null {
  const bv = node.boundVariables;
  if (!bv) return null;

  // Primary path: bv.characters is a VariableAlias
  const alias = (bv as Record<string, unknown>)["characters"];
  if (!alias) return null;

  // It can be a single alias object or an array
  if (Array.isArray(alias)) {
    const first = alias[0];
    if (first && typeof first === "object" && "id" in first) {
      return (first as VariableAlias).id;
    }
  } else if (
    typeof alias === "object" &&
    alias !== null &&
    "id" in alias
  ) {
    return (alias as VariableAlias).id;
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
function getTextBoundVariableIdFromComponentProperty(node: TextNode): string | null {
  const refs = (node as any).componentPropertyReferences as Record<string, string> | null;
  if (!refs || !refs["characters"]) return null;

  const propKey = refs["characters"];

  // Walk up the parent chain to find the nearest InstanceNode
  let parent: BaseNode | null = node.parent;
  while (parent) {
    if (parent.type === "INSTANCE") {
      const instance = parent as InstanceNode;
      const props = instance.componentProperties as ComponentProperties;
      const prop = props?.[propKey];
      if (prop && prop.type === "TEXT") {
        const bv = prop.boundVariables;
        if (bv) {
          const valueAlias = (bv as Record<string, unknown>)["value"];
          if (valueAlias && typeof valueAlias === "object" && "id" in (valueAlias as object)) {
            return (valueAlias as VariableAlias).id;
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

function sendToUI(msg: PluginToUI): void {
  figma.ui.postMessage(msg);
}
