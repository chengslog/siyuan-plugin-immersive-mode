const { Plugin, Setting, getFrontend, getBackend, showMessage } = require('siyuan');
const css = require('./styles.css');
const uiCss = require('./ui.css');
const { name: pluginName, version: pluginVersion } = require('../plugin.json');
const { ACTION_GROUPS, normalizeSettings, clamp, orbPosition, plainLabel, stripShortcuts, discoverActions, tabsOverflow } = require('./core');
const { ENTER_ICON, EXIT_ICON } = require('./icons');
const STORE = 'preferences.json';
const CONTROL_ICONS = {
  settings: 'iconSettings', minimize: 'iconMin', maximize: 'iconMax', restore: 'iconRestore', close: 'iconClose',
};

function button(label, className, callback) {
  const element = document.createElement('button');
  element.type = 'button';
  element.className = className;
  element.textContent = label;
  element.addEventListener('click', callback);
  return element;
}

function setButtonIcon(element, label, icon) {
  element.title = label;
  element.setAttribute('aria-label', label);
  element.innerHTML = icon === 'exit' ? EXIT_ICON : `<svg aria-hidden="true" fill="currentColor"><use href="#${CONTROL_ICONS[icon]}" xlink:href="#${CONTROL_ICONS[icon]}"></use></svg>`;
}

