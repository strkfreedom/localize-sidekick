# Locale Editor (Figma Plugin)

Locale Editor is a powerful and highly optimized Figma plugin designed to streamline the management of string variables for localization. It seamlessly handles context-aware variable discovery, batch editing, and auto-translation to rapidly speed up your design-to-production workflows.

## 🚀 Core Functionalities

### 1. Context-Aware Variable Editing
* **Smart Selection Scanning:** Instantly scans your current Figma selection and lists all Text nodes bound to string variables.
* **Bulk Mode Editing:** Presents a clean, collapsible accordion interface displaying all variable modes (languages) simultaneously.
* **Auto-Apply:** Changes are applied and synced directly to the Figma canvas in real-time as you type.

### 2. Streamlined Variable Creation & Auto-Translation
* **One-Click Binding:** Select any unbound text node, and the plugin instantly offers a smooth UI to create and bind a new variable.
* **Auto-Translation Engine:** When creating a new variable, simply leave a language mode blank, and the plugin will seamlessly use the Google Translate API to translate your base text into the target language automatically.
* **Smart Defaults:** Persistently remembers your last-used variable collection to speed up repetitive creation workflows.

### 3. Inline Management Tools
* **Rename Variables:** Click the pencil icon to quickly rename variables directly within the plugin.
* **Safe Deletion:** A built-in "Delete Variable" flow tucked securely at the bottom of the edit screen prevents accidental clicks with a two-step "Confirm Delete?" safeguard.
* **Copy to Clipboard:** A dedicated copy icon allows you to instantly copy variable names for use in your codebase.
* **Duplicate Name Protection:** If you attempt to create or rename a variable using an existing name, the UI cleanly highlights the input in red and warns you immediately.

### 4. Highly Optimized Performance
* **Batch Processing:** Uses a "Load More" mechanism to process massive selections without freezing the Figma UI.
* **Targeted Re-rendering:** Reacts intelligently to selection changes, only rebuilding the DOM when necessary, ensuring a buttery smooth editing experience.
* **Flexible UI:** Completely resizable interface that respects your screen real-estate.

## 🛠 Usage
1. Open the plugin in Figma.
2. Select any text node (or multiple frames) on the canvas.
3. Edit existing variable modes, or create new ones directly from the plugin interface!
