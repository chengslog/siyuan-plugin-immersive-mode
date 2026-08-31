const DEFAULTS = { favorites: [], side: "right", y: 0.65, windowsTopBar: false, tabPreviewCount: 5 };
const ACTION_GROUPS = [
  ['left', '左侧栏'], ['top', '上侧栏'], ['right', '右侧栏'], ['bottom', '下侧栏'],
  ['page', '页面与设置'], ['unknown-dock', '其他 Dock（位置未识别）'],
];

function normalizeSettings(value) {
  const data = value && typeof value === "object" ? value : {};
  return {
    // Preserve legacy preferences on disk without rendering favorites or stars.
    favorites: Array.isArray(data.favorites) ? [...new Set(data.favorites.filter(x => typeof x === "string"))] : [],
    side: data.side === "left" ? "left" : "right",
    y: Number.isFinite(data.y) ? Math.min(1, Math.max(0, data.y)) : DEFAULTS.y,
    windowsTopBar: data.windowsTopBar === true,
    tabPreviewCount: Number.isFinite(data.tabPreviewCount) ? clamp(Math.floor(data.tabPreviewCount), 1, 20) : DEFAULTS.tabPreviewCount,
  };
}

function clamp(value, min, max) { return Math.max(min, Math.min(value, Math.max(min, max))); }

function orbPosition(settings, width, height) {
  return { x: settings.side === "left" ? 8 : Math.max(8, width - 50), y: clamp(settings.y * (height - 42), 8, height - 50) };
}

// Share the toolbar's actual free space; never cover tool/window controls.
// Leave 48px at the right for native window dragging, including with many tabs.
function mergedTabSlots(left, right, weights) {
  if (!weights.length) return [];
  const start = Math.max(0, left) + 4;
  const available = Math.max(0, right - start - 48);
  const gap = Math.min(4, available / (weights.length * 2));
  const content = Math.max(0, available - gap * (weights.length - 1));
  const normalized = weights.map(value => Number.isFinite(value) && value > 0 ? value : 1);
  const total = normalized.reduce((sum, value) => sum + value, 0);
  let x = start;
  return normalized.map(value => {
    const width = content * value / total;
    const slot = { left: x, width };
    x += width + gap;
    return slot;
  });
}

function tabsOverflow(scrollWidth, clientWidth, switcherWidth = 0) {
  // Compare with the space available if the switcher were hidden. Otherwise
  // its own width can cause a fit -> overflow -> fit visibility oscillation.
  return clientWidth > 0 && scrollWidth > clientWidth + Math.max(0, switcherWidth) + 1;
}

function plainLabel(element) {
  const raw = element.getAttribute("data-title") || element.getAttribute("aria-label") || element.getAttribute("title") || element.textContent || "";
  const parser = element.ownerDocument.createElement("template");
  parser.innerHTML = raw;
  return (parser.content.textContent || "").replace(/\s+/g, " ").trim().slice(0, 100);
}

// Verified against the installed SiYuan toolbar and the reference drawer.
// These are fallbacks for real nodes, never synthetic entries for absent tools.
const NATIVE_TOOLBAR = {
  barPlugins: ['插件管理', 'iconPlugin'], barCommand: ['命令面板', 'iconTerminal'],
  barSearch: ['全局搜索', 'iconSearch'], barSync: ['同步', 'iconCloudSucc'],
  barMode: ['外观模式', 'iconMode'], barZoom: ['界面缩放', 'iconZoomIn'],
  barMore: ['更多与设置', 'iconMore'], barWorkspace: ['工作空间与主菜单', 'iconMenu'],
  barBack: ['后退', 'iconLeft'], barForward: ['前进', 'iconRight'],
};
const NATIVE_DOCK = {
  file: ['文档树', 'iconFiles'], outline: ['大纲', 'iconOutline'],
  inbox: ['收集箱', 'iconInbox'], bookmark: ['书签', 'iconBookmark'], tag: ['标签', 'iconTag'],
  agentChat: ['智能助手', 'iconSparkles'], graph: ['关系图', 'iconGraph'],
  globalGraph: ['全局关系图', 'iconGlobalGraph'], backlink: ['反链', 'iconLink'],
};

