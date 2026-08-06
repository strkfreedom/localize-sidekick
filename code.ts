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
  defaultCollectionId?: string;
  unboundNodes?: UnboundNodeInfo[];
  hasMoreUnbound?: boolean;
  activeTab?: "bound" | "unbound";
  negativeList?: string[];
  isSelectionEmpty?: boolean;
  collectionFilter?: string;
  autoApply?: boolean;
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
  message: string;
}

interface RenameErrorMessage {
  type: "rename-error";
  variableId: string;
  message: string;
}

interface LoadingStartMessage {
  type: "loading-start";
}

type PluginToUI = ScanResult | LoadMoreResult | CreateErrorMessage | RenameErrorMessage | StatusMessage | LoadingStartMessage;

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
  type: "update-default-collection";
  collectionId: string;
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
  | ApplyMultipleMessage;

// ---------------------------------------------------------------------------
// Plugin entry point
// ---------------------------------------------------------------------------

let lastCollectionId: string | undefined;
let defaultCollectionId: string | undefined;
let activeTab: "bound" | "unbound" = "bound";
let scanAllUnbound = false;
let collectionFilterVal: string | undefined;
let autoApplyVal: boolean | undefined;

async function initPlugin() {
  const size = await figma.clientStorage.getAsync("pluginSize");
  const width = size?.width || 560;
  const height = size?.height || 720;

  const savedActiveTab = await figma.clientStorage.getAsync("activeTab");
  const savedNegativeList = await figma.clientStorage.getAsync("negativeList");
  const savedCollectionFilter = await figma.clientStorage.getAsync("collectionFilter");
  const savedAutoApply = await figma.clientStorage.getAsync("autoApply");
  const savedDefaultCollectionId = await figma.clientStorage.getAsync("defaultCollectionId");
  
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
  if (typeof savedDefaultCollectionId === "string") {
    defaultCollectionId = savedDefaultCollectionId;
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

  if (msg.type === "update-default-collection") {
    defaultCollectionId = msg.collectionId;
    await figma.clientStorage.setAsync("defaultCollectionId", defaultCollectionId);
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
const BATCH_SIZE = 20;

const collectionCache = new Map<string, Promise<VariableCollection | null>>();
const getCachedCollection = (collectionId: string) => {
  if (!collectionCache.has(collectionId)) {
    const promise = figma.variables.getVariableCollectionByIdAsync(collectionId);
    collectionCache.set(collectionId, promise);
  }
  return collectionCache.get(collectionId)!;
};

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
    name: c.name,
    modes: c.modes.map(m => ({ modeId: m.modeId, name: m.name }))
  }));

  if (selection.length === 0) {
    activeVariableIds = [];
    sendToUI({ type: "scan-result", variables: [], hasMore: false, negativeList, unboundNodes: [], isSelectionEmpty: true, collectionFilter: collectionFilterVal, autoApply: autoApplyVal, defaultCollectionId, localCollections: activeLocalCollections });
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
    sendToUI({ type: "scan-result", variables: [], hasMore: false, negativeList, unboundNodes: [], isSelectionEmpty: false, collectionFilter: collectionFilterVal, autoApply: autoApplyVal, defaultCollectionId, localCollections: activeLocalCollections });
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

  if (!scanAllUnbound && allUnboundNodes.length > 100) {
    activeUnboundNodesList = allUnboundNodes.slice(0, 100);
    hasMoreUnboundNodes = true;
  } else {
    activeUnboundNodesList = allUnboundNodes;
    hasMoreUnboundNodes = false;
  }

  activeVariableIds = Array.from(variableIds);
  loadedVariableCount = 0;

  await fetchAndSendNextBatch(true);
}

async function fetchAndSendNextBatch(isInitial: boolean) {
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

      return {
        variableId: variable.id,
        variableName: variable.name,
        collectionName: collection.name + (isRemote ? " (Library)" : ""),
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
    (payload as ScanResult).isSelectionEmpty = false;
    (payload as ScanResult).collectionFilter = collectionFilterVal;
    (payload as ScanResult).defaultCollectionId = defaultCollectionId;
    if (autoApplyVal !== undefined) (payload as ScanResult).autoApply = autoApplyVal;
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