function iconButton(key, label, icon, callback) {
  const element = button('', 'sim-window-button', callback);
  element.dataset.controlKey = key;
  setButtonIcon(element, label, icon);
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
    this.actionPositions = new WeakMap();
    this.knownMenuSources = new WeakSet();
    this.childMenuPositions = new Map();
    this.defaultPageTools = new Set();
    this.geometryRestores = new Set();
    this.markedRows = new Set();
    this.mergedRows = new Map();
    this.tabSwitchers = new Map();
    this.tabResizeTargets = new Set();
    this.topbarOverflow = new Map();
    try { this.settingsData = normalizeSettings(await this.loadData(STORE)); }
    catch (error) { console.warn('[immersive-mode] Settings unavailable', error); }
    if (this.disposed) return;
    this.frontend = getFrontend();
    if (!['desktop', 'browser-desktop'].includes(this.frontend)) return;
    const backend = typeof getBackend === 'function' ? getBackend() : '';
    this.isDesktopClient = this.frontend === 'desktop' && ['windows', 'linux', 'darwin'].includes(backend);
    this.isWindowsDesktop = this.isDesktopClient && /^Win/i.test(navigator.platform) && backend === 'windows';
    this.addCommand({ langKey: 'toggleImmersive', langText: '切换沉浸模式', hotkey: '⌥⇧I', callback: () => this.toggle() });
    this.uiStyle = document.createElement('style'); this.uiStyle.id = 'sim-ui-style'; this.uiStyle.textContent = uiCss; document.head.append(this.uiStyle);
    this.setting = new Setting({ width: '520px', height: 'fit-content' });
    const openSettings = this.setting.open.bind(this.setting);
    this.setting.open = (...args) => {
      openSettings(...args);
      this.setting.dialog?.element?.classList.add('sim-settings-dialog');
      const content = this.setting.dialog?.element?.querySelector('.b3-dialog__content');
      if (content) {
        const version = document.createElement('div'); version.className = 'sim-settings-version';
        version.textContent = `${pluginName} · v${pluginVersion}`; content.append(version);
      }
    };
    this.setting.addItem({ title: 'Windows：保留顶部工具栏', description: '工具与页签保留在顶部，仅 Windows 客户端生效。', createActionElement: () => {
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
    this.setting.addItem({ title: '资源打开时进入沉浸模式', description: '新开资源页签时自动进入，默认关闭。', createActionElement: () => {
      const toggle = document.createElement('input'); toggle.type = 'checkbox'; toggle.className = 'b3-switch';
      toggle.setAttribute('aria-label', '资源打开时进入沉浸模式');
      toggle.checked = this.settingsData.autoEnterOnResourceOpen;
      toggle.addEventListener('change', () => {
        this.settingsData.autoEnterOnResourceOpen = toggle.checked;
        this.configureResourceAutoEnter(); this.savePreferences();
      });
      return toggle;
    } });
    this.setting.addItem({ title: '页签默认展示数量', description: '悬浮菜单显示 1–20 个页签，超出折叠。', createActionElement: () => {
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
  }

  onLayoutReady() {
    if (this.disposed || !['desktop', 'browser-desktop'].includes(this.frontend) || this.topButton?.isConnected) return;
    this.topButton = this.addTopBar({
      icon: ENTER_ICON, title: '进入沉浸模式 · Alt+Shift+I', position: 'right',
      callback: event => {
        // SiYuan 3.8.2's delegated toolbar handler interprets a bubbling
        // PointerEvent.detail as an element id and dereferences a null result.
        event?.stopPropagation?.();
        this.deferTopButtonIcon = true;
        try { this.toggle(); } finally { this.deferTopButtonIcon = false; }
      },
    });
    this.topButton?.classList.add('sim-immersive-entry');
    this.updateTopButton();
    this.configureResourceAutoEnter();
  }

  updateTopButton() {
    if (!this.topButton) return;
    this.topButton.removeAttribute('title');
    this.topButton.classList.add('ariaLabel');
    this.topButton.setAttribute('aria-label', `${this.active ? '退出' : '进入'}沉浸模式 · Alt+Shift+I`);
    const updateIcon = () => {
      this.topButtonIconFrame = null;
      if (this.topButton?.isConnected) this.topButton.innerHTML = this.active ? EXIT_ICON : ENTER_ICON;
    };
    if (this.deferTopButtonIcon) {
      if (this.topButtonIconFrame != null) window.cancelAnimationFrame(this.topButtonIconFrame);
      this.topButtonIconFrame = window.requestAnimationFrame(updateIcon);
    } else {
      if (this.topButtonIconFrame != null) window.cancelAnimationFrame(this.topButtonIconFrame);
      updateIcon();
    }
  }

  configureResourceAutoEnter() {
    this.resourceObserver?.disconnect(); this.resourceObserver = null;
    if (this.resourceEnterFrame != null) window.cancelAnimationFrame(this.resourceEnterFrame);
    this.resourceEnterFrame = null;
    this.pendingResourceTabs = new Set();
    if (this.disposed || !this.settingsData.autoEnterOnResourceOpen || !this.topButton?.isConnected) return;
    const center = document.querySelector('.layout__center');
    if (!center) return;
    const selector = '.layout-tab-bar:not(.layout-tab-bar--readonly) > [data-id]';
    this.knownResourceTabs = new WeakSet(center.querySelectorAll(selector));
    this.resourceObserver = new MutationObserver(records => {
      for (const record of records) {
        const target = record.target;
        // Only tab/layout insertions matter; never rescan editor text changes.
        if (target.closest('.layout-tab-container, .protyle')) continue;
        for (const node of record.addedNodes) {
          if (node.nodeType !== 1) continue;
          const tabs = node.matches(selector) ? [node] : node.querySelectorAll(selector);
          for (const tab of tabs) {
            if (!this.knownResourceTabs.has(tab)) {
              this.knownResourceTabs.add(tab);
              if (!this.active) this.pendingResourceTabs.add(tab);
            }
          }
        }
      }
      if (!this.pendingResourceTabs.size || this.active || this.resourceEnterFrame != null) return;
      this.resourceEnterFrame = window.requestAnimationFrame(() => {
        this.resourceEnterFrame = null;
        const opened = [...this.pendingResourceTabs].some(tab => center.contains(tab) && tab.matches(selector));
        this.pendingResourceTabs.clear();
        if (opened && !this.disposed && this.settingsData.autoEnterOnResourceOpen && !this.active) this.enter();
      });
    });
    this.resourceObserver.observe(center, { childList: true, subtree: true });
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
      discoverActions(document, this.topButton, this.app?.plugins, this.actionPositions);
      this.active = true;
      this.styleElement = document.createElement('style');
      this.styleElement.id = 'sim-style';
      this.styleElement.textContent = css;
      document.head.append(this.styleElement);
      this.orb = button('', 'sim-orb', () => {
        if (this.suppressClick) { this.suppressClick = false; return; }
        if (this.menu && this.menuOpenedByHover) {
          this.menuOpenedByHover = false;
          this.menu.querySelector('button')?.focus({ preventScroll: true });
          return;
        }
        if (this.menu) this.closeMenu(); else this.openMenu();
      });
      this.orb.title = '沉浸模式 · 悬停展开功能 / 拖动调整位置';
      this.orb.setAttribute('aria-label', '沉浸模式功能菜单');
      this.orb.setAttribute('aria-expanded', 'false');
      this.orb.setAttribute('aria-haspopup', 'dialog');
      document.body.append(this.orb);
      this.listen(this.orb, 'pointerenter', event => {
        if (event.pointerType !== 'mouse' || event.buttons || this.drag || this.menu) return;
        this.openMenu(false);
        this.menuOpenedByHover = true;
      });
      if (this.isDesktopClient) {
        this.dragRegion = document.createElement('div');
        this.dragRegion.className = 'sim-window-drag';
        this.dragRegion.title = '拖动移动窗口';
        this.dragRegion.setAttribute('aria-hidden', 'true');
        document.body.append(this.dragRegion);
      }
      document.body.classList.add('sim-active');
      this.applyTopBarSetting();
      this.showDefaultPageTools();
      this.updateTopButton();
      this.markLayoutRows();
      this.bindOrbDrag();
      this.placeOrb();
      this.listen(window, 'resize', () => { this.placeOrb(); this.placeMenu(); this.queueMergedTabs(); });
      this.listen(document, 'pointerdown', event => {
        if (!this.menu?.contains(event.target) && !this.windowActions?.contains(event.target) && !this.submenu?.contains(event.target) && !this.orb.contains(event.target)) this.closeMenu();
        if (![...this.nativeReveals].some(el => el.contains(event.target))) this.clearNativeTools(true);
      }, true);
      this.listen(document, 'keydown', event => {
        if (event.key === 'Escape' && this.submenu) {
          // SiYuan owns deeper nested menus and their keyboard navigation.
          if (this.submenu.querySelector('.b3-menu__item--show')) return;
          event.preventDefault(); event.stopPropagation(); this.closeSubmenu(true); return;
        }
        if (event.key === 'Escape' && (this.menu || this.nativeReveals.size)) {
          event.preventDefault(); event.stopPropagation(); this.closeMenu(true); this.clearNativeTools(true);
        }
      }, true);
      // Observe chrome only: do not rescan the document on every editor keystroke.
      this.observer = new MutationObserver(records => {
        // Refresh only sync's tooltip, avoiding a render/hover/request loop.
        if (records.every(record => record.target.id === 'barSync' && record.type === 'attributes' && ['aria-label', 'data-title', 'title'].includes(record.attributeName))) {
          this.updateSyncTip(); return;
        }
        if (!records.some(record => !(record.target.nodeType === 1 ? record.target : record.target.parentElement)?.closest('.layout-tab-container, .protyle'))) return;
        this.syncDefaultPageTools();
        this.updateWindowButtons();
        if (!this.menu || this.refreshTimer) return;
        this.refreshTimer = setTimeout(() => { this.refreshTimer = null; if (this.active && this.menu) this.renderMenu(); }, 120);
      });
      document.querySelectorAll('#toolbar, #dockLeft, #dockRight, #dockBottom, .layout__center').forEach(el => this.observer.observe(el, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class', 'aria-label', 'aria-selected', 'aria-disabled', 'disabled', 'data-title', 'title', 'hidden'] }));
      if (this.isDesktopClient) {
        this.windowStateObserver = new MutationObserver(() => this.updateWindowButtons());
        this.windowStateObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });
      }
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
    this.clearNativeTools(true);
    document.body.classList.toggle('sim-window-strip', !!keep);
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

  fitTopbarTools(pageLeft) {
    const toolbar = document.getElementById('toolbar');
    if (!toolbar) return;
    const style = window.getComputedStyle(toolbar);
    const gap = parseFloat(style.columnGap) || 0;
    let right = toolbar.getBoundingClientRect().left + (parseFloat(style.paddingLeft) || 0);
    for (const child of toolbar.children) {
      if (child.id === 'drag') break;
      if (child.matches('.fn__none, [hidden]')) continue;
      const hidden = child.classList.contains('sim-topbar-overflow');
      const childStyle = window.getComputedStyle(child);
      const width = hidden ? this.topbarOverflow.get(child) : child.getBoundingClientRect().width + (parseFloat(childStyle.marginLeft) || 0) + (parseFloat(childStyle.marginRight) || 0);
      if (!width) continue;
      right += width + gap;
      const overflow = right > pageLeft;
      if (overflow && !hidden) { this.topbarOverflow.set(child, width); child.classList.add('sim-topbar-overflow'); }
      else if (!overflow && hidden) { child.classList.remove('sim-topbar-overflow'); this.topbarOverflow.delete(child); }
    }
  }

  syncMergedTabs() {
    if (!this.tabMergeObserver) return;
    const drag = document.querySelector('#toolbar #drag');
    const candidates = [];
    for (const wnd of document.querySelectorAll('.layout__center [data-type="wnd"]')) {
      if (wnd.closest('.fn__none, [hidden]') || window.getComputedStyle(wnd).display === 'none') continue;
      const bounds = wnd.getBoundingClientRect();
      if (!bounds.width || !bounds.height) continue;
      const row = [...wnd.children].find(element => element.classList.contains('fn__flex') && [...element.children].some(child => child.classList.contains('layout-tab-bar')));
      if (!row || row.matches('.fn__none, [hidden]')) continue;
      const page = wnd.querySelector(':scope > .layout-tab-container');
      const pageRect = page?.getBoundingClientRect();
      candidates.push({ row, wnd, page, bounds: pageRect?.width ? pageRect : bounds });
    }
    if (candidates.length) this.fitTopbarTools(Math.min(...candidates.map(item => item.bounds.left)));
    const rect = drag?.getBoundingClientRect();
    candidates.sort((a, b) => a.bounds.left - b.bounds.left || Number(b.wnd.classList.contains('layout__wnd--active')) - Number(a.wnd.classList.contains('layout__wnd--active')));
    const slots = candidates.map(({ bounds }, index) => {
      if (index && bounds.left === candidates[index - 1].bounds.left) return null;
      const next = candidates.slice(index + 1).find(item => item.bounds.left > bounds.left);
      const end = Math.min(bounds.right, next ? next.bounds.left - 4 : innerWidth - 8, rect ? rect.right - 48 : innerWidth - 8);
      return { left: bounds.left, width: Math.max(0, end - bounds.left) };
    });
    const nextRows = new Set();
    candidates.forEach(({ row }, index) => {
      const slot = slots[index];
      if (!slot || slot.width < 1) return; // Never place tabs over native tools in a crowded toolbar.
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
    const targets = new Set([drag, document.getElementById('toolbar'), ...candidates.flatMap(item => [item.wnd, item.page]), ...tabTargets].filter(Boolean));
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
    for (const element of this.topbarOverflow.keys()) element.classList.remove('sim-topbar-overflow');
    this.topbarOverflow.clear();
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

  openMenu(focus = true) {
    this.clearNativeTools(true);
    this.closeMenu();
    this.tabsExpanded = false;
    this.menu = document.createElement('section');
    this.menu.className = 'sim-menu';
    this.menu.setAttribute('role', 'dialog');
    this.menu.setAttribute('aria-label', '沉浸模式功能');
    this.menu.tabIndex = -1;
    this.menu.addEventListener('scroll', () => { this.placeSubmenu(); this.updateSyncTip(); }, true);
    // Native menus lock wheel events outside their own DOM. Allow the primary
    // card to scroll while a child card is open, without changing host hooks.
    this.menu.addEventListener('wheel', event => { if (this.submenu) event.stopPropagation(); }, { passive: true });
    document.body.append(this.menu);
    this.orb.classList.add('sim-orb--active');
    this.orb.setAttribute('aria-expanded', 'true');
    this.renderMenu();
    if (focus) this.menu.querySelector('button')?.focus({ preventScroll: true });
  }

  actions() {
    return [
      ...discoverActions(document, this.topButton, this.app?.plugins, this.actionPositions)
        .filter(action => !document.body.classList.contains('sim-keep-topbar') || action.group !== 'top' || action.element.closest('.sim-topbar-overflow'))
        .map(action => ({ ...action, hasSubmenu: action.hasSubmenu || this.knownMenuSources.has(action.element), run: () => this.invokeSource(action.element) })),
      ...(!document.body.classList.contains('sim-keep-topbar') ? [{ key: 'builtin:toolbar', title: '原生工具栏（手动展开）', icon: 'iconMenu', origin: '补充', group: 'top', run: () => this.revealToolbar() }] : []),
    ];
  }

  renderMenu() {
    if (!this.menu) return;
    this.hideSyncTip();
    this.cancelSubmenuHover();
    const focusedKey = document.activeElement?.dataset?.actionKey;
    const focusedControl = document.activeElement?.dataset?.controlKey;
    const focusedTab = document.activeElement?.dataset?.tabKey;
    const focusedToggle = document.activeElement?.classList.contains('sim-tabs-toggle');
    const oldScroll = this.menu.querySelector(".sim-menu-other-scroll")?.scrollTop || 0;
    this.menu.className = "sim-menu";
    this.menu.replaceChildren();
    const header = document.createElement("div");
    header.className = "sim-menu-header";
    const title = document.createElement("strong");
    title.textContent = "Immersive 沉浸模式";
    header.append(title);
    const keepTopbar = this.isWindowsDesktop && this.settingsData.windowsTopBar;
    const tabPanel = keepTopbar ? null : this.createTabPanel();
    const scroll = document.createElement("div");
    scroll.className = "sim-menu-other-scroll";
    if (tabPanel) scroll.append(tabPanel);
    scroll.addEventListener('scroll', () => this.closeSubmenu(), { passive: true });
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
        const dock = action.element?.classList.contains('dock__item');
        if (dock) {
          row.classList.add('sim-row--dock');
          row.classList.toggle('sim-row--active', action.element.classList.contains('dock__item--active'));
          row.classList.toggle('sim-row--activefocus', action.element.classList.contains('dock__item--activefocus'));
        }
        const launch = button("", `sim-action${action.hasSubmenu ? ' sim-action--submenu' : ''}`, event => {
          event.stopPropagation();
          if (action.mayOpenMenu) this.openSubmenu(action); else this.runAction(action);
        });
        launch.dataset.actionKey = action.key;
        if (action.element?.id !== 'barSync') launch.title = action.title;
        launch.setAttribute("aria-label", action.title);
        if (dock) launch.setAttribute('aria-pressed', String(action.element.matches('.dock__item--active, .dock__item--activefocus')));
        if (action.hasSubmenu) {
          launch.setAttribute('aria-haspopup', 'dialog');
          launch.setAttribute('aria-expanded', String(this.submenuAction?.key === action.key));
        }
        row.addEventListener('pointerenter', event => {
          if (event.pointerType !== 'mouse' || event.buttons || this.drag) return;
          this.cancelSubmenuHover();
          // Entering a different item dismisses the previous card even when
          // this item is a direct action. Leaving toward the child does not.
          if (this.submenuAction && this.submenuAction.key !== action.key) this.closeSubmenu();
          if (action.element?.id === 'barSync') this.showSyncTip(launch, action.element);
          if (!action.hasSubmenu) return;
          this.submenuHoverTimer = setTimeout(() => {
            this.submenuHoverTimer = null;
            if (this.active && row.isConnected && !this.drag) this.openSubmenu(action, true);
          }, 180);
        });
        row.addEventListener('pointerleave', () => { this.cancelSubmenuHover(); if (action.element?.id === 'barSync') this.hideSyncTip(); });
        if (action.element?.id === 'barSync') {
          launch.addEventListener('focus', () => this.showSyncTip(launch, action.element));
          launch.addEventListener('blur', () => this.hideSyncTip());
        }
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
        label.className = 'sim-action-label';
        label.textContent = action.title;
        launch.append(label);
        if (action.hasSubmenu) {
          const arrow = document.createElement('span');
          arrow.className = 'sim-submenu-chevron';
          arrow.textContent = '›';
          arrow.setAttribute('aria-hidden', 'true');
          launch.append(arrow);
        }
        row.append(launch);
        container.append(row);
      }
    }
    const settingsRow = document.createElement('div');
    settingsRow.className = 'sim-row sim-plugin-settings';
    const settings = button('', 'sim-action', () => { this.closeMenu(); this.setting.open('Immersive 沉浸模式设置'); });
    settings.dataset.actionKey = 'builtin:plugin-settings';
    setButtonIcon(settings, '插件设置', 'settings');
    const settingsLabel = document.createElement('span'); settingsLabel.textContent = '插件设置';
    settings.append(settingsLabel); settingsRow.append(settings); scroll.append(settingsRow);
    settingsRow.addEventListener('pointerenter', event => { if (event.pointerType === 'mouse' && !event.buttons) this.closeSubmenu(); });
    this.windowActions?.remove();
    this.windowActions = null;
    this.menu.append(header);
    this.menu.append(scroll);
    if (!keepTopbar) {
      this.menu.classList.add('sim-menu--with-control-dock');
      this.menu.append(this.createWindowActions());
    }
    this.updateWindowButtons();
    scroll.scrollTop = oldScroll;
    this.placeMenu();
    if (this.submenuAction) {
      const current = actions.find(action => action.key === this.submenuAction.key);
      if (current) this.submenuAction = current; else this.closeSubmenu();
    }
    if (focusedKey) [...this.menu.querySelectorAll('.sim-action')].find(el => el.dataset.actionKey === focusedKey)?.focus({ preventScroll: true });
    if (focusedTab) [...this.menu.querySelectorAll('.sim-tab')].find(el => el.dataset.tabKey === focusedTab)?.focus({ preventScroll: true });
    if (focusedToggle) this.menu.querySelector('.sim-tabs-toggle')?.focus({ preventScroll: true });
    if (focusedControl) this.windowActions?.querySelector(`[data-control-key="${focusedControl}"]`)?.focus({ preventScroll: true });
  }

  createWindowActions() {
    const actions = document.createElement('div');
    actions.className = 'sim-window-actions sim-control-dock';
    actions.setAttribute('role', 'toolbar'); actions.setAttribute('aria-label', '窗口与沉浸模式控制');
    actions.append(iconButton('exit', '退出沉浸', 'exit', () => this.leave()));
    if (this.isDesktopClient) {
      actions.append(
        iconButton('minimize', '最小化', 'minimize', () => this.invokeWindowControl('minWindow')),
        iconButton('maximize', '最大化', 'maximize', () => this.invokeWindowControl(document.body.classList.contains('body--maximize') ? 'restoreWindow' : 'maxWindow')),
        iconButton('close', '关闭窗口', 'close', () => this.invokeWindowControl('closeWindow')));
    }
    this.windowActions = actions;
    actions.addEventListener('pointerenter', event => { if (event.pointerType === 'mouse' && !event.buttons) this.closeSubmenu(); });
    return actions;
  }

  updateWindowButtons() {
    if (!this.windowActions || !this.isDesktopClient) return;
    const maximized = document.body.classList.contains('body--maximize');
    const maximize = this.windowActions.querySelector('[data-control-key="maximize"]');
    if (maximize) setButtonIcon(maximize, maximized ? '还原' : '最大化', maximized ? 'restore' : 'maximize');
    for (const [key, id] of [['minimize', 'minWindow'], ['maximize', maximized ? 'restoreWindow' : 'maxWindow'], ['close', 'closeWindow']]) {
      const control = this.windowActions.querySelector(`[data-control-key="${key}"]`);
      const source = document.getElementById(id);
      if (control) control.disabled = !source || source.matches('[disabled], [aria-disabled="true"]');
    }
  }

  invokeWindowControl(id) {
    if (!this.isDesktopClient) return;
    const source = document.getElementById(id);
    if (!source || source.matches('[disabled], [aria-disabled="true"]')) return;
    // Proxy a click only; native controls keep their parent, order and handlers.
    this.closeMenu();
    source.click();
  }

  cancelSubmenuHover() {
    clearTimeout(this.submenuHoverTimer); this.submenuHoverTimer = null;
  }

  showSyncTip(anchor, source) {
    if (this.syncTipAnchor === anchor) return;
    this.hideSyncTip();
    this.syncTipAnchor = anchor; this.syncTipSource = source;
    this.syncTip = document.createElement('div');
    this.syncTip.className = 'sim-sync-tip'; this.syncTip.id = 'sim-sync-tip';
    this.syncTip.setAttribute('role', 'tooltip');
    anchor.setAttribute('aria-describedby', this.syncTip.id);
    document.body.append(this.syncTip);
    this.updateSyncTip();
    // Reuse SiYuan's read-only info request; never trigger its sync click.
    source.dispatchEvent(new window.MouseEvent('mouseenter'));
  }

  updateSyncTip() {
    if (!this.syncTip || !this.syncTipAnchor?.isConnected) return;
    const source = this.syncTipSource;
    const raw = source.getAttribute('aria-label') || source.getAttribute('data-title') || source.title || '暂无同步信息';
    const parser = document.createElement('template');
    parser.innerHTML = raw.replace(/<br\s*\/?\s*>/gi, '\n');
    this.syncTip.textContent = stripShortcuts(parser.content.textContent || '').trim() || '暂无同步信息';
    const rect = this.syncTipAnchor.getBoundingClientRect();
    const bounds = this.syncTip.getBoundingClientRect();
    const left = this.settingsData.side === 'right' ? this.menu.getBoundingClientRect().left - bounds.width - 6 : this.menu.getBoundingClientRect().right + 6;
    this.syncTip.style.left = `${clamp(left, 8, innerWidth - bounds.width - 8)}px`;
    this.syncTip.style.top = `${clamp(rect.top, 8, innerHeight - bounds.height - 8)}px`;
  }

  hideSyncTip() {
    this.syncTipAnchor?.removeAttribute('aria-describedby');
    this.syncTip?.remove(); this.syncTip = null; this.syncTipAnchor = null; this.syncTipSource = null;
  }

  createTabPanel() {
    const panel = document.createElement('section'); panel.className = 'sim-menu-tabs';
    panel.addEventListener('pointerenter', event => { if (event.pointerType === 'mouse' && !event.buttons) this.closeSubmenu(); });
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

  openSubmenu(action, fromHover = false) {
    this.cancelSubmenuHover();
    if (!action?.mayOpenMenu) return this.runAction(action);
    if (this.submenuAction?.key === action.key) {
      if (fromHover) return;
      if (this.submenuOpenedByHover) { this.submenuOpenedByHover = false; return; }
      this.closeSubmenu(true); return;
    }
    this.closeSubmenu();
    this.submenuAction = action;
    this.submenuOpenedByHover = fromHover;
    this.menusBeforeAction = new Set(this.visibleNativeMenus());
    this.dialogsBeforeAction = new Set(document.querySelectorAll('.b3-dialog, dialog[open], [role="dialog"]'));
    this.nativeMenuObserver = new MutationObserver(records => {
      if (records.some(record => {
        const element = record.target.nodeType === 1 ? record.target : record.target.parentElement;
        return element === document.body || element?.closest('.b3-menu, .b3-dialog, dialog');
      })) this.syncSubmenu();
    });
    this.nativeMenuObserver.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'hidden'] });
    // Invoke the original entry ONCE. It creates the real menu (including its
    // disabled/check states and nested handlers), or opens its original panel.
    try {
      const anchor = this.menuActionElement(action.key)?.getBoundingClientRect();
      this.invokeSource(action.element, anchor);
      this.syncSubmenu();
      if (this.submenuAction && !this.submenu) this.submenuTimer = setTimeout(() => {
        this.submenuTimer = null;
        if (!this.submenu && this.submenuAction) this.closeMenu();
      }, 1500);
    } catch (error) {
      this.closeMenu();
      console.error('[immersive-mode] Native menu failed', error);
      showMessage('该入口未能打开，可通过原生工具栏重试。', 5000, 'error');
    }
  }

  menuActionElement(key) {
    return [...(this.menu?.querySelectorAll('[data-action-key]') || [])].find(element => element.dataset.actionKey === key);
  }

  visibleNativeMenus() {
    return [...document.querySelectorAll('.b3-menu')].filter(element => {
      if (element.closest('.fn__none, .fn__hidden, [hidden], .protyle, .layout__center')) return false;
      const style = window.getComputedStyle(element);
      return style.display !== 'none' && style.visibility !== 'hidden';
    });
  }

  syncSubmenu() {
    if (!this.menu || !this.submenuAction) return;
    const visible = this.visibleNativeMenus();
    if (this.submenu) {
      if (!visible.includes(this.submenu)) { this.closeSubmenu(false, false); return; }
      this.placeSubmenu();
      return;
    }
    const element = visible.find(menu => !this.menusBeforeAction.has(menu));
    if (!element) {
      const dialog = [...document.querySelectorAll('.b3-dialog, dialog[open], [role="dialog"]')]
        .find(node => !this.dialogsBeforeAction.has(node));
      if (dialog) this.closeMenu();
      return;
    }
    clearTimeout(this.submenuTimer); this.submenuTimer = null;
    this.submenu = element;
    this.knownMenuSources.add(this.submenuAction.element);
    this.submenuStyle = ['--sim-submenu-left', '--sim-submenu-top'].map(key => [key, element.style.getPropertyValue(key), element.style.getPropertyPriority(key)]);
    this.submenuHadClass = element.classList.contains('sim-native-submenu');
    element.classList.add('sim-native-submenu');
    this.nativeMenuScrollHandler = () => this.placeSubmenu();
    element.addEventListener('scroll', this.nativeMenuScrollHandler, true);
    this.menuActionElement(this.submenuAction.key)?.setAttribute('aria-expanded', 'true');
    this.placeSubmenu();
  }

  closeSubmenu(focusParent = false, dismiss = true) {
    this.cancelSubmenuHover();
    this.submenuOpenedByHover = false;
    const key = this.submenuAction?.key;
    const element = this.submenu;
    this.nativeMenuObserver?.disconnect(); this.nativeMenuObserver = null;
    clearTimeout(this.submenuTimer); this.submenuTimer = null;
    this.submenu = null; this.submenuAction = null;
    this.menusBeforeAction = null; this.dialogsBeforeAction = null;
    if (element) {
      element.removeEventListener('scroll', this.nativeMenuScrollHandler, true);
      if (!this.submenuHadClass) element.classList.remove('sim-native-submenu');
      for (const [prop, value, priority] of this.submenuStyle || []) {
        if (value) element.style.setProperty(prop, value, priority); else element.style.removeProperty(prop);
      }
      // Never remove/reparent the host's menu element. Let its owner clean up
      // callbacks, scroll locks and reusable menu state.
      const owner = Object.values(window.siyuan?.menus || {}).find(menu => menu?.element === element);
      if (dismiss && owner?.remove) owner.remove();
    }
    this.nativeMenuScrollHandler = null;
    for (const [child, saved] of this.childMenuPositions) {
      if (!saved.hadClass) child.classList.remove('sim-child-positioned');
      if (saved.value) child.style.setProperty('--sim-child-top', saved.value, saved.priority);
      else child.style.removeProperty('--sim-child-top');
    }
    this.childMenuPositions.clear();
    this.submenuStyle = null;
    this.menuActionElement(key)?.setAttribute('aria-expanded', 'false');
    if (focusParent) this.menuActionElement(key)?.focus({ preventScroll: true });
  }

  placeMenu() {
    if (!this.menu || !this.orb) return;
    const orb = this.orb.getBoundingClientRect();
    const { width, height } = this.menu.getBoundingClientRect();
    const x = this.settingsData.side === 'right' ? orb.left - width - 10 : orb.right + 10;
    const left = clamp(x, 8, innerWidth - width - 8);
    const top = clamp(orb.top - height / 2 + 21, 8, innerHeight - height - 8);
    this.menu.style.left = `${left}px`;
    this.menu.style.top = `${top}px`;
    this.placeSubmenu();
    this.updateSyncTip();
  }

  placeSubmenu() {
    if (!this.submenu || !this.menu) return;
    const primary = this.menu.getBoundingClientRect();
    const { width, height } = this.submenu.getBoundingClientRect();
    const gap = 8;
    const preferRight = this.settingsData.side === 'left';
    let x = preferRight ? primary.right + gap : primary.left - width - gap;
    if (x < 8 || x + width > innerWidth - 8) x = preferRight ? primary.left - width - gap : primary.right + gap;
    const anchor = this.menuActionElement(this.submenuAction?.key)?.getBoundingClientRect();
    const values = [['--sim-submenu-left', clamp(x, 8, innerWidth - width - 8)],
      ['--sim-submenu-top', clamp(anchor?.top || primary.top, 8, innerHeight - height - 8)]];
    for (const [prop, value] of values) {
      const pixel = `${Math.round(value)}px`;
      if (this.submenu.style.getPropertyValue(prop) !== pixel) this.submenu.style.setProperty(prop, pixel);
    }
    // Host nested menus also need to fit above the viewport bottom. Keep their
    // native horizontal placement and handlers; only constrain the vertical edge.
    for (const child of this.submenu.querySelectorAll('.b3-menu__submenu')) {
      const rect = child.getBoundingClientRect();
      if (!rect.height || window.getComputedStyle(child).display === 'none') continue;
      if (!this.childMenuPositions.has(child)) this.childMenuPositions.set(child, {
        hadClass: child.classList.contains('sim-child-positioned'),
        value: child.style.getPropertyValue('--sim-child-top'), priority: child.style.getPropertyPriority('--sim-child-top'),
      });
      const parentTop = child.parentElement.getBoundingClientRect().top;
      const top = `${Math.round(clamp(parentTop, 8, innerHeight - rect.height - 8))}px`;
      if (!child.classList.contains('sim-child-positioned')) child.classList.add('sim-child-positioned');
      if (child.style.getPropertyValue('--sim-child-top') !== top) child.style.setProperty('--sim-child-top', top);
    }
  }

  closeMenu(focusOrb = false) {
    this.hideSyncTip();
    this.menu?.remove(); this.menu = null;
    this.windowActions?.remove();
    this.windowActions = null;
    this.closeSubmenu();
    this.menuOpenedByHover = false;
    this.orb?.classList.remove('sim-orb--active');
    this.orb?.setAttribute('aria-expanded', 'false');
    if (focusOrb) this.orb?.focus({ preventScroll: true });
  }

  invokeSource(element, anchor = this.orb.getBoundingClientRect()) {
    if (!element.isConnected) { showMessage('此入口已不可用，请重新打开菜单。'); return; }
    // Keep the real node and event bubbling chain. Supply an on-screen anchor while
    // the hidden chrome measures zero; restore every own descriptor on the next frame.
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
    const element = this.findPageTools();
    if (!element) { showMessage('当前页面没有可用的文档工具。'); return; }
    this.clearNativeTools(false); element.classList.add('sim-page-tools'); this.nativeReveals.add(element);
    showMessage('已显示原生页面工具；点击其他位置或按 Esc 收起。', 2500);
  }

  findPageTools() {
    const candidates = [...document.querySelectorAll('.layout__center .protyle:not(.fn__none) .protyle-breadcrumb')]
      .filter(element => !element.closest('.fn__none, [hidden]'));
    return candidates.find(element => element.closest('.layout__wnd--active')) || candidates[0];
  }

  showDefaultPageTools() {
    const element = this.findPageTools();
    if (!element) return;
    element.classList.add('sim-page-tools');
    this.nativeReveals.add(element);
    this.defaultPageTools.add(element);
  }

  syncDefaultPageTools() {
    if (!this.active) return;
    // A deliberately revealed toolbar/page tool takes precedence until it is
    // dismissed, so editor mutations do not unexpectedly steal the surface.
    if ([...this.nativeReveals].some(element => !this.defaultPageTools.has(element))) return;
    const current = this.findPageTools();
    const defaults = [...this.defaultPageTools].filter(element => element.isConnected);
    if (current === (defaults.length === 1 ? defaults[0] : null) && defaults.length === this.defaultPageTools.size) return;
    this.clearNativeTools(false);
    this.showDefaultPageTools();
  }

  revealToolbar() {
    if (document.body.classList.contains('sim-keep-topbar')) return;
    const element = document.getElementById('toolbar');
    if (!element) { this.leave(); return; }
    this.clearNativeTools(false); element.classList.add('sim-native-tools'); this.nativeReveals.add(element);
    showMessage('已临时显示原生工具栏；点击其他位置或按 Esc 收起。', 2500);
  }

  clearNativeTools(preservePageTools = true) {
    for (const element of this.nativeReveals) {
      if (preservePageTools && this.defaultPageTools.has(element)) continue;
      element.classList.remove('sim-page-tools', 'sim-native-tools');
      this.defaultPageTools.delete(element);
    }
    this.nativeReveals = new Set(preservePageTools ? [...this.nativeReveals].filter(element => this.defaultPageTools.has(element)) : []);
  }

  leave() {
    const wasActive = this.active;
    this.active = false;
    if (this.resourceEnterFrame != null) window.cancelAnimationFrame(this.resourceEnterFrame);
    this.resourceEnterFrame = null; this.pendingResourceTabs?.clear();
    this.stopMergedTabs();
    this.observer?.disconnect(); this.observer = null;
    this.windowStateObserver?.disconnect(); this.windowStateObserver = null;
    clearTimeout(this.refreshTimer); this.refreshTimer = null;
    for (const cleanup of this.cleanups || []) { try { cleanup(); } catch (error) { console.warn(error); } }
    this.cleanups = [];
    this.closeMenu();
    this.clearNativeTools(false);
    this.defaultPageTools.clear();
    for (const restore of this.geometryRestores) restore();
    for (const row of this.markedRows) row.classList.remove('sim-layout-row');
    this.markedRows.clear();
    this.orb?.remove(); this.orb = null;
    this.dragRegion?.remove(); this.dragRegion = null;
    this.windowActions?.remove(); this.windowActions = null;
    this.styleElement?.remove(); this.styleElement = null;
    this.drag = null; this.suppressClick = false;
    document.body.classList.remove('sim-active', 'sim-keep-topbar', 'sim-window-strip');
    this.updateTopButton();
    if (wasActive) {
      // SiYuan computes the tab switcher's right margin from the visible drag
      // region. Re-run its resize layout only AFTER all immersive styles and
      // temporary geometry are restored. No OS window resize or click occurs.
      document.getElementById('toolbar')?.getBoundingClientRect();
      window.dispatchEvent(new window.Event('resize'));
    }
  }

  onunload() {
    this.disposed = true;
    if (this.topButtonIconFrame != null) window.cancelAnimationFrame(this.topButtonIconFrame);
    this.topButtonIconFrame = null;
    this.resourceObserver?.disconnect(); this.resourceObserver = null;
    if (this.resourceEnterFrame != null) window.cancelAnimationFrame(this.resourceEnterFrame);
    this.resourceEnterFrame = null;
    this.leave();
    if (this.setting?.dialog?.element?.isConnected) this.setting.dialog.destroy();
    this.uiStyle?.remove(); this.uiStyle = null;
    this.topButton?.remove(); this.topButton = null;
  }
};
