const { Plugin, Setting, getFrontend, getBackend, openSetting, showMessage } = require('siyuan');
const css = require('./styles.css');
const { ACTION_GROUPS, normalizeSettings, clamp, orbPosition, plainLabel, discoverActions, mergedTabSlots, tabsOverflow } = require('./core');
const APPLE_ZOOM_ICON = '<svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="11" fill="currentColor"/><path d="M11 20.5 20.5 11M13 11h7.5v7.5" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const STORE = 'preferences.json';

function button(label, className, callback) {
  const element = document.createElement('button');
  element.type = 'button';
  element.className = className;
  element.textContent = label;
  element.addEventListener('click', callback);
  return element;
}

module.exports = class ImmersiveMode extends Plugin {
  async onload() {
    this.disposed = false;
    this.active = false;
    this.settingsData = normalizeSettings(null);
    this.cleanups = [];
    this.pendingSave = Promise.resolve();
    this.nativeReveals = new Set();
    this.geometryRestores = new Set();
    this.markedRows = new Set();
    this.mergedRows = new Map();
    this.tabSwitchers = new Map();
    this.tabResizeTargets = new Set();
    try { this.settingsData = normalizeSettings(await this.loadData(STORE)); }
    catch (error) { console.warn('[immersive-mode] Settings unavailable', error); }
    if (this.disposed) return;
    this.frontend = getFrontend();
    if (!['desktop', 'browser-desktop'].includes(this.frontend)) return;
    this.isWindowsDesktop = this.frontend === 'desktop' && /^Win/i.test(navigator.platform)
      && typeof getBackend === 'function' && getBackend() === 'windows';
    this.addCommand({ langKey: 'toggleImmersive', langText: '切换沉浸模式', hotkey: '⌥⇧I', callback: () => this.toggle() });
    this.setting = new Setting({ confirmCallback: () => {} });
    this.setting.addItem({ title: 'Windows：保留顶部工具栏', description: '默认关闭：完全沉浸，28px 顶部只保留最小化、最大化 / 还原、关闭和空白拖窗区，页签收进小圆球。开启后工具按钮与原生页签共用这行，菜单不重复收纳上侧栏功能。仅本地 Windows 客户端生效，浏览器 / Docker 不显示窗口控制条。', createActionElement: () => {
      const toggle = document.createElement('input');
      toggle.type = 'checkbox'; toggle.className = 'b3-switch';
      toggle.setAttribute('aria-label', 'Windows：保留顶部工具栏');
      toggle.checked = this.settingsData.windowsTopBar;
      toggle.disabled = !this.isWindowsDesktop;
      toggle.addEventListener('change', () => {
        if (!this.isWindowsDesktop) return;
        this.settingsData.windowsTopBar = toggle.checked;
        this.applyTopBarSetting(); this.savePreferences();
      });
      return toggle;
    } });
    this.setting.addItem({ title: '页签默认展示数量', description: '小圆球卡片默认展示的已打开页签数量（1–20，默认 5）。超出的页签折叠，点击“展开其余页签”查看；不关闭或重建原页面。', createActionElement: () => {
      const input = document.createElement('input');
      input.type = 'number'; input.min = '1'; input.max = '20'; input.step = '1';
      input.className = 'b3-text-field'; input.style.width = '72px';
      input.setAttribute('aria-label', '页签默认展示数量');
      input.value = String(this.settingsData.tabPreviewCount);
      const applyCount = () => {
        const value = input.value.trim() ? Number(input.value) : NaN;
        const count = normalizeSettings({ tabPreviewCount: value }).tabPreviewCount;
        input.value = String(count);
        if (count === this.settingsData.tabPreviewCount) return;
        this.settingsData.tabPreviewCount = count;
        this.tabsExpanded = false; this.renderMenu(); this.savePreferences();
      };
      input.addEventListener('change', applyCount);
      // Persist valid edits immediately, even if the settings dialog closes
      // before blur/change; allow incomplete typing until final validation.
      input.addEventListener('input', () => { if (input.value !== '' && input.validity.valid) applyCount(); });
      return input;
    } });
    this.setting.addItem({ title: '悬浮球位置', description: '重置到窗口右侧。拖动小圆球可以重新定位，松手后自动贴边。', createActionElement: () => button('重置位置', 'b3-button b3-button--outline', () => {
      this.settingsData.side = 'right'; this.settingsData.y = 0.65; this.placeOrb(); this.savePreferences();
    }) });
    this.setting.addItem({ title: '紧急退出', description: 'Alt+Shift+I 切换沉浸。每次启动保持普通界面，不自动改变系统窗口大小。', createActionElement: () => button('退出沉浸', 'b3-button b3-button--outline', () => this.leave()) });
    this.setting.addItem({ title: '思源设置', description: '打开思源原生设置。第三方非标准入口可通过菜单中的“原生工具栏”访问。', createActionElement: () => button('打开', 'b3-button b3-button--outline', () => openSetting(this.app)) });
  }

  onLayoutReady() {
    if (this.disposed || !['desktop', 'browser-desktop'].includes(this.frontend) || this.topButton?.isConnected) return;
    this.topButton = this.addTopBar({ icon: APPLE_ZOOM_ICON, title: '进入沉浸模式 · Alt+Shift+I', position: 'right', callback: () => this.toggle() });
    this.topButton?.classList.add('sim-apple-zoom');
  }

  listen(target, type, fn, options) {
    target.addEventListener(type, fn, options);
    this.cleanups.push(() => target.removeEventListener(type, fn, options));
  }

  savePreferences() {
    const snapshot = normalizeSettings(this.settingsData);
    this.pendingSave = this.pendingSave.then(() => this.saveData(STORE, snapshot)).catch(error => {
      console.error('[immersive-mode] Save failed', error);
      if (!this.disposed) showMessage('沉浸模式：设置保存失败，本次修改可能无法在重启后保留。', 5000, 'error');
    });
    return this.pendingSave;
  }

  toggle() { if (this.active) this.leave(); else this.enter(); }

  enter() {
    if (this.active || this.disposed || !this.topButton?.isConnected) return;
    try {
      this.active = true;
      this.styleElement = document.createElement('style');
      this.styleElement.id = 'sim-style';
      this.styleElement.textContent = css;
      document.head.append(this.styleElement);
      this.orb = button('', 'sim-orb', () => {
        if (this.suppressClick) { this.suppressClick = false; return; }
        if (this.menu) this.closeMenu(); else this.openMenu();
      });
      this.orb.title = '沉浸模式 · 点击打开功能 / 拖动调整位置';
      this.orb.setAttribute('aria-label', '沉浸模式功能菜单');
      this.orb.setAttribute('aria-expanded', 'false');
      this.orb.setAttribute('aria-haspopup', 'dialog');
      document.body.append(this.orb);
      document.body.classList.add('sim-active');
      this.applyTopBarSetting();
      this.topButton.title = '退出沉浸模式 · Alt+Shift+I';
      this.markLayoutRows();
      this.bindOrbDrag();
      this.placeOrb();
      this.listen(window, 'resize', () => { this.placeOrb(); this.placeMenu(); this.queueMergedTabs(); });
      this.listen(document, 'pointerdown', event => {
        if (!this.menu?.contains(event.target) && !this.orb.contains(event.target)) this.closeMenu();
        if (![...this.nativeReveals].some(el => el.contains(event.target))) this.clearNativeTools();
      }, true);
      this.listen(document, 'keydown', event => {
        if (event.key === 'Escape' && (this.menu || this.nativeReveals.size)) {
          event.preventDefault(); event.stopPropagation(); this.closeMenu(true); this.clearNativeTools();
        }
      }, true);
      // Observe chrome only: do not rescan the document on every editor keystroke.
      this.observer = new MutationObserver(records => {
        if (!records.some(record => !(record.target.nodeType === 1 ? record.target : record.target.parentElement)?.closest('.layout-tab-container, .protyle'))) return;
        if (!this.menu || this.refreshTimer) return;
        this.refreshTimer = setTimeout(() => { this.refreshTimer = null; if (this.active && this.menu) this.renderMenu(); }, 120);
      });
      document.querySelectorAll('#toolbar, #dockLeft, #dockRight, #dockBottom, .layout__center').forEach(el => this.observer.observe(el, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class', 'aria-label', 'aria-selected', 'disabled', 'data-title', 'hidden'] }));
    } catch (error) {
      this.leave();
      console.error('[immersive-mode] Enter failed', error);
      showMessage('沉浸模式初始化失败，已恢复普通界面。', 5000, 'error');
    }
  }

  markLayoutRows() {
    const center = document.querySelector('.layout__center');
    if (!center) return;
    // This is the flex row that holds the sidebar panels and center, not a sidebar itself.
    const row = center.parentElement;
    if (row && !row.classList.contains('sim-layout-row')) { row.classList.add('sim-layout-row'); this.markedRows.add(row); }
  }

  applyTopBarSetting() {
    const keep = this.active && this.isWindowsDesktop && this.settingsData.windowsTopBar;
    document.body.classList.toggle('sim-window-strip', !!(this.active && this.isWindowsDesktop));
    document.body.classList.toggle('sim-keep-topbar', !!keep);
    if (keep) this.startMergedTabs(); else this.stopMergedTabs();
    if (this.menu) this.renderMenu();
    this.placeMenu();
  }

  startMergedTabs() {
    if (!this.tabMergeObserver) {
      this.tabMergeObserver = new MutationObserver(records => {
        // Ignore editor/business-content mutations; only layout/tab/chrome changes matter.
        if (records.some(record => !(record.target.nodeType === 1 ? record.target : record.target.parentElement)?.closest('.layout-tab-container, .protyle'))) this.queueMergedTabs();
      });
      document.querySelectorAll('#toolbar, .layout__center').forEach(element => this.tabMergeObserver.observe(element, {
        childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class', 'style', 'hidden'],
      }));
      if (window.ResizeObserver) this.tabResizeObserver = new window.ResizeObserver(() => this.queueMergedTabs());
    }
    this.syncMergedTabs();
  }

  queueMergedTabs() {
    if (!this.tabMergeObserver || this.tabLayoutFrame != null) return;
    this.tabLayoutFrame = window.requestAnimationFrame(() => { this.tabLayoutFrame = null; this.syncMergedTabs(); });
  }

  syncMergedTabs() {
    if (!this.tabMergeObserver) return;
    const drag = document.querySelector('#toolbar #drag');
    const rect = drag?.getBoundingClientRect();
    const candidates = [];
    for (const wnd of document.querySelectorAll('.layout__center [data-type="wnd"]')) {
      if (wnd.closest('.fn__none, [hidden]') || window.getComputedStyle(wnd).display === 'none') continue;
      const bounds = wnd.getBoundingClientRect();
      if (!bounds.width || !bounds.height) continue;
      const row = [...wnd.children].find(element => element.classList.contains('fn__flex') && [...element.children].some(child => child.classList.contains('layout-tab-bar')));
      if (!row || row.matches('.fn__none, [hidden]')) continue;
      candidates.push({ row, wnd, weight: bounds.width });
    }
    const slots = rect ? mergedTabSlots(rect.left, Math.min(rect.right, innerWidth - 8), candidates.map(item => item.weight)) : [];
    const nextRows = new Set();
    candidates.forEach(({ row }, index) => {
      const slot = slots[index];
      if (!slot || slot.width < 1) return; // The existing page chooser remains available in tiny windows.
      nextRows.add(row);
      if (!this.mergedRows.has(row)) this.mergedRows.set(row, {
        hadClass: row.classList.contains('sim-merged-tabs'),
        props: ['--sim-tabs-left', '--sim-tabs-width'].map(key => [key, row.style.getPropertyValue(key), row.style.getPropertyPriority(key)]),
      });
      if (!row.classList.contains('sim-merged-tabs')) row.classList.add('sim-merged-tabs');
      for (const [key, value] of [['--sim-tabs-left', slot.left], ['--sim-tabs-width', slot.width]]) {
        const cssValue = `${Math.round(value * 100) / 100}px`;
        if (row.style.getPropertyValue(key) !== cssValue) row.style.setProperty(key, cssValue);
      }
    });
    for (const row of this.mergedRows.keys()) if (!nextRows.has(row)) this.restoreMergedRow(row);
    const tabTargets = this.syncTabSwitchers(nextRows);
    const targets = new Set([drag, document.getElementById('toolbar'), ...candidates.map(item => item.wnd), ...tabTargets].filter(Boolean));
    for (const target of this.tabResizeTargets) if (!targets.has(target)) this.tabResizeObserver?.unobserve(target);
    for (const target of targets) if (!this.tabResizeTargets.has(target)) this.tabResizeObserver?.observe(target);
    this.tabResizeTargets = targets;
  }

  syncTabSwitchers(rows) {
    const current = new Set();
    const resizeTargets = [];
    for (const row of rows) {
      const list = [...row.children].find(element => element.classList.contains('layout-tab-bar') && !element.classList.contains('layout-tab-bar--readonly'));
      const readonly = row.querySelector('.layout-tab-bar--readonly');
      if (!list || !readonly) continue;
      resizeTargets.push(list, readonly, ...list.children);
      const switchers = [...readonly.querySelectorAll('[data-type="more"]')];
      const visibleWidth = switchers.reduce((sum, element) => {
        const style = window.getComputedStyle(element);
        if (style.display === 'none') return sum;
        return sum + element.getBoundingClientRect().width + (parseFloat(style.marginLeft) || 0) + (parseFloat(style.marginRight) || 0);
      }, 0);
      const overflow = tabsOverflow(list.scrollWidth, list.clientWidth, visibleWidth);
      for (const element of switchers) {
        current.add(element);
        if (!this.tabSwitchers.has(element)) this.tabSwitchers.set(element, { row, hadClass: element.classList.contains('sim-tab-switch-hidden') });
        if (element.classList.contains('sim-tab-switch-hidden') !== !overflow) element.classList.toggle('sim-tab-switch-hidden', !overflow);
      }
    }
    for (const element of this.tabSwitchers.keys()) if (!current.has(element)) this.restoreTabSwitcher(element);
    return resizeTargets;
  }

  restoreTabSwitcher(element) {
    const saved = this.tabSwitchers.get(element);
    if (!saved) return;
    element.classList.toggle('sim-tab-switch-hidden', saved.hadClass);
    this.tabSwitchers.delete(element);
  }

  restoreMergedRow(row) {
    const saved = this.mergedRows.get(row);
    if (!saved) return;
    if (!saved.hadClass) row.classList.remove('sim-merged-tabs');
    for (const [key, value, priority] of saved.props) {
      if (value) row.style.setProperty(key, value, priority); else row.style.removeProperty(key);
    }
    this.mergedRows.delete(row);
    for (const [element, state] of this.tabSwitchers) if (state.row === row) this.restoreTabSwitcher(element);
  }

  stopMergedTabs() {
    this.tabMergeObserver?.disconnect(); this.tabMergeObserver = null;
    this.tabResizeObserver?.disconnect(); this.tabResizeObserver = null;
    this.tabResizeTargets.clear();
    if (this.tabLayoutFrame != null) window.cancelAnimationFrame(this.tabLayoutFrame);
    this.tabLayoutFrame = null;
    for (const row of this.mergedRows.keys()) this.restoreMergedRow(row);
    for (const element of this.tabSwitchers.keys()) this.restoreTabSwitcher(element);
  }

  bindOrbDrag() {
    const orb = this.orb;
    this.listen(orb, 'pointerdown', event => {
      if (event.button !== 0) return;
      this.suppressClick = false;
      const rect = orb.getBoundingClientRect();
      this.drag = { id: event.pointerId, x: event.clientX, y: event.clientY, left: rect.left, top: rect.top, moved: false };
      orb.setPointerCapture?.(event.pointerId);
    });
    // Listen on window as well as capturing the pointer: embedded webviews can lose
    // capture when their host forwards mouse events outside the original button.
    this.listen(window, 'pointermove', event => {
      const drag = this.drag;
      if (!drag || drag.id !== event.pointerId) return;
      const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) < 5) return;
      drag.moved = true;
      this.closeMenu();
      orb.style.left = `${clamp(drag.left + dx, 8, innerWidth - 50)}px`;
      orb.style.top = `${clamp(drag.top + dy, 8, innerHeight - 50)}px`;
    });
    const finish = event => {
      if (!this.drag || this.drag.id !== event.pointerId) return;
      const drag = this.drag;
      this.drag = null;
      if (drag.moved) {
        this.suppressClick = true;
        this.settingsData.side = parseFloat(orb.style.left) + 21 < innerWidth / 2 ? 'left' : 'right';
        this.settingsData.y = clamp(parseFloat(orb.style.top) / Math.max(1, innerHeight - 42), 0, 1);
        this.placeOrb(); this.savePreferences();
      }
      if (orb.hasPointerCapture?.(event.pointerId)) orb.releasePointerCapture(event.pointerId);
    };
    this.listen(window, 'pointerup', finish);
    this.listen(window, 'pointercancel', finish);
    this.listen(window, 'blur', () => { this.drag = null; this.placeOrb(); });
  }

  placeOrb() {
    if (!this.orb) return;
    const point = orbPosition(this.settingsData, innerWidth, innerHeight);
    this.orb.style.left = `${point.x}px`;
    this.orb.style.top = `${point.y}px`;
  }

  openMenu() {
    this.clearNativeTools();
    this.closeMenu();
    this.tabsExpanded = false;
    this.menu = document.createElement('section');
    this.menu.className = 'sim-menu';
    this.menu.setAttribute('role', 'dialog');
    this.menu.setAttribute('aria-label', '沉浸模式功能');
    this.menu.tabIndex = -1;
    document.body.append(this.menu);
    this.orb.classList.add('sim-orb--active');
    this.orb.setAttribute('aria-expanded', 'true');
    this.renderMenu();
    this.menu.querySelector('button')?.focus({ preventScroll: true });
  }

  actions() {
    return [
      ...discoverActions(document, this.topButton, this.app?.plugins)
        .filter(action => !document.body.classList.contains('sim-keep-topbar') || action.group !== 'top')
        .map(action => ({ ...action, run: () => this.invokeSource(action.element) })),
      { key: 'builtin:page-tools', title: '页面工具', icon: 'iconMore', origin: '补充', group: 'page', run: () => this.revealPageTools() },
      ...(!document.body.classList.contains('sim-keep-topbar') ? [{ key: 'builtin:toolbar', title: '原生工具栏（手动展开）', icon: 'iconMenu', origin: '补充', group: 'top', run: () => this.revealToolbar() }] : []),
      { key: 'builtin:settings', title: '思源设置', icon: 'iconSettings', origin: '补充', group: 'page', run: () => openSetting(this.app) },
    ];
  }

  renderMenu() {
    if (!this.menu) return;
    const focusedKey = document.activeElement?.dataset?.actionKey;
    const focusedTab = document.activeElement?.dataset?.tabKey;
    const focusedToggle = document.activeElement?.classList.contains('sim-tabs-toggle');
    const oldScroll = this.menu.querySelector(".sim-menu-other-scroll")?.scrollTop || 0;
    const oldTabScroll = this.menu.querySelector('.sim-tab-list')?.scrollTop || 0;
    this.menu.className = "sim-menu";
    this.menu.replaceChildren();
    const header = document.createElement("div");
    header.className = "sim-menu-header";
    const title = document.createElement("strong");
    title.textContent = "沉浸模式";
    const hint = document.createElement("small");
    hint.textContent = "Alt+Shift+I";
    header.append(title, hint);
    const tabPanel = this.createTabPanel();
    const scroll = document.createElement("div");
    scroll.className = "sim-menu-other-scroll";
    const actions = this.actions();
    const sections = ACTION_GROUPS.map(([group, title]) => ({ group, title, items: actions.filter(action => action.group === group) }));
    for (const { group, title, items } of sections) {
      if (!items.length) continue;
      const container = document.createElement('section');
      container.className = 'sim-action-group'; container.dataset.actionGroup = group; scroll.append(container);
      const heading = document.createElement("h3");
      heading.textContent = title;
      const count = document.createElement('small'); count.textContent = String(items.length); heading.append(count);
      container.append(heading);
      for (const action of items) {
        const row = document.createElement("div");
        row.className = "sim-row";
        const launch = button("", "sim-action", () => this.runAction(action));
        launch.dataset.actionKey = action.key;
        launch.title = action.title;
        launch.setAttribute("aria-label", action.title);
        const sourceIcon = action.element?.querySelector("svg use");
        const href = sourceIcon?.getAttribute("xlink:href") || sourceIcon?.getAttribute("href") || (action.icon ? `#${action.icon.replace(/^#/, "")}` : "");
        if (href?.startsWith("#")) {
          const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
          svg.setAttribute("aria-hidden", "true");
          const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
          use.setAttribute("href", href);
          svg.append(use);
          launch.append(svg);
        } else {
          const icon = document.createElement("span");
          icon.textContent = "◇";
          icon.setAttribute("aria-hidden", "true");
          launch.append(icon);
        }
        const label = document.createElement("span");
        label.textContent = action.title;
        launch.append(label);
        const origin = document.createElement("small");
        origin.className = "sim-origin";
        origin.textContent = action.origin || "补充";
        origin.title = ACTION_GROUPS.find(([key]) => key === action.group)?.[1] || '';
        row.append(launch, origin);
        container.append(row);
      }
    }
    const footer = document.createElement("div");
    footer.className = "sim-footer";
    footer.append(button("设置", "", () => {
      this.closeMenu();
      this.setting.open("沉浸模式设置");
    }), button("退出沉浸", "", () => this.leave()));
    this.menu.append(header, tabPanel, scroll, footer);
    scroll.scrollTop = oldScroll;
    tabPanel.querySelector('.sim-tab-list').scrollTop = oldTabScroll;
    this.placeMenu();
    if (focusedKey) [...this.menu.querySelectorAll('.sim-action')].find(el => el.dataset.actionKey === focusedKey)?.focus({ preventScroll: true });
    if (focusedTab) [...this.menu.querySelectorAll('.sim-tab')].find(el => el.dataset.tabKey === focusedTab)?.focus({ preventScroll: true });
    if (focusedToggle) this.menu.querySelector('.sim-tabs-toggle')?.focus({ preventScroll: true });
  }

  createTabPanel() {
    const panel = document.createElement('section'); panel.className = 'sim-menu-tabs';
    const tabs = [...document.querySelectorAll('.layout__center .layout-tab-bar:not(.layout-tab-bar--readonly) > [data-id]')];
    const heading = document.createElement('h3'); heading.textContent = '页签';
    const count = document.createElement('small'); count.textContent = String(tabs.length); heading.append(count);
    const list = document.createElement('div'); list.className = 'sim-tab-list';
    list.setAttribute('aria-label', '已打开页签');
    if (!tabs.length) { const empty = document.createElement('p'); empty.className = 'sim-empty'; empty.textContent = '暂无已打开页签'; list.append(empty); }
    const visible = this.tabsExpanded ? tabs : tabs.slice(0, this.settingsData.tabPreviewCount);
    for (const tab of visible) {
      const name = tab.querySelector('.item__text')?.textContent?.trim() || plainLabel(tab) || '未命名页面';
      const active = tab.classList.contains('item--focus');
      const select = button('', 'sim-tab', () => { this.closeMenu(); if (tab.isConnected) tab.click(); });
      select.dataset.tabKey = `${tab.closest('[data-type="wnd"]')?.dataset.id || ''}:${tab.dataset.id}`;
      select.title = name; select.setAttribute('aria-label', `切换页签：${name}`);
      select.setAttribute('aria-current', String(active));
      const marker = document.createElement('span'); marker.className = 'sim-tab-marker'; marker.textContent = active ? '●' : '○'; marker.setAttribute('aria-hidden', 'true');
      const label = document.createElement('span'); label.className = 'sim-tab-label'; label.textContent = name;
      select.append(marker, label); list.append(select);
    }
    panel.append(heading, list);
    const remaining = tabs.length - this.settingsData.tabPreviewCount;
    if (remaining > 0) {
      const toggle = button(this.tabsExpanded ? '收起页签' : `展开其余页签（${remaining}）`, 'sim-tabs-toggle', () => {
        this.tabsExpanded = !this.tabsExpanded; this.renderMenu();
        this.menu?.querySelector('.sim-tabs-toggle')?.focus({ preventScroll: true });
      });
      toggle.setAttribute('aria-expanded', String(!!this.tabsExpanded)); panel.append(toggle);
    }
    return panel;
  }

  runAction(action) {
    if (!action.keepOpen) this.closeMenu();
    try { action.run(); }
    catch (error) { console.error('[immersive-mode] Action failed', error); showMessage('该入口未能打开，可通过“原生工具栏”重试，或 Alt+Shift+I 退出沉浸。', 6000, 'error'); }
  }

  placeMenu() {
    if (!this.menu || !this.orb) return;
    const orb = this.orb.getBoundingClientRect();
    const { width, height } = this.menu.getBoundingClientRect();
    const x = this.settingsData.side === 'right' ? orb.left - width - 10 : orb.right + 10;
    this.menu.style.left = `${clamp(x, 8, innerWidth - width - 8)}px`;
    this.menu.style.top = `${clamp(orb.top - height / 2 + 21, 8, innerHeight - height - 8)}px`;
  }

  closeMenu(focusOrb = false) {
    this.menu?.remove(); this.menu = null;
    this.orb?.classList.remove('sim-orb--active');
    this.orb?.setAttribute('aria-expanded', 'false');
    if (focusOrb) this.orb?.focus({ preventScroll: true });
  }

  invokeSource(element) {
    if (!element.isConnected) { showMessage('此入口已不可用，请重新打开菜单。'); return; }
    // Keep the real node and event bubbling chain. Supply an on-screen anchor while
    // the hidden chrome measures zero; restore every own descriptor on the next frame.
    const anchor = this.orb.getBoundingClientRect();
    const restores = [];
    for (const target of [element, ...element.querySelectorAll('svg')]) {
      const descriptor = Object.getOwnPropertyDescriptor(target, 'getBoundingClientRect');
      try {
        Object.defineProperty(target, 'getBoundingClientRect', { configurable: true, value: () => anchor });
        restores.push(() => { if (descriptor) Object.defineProperty(target, 'getBoundingClientRect', descriptor); else delete target.getBoundingClientRect; });
      } catch { /* A plugin may already have a non-configurable geometry override. */ }
    }
    const restore = () => { restores.forEach(fn => fn()); this.geometryRestores.delete(restore); };
    this.geometryRestores.add(restore);
    try { element.click(); } finally { requestAnimationFrame(restore); }
  }

  revealPageTools() {
    const candidates = [...document.querySelectorAll('.layout__center .protyle:not(.fn__none) .protyle-breadcrumb')];
    const element = candidates.find(el => el.closest('.layout__wnd--active')) || candidates.find(el => !el.closest('.fn__none'));
    if (!element) { showMessage('当前页面没有可用的文档工具。'); return; }
    this.clearNativeTools(); element.classList.add('sim-page-tools'); this.nativeReveals.add(element);
    showMessage('已显示原生页面工具；点击其他位置或按 Esc 收起。', 2500);
  }

  revealToolbar() {
    if (document.body.classList.contains('sim-keep-topbar')) return;
    const element = document.getElementById('toolbar');
    if (!element) { this.leave(); return; }
    this.clearNativeTools(); element.classList.add('sim-native-tools'); this.nativeReveals.add(element);
    showMessage('已临时显示原生工具栏；点击其他位置或按 Esc 收起。', 2500);
  }

  clearNativeTools() {
    for (const element of this.nativeReveals) element.classList.remove('sim-page-tools', 'sim-native-tools');
    this.nativeReveals.clear();
  }

  leave() {
    this.active = false;
    this.stopMergedTabs();
    this.observer?.disconnect(); this.observer = null;
    clearTimeout(this.refreshTimer); this.refreshTimer = null;
    for (const cleanup of this.cleanups || []) { try { cleanup(); } catch (error) { console.warn(error); } }
    this.cleanups = [];
    this.closeMenu();
    this.clearNativeTools();
    for (const restore of this.geometryRestores) restore();
    for (const row of this.markedRows) row.classList.remove('sim-layout-row');
    this.markedRows.clear();
    this.orb?.remove(); this.orb = null;
    this.styleElement?.remove(); this.styleElement = null;
    this.drag = null; this.suppressClick = false;
    document.body.classList.remove('sim-active', 'sim-keep-topbar', 'sim-window-strip');
    if (this.topButton) this.topButton.title = '进入沉浸模式 · Alt+Shift+I';
  }

  onunload() {
    this.disposed = true;
    this.leave();
    this.topButton?.remove(); this.topButton = null;
  }
};