function dockGroup(element, registeredPosition) {
  if (element.closest('#dockBottom')) return 'bottom';
  const rail = element.closest('#dockLeft, #dockRight');
  if (rail) {
    // SiYuan's third .dock__items slot belongs to Bottom, not Left/Right.
    // LeftBottom/RightBottom are the SECOND slot, still side panels.
    const slots = [...rail.children].filter(node => node.classList.contains('dock__items'));
    if (slots.length >= 3 && slots[2].contains(element)) return 'bottom';
    return rail.id === 'dockLeft' ? 'left' : 'right';
  }
  const layout = element.ownerDocument.defaultView?.siyuan?.layout;
  const type = element.getAttribute('data-type');
  for (const [key, group] of [['bottomDock', 'bottom'], ['leftDock', 'left'], ['rightDock', 'right']]) {
    const dock = layout?.[key];
    if (Array.from(dock?.elements || []).some(slot => slot?.contains(element))) return group;
  }
  for (const [key, group] of [['bottomDock', 'bottom'], ['leftDock', 'left'], ['rightDock', 'right']]) {
    if (Object.prototype.hasOwnProperty.call(layout?.[key]?.data || {}, type)) return group;
  }
  if (typeof registeredPosition === 'string') {
    if (registeredPosition.startsWith('Bottom')) return 'bottom';
    if (registeredPosition.startsWith('Left')) return 'left';
    if (registeredPosition.startsWith('Right')) return 'right';
  }
  return 'unknown-dock';
}

function discoverActions(doc, ownButton, plugins = []) {
  const result = [];
  const seen = new Set();
  const pluginMetadata = new Map();
  const dockMetadata = new Map();
  for (const plugin of plugins || []) {
    if (!plugin) continue;
    for (const element of plugin.topBarIcons || []) {
      if (element?.nodeType === 1) pluginMetadata.set(element, { title: plugin.displayName || plugin.name });
    }
    for (const [type, definition] of Object.entries(plugin.docks || {})) {
      dockMetadata.set(type, { title: definition?.config?.title || plugin.displayName || plugin.name, icon: definition?.config?.icon, position: definition?.config?.position });
    }
  }
  const candidates = new Set([
    ...Object.keys(NATIVE_TOOLBAR).map(id => doc.getElementById(id)).filter(Boolean),
    ...doc.querySelectorAll('#toolbar .toolbar__item, .dock__item[data-type], [id^="plugin_"][data-menu="true"]'),
    ...pluginMetadata.keys(),
  ]);
  for (const element of candidates) {
    if (!element.isConnected) continue;
    if (element === ownButton || element.closest('#windowControls') || element.id === 'barExit') continue;
    if (element.matches('[hidden], [disabled], [aria-disabled="true"], .toolbar__item--disabled, .dock__item--disabled')) continue;
    // SiYuan hides Zoom at 100%, but its native click handler remains available.
    if (element.classList.contains('fn__none') && element.id !== 'barZoom') continue;
    const type = element.getAttribute('data-type');
    const isDock = element.classList.contains('dock__item');
    const key = isDock ? (type && `dock:${type}`) : (element.id && `top:${element.id}`);
    const native = isDock ? NATIVE_DOCK[type] : NATIVE_TOOLBAR[element.id];
    const plugin = isDock ? dockMetadata.get(type) : pluginMetadata.get(element);
    const title = plainLabel(element) || native?.[0] || plugin?.title;
    if (!key || !title || seen.has(key)) continue;
    seen.add(key);
    const origin = native || (!isDock && !plugin && !element.id.startsWith('plugin_')) ? '原生' : '插件';
    const group = isDock ? dockGroup(element, plugin?.position) : 'top';
    result.push({ key, title, element, icon: native?.[1] || plugin?.icon, origin, group });
  }
  return result;
}

module.exports = { DEFAULTS, ACTION_GROUPS, normalizeSettings, clamp, orbPosition, plainLabel, discoverActions, mergedTabSlots, tabsOverflow };
