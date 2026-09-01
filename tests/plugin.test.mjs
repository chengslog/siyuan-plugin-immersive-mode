import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { Window } from 'happy-dom';
import { createRequire } from 'node:module';
import { unzipSync } from 'fflate';
const require = createRequire(import.meta.url);
const { normalizeSettings, orbPosition, discoverActions, mergedTabSlots, tabsOverflow } = require('../src/core.js');
const bundle = readFileSync(new URL('../dist/index.js', import.meta.url), 'utf8');

async function fixture(options = {}) {
  const width = options.width || 1000, height = options.height || 700;
  const win = new Window({ width, height });
  win.document.body.innerHTML = `<div id="toolbar"><button id="barSearch" class="toolbar__item" aria-label="全局搜索"><svg><use href="#iconSearch"/></svg></button><div id="barMore" class="toolbar__item" aria-label="更多"></div></div>
  <div class="layout"><div class="fn__flex" id="main-row"><div id="dockLeft"><span class="dock__item" data-type="file" data-title="文档树"></span><span class="dock__item" data-type="things" data-title="Things"></span></div><div class="layout__dockl" id="sidebar"><input value="侧栏内容"></div><div class="layout__center"><div data-type="wnd" class="layout__wnd--active"><div class="fn__flex"><ul class="layout-tab-bar"><li data-id="doc-1" class="item--focus"><span class="item__text">文档一</span></li><li data-id="doc-2"><span class="item__text">文档二</span></li></ul></div><div class="layout-tab-container"><div class="protyle"><div class="protyle-breadcrumb">页面工具</div><div contenteditable="true" id="editor">原始笔记内容</div></div></div></div></div><div id="dockRight"></div></div></div><div id="status">同步正常</div>`;
  const saves = [], messages = [], commands = [];
  const nativeChrome = win.document.createElement('style');
  nativeChrome.textContent = `#toolbar { display:flex; background:#fff; height:42px; }
    #toolbar #drag { -webkit-app-region:drag; }
    body.body--toolbar-hide #toolbar #drag { -webkit-app-region:none; height:42px; }
    .layout__wnd--active > .fn__flex { display:flex; }
    body.body--toolbar-hide .toolbar__item--win { height:42px; padding:13.25px; }
    .toolbar__item--win { height:32px; }
    #maxWindow { display:flex; } #restoreWindow { display:none; }
    body.body--maximize #maxWindow { display:none; } body.body--maximize #restoreWindow { display:flex; }`;
  win.document.head.append(nativeChrome);
  win.document.body.classList.add('body--toolbar-hide');
  if (options.maximized) win.document.body.classList.add('body--maximize');
  const nativeDrag = win.document.createElement('div'); nativeDrag.id = 'drag';
  const nativeControls = win.document.createElement('div'); nativeControls.id = 'windowControls';
  nativeControls.innerHTML = '<button id="minWindow" class="toolbar__item toolbar__item--win" aria-label="最小化">−</button><button id="maxWindow" class="toolbar__item toolbar__item--win">□</button><button id="restoreWindow" class="toolbar__item toolbar__item--win">▣</button><button id="closeWindow" class="toolbar__item toolbar__item--close">×</button>';
  win.document.getElementById('toolbar').append(nativeDrag, nativeControls);
  const readonly = win.document.createElement('ul'); readonly.className = 'layout-tab-bar layout-tab-bar--readonly fn__flex-1';
  readonly.innerHTML = '<li class="item item--readonly"><span data-type="new" class="block__icon" role="button" aria-label="新建文档">+</span><span class="fn__flex-1"></span><span data-type="more" data-menu="true" class="block__icon" role="button" aria-label="页签切换">⌄</span></li>';
  win.document.querySelector('.layout-tab-bar').parentElement.append(readonly);
  // Explicit geometry for Happy DOM, which has no layout engine.
  nativeDrag.getBoundingClientRect = () => ({ left: 150, right: 750, top: 0, bottom: 32, width: 600, height: 32 });
  win.document.querySelector('[data-type="wnd"]').getBoundingClientRect = () => ({ left: 100, right: 800, top: 40, bottom: 640, width: 700, height: 600 });
  let nativeSettingsOpened = 0;
  class Plugin {
    app = {};
    async loadData() { return options.saved; }
    async saveData(key, data) { saves.push({ key, data }); if (options.failSave) throw new Error('disk full'); }
    addCommand(command) { commands.push(command); }
    addTopBar({ callback, title, icon }) { const el = win.document.createElement('button'); el.className = 'toolbar__item'; el.id = 'plugin_immersive'; el.title = title; el.innerHTML = icon; el.onclick = callback; win.document.querySelector('#toolbar').append(el); return el; }
  }
  class Setting {
    items = []; constructor(options) { this.options = options; }
    addItem(item) { this.items.push(item); }
    open() { this.opened = true; const element = win.document.createElement('div'); element.innerHTML = '<div class="b3-dialog__content"></div>'; win.document.body.append(element); this.dialog = { element, destroy: () => element.remove() }; }
  }
  const host = { Plugin, Setting, getFrontend: () => options.frontend || 'browser-desktop', getBackend: () => options.backend || 'windows', openSetting: () => nativeSettingsOpened++, showMessage: (...args) => messages.push(args) };
  Object.defineProperty(win.navigator, 'platform', { configurable: true, value: options.platform || 'Win32' });
  if (options.nativeWindow) win.require = () => ({ getCurrentWindow: () => options.nativeWindow });
  const sandbox = { window: win, document: win.document, navigator: win.navigator, innerWidth: width, innerHeight: height, MutationObserver: win.MutationObserver, HTMLElement: win.HTMLElement, setTimeout, clearTimeout, requestAnimationFrame: cb => setTimeout(cb, 0), console: { warn() {}, error() {} }, module: { exports: {} }, require: name => { if (name === 'siyuan') return host; throw new Error(`Unavailable ${name}`); } };
  vm.runInNewContext(bundle, sandbox);
  const plugin = new sandbox.module.exports();
  await plugin.onload(); plugin.onLayoutReady();
  return { win, plugin, saves, messages, commands, sandbox, nativeSettings: () => nativeSettingsOpened, dispose: () => { plugin.onunload(); win.happyDOM.abort(); } };
}

test('settings sanitize corrupt data, deduplicate favorites, clamp coordinates', () => {
  assert.deepEqual(normalizeSettings({ favorites: ['x', 7, 'x', 'y'], side: 'invalid', y: 9 }), { favorites: ['x', 'y'], side: 'right', y: 1, windowsTopBar: false, tabPreviewCount: 5, autoEnterOnResourceOpen: false });
  assert.equal(normalizeSettings({ windowsTopBar: 'true' }).windowsTopBar, false);
  assert.equal(normalizeSettings({ windowsTopBar: true }).windowsTopBar, true);
  assert.equal(normalizeSettings({ autoEnterOnResourceOpen: 'true' }).autoEnterOnResourceOpen, false);
  assert.equal(normalizeSettings({ autoEnterOnResourceOpen: true }).autoEnterOnResourceOpen, true);
  assert.equal(normalizeSettings({ y: NaN }).y, 0.65);
  assert.equal(normalizeSettings(null).favorites.length, 0);
});

test('resource auto-entry is opt-in, saves immediately and stops when disabled', async () => {
  const f = await fixture(); const { plugin: p, win } = f;
  const wait = () => new Promise(resolve => setTimeout(resolve, 60));
  const tabs = win.document.querySelector('.layout-tab-bar');
  const addTab = id => { const tab = win.document.createElement('li'); tab.dataset.id = id; tabs.append(tab); return tab; };
  assert.deepEqual(Array.from(p.setting.items, item => item.title), ['Windows：保留顶部工具栏', '资源打开时进入沉浸模式', '页签默认展示数量']);
  addTab('before-enabled'); await wait(); assert.equal(p.active, false);
  const toggle = p.setting.items.find(item => item.title === '资源打开时进入沉浸模式').createActionElement();
  assert.equal(toggle.checked, false);
  toggle.checked = true; toggle.dispatchEvent(new win.Event('change')); await p.pendingSave;
  assert.equal(f.saves.at(-1).data.autoEnterOnResourceOpen, true);
  await wait(); assert.equal(p.active, false, 'enabling does not enter for existing tabs');
  addTab('new-resource'); await wait(); assert.equal(p.active, true);
  p.openMenu(); assert.equal(p.menu.querySelector('.sim-origin'), null);
  p.leave(); await wait(); assert.equal(p.active, false, 'manual exit remains normal');
  toggle.checked = false; toggle.dispatchEvent(new win.Event('change')); await p.pendingSave;
  addTab('after-disabled'); await wait(); assert.equal(p.active, false);
  assert.equal(p.resourceObserver, null); assert.equal(f.saves.at(-1).data.autoEnterOnResourceOpen, false);
  f.dispose();
});

test('resource auto-entry ignores existing tabs, editor updates, tab moves and transient tabs', async () => {
  const f = await fixture({ saved: { autoEnterOnResourceOpen: true } }); const { plugin: p, win } = f;
  const wait = () => new Promise(resolve => setTimeout(resolve, 60));
  const doc = win.document, tabs = doc.querySelector('.layout-tab-bar');
  await wait(); assert.equal(p.active, false, 'restored tabs do not trigger entry');
  tabs.append(tabs.firstElementChild);
  tabs.firstElementChild.classList.add('item--focus');
  doc.querySelector('#editor').append(doc.createElement('span'));
  const transient = doc.createElement('li'); transient.dataset.id = 'transient'; tabs.append(transient); transient.remove();
  await wait(); assert.equal(p.active, false);
  const split = doc.createElement('div'); split.innerHTML = '<ul class="layout-tab-bar"><li data-id="attachment">附件</li></ul>';
  doc.querySelector('.layout__center').append(split); await wait(); assert.equal(p.active, true);
  p.leave();
  tabs.append(split.querySelector('li')); split.remove(); await wait(); assert.equal(p.active, false, 'moving a known tab does not reenter');
  const next = doc.createElement('li'); next.dataset.id = 'another-resource'; tabs.append(next);
  await wait(); assert.equal(p.active, true, 'the next new resource enters again');
  f.dispose(); assert.equal(p.resourceObserver, null); assert.equal(p.resourceEnterFrame, null);
});

test('pending resource entry is cancelled by exit, disabling or unload', async () => {
  for (const cancel of ['leave', 'disable', 'unload']) {
    const f = await fixture({ saved: { autoEnterOnResourceOpen: true } }); const { plugin: p, win } = f;
    let scheduled, cancelled = false;
    win.requestAnimationFrame = cb => { scheduled = cb; return 123; };
    win.cancelAnimationFrame = id => { if (id === 123) cancelled = true; };
    const tab = win.document.createElement('li'); tab.dataset.id = 'pending-resource'; win.document.querySelector('.layout-tab-bar').append(tab);
    await new Promise(resolve => setTimeout(resolve, 30)); assert.equal(typeof scheduled, 'function');
    if (cancel === 'leave') p.leave();
    else if (cancel === 'unload') p.onunload();
    else { p.settingsData.autoEnterOnResourceOpen = false; p.configureResourceAutoEnter(); }
    assert.equal(cancelled, true); assert.equal(p.resourceEnterFrame, null);
    scheduled(); assert.equal(p.active, false);
    f.dispose();
  }
});

test('top entry keeps one native tooltip synchronized with the immersive state', async () => {
  const f = await fixture({ frontend: 'desktop', saved: { windowsTopBar: true } }); const p = f.plugin;
  assert.equal(p.topButton.hasAttribute('title'), false);
  assert.equal(p.topButton.getAttribute('aria-label'), '进入沉浸模式 · Alt+Shift+I');
  assert.ok(p.topButton.classList.contains('ariaLabel'));
  p.enter(); assert.equal(p.topButton.getAttribute('aria-label'), '退出沉浸模式 · Alt+Shift+I');
  assert.equal(p.topButton.hasAttribute('title'), false);
  p.leave(); assert.equal(p.topButton.getAttribute('aria-label'), '进入沉浸模式 · Alt+Shift+I');
  f.dispose(); assert.equal(f.win.document.querySelector('#sim-ui-style'), null);
});

test('top entry contains its pointer event and defers icon replacement until host delegation finishes', async () => {
  const f = await fixture({ frontend: 'desktop' }); const p = f.plugin; const doc = f.win.document;
  const originalIcon = p.topButton.firstElementChild; const originalMarkup = p.topButton.innerHTML; let bubbled = 0;
  doc.getElementById('toolbar').addEventListener('click', () => bubbled++);
  p.topButton.dispatchEvent(new f.win.PointerEvent('click', { bubbles: true, detail: 1 }));
  assert.equal(p.active, true);
  assert.equal(bubbled, 0, 'raw pointer event must not reach SiYuan delegated toolbar handling');
  assert.equal(originalIcon.isConnected, true, 'click target remains connected during event dispatch');
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(originalIcon.isConnected, false); assert.notEqual(p.topButton.innerHTML, originalMarkup);
  assert.equal(p.topButton.getAttribute('aria-label'), '退出沉浸模式 · Alt+Shift+I');
  f.dispose();
});

test('compact settings apply in ordinary and immersive modes and destroy on unload', async () => {
  const f = await fixture(); const p = f.plugin;
  assert.equal(p.setting.options.height, 'fit-content'); assert.equal(p.setting.options.confirmCallback, undefined);
  p.setting.open('沉浸模式设置'); assert.ok(p.setting.dialog.element.classList.contains('sim-settings-dialog'));
  const manifest = require('../plugin.json');
  assert.equal(p.setting.dialog.element.querySelector('.sim-settings-version').textContent, `${manifest.name} · v${manifest.version}`);
  assert.ok(f.win.document.querySelector('#sim-ui-style')); p.setting.dialog.destroy();
  p.enter(); p.openMenu(); p.menu.querySelector('[data-action-key="builtin:plugin-settings"]').click();
  const dialog = p.setting.dialog.element; assert.ok(dialog.classList.contains('sim-settings-dialog'));
  p.leave(); assert.ok(dialog.isConnected); assert.ok(f.win.document.querySelector('#sim-ui-style'));
  f.dispose(); assert.equal(dialog.isConnected, false);
});

test('kept topbar aligns tabs to the current page edge, not the original toolbar start', async () => {
  const f = await fixture({ frontend: 'desktop', saved: { windowsTopBar: true } }); const p = f.plugin, doc = f.win.document;
  const list = doc.querySelector('.layout-tab-bar'), row = list.parentElement, first = list.firstElementChild;
  list.getBoundingClientRect = () => ({ left: 276, width: 400 });
  list.scrollLeft = 20;
  first.getBoundingClientRect = () => ({ left: 260, width: 100 });
  const page = doc.querySelector('.layout-tab-container');
  page.getBoundingClientRect = () => ({ left: 210, right: 800, width: 590 });
  p.enter();
  assert.equal(row.style.getPropertyValue('--sim-tabs-left'), '210px');
  assert.equal(doc.querySelector('.layout-tab-bar'), list);
  doc.getElementById('drag').getBoundingClientRect = () => ({ left: 320, right: 650, width: 330 });
  p.syncMergedTabs(); assert.equal(row.style.getPropertyValue('--sim-tabs-left'), '210px');
  const right = parseFloat(row.style.getPropertyValue('--sim-tabs-left')) + parseFloat(row.style.getPropertyValue('--sim-tabs-width'));
  assert.ok(right <= 602, 'window controls and drag space remain clear');
  p.leave(); assert.equal(row.style.getPropertyValue('--sim-tabs-left'), '');
  page.getBoundingClientRect = () => ({ left: 280, right: 800, width: 520 });
  p.enter(); assert.equal(row.style.getPropertyValue('--sim-tabs-left'), '280px');
  f.dispose();
});

test('toolbar tools that conflict with page-aligned tabs remain reachable and restore without moving nodes', async () => {
  const f = await fixture({ frontend: 'desktop', saved: { windowsTopBar: true } }); const p = f.plugin, doc = f.win.document;
  const search = doc.getElementById('barSearch'), more = doc.getElementById('barMore'), toolbar = search.parentElement;
  for (const element of [search, more]) element.getBoundingClientRect = () => ({ width: 60 });
  const page = doc.querySelector('.layout-tab-container'); let left = 90;
  page.getBoundingClientRect = () => ({ left, right: 800, width: 800 - left });
  p.enter(); p.openMenu();
  assert.equal(search.classList.contains('sim-topbar-overflow'), false);
  assert.equal(more.classList.contains('sim-topbar-overflow'), true);
  assert.ok(p.menu.querySelector('[data-action-key="top:barMore"]'));
  assert.equal(p.menu.querySelectorAll('[data-action-key="top:barSearch"]').length, 0);
  for (let i = 0; i < 5; i++) p.syncMergedTabs();
  assert.equal(p.topbarOverflow.size, 1);
  left = 180; p.syncMergedTabs(); assert.equal(more.classList.contains('sim-topbar-overflow'), false);
  left = 90; p.syncMergedTabs(); assert.equal(more.classList.contains('sim-topbar-overflow'), true);
  p.leave(); assert.equal(p.topbarOverflow.size, 0); assert.equal(more.classList.contains('sim-topbar-overflow'), false);
  assert.equal(more.parentElement, toolbar); f.dispose();
});

test('orb stays in ordinary small viewport after resize', () => {
  for (const width of [180, 360, 1920]) for (const height of [120, 400, 1080]) for (const side of ['left', 'right']) {
    const p = orbPosition({ side, y: 4 }, width, height);
    assert.ok(p.x >= 0 && p.x + 42 <= width);
    assert.ok(p.y >= 0 && p.y + 42 <= height);
  }
});

test('20 enter/leave cycles preserve sidebar/editor node identity and clear resources', async () => {
  const f = await fixture(); const { plugin: p, win } = f;
  const sidebar = win.document.querySelector('#sidebar'); const editor = win.document.querySelector('#editor');
  for (let i = 0; i < 20; i++) {
    p.enter(); p.enter(); assert.equal(win.document.querySelectorAll('.sim-orb').length, 1);
    p.openMenu(); assert.equal(win.document.querySelectorAll('.sim-menu').length, 1);
    p.leave();
    assert.equal(win.document.querySelectorAll('.sim-orb, .sim-menu, .sim-radial-menu, #sim-style, .sim-layout-row').length, 0);
    assert.equal(win.document.body.classList.contains('sim-active'), false);
    assert.equal(p.cleanups.length, 0);
    assert.equal(win.document.querySelector('#sidebar'), sidebar);
    assert.equal(win.document.querySelector('#editor'), editor);
    assert.equal(editor.textContent, '原始笔记内容');
  }
  f.dispose();
});

test('legacy favorites no longer create stars or duplicates; text action invokes real button once', async () => {
  const f = await fixture(); const p = f.plugin; let calls = 0;
  f.win.document.querySelector('#barSearch').addEventListener('click', () => calls++);
  p.enter(); p.openMenu();
  assert.equal(p.menu.querySelector('.sim-star, .sim-menu-favorites'), null);
  assert.equal(calls, 0);
  assert.equal(p.menu.querySelectorAll('.sim-action[data-action-key="top:barSearch"]').length, 1);
  p.menu.querySelector('.sim-action[data-action-key="top:barSearch"] span:last-child').click();
  assert.equal(calls, 1); assert.equal(p.menu, null); assert.equal(p.active, true);
  f.dispose();
});

test('tab count loads on restart but immersive state never auto-restores', async () => {
  const f = await fixture({ saved: { favorites: ['dock:things'], tabPreviewCount: 1, side: 'left', y: 0.3, active: true } });
  assert.equal(f.plugin.active, false); f.plugin.enter(); f.plugin.openMenu();
  assert.equal(f.plugin.menu.querySelectorAll('.sim-tab').length, 1);
  assert.equal(f.plugin.menu.querySelector('.sim-tabs-toggle').getAttribute('aria-expanded'), 'false');
  assert.equal(f.plugin.menu.querySelectorAll('[data-action-key="dock:things"]').length, 1);
  f.dispose();
});

test('pointer drag works outside orb, snaps left, suppresses release click only', async () => {
  const f = await fixture(); const p = f.plugin; p.enter();
  p.orb.dispatchEvent(new f.win.PointerEvent('pointerdown', { button: 0, pointerId: 1, clientX: 970, clientY: 440 }));
  f.win.dispatchEvent(new f.win.PointerEvent('pointermove', { pointerId: 1, clientX: 25, clientY: 180 }));
  f.win.dispatchEvent(new f.win.PointerEvent('pointerup', { pointerId: 1, clientX: 25, clientY: 180 }));
  assert.equal(p.settingsData.side, 'left'); assert.equal(p.orb.style.left, '8px');
  p.orb.click(); assert.equal(p.menu, null);
  p.orb.click(); assert.ok(p.menu);
  await p.pendingSave; assert.equal(f.saves.at(-1).data.side, 'left'); f.dispose();
});

test('mouse hover opens without taking editor focus; touch and dragging do not open the card', async () => {
  const f = await fixture(); const p = f.plugin; const doc = f.win.document; p.enter();
  const editor = doc.getElementById('editor'); editor.focus();
  p.orb.dispatchEvent(new f.win.PointerEvent('pointerenter', { pointerType: 'touch' }));
  assert.equal(p.menu, undefined);
  p.orb.dispatchEvent(new f.win.PointerEvent('pointerenter', { pointerType: 'mouse' }));
  assert.ok(p.menu); assert.equal(doc.activeElement, editor);
  const menu = p.menu; p.orb.click(); assert.equal(p.menu, menu, 'click after hover keeps the card open');
  doc.dispatchEvent(new f.win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(p.menu, null);
  p.orb.dispatchEvent(new f.win.PointerEvent('pointerdown', { button: 0, pointerId: 3 }));
  p.orb.dispatchEvent(new f.win.PointerEvent('pointerenter', { pointerType: 'mouse', buttons: 1 }));
  assert.equal(p.menu, null);
  f.win.dispatchEvent(new f.win.PointerEvent('pointerup', { pointerId: 3 }));
  p.orb.dispatchEvent(new f.win.PointerEvent('pointerenter', { pointerType: 'mouse' }));
  p.orb.dispatchEvent(new f.win.PointerEvent('pointerleave', { pointerType: 'mouse' }));
  assert.ok(p.menu, 'card stays accessible when moving from orb to card');
  doc.getElementById('editor').dispatchEvent(new f.win.PointerEvent('pointerdown', { bubbles: true }));
  assert.equal(p.menu, null); f.dispose();
});

test('desktop gets an invisible native drag inset; Docker does not', async () => {
  const f = await fixture({ frontend: 'desktop' }); const p = f.plugin; const doc = f.win.document;
  p.enter();
  assert.equal(doc.querySelectorAll('.sim-window-drag').length, 1);
  assert.equal(f.win.getComputedStyle(p.dragRegion).getPropertyValue('-webkit-app-region'), 'drag');
  assert.equal(f.win.getComputedStyle(p.dragRegion).height, '8px');
  assert.equal(f.win.getComputedStyle(doc.getElementById('toolbar')).display, 'none');
  p.leave(); assert.equal(doc.querySelector('.sim-window-drag, .sim-minimize'), null); f.dispose();
});

test('browser and Docker never receive a desktop drag region', async () => {
  for (const options of [{ frontend: 'browser-desktop' }, { frontend: 'desktop', backend: 'docker' }]) {
    const f = await fixture(options); f.plugin.enter();
    assert.equal(f.win.document.querySelector('.sim-minimize, .sim-window-drag'), null); f.dispose();
  }
});

test('removed source disappears while favorite preference remains', async () => {
  const f = await fixture({ saved: { favorites: ['dock:things'] } }); const p = f.plugin;
  p.enter(); p.openMenu(); f.win.document.querySelector('[data-type="things"]').remove(); p.renderMenu();
  assert.equal(p.menu.querySelector('[data-action-key="dock:things"]'), null);
  assert.equal(p.settingsData.favorites.includes('dock:things'), true); f.dispose();
});

test('discovery skips own, disabled and hidden entries and sanitizes labels', async () => {
  const f = await fixture(); const doc = f.win.document;
  doc.querySelector('#barMore').setAttribute('aria-label', '<b>更多</b><img src=x onerror="alert(1)">');
  doc.querySelector('#barSearch').classList.add('toolbar__item--disabled');
  const actions = discoverActions(doc, f.plugin.topButton);
  assert.equal(actions.find(x => x.key === 'top:barMore').title, '更多');
  assert.equal(actions.some(x => x.key === 'top:barSearch'), false);
  assert.equal(actions.some(x => x.key === 'top:plugin_immersive'), false); f.dispose();
});

test('tabs call original tab, page/toolbar reveal classes clear on exit', async () => {
  const f = await fixture(); const p = f.plugin; let selected = 0;
  f.win.document.querySelector('[data-id="doc-2"]').onclick = () => selected++;
  p.enter(); p.openMenu();
  [...p.menu.querySelectorAll('button')].find(x => x.textContent.includes('文档二')).click();
  assert.equal(selected, 1); assert.equal(p.active, true);
  p.revealPageTools(); assert.ok(f.win.document.querySelector('.sim-page-tools'));
  p.revealToolbar(); assert.equal(f.win.document.querySelector('.sim-page-tools'), null);
  assert.ok(f.win.document.querySelector('.sim-native-tools'));
  p.leave(); assert.equal(f.win.document.querySelector('.sim-native-tools'), null); f.dispose();
});

test('immersive mode keeps the active page tools visible by default', async () => {
  const f = await fixture(); const p = f.plugin; const doc = f.win.document;
  const pageTools = doc.querySelector('.protyle-breadcrumb');
  p.enter();
  assert.ok(pageTools.classList.contains('sim-page-tools'));
  assert.notEqual(f.win.getComputedStyle(pageTools).position, 'absolute', 'default page tools stay in document flow');
  p.openMenu();
  assert.ok(pageTools.classList.contains('sim-page-tools'), 'opening the card does not hide default page tools');
  doc.getElementById('editor').dispatchEvent(new f.win.PointerEvent('pointerdown', { bubbles: true }));
  assert.ok(pageTools.classList.contains('sim-page-tools'), 'outside clicks only dismiss temporary reveals');
  p.revealToolbar();
  assert.equal(pageTools.classList.contains('sim-page-tools'), false);
  p.clearNativeTools(false);
  p.showDefaultPageTools();
  assert.ok(pageTools.classList.contains('sim-page-tools'));
  p.leave(); assert.equal(pageTools.classList.contains('sim-page-tools'), false);
  f.dispose();
});

test('list ordering follows the native toolbar DOM, not the fallback icon table', async () => {
  const f = await fixture(); const p = f.plugin; const doc = f.win.document;
  const toolbar = doc.getElementById('toolbar');
  const main = doc.createElement('button'); main.id = 'barWorkspace'; main.className = 'toolbar__item';
  const sync = doc.createElement('button'); sync.id = 'barSync'; sync.className = 'toolbar__item';
  toolbar.prepend(main, sync);
  p.enter(); p.openMenu();
  assert.deepEqual([...p.menu.querySelectorAll('.sim-action-group')].map(group => group.dataset.actionGroup), ['left', 'top']);
  const topGroup = p.menu.querySelector('[data-action-group="top"]');
  assert.equal(topGroup.querySelector('.sim-action-grid'), null);
  assert.deepEqual([...topGroup.querySelectorAll('.sim-action')].map(action => action.dataset.actionKey), ['top:barWorkspace', 'top:barSync', 'top:barSearch', 'top:barMore', 'builtin:toolbar']);
  toolbar.insertBefore(sync, main); p.renderMenu();
  assert.equal(p.menu.querySelector('[data-action-group="top"] .sim-action').dataset.actionKey, 'top:barSync');
  f.dispose();
});

test('native visual ordering survives hiding chrome on all four rails', async () => {
  const f = await fixture(); const p = f.plugin; const doc = f.win.document;
  const bottom = doc.createElement('div'); bottom.id = 'dockBottom'; doc.body.append(bottom);
  for (const [rail, axis] of [['dockLeft', 'top'], ['dockRight', 'top'], ['dockBottom', 'left']]) {
    const target = doc.getElementById(rail); target.replaceChildren();
    for (const [name, position] of [['last', 100], ['first', 20]]) {
      const node = doc.createElement('button'); node.className = 'dock__item'; node.dataset.type = `${rail}-${name}`; node.title = name;
      node.getBoundingClientRect = () => doc.body.classList.contains('sim-active') ? { width: 0, height: 0, left: 0, top: 0 } : { width: 24, height: 24, left: 0, top: 0, [axis]: position };
      target.append(node);
    }
  }
  for (const [id, left] of [['barSearch', 100], ['barMore', 20]]) doc.getElementById(id).getBoundingClientRect = () => doc.body.classList.contains('sim-active') ? { width: 0, height: 0 } : { width: 24, height: 24, left, top: 0 };
  p.enter(); p.openMenu();
  for (const [group, key] of [['left', 'dock:dockLeft-first'], ['right', 'dock:dockRight-first'], ['bottom', 'dock:dockBottom-first'], ['top', 'top:barMore']]) {
    assert.equal(p.menu.querySelector(`[data-action-group="${group}"] .sim-action`).dataset.actionKey, key);
  }
  f.dispose();
});

function nativeMenuFixture(f) {
  const doc = f.win.document;
  const menu = doc.createElement('div'); menu.id = 'commonMenu'; menu.className = 'b3-menu fn__none';
  const items = doc.createElement('div'); items.className = 'b3-menu__items'; menu.append(items); doc.body.append(menu);
  const choice = doc.createElement('button'); choice.className = 'b3-menu__item'; choice.textContent = '原生选项'; items.append(choice);
  let opens = 0, executions = 0, closes = 0;
  const owner = { element: menu, remove() { closes++; menu.classList.add('fn__none'); } };
  f.win.siyuan = { menus: { menu: owner } };
  const open = () => { opens++; menu.classList.remove('fn__none'); };
  choice.onclick = () => { executions++; owner.remove(); };
  return { menu, choice, open, owner, counts: () => ({ opens, executions, closes }) };
}

test('plugin settings is a menu item and browser control dock has only exit without hiding page tools', async () => {
  for (const options of [{}, { frontend: 'browser-desktop', backend: 'docker' }]) {
    const f = await fixture(options); const p = f.plugin;
    p.enter(); p.openMenu();
    assert.equal(p.menu.querySelector('[data-action-group="page"], [data-action-key="builtin:page-tools"], [data-action-key="builtin:settings"]'), null);
    assert.ok(f.win.document.querySelector('.protyle-breadcrumb.sim-page-tools'));
    assert.equal(p.menu.querySelector('.sim-window-actions'), p.windowActions);
    assert.equal(p.windowActions.parentElement, p.menu);
    assert.ok(p.windowActions.classList.contains('sim-control-dock'));
    assert.deepEqual([...p.windowActions.querySelectorAll('button')].map(el => el.getAttribute('aria-label')), ['退出沉浸']);
    const settings = p.menu.querySelector('[data-action-key="builtin:plugin-settings"]');
    assert.equal(settings.textContent, '插件设置');
    assert.equal(settings.querySelector('use').getAttribute('href'), '#iconSettings');
    assert.ok(settings.closest('.sim-menu-other-scroll'));
    settings.click();
    assert.equal(p.setting.opened, true); assert.equal(p.menu, null);
    f.dispose();
  }
});

test('menu strips modifier shortcuts without changing original labels or shortcut commands', async () => {
  const f = await fixture(); const p = f.plugin; const doc = f.win.document;
  doc.getElementById('barMore').setAttribute('aria-label', '主菜单 Alt+\\');
  doc.getElementById('barSearch').setAttribute('aria-label', '搜索（Ctrl+Shift+F）');
  doc.querySelector('[data-type="things"]').setAttribute('data-title', 'Things ⌥⇧T');
  p.enter(); p.openMenu();
  for (const [key, label] of [['top:barMore', '主菜单'], ['top:barSearch', '搜索'], ['dock:things', 'Things']]) {
    const item = p.menu.querySelector(`[data-action-key="${key}"]`);
    assert.equal(item.getAttribute('aria-label'), label); assert.equal(item.title, label);
  }
  assert.equal(p.menu.textContent.includes('Alt+'), false);
  assert.equal(doc.getElementById('barMore').getAttribute('aria-label'), '主菜单 Alt+\\');
  assert.equal(f.commands[0].hotkey, '⌥⇧I'); f.dispose();
});

test('sync keeps a fixed label and hover displays fresh host information without synchronizing or rerendering', async () => {
  const f = await fixture(); const p = f.plugin; const doc = f.win.document;
  const sync = doc.createElement('button'); sync.id = 'barSync'; sync.className = 'toolbar__item';
  sync.setAttribute('aria-label', '上传 12 KB / 下载 30 KB Alt+S'); doc.getElementById('toolbar').append(sync);
  let queries = 0, clicks = 0;
  sync.onclick = () => clicks++;
  sync.addEventListener('mouseenter', () => { queries++; setTimeout(() => sync.setAttribute('aria-label', '最近同步：22:00<br>上传 20 KB / 下载 40 KB'), 10); });
  p.enter(); p.openMenu();
  const trigger = p.menu.querySelector('[data-action-key="top:barSync"]');
  assert.equal(trigger.getAttribute('aria-label'), '同步');
  trigger.parentElement.dispatchEvent(new f.win.PointerEvent('pointerenter', { pointerType: 'mouse' }));
  assert.equal(p.syncTip.textContent, '上传 12 KB / 下载 30 KB');
  await new Promise(resolve => setTimeout(resolve, 200));
  assert.equal(queries, 1); assert.equal(clicks, 0);
  assert.equal(p.menu.querySelector('[data-action-key="top:barSync"]'), trigger);
  assert.equal(p.syncTip.textContent, '最近同步：22:00\n上传 20 KB / 下载 40 KB');
  trigger.parentElement.dispatchEvent(new f.win.PointerEvent('pointerleave', { pointerType: 'mouse' }));
  assert.equal(p.syncTip, null); assert.equal(trigger.hasAttribute('aria-describedby'), false);
  trigger.click(); assert.equal(clicks, 1); assert.equal(p.menu, null);
  p.openMenu(); p.menu.querySelector('[data-action-key="top:barSync"]').focus();
  assert.ok(p.syncTip); p.leave();
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(doc.querySelector('.sim-sync-tip'), null); f.dispose();
});

test('desktop control dock follows live window state and proxies native clicks without moving controls', async () => {
  for (const backend of ['windows', 'linux', 'darwin']) {
    const f = await fixture({ frontend: 'desktop', backend }); const p = f.plugin; const doc = f.win.document;
    const controls = doc.getElementById('windowControls'); const nodes = [...controls.children];
    const calls = [];
    for (const source of nodes) source.onclick = () => {
      calls.push(source.id);
      if (source.id === 'maxWindow') doc.body.classList.add('body--maximize');
      if (source.id === 'restoreWindow') doc.body.classList.remove('body--maximize');
    };
    p.enter(); p.openMenu();
    assert.equal(p.windowActions.querySelectorAll('button').length, 4);
    doc.body.classList.add('body--maximize');
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(p.windowActions.querySelector('[data-control-key="maximize"]').title, '还原');
    doc.body.classList.remove('body--maximize');
    for (const key of ['minimize', 'maximize', 'maximize', 'close']) {
      p.openMenu(); p.windowActions.querySelector(`[data-control-key="${key}"]`).click();
    }
    assert.deepEqual(calls, ['minWindow', 'maxWindow', 'restoreWindow', 'closeWindow']);
    for (let i = 0; i < 20; i++) { p.leave(); p.enter(); p.openMenu(); }
    p.leave(); assert.equal(p.windowStateObserver, null);
    assert.deepEqual([...controls.children], nodes);
    assert.equal(controls.parentElement.id, 'toolbar');
    assert.equal(doc.querySelector('.sim-control-dock'), null);
    f.dispose();
  }
});

test('hover opens real submenu once and keeps it usable across the gap and following click', async () => {
  const f = await fixture(); const p = f.plugin; const doc = f.win.document;
  const native = nativeMenuFixture(f); doc.getElementById('barMore').onclick = native.open;
  p.enter(); p.openMenu(false);
  const trigger = p.menu.querySelector('[data-action-key="top:barMore"]'); const row = trigger.parentElement;
  row.dispatchEvent(new f.win.PointerEvent('pointerenter', { pointerType: 'mouse' }));
  await new Promise(resolve => setTimeout(resolve, 220));
  assert.equal(p.submenu, native.menu); assert.equal(native.counts().opens, 1);
  trigger.click(); assert.equal(p.submenu, native.menu); assert.equal(native.counts().opens, 1);
  row.dispatchEvent(new f.win.PointerEvent('pointerleave', { pointerType: 'mouse' }));
  native.menu.dispatchEvent(new f.win.PointerEvent('pointerenter', { pointerType: 'mouse' }));
  assert.equal(p.submenu, native.menu);
  native.choice.click(); await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(native.counts().executions, 1); assert.equal(p.submenu, null);
  f.dispose();
});

test('window controls use a proportional floating dock inside the card bottom', async () => {
  const f = await fixture({ frontend: 'desktop' }); const p = f.plugin; const win = f.win;
  p.enter();
  assert.equal(win.document.querySelector('.sim-window-actions'), null);
  win.dispatchEvent(new win.PointerEvent('pointermove', { pointerType: 'mouse', clientX: 970, clientY: 14 }));
  assert.equal(win.document.querySelector('.sim-window-actions'), null);
  p.openMenu(); const controls = p.windowActions;
  assert.equal(controls.parentElement, p.menu);
  assert.equal(p.menu.querySelector('.sim-window-actions'), controls);
  assert.equal(p.menu.lastElementChild, controls);
  assert.ok(p.menu.classList.contains('sim-menu--with-control-dock'));
  assert.equal(controls.querySelectorAll('button').length, 4);
  assert.notEqual(win.getComputedStyle(controls).position, 'fixed');
  assert.equal(win.getComputedStyle(controls).width, 'calc(100% - 24px)');
  assert.equal(win.getComputedStyle(controls).borderRadius, '10px');
  for (const control of controls.querySelectorAll('button')) {
    assert.equal(win.getComputedStyle(control).width, '22px');
    assert.equal(win.getComputedStyle(control).height, '22px');
    assert.equal(win.getComputedStyle(control.querySelector('svg')).width, '14px');
  }
  assert.equal(controls.previousElementSibling.className, 'sim-menu-other-scroll');
  controls.dispatchEvent(new win.PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse' }));
  assert.equal(p.menu.isConnected, true, 'the dock is part of the card interaction surface');
  p.renderMenu(); assert.equal(win.document.querySelectorAll('.sim-control-dock').length, 1);
  p.closeMenu(); assert.equal(p.windowActions, null); assert.equal(controls.isConnected, false);
  p.openMenu(); p.leave(); assert.equal(win.document.querySelector('.sim-window-actions'), null);
  f.dispose();
});

test('exit refreshes native layout only after original chrome and tab geometry are restored', async () => {
  const f = await fixture({ frontend: 'desktop', saved: { windowsTopBar: true } }); const p = f.plugin; const doc = f.win.document;
  const row = doc.querySelector('.layout-tab-bar').parentElement;
  const controls = doc.getElementById('windowControls'); const switcher = row.querySelector('[data-type="more"]');
  let refreshes = 0;
  f.win.addEventListener('resize', () => {
    refreshes++;
    assert.equal(p.active, false);
    assert.equal(doc.querySelector('#sim-style, .sim-merged-tabs, .sim-tab-switch-hidden'), null);
    assert.equal(doc.body.classList.contains('sim-active'), false);
    assert.equal(controls.parentElement.id, 'toolbar');
    assert.ok(row.contains(switcher));
  });
  p.enter(); p.leave(); assert.equal(refreshes, 1);
  p.leave(); assert.equal(refreshes, 1);
  p.enter(); p.onunload(); assert.equal(refreshes, 2);
  f.dispose();
});

test('root and nested menu shift above the bottom edge and restore native positioning on close', async () => {
  const f = await fixture({ height: 400 }); const p = f.plugin; const doc = f.win.document;
  const native = nativeMenuFixture(f); doc.getElementById('barMore').onclick = native.open;
  const parent = doc.createElement('div'); parent.className = 'b3-menu__item'; native.menu.querySelector('.b3-menu__items').append(parent);
  const child = doc.createElement('div'); child.className = 'b3-menu__submenu'; child.style.top = '380px';
  child.style.setProperty('--sim-child-top', '25px', 'important'); parent.append(child);
  let parentTop = 360;
  parent.getBoundingClientRect = () => ({ top: parentTop });
  child.getBoundingClientRect = () => ({ width: 230, height: 180, left: 50, top: parentTop });
  p.enter(); p.openMenu();
  p.menu.getBoundingClientRect = () => ({ left: 640, right: 920, top: 8, width: 280, height: 384 });
  native.menu.getBoundingClientRect = () => ({ width: 230, height: 300 });
  const trigger = p.menu.querySelector('[data-action-key="top:barMore"]');
  trigger.getBoundingClientRect = () => ({ top: 370 }); trigger.click();
  assert.equal(native.menu.style.getPropertyValue('--sim-submenu-top'), '92px');
  assert.equal(child.style.getPropertyValue('--sim-child-top'), '212px');
  parentTop = 100; native.menu.dispatchEvent(new f.win.Event('scroll'));
  assert.equal(child.style.getPropertyValue('--sim-child-top'), '100px');
  p.closeSubmenu();
  assert.equal(child.style.top, '380px'); assert.equal(child.style.getPropertyValue('--sim-child-top'), '25px');
  assert.equal(child.style.getPropertyPriority('--sim-child-top'), 'important');
  assert.equal(child.classList.contains('sim-child-positioned'), false);
  assert.equal(p.childMenuPositions.size, 0); assert.equal(p.nativeMenuScrollHandler, null);
  f.dispose();
});

test('hover excludes dock/unknown commands, touch and held buttons; cancelled hover never fires', async () => {
  const f = await fixture(); const p = f.plugin; const doc = f.win.document; let calls = 0;
  const command = doc.createElement('button'); command.id = 'plugin_command'; command.dataset.menu = 'true'; command.title = '插件命令';
  command.onclick = () => calls++; doc.getElementById('toolbar').append(command);
  doc.querySelector('[data-type="file"]').onclick = () => calls++;
  doc.getElementById('barMore').onclick = () => calls++;
  p.enter(); p.openMenu();
  const hover = (key, options = {}) => p.menu.querySelector(`[data-action-key="${key}"]`).parentElement.dispatchEvent(new f.win.PointerEvent('pointerenter', { pointerType: 'mouse', ...options }));
  hover('dock:file'); hover('top:plugin_command'); hover('top:barMore', { pointerType: 'touch' }); hover('top:barMore', { buttons: 1 });
  await new Promise(resolve => setTimeout(resolve, 220)); assert.equal(calls, 0);
  hover('top:barMore');
  p.menu.querySelector('[data-action-key="top:barMore"]').parentElement.dispatchEvent(new f.win.PointerEvent('pointerleave', { pointerType: 'mouse' }));
  await new Promise(resolve => setTimeout(resolve, 220)); assert.equal(calls, 0);
  hover('top:barMore'); p.leave();
  await new Promise(resolve => setTimeout(resolve, 220)); assert.equal(calls, 0);
  assert.equal(p.submenuHoverTimer, null); f.dispose();
});

test('dock highlights track native active and focused selection changes', async () => {
  const f = await fixture(); const p = f.plugin; const source = f.win.document.querySelector('[data-type="file"]');
  source.classList.add('dock__item--active'); p.enter(); p.openMenu();
  const action = () => p.menu.querySelector('[data-action-key="dock:file"]');
  assert.equal(action().getAttribute('aria-pressed'), 'true'); assert.ok(action().parentElement.classList.contains('sim-row--active'));
  source.classList.replace('dock__item--active', 'dock__item--activefocus');
  await new Promise(resolve => setTimeout(resolve, 180));
  assert.ok(action().parentElement.classList.contains('sim-row--activefocus'));
  source.classList.remove('dock__item--activefocus');
  await new Promise(resolve => setTimeout(resolve, 180));
  assert.equal(action().getAttribute('aria-pressed'), 'false');
  assert.equal(action().parentElement.classList.contains('sim-row--activefocus'), false);
  f.dispose();
});

test('one primary click opens the actual native submenu outside the card and keeps handlers intact', async () => {
  const f = await fixture(); const p = f.plugin; const doc = f.win.document;
  const native = nativeMenuFixture(f); doc.getElementById('barMore').onclick = native.open;
  p.enter(); p.openMenu();
  p.menu.getBoundingClientRect = () => ({ left: 640, right: 950, top: 60, width: 310, height: 560 });
  native.menu.getBoundingClientRect = () => ({ width: 220, height: 180 });
  const trigger = p.menu.querySelector('[data-action-key="top:barMore"]');
  trigger.getBoundingClientRect = () => ({ top: 150, bottom: 180, left: 648, right: 920, width: 272, height: 30 });
  trigger.click();
  assert.equal(p.submenu, native.menu); assert.equal(native.menu.parentElement, doc.body);
  assert.equal(native.counts().opens, 1); assert.equal(native.counts().executions, 0);
  assert.equal(native.menu.style.getPropertyValue('--sim-submenu-left'), '412px');
  assert.equal(native.menu.style.getPropertyValue('--sim-submenu-top'), '150px');
  assert.equal(doc.querySelector('.sim-submenu-action'), null, 'no intermediary open button');
  native.choice.dispatchEvent(new f.win.PointerEvent('pointerdown', { bubbles: true }));
  assert.ok(p.menu); assert.equal(p.submenu, native.menu);
  native.choice.click(); await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(native.counts().executions, 1); assert.equal(p.submenu, null); assert.ok(p.menu);
  assert.equal(native.menu.classList.contains('sim-native-submenu'), false);
  trigger.click();
  doc.dispatchEvent(new f.win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(p.submenu, null); assert.ok(p.menu); assert.equal(doc.activeElement, trigger);
  assert.equal(native.menu.style.getPropertyValue('--sim-submenu-left'), '');
  trigger.click(); p.leave();
  assert.equal(native.menu.parentElement, doc.body); assert.equal(p.nativeMenuObserver, null);
  assert.equal(native.menu.classList.contains('fn__none'), true);
  f.dispose();
});

test('async native submenu is adopted without a second click and late results after exit stay untouched', async () => {
  const f = await fixture(); const p = f.plugin; const doc = f.win.document;
  const native = nativeMenuFixture(f);
  doc.getElementById('barMore').onclick = () => setTimeout(native.open, 20);
  p.enter(); p.openMenu(); p.menu.querySelector('[data-action-key="top:barMore"]').click();
  assert.equal(p.submenu, null);
  await new Promise(resolve => setTimeout(resolve, 60));
  assert.equal(p.submenu, native.menu); assert.equal(native.counts().opens, 1);
  p.closeMenu(); assert.equal(p.nativeMenuObserver, null);
  p.openMenu(); p.menu.querySelector('[data-action-key="top:barMore"]').click(); p.leave();
  await new Promise(resolve => setTimeout(resolve, 60));
  assert.equal(native.menu.classList.contains('sim-native-submenu'), false);
  assert.equal(p.submenu, null); assert.equal(p.submenuTimer, null);
  f.dispose();
});

test('document tree and agent dock reuse their original click logic even with data-menu attributes', async () => {
  const f = await fixture(); const p = f.plugin; const doc = f.win.document;
  const agent = doc.createElement('button'); agent.className = 'dock__item'; agent.dataset.type = 'agentChat'; doc.getElementById('dockRight').append(agent);
  const file = doc.querySelector('[data-type="file"]');
  let opened = [];
  for (const source of [file, agent]) {
    source.dataset.menu = 'true'; source.setAttribute('aria-haspopup', 'menu');
    source.onclick = () => opened.push(source.dataset.type);
  }
  p.enter();
  for (const source of [file, agent]) {
    const parent = source.parentNode; p.openMenu();
    p.menu.querySelector(`[data-action-key="dock:${source.dataset.type}"]`).click();
    assert.equal(p.menu, null); assert.equal(p.submenu, null); assert.equal(source.parentNode, parent);
  }
  assert.deepEqual(opened, ['file', 'agentChat']); f.dispose();
});

test('unload restores temporary geometry methods exactly', async () => {
  const f = await fixture(); const p = f.plugin; p.enter();
  const source = f.win.document.querySelector('#barSearch'); const original = source.getBoundingClientRect;
  p.invokeSource(source); assert.notEqual(source.getBoundingClientRect, original);
  p.onunload(); assert.equal(source.getBoundingClientRect, original);
  assert.equal(f.win.document.querySelector('.sim-orb'), null); f.dispose();
});

test('desktop and browser never create a hover drag bar or call the native bridge', async () => {
  for (const frontend of ['desktop', 'browser-desktop']) {
    const f = await fixture({ frontend }); let bridgeCalls = 0;
    f.win.require = () => { bridgeCalls++; throw new Error('Native bridge must not be used'); };
    f.plugin.enter();
    f.win.document.dispatchEvent(new f.win.PointerEvent('pointermove', { clientX: 500, clientY: 1 }));
    assert.equal(f.win.document.querySelector('.sim-drag-hint'), null);
    assert.equal(bridgeCalls, 0);
    assert.equal(f.messages.length, 0);
    assert.equal(f.plugin.active, true);
    f.dispose();
  }
});

test('reference native tools include hidden-at-100-percent Zoom but not absent or disabled tools', async () => {
  const f = await fixture(); const doc = f.win.document;
  const toolbarIds = ['barPlugins', 'barCommand', 'barSearch', 'barSync', 'barMode', 'barZoom', 'barMore'];
  const dockTypes = ['file', 'outline', 'inbox', 'bookmark', 'tag', 'agentChat', 'graph', 'globalGraph', 'backlink'];
  for (const id of toolbarIds) {
    if (doc.getElementById(id)) continue;
    const node = doc.createElement('button'); node.id = id; node.className = 'toolbar__item';
    if (id === 'barZoom') node.classList.add('fn__none');
    doc.querySelector('#toolbar').append(node);
  }
  for (const type of dockTypes) {
    if (doc.querySelector('.dock__item[data-type="' + type + '"]')) continue;
    const node = doc.createElement('button'); node.className = 'dock__item'; node.dataset.type = type;
    doc.querySelector('#dockLeft').append(node);
  }
  const zoom = doc.getElementById('barZoom'); let calls = 0;
  zoom.addEventListener('click', () => calls++);
  f.plugin.enter(); f.plugin.openMenu();
  for (const key of [...toolbarIds.map(id => 'top:' + id), ...dockTypes.map(type => 'dock:' + type)]) {
    assert.equal(f.plugin.menu.querySelectorAll('.sim-action[data-action-key="' + key + '"]').length, 1, key);
  }
  f.plugin.menu.querySelector('.sim-action[data-action-key="top:barZoom"]').click();
  assert.equal(calls, 1);
  assert.ok(zoom.classList.contains('fn__none'), 'source visibility must not be changed');
  doc.querySelector('[data-type="inbox"]').remove();
  doc.getElementById('barSync').disabled = true;
  const actions = f.plugin.actions();
  assert.equal(actions.some(x => x.key === 'dock:inbox' || x.key === 'top:barSync'), false);
  f.dispose();
});

test('registered plugin buttons remain reachable after another collector moves them', async () => {
  const f = await fixture(); const doc = f.win.document;
  const moved = doc.createElement('button'); moved.id = 'plugin_relocated'; moved.dataset.menu = 'true';
  const container = doc.createElement('div'); container.hidden = true; doc.body.append(container); container.append(moved);
  f.plugin.app.plugins = [{ name: 'relocated', displayName: '测试插件', topBarIcons: [moved] }];
  let calls = 0; moved.onclick = () => calls++;
  f.plugin.enter(); f.plugin.openMenu();
  const buttons = f.plugin.menu.querySelectorAll('.sim-action[data-action-key="top:plugin_relocated"]');
  assert.equal(buttons.length, 1); assert.equal(buttons[0].getAttribute('aria-label'), '测试插件');
  buttons[0].click(); assert.equal(f.plugin.submenu, null);
  assert.equal(calls, 1); assert.equal(moved.parentNode, container);
  moved.remove();
  assert.equal(f.plugin.actions().some(x => x.key === 'top:plugin_relocated'), false);
  f.dispose();
});

test('entry and exit use supplied vectors while control dock uses SiYuan icon symbols', async () => {
  const f = await fixture({ frontend: 'desktop' }); const p = f.plugin;
  const enter = p.topButton.querySelectorAll('path')[1].getAttribute('d');
  assert.ok(enter.startsWith('M775.314286 204.8'));
  assert.equal(p.topButton.querySelector('svg').getAttribute('viewBox'), '0 0 1024 1024');
  p.enter(); p.openMenu();
  const exit = p.windowActions.querySelector('[data-control-key="exit"] path:last-child').getAttribute('d');
  assert.ok(exit.startsWith('M811.885714 438.857143'));
  assert.equal(p.topButton.querySelector('path:last-child').getAttribute('d'), exit);
  for (const [key, icon] of [['minimize','iconMin'],['maximize','iconMax'],['close','iconClose']]) {
    assert.equal(p.windowActions.querySelector(`[data-control-key="${key}"] use`).getAttribute('href'), `#${icon}`);
  }
  f.win.document.body.classList.add('body--maximize');
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(p.windowActions.querySelector('[data-control-key="maximize"] use').getAttribute('href'), '#iconRestore');
  p.leave(); assert.equal(p.topButton.querySelector('path:last-child').getAttribute('d'), enter);
  f.dispose();
});

test('moving to direct actions, another menu, tabs or settings dismisses the previous child without executing commands', async () => {
  const f = await fixture(); const p = f.plugin; const doc = f.win.document;
  const native = nativeMenuFixture(f); doc.getElementById('barMore').onclick = native.open;
  const next = doc.createElement('button'); next.id = 'barPlugins'; next.className = 'toolbar__item'; next.onclick = native.open; doc.getElementById('toolbar').append(next);
  let calls = 0; doc.getElementById('barSearch').onclick = () => calls++; doc.querySelector('[data-type="file"]').onclick = () => calls++;
  p.enter(); p.openMenu();
  for (const selector of ['[data-action-key="top:barSearch"]', '[data-action-key="dock:file"]', '.sim-menu-tabs', '.sim-plugin-settings']) {
    p.menu.querySelector('[data-action-key="top:barMore"]').click(); assert.equal(p.submenu, native.menu);
    const item = p.menu.querySelector(selector);
    (item.closest('.sim-row') || item).dispatchEvent(new f.win.PointerEvent('pointerenter', { pointerType: 'mouse' }));
    assert.equal(p.submenu, null); assert.equal(native.menu.classList.contains('fn__none'), true); assert.equal(calls, 0);
  }
  p.menu.querySelector('[data-action-key="top:barMore"]').click();
  // pointerenter does not bubble: dispatch on the row as a real pointer crossing does.
  p.menu.querySelector('[data-action-key="top:barPlugins"]').parentElement.dispatchEvent(new f.win.PointerEvent('pointerenter', { pointerType: 'mouse' }));
  assert.equal(p.submenu, null);
  await new Promise(resolve => setTimeout(resolve, 220));
  assert.equal(p.submenu, native.menu); assert.equal(p.submenuAction.key, 'top:barPlugins');
  f.dispose();
});

test('Dock grouping follows actual SiYuan slots, distinguishes side-bottom from bottom panel and follows moves', async () => {
  const f = await fixture(); const doc = f.win.document;
  for (const side of ['Left', 'Right']) {
    doc.getElementById('dock' + side).innerHTML = '<div class="dock__items"></div><div class="dock__split"></div><div class="dock__items"></div><div class="dock__item--space"></div><div class="dock__items"></div>';
  }
  const nodes = new Map();
  for (const [side, slot, type] of [['Left', 0, 'file'], ['Left', 1, 'outline'], ['Left', 2, 'graph'], ['Right', 0, 'agentChat'], ['Right', 1, 'backlink'], ['Right', 2, 'globalGraph']]) {
    const node = doc.createElement('button'); node.className = 'dock__item'; node.dataset.type = type;
    doc.querySelectorAll('#dock' + side + ' .dock__items')[slot].append(node); nodes.set(type, node);
  }
  const groups = () => Object.fromEntries(f.plugin.actions().map(action => [action.key, action.group]));
  assert.equal(groups()['dock:file'], 'left'); assert.equal(groups()['dock:outline'], 'left');
  assert.equal(groups()['dock:agentChat'], 'right'); assert.equal(groups()['dock:backlink'], 'right');
  assert.equal(groups()['dock:graph'], 'bottom'); assert.equal(groups()['dock:globalGraph'], 'bottom');
  assert.equal(groups()['top:barSearch'], 'top');
  f.plugin.app.plugins = [{ docks: { graph: { config: { position: 'BottomLeft' } } } }];
  doc.querySelector('#dockRight .dock__items').append(nodes.get('graph'));
  assert.equal(groups()['dock:graph'], 'right', 'actual location overrides stale registration');
  f.dispose();
});

test('relocated Dock uses host ownership or plugin position, unknown location is never invented', async () => {
  const f = await fixture(); const doc = f.win.document;
  const container = doc.createElement('div'); doc.body.append(container);
  for (const type of ['moved-bottom', 'moved-left-bottom', 'moved-right-bottom', 'unlocated', 'graph']) {
    const node = doc.createElement('button'); node.className = 'dock__item'; node.dataset.type = type; node.title = type; container.append(node);
  }
  f.plugin.app.plugins = [{ docks: { 'moved-bottom': { config: { position: 'BottomRight' } }, 'moved-left-bottom': { config: { position: 'LeftBottom' } }, 'moved-right-bottom': { config: { position: 'RightBottom' } } } }];
  f.win.siyuan = { layout: { bottomDock: { data: { graph: {} } } } };
  const groups = Object.fromEntries(f.plugin.actions().map(action => [action.key, action.group]));
  assert.equal(groups['dock:moved-bottom'], 'bottom'); assert.equal(groups['dock:moved-left-bottom'], 'left');
  assert.equal(groups['dock:moved-right-bottom'], 'right'); assert.equal(groups['dock:unlocated'], 'unknown-dock');
  assert.equal(groups['dock:graph'], 'bottom'); f.dispose();
});

test('card displays location groups and moved actions follow their current group without duplicates', async () => {
  const f = await fixture(); const p = f.plugin; p.enter(); p.openMenu();
  assert.deepEqual([...p.menu.querySelectorAll('[data-action-group]')].map(el => el.dataset.actionGroup), ['left', 'top']);
  assert.equal(p.menu.querySelector('[data-action-group="bottom"]'), null);
  f.win.document.getElementById('dockRight').append(f.win.document.querySelector('[data-type="things"]'));
  p.renderMenu();
  assert.ok(p.menu.querySelector('[data-action-group="right"] .sim-action[data-action-key="dock:things"]'));
  assert.equal(p.menu.querySelectorAll('.sim-action[data-action-key="dock:things"]').length, 1); f.dispose();
});

test('Windows topbar setting is off by default, applies live, persists and cleans up without changing native nodes', async () => {
  const f = await fixture({ frontend: 'desktop' }); const p = f.plugin; const doc = f.win.document;
  const source = doc.getElementById('barSearch'); let calls = 0; source.onclick = () => calls++;
  const control = p.setting.items.find(item => item.title === 'Windows：保留顶部工具栏').createActionElement();
  assert.equal(control.checked, false); assert.equal(control.disabled, false);
  p.enter(); assert.equal(doc.body.classList.contains('sim-keep-topbar'), false);
  for (let i = 0; i < 3; i++) {
    control.checked = true; control.dispatchEvent(new f.win.Event('change'));
    assert.ok(doc.body.classList.contains('sim-keep-topbar'));
    assert.equal(p.actions().some(action => action.key === 'builtin:toolbar'), false);
    p.clearNativeTools(); p.openMenu(); p.closeMenu();
    doc.dispatchEvent(new f.win.KeyboardEvent('keydown', { key: 'Escape' }));
    assert.ok(doc.body.classList.contains('sim-keep-topbar'));
    assert.equal(doc.getElementById('barSearch'), source); source.click();
    control.checked = false; control.dispatchEvent(new f.win.Event('change'));
    assert.equal(doc.body.classList.contains('sim-keep-topbar'), false);
  }
  assert.equal(calls, 3);
  control.checked = true; control.dispatchEvent(new f.win.Event('change')); await p.pendingSave;
  assert.equal(f.saves.at(-1).data.windowsTopBar, true);
  p.leave(); assert.equal(doc.body.classList.contains('sim-keep-topbar'), false);
  p.enter(); assert.ok(doc.body.classList.contains('sim-keep-topbar'));
  const saved = f.saves.at(-1).data; f.dispose(); assert.equal(doc.body.classList.contains('sim-keep-topbar'), false);
  const restarted = await fixture({ frontend: 'desktop', saved });
  assert.equal(restarted.plugin.active, false); restarted.plugin.enter();
  assert.ok(restarted.win.document.body.classList.contains('sim-keep-topbar')); restarted.dispose();
});

test('Windows setting cannot activate on browser, Docker, Linux or macOS even with synced preferences', async () => {
  for (const options of [{ frontend: 'browser-desktop' }, { frontend: 'desktop', backend: 'docker' }, { frontend: 'desktop', platform: 'Linux x86_64', backend: 'linux' }, { frontend: 'desktop', platform: 'MacIntel', backend: 'darwin' }]) {
    const f = await fixture({ ...options, saved: { windowsTopBar: true } });
    const control = f.plugin.setting.items.find(item => item.title === 'Windows：保留顶部工具栏').createActionElement();
    assert.equal(control.disabled, true); f.plugin.enter();
    assert.equal(f.win.document.body.classList.contains('sim-keep-topbar'), false);
    assert.equal(f.win.document.body.classList.contains('sim-window-strip'), false);
    assert.equal(f.win.getComputedStyle(f.win.document.getElementById('toolbar')).display, 'none');
    control.dispatchEvent(new f.win.Event('change'));
    assert.equal(f.saves.length, 0); f.dispose();
  }
});

test('kept Windows toolbar overrides merged-title drag suppression without making controls draggable', async () => {
  const f = await fixture({ frontend: 'desktop', saved: { windowsTopBar: true } });
  const doc = f.win.document; const drag = doc.getElementById('drag'); const min = doc.getElementById('minWindow');
  const style = el => f.win.getComputedStyle(el);
  assert.equal(style(drag).getPropertyValue('-webkit-app-region'), 'none');
  f.plugin.enter();
  assert.equal(style(drag).getPropertyValue('-webkit-app-region'), 'drag');
  assert.equal(style(min).getPropertyValue('-webkit-app-region'), 'no-drag');
  assert.equal(style(doc.getElementById('barSearch')).getPropertyValue('-webkit-app-region'), 'no-drag');
  assert.equal(style(doc.getElementById('toolbar')).backgroundColor, 'transparent');
  assert.equal(style(doc.body).getPropertyValue('--sim-topbar-height'), '28px');
  assert.equal(style(min).height, '28px');
  let calls = 0; min.onclick = () => calls++; min.click(); assert.equal(calls, 1);
  f.plugin.leave();
  assert.equal(style(drag).getPropertyValue('-webkit-app-region'), 'none');
  assert.equal(style(min).height, '42px');
  assert.equal(doc.getElementById('drag'), drag); f.dispose();
});

test('kept toolbar preserves native tab nodes, host offsets and click/contextmenu/pointer handlers', async () => {
  const f = await fixture({ frontend: 'desktop' }); const doc = f.win.document; const p = f.plugin;
  const tab = doc.querySelector('[data-id="doc-2"]'); const row = tab.parentElement.parentElement;
  row.style.visibility = 'hidden'; row.style.paddingLeft = '95px';
  const style = el => f.win.getComputedStyle(el);
  const events = []; for (const name of ['click', 'contextmenu', 'pointerdown']) tab.addEventListener(name, () => events.push(name));
  // Happy DOM does not implement the relative :has(> ...) selector correctly;
  // actual tab visibility and reserved space are checked in Chromium preview.
  p.enter(); assert.equal(doc.body.classList.contains('sim-keep-topbar'), false);
  p.settingsData.windowsTopBar = true; p.applyTopBarSetting();
  assert.equal(doc.body.classList.contains('sim-keep-topbar'), true);
  assert.equal(row.classList.contains('sim-merged-tabs'), true);
  assert.equal(style(row).position, 'fixed'); assert.equal(style(row).top, 'calc(8px / 2)');
  assert.equal(row.parentElement.getAttribute('data-type'), 'wnd');
  assert.equal(row.style.visibility, 'hidden'); assert.equal(row.style.paddingLeft, '95px');
  assert.equal(style(tab).getPropertyValue('-webkit-app-region'), 'no-drag');
  tab.click(); tab.dispatchEvent(new f.win.MouseEvent('contextmenu', { bubbles: true }));
  tab.dispatchEvent(new f.win.PointerEvent('pointerdown', { bubbles: true }));
  assert.deepEqual(events, ['click', 'contextmenu', 'pointerdown']);
  assert.equal(doc.querySelector('[data-id="doc-2"]'), tab);
  p.settingsData.windowsTopBar = false; p.applyTopBarSetting(); assert.equal(doc.body.classList.contains('sim-keep-topbar'), false);
  p.leave(); assert.equal(style(row).display, 'flex'); assert.equal(style(row).visibility, 'hidden');
  assert.equal(style(row).paddingLeft, '95px'); f.dispose();
});

test('visible full toolbar removes top actions; full immersion keeps those actions in the card', async () => {
  const f = await fixture({ frontend: 'desktop', saved: { favorites: ['top:barSearch', 'dock:file', 'builtin:toolbar'] } });
  const p = f.plugin; p.enter(); p.openMenu();
  assert.ok(p.menu.querySelector('[data-action-group="top"] [data-action-key="top:barSearch"]'));
  p.settingsData.windowsTopBar = true; p.applyTopBarSetting();
  assert.equal(p.actions().some(action => action.group === 'top'), false);
  assert.equal(p.menu.querySelector('[data-action-key="top:barSearch"]'), null);
  assert.equal(p.menu.querySelector('[data-action-group="top"]'), null);
  assert.equal(p.menu.querySelector('.sim-menu-tabs, .sim-window-actions'), null);
  assert.equal(f.win.document.querySelector('.sim-window-actions'), null);
  assert.equal(p.windowActions, null);
  assert.ok(p.menu.querySelector('[data-action-group="left"] [data-action-key="dock:file"]'));
  assert.deepEqual(Array.from(p.settingsData.favorites), ['top:barSearch', 'dock:file', 'builtin:toolbar']);
  p.settingsData.windowsTopBar = false; p.applyTopBarSetting();
  assert.ok(p.menu.querySelector('[data-action-group="top"] [data-action-key="top:barSearch"]'));
  assert.ok(p.menu.querySelector('[data-action-group="top"] [data-action-key="builtin:toolbar"]'));
  f.dispose();
});

test('nonempty groups follow left-top-right-bottom and a removed group disappears', async () => {
  const f = await fixture(); const doc = f.win.document; const p = f.plugin;
  doc.getElementById('dockRight').innerHTML = '<button class="dock__item" data-type="agentChat" title="智能助手"></button>';
  const bottom = doc.createElement('div'); bottom.id = 'dockBottom'; bottom.innerHTML = '<button class="dock__item" data-type="graph" title="关系图"></button>'; doc.body.append(bottom);
  p.enter(); p.openMenu();
  const groups = () => [...p.menu.querySelectorAll('[data-action-group]')].map(el => el.dataset.actionGroup);
  assert.deepEqual(groups(), ['left', 'top', 'right', 'bottom']);
  bottom.remove(); p.renderMenu(); assert.equal(groups().includes('bottom'), false);
  f.dispose();
});

test('merged tab slots remain in free toolbar area and reserve 48px for dragging', () => {
  assert.deepEqual(mergedTabSlots(100, 700, []), []);
  for (const weights of [[1], [1, 1], [200, 700, 400], [0, NaN, -1]]) {
    const slots = mergedTabSlots(100, 700, weights);
    assert.equal(slots.length, weights.length);
    for (let i = 0; i < slots.length; i++) {
      assert.ok(slots[i].left >= 104 && slots[i].width >= 0);
      assert.ok(slots[i].left + slots[i].width <= 652.001);
      if (i) assert.ok(slots[i].left >= slots[i-1].left + slots[i-1].width);
    }
  }
  assert.equal(mergedTabSlots(100, 125, [1])[0].width, 0);
});

test('split panes share one toolbar row without reparenting; resize/hide/remove restores only plugin-owned properties', async () => {
  const f = await fixture({ frontend: 'desktop', saved: { windowsTopBar: true } }); const doc = f.win.document; const p = f.plugin;
  const first = doc.querySelector('[data-type="wnd"]');
  const second = first.cloneNode(true); second.classList.remove('layout__wnd--active'); first.parentElement.append(second);
  second.getBoundingClientRect = () => ({ left: 500, right: 900, top: 40, bottom: 640, width: 400, height: 600 });
  const row1 = first.firstElementChild, row2 = second.firstElementChild;
  row2.style.setProperty('--sim-tabs-left', '7px', 'important');
  p.enter(); assert.equal(p.mergedRows.size, 2);
  const right1 = parseFloat(row1.style.getPropertyValue('--sim-tabs-left')) + parseFloat(row1.style.getPropertyValue('--sim-tabs-width'));
  assert.ok(parseFloat(row2.style.getPropertyValue('--sim-tabs-left')) >= right1);
  assert.equal(row1.parentElement, first); assert.equal(row2.parentElement, second);
  const before = parseFloat(row2.style.getPropertyValue('--sim-tabs-width'));
  doc.getElementById('drag').getBoundingClientRect = () => ({ left: 250, right: 950, top: 0, bottom: 32, width: 700, height: 32 });
  p.syncMergedTabs(); assert.ok(parseFloat(row2.style.getPropertyValue('--sim-tabs-width')) > before);
  assert.equal(row1.style.getPropertyValue('--sim-tabs-left'), '100px');
  assert.equal(row2.style.getPropertyValue('--sim-tabs-left'), '500px');
  second.classList.add('fn__none'); p.syncMergedTabs(); assert.equal(p.mergedRows.size, 1);
  assert.equal(row2.style.getPropertyValue('--sim-tabs-left'), '7px');
  assert.equal(row2.style.getPropertyPriority('--sim-tabs-left'), 'important');
  second.classList.remove('fn__none'); p.syncMergedTabs(); assert.equal(p.mergedRows.size, 2);
  second.remove(); p.syncMergedTabs(); assert.equal(row2.classList.contains('sim-merged-tabs'), false);
  p.queueMergedTabs(); p.leave();
  assert.equal(p.mergedRows.size, 0); assert.equal(p.tabLayoutFrame, null); assert.equal(p.tabMergeObserver, null);
  assert.equal(p.tabResizeObserver, null); assert.equal(p.tabResizeTargets.size, 0);
  assert.equal(row1.style.getPropertyValue('--sim-tabs-left'), '');
  f.dispose();
});

test('overflow threshold excludes switcher width and tolerates subpixel rounding without oscillation', () => {
  assert.equal(tabsOverflow(0, 0, 28), false);
  assert.equal(tabsOverflow(400, 400), false);
  assert.equal(tabsOverflow(400.6, 400), false);
  assert.equal(tabsOverflow(402, 400), true);
  assert.equal(tabsOverflow(450, 400, 28), true);
  assert.equal(tabsOverflow(420, 400, 28), false, 'switcher is the only cause of overflow');
  assert.equal(tabsOverflow(428, 428, 0), false, 'still fits after switcher hides');
});

test('native tab switcher only appears on overflow while plus and original handlers remain intact', async () => {
  const f = await fixture({ frontend: 'desktop', saved: { windowsTopBar: true } }); const p = f.plugin; const doc = f.win.document;
  const list = doc.querySelector('.layout-tab-bar:not(.layout-tab-bar--readonly)');
  const more = doc.querySelector('.layout-tab-bar--readonly [data-type="more"]'); const plus = doc.querySelector('.layout-tab-bar--readonly [data-type="new"]');
  let contentWidth = 180, availableWidth = 400;
  Object.defineProperty(list, 'scrollWidth', { configurable: true, get: () => contentWidth });
  Object.defineProperty(list, 'clientWidth', { configurable: true, get: () => availableWidth });
  more.getBoundingClientRect = () => ({ width: more.classList.contains('sim-tab-switch-hidden') ? 0 : 28 });
  const originalParent = more.parentElement; let calls = 0; more.onclick = () => calls++; plus.onclick = () => calls += 10;
  p.enter(); assert.equal(more.classList.contains('sim-tab-switch-hidden'), true); assert.equal(plus.classList.contains('sim-tab-switch-hidden'), false);
  contentWidth = 700; p.syncMergedTabs(); assert.equal(more.classList.contains('sim-tab-switch-hidden'), false);
  more.click(); plus.click(); assert.equal(calls, 11); assert.equal(more.parentElement, originalParent);
  contentWidth = 420; p.syncMergedTabs(); assert.equal(more.classList.contains('sim-tab-switch-hidden'), true);
  availableWidth = 428; p.syncMergedTabs(); assert.equal(more.classList.contains('sim-tab-switch-hidden'), true);
  contentWidth = 900; p.syncMergedTabs(); assert.equal(more.classList.contains('sim-tab-switch-hidden'), false);
  availableWidth = 1000; p.syncMergedTabs(); assert.equal(more.classList.contains('sim-tab-switch-hidden'), true);
  p.leave(); assert.equal(more.classList.contains('sim-tab-switch-hidden'), false); assert.equal(p.tabSwitchers.size, 0);
  f.dispose();
});

test('toolbar, tab background and readonly spacer drag; real buttons, input and document tabs do not', async () => {
  const f = await fixture({ frontend: 'desktop', saved: { windowsTopBar: true } }); const doc = f.win.document;
  const label = doc.createElement('label'); const input = doc.createElement('input'); input.type = 'checkbox'; label.append(input); doc.getElementById('toolbar').append(label);
  f.plugin.enter(); const region = el => f.win.getComputedStyle(el).getPropertyValue('-webkit-app-region');
  for (const selector of ['#toolbar', '#drag', '#windowControls', '.sim-merged-tabs', '.sim-merged-tabs > .layout-tab-bar', '.item--readonly', '.item--readonly > .fn__flex-1']) {
    assert.equal(region(doc.querySelector(selector)), 'drag', selector);
  }
  for (const selector of ['#minWindow', '#barSearch', '[data-id="doc-1"]', '.block__icon[data-type="new"]', '.block__icon[data-type="more"]']) {
    assert.equal(region(doc.querySelector(selector)), 'no-drag', selector);
  }
  assert.equal(region(label), 'no-drag'); assert.equal(region(input), 'no-drag');
  f.dispose();
});

test('removed or replaced switcher is restored and observer tracks tab widths for title changes', async () => {
  const f = await fixture({ frontend: 'desktop', saved: { windowsTopBar: true } }); const p = f.plugin; const doc = f.win.document;
  p.enter(); const more = doc.querySelector('.layout-tab-bar--readonly [data-type="more"]'); const parent = more.parentElement;
  assert.ok(p.tabResizeTargets.has(doc.querySelector('[data-id="doc-1"]')));
  more.remove(); p.syncMergedTabs(); assert.equal(more.classList.contains('sim-tab-switch-hidden'), false); assert.equal(p.tabSwitchers.has(more), false);
  const replacement = more.cloneNode(true); parent.append(replacement); p.syncMergedTabs();
  assert.equal(replacement.classList.contains('sim-tab-switch-hidden'), true);
  p.settingsData.windowsTopBar = false; p.applyTopBarSetting();
  assert.equal(replacement.classList.contains('sim-tab-switch-hidden'), false); assert.equal(p.tabSwitchers.size, 0);
  f.dispose();
});

test('resizing an open card keeps its page actions and control dock exit available', async () => {
  const f = await fixture(); f.plugin.enter(); f.plugin.openMenu();
  f.sandbox.innerWidth = 420; f.sandbox.innerHeight = 280;
  f.win.dispatchEvent(new f.win.Event('resize'));
  assert.ok([...f.plugin.menu.querySelectorAll('button')].some(x => x.textContent.includes('文档二')));
  assert.equal(f.plugin.windowActions.querySelector('[data-control-key="exit"]').getAttribute('aria-label'), '退出沉浸');
  f.dispose();
});

test('card scrolls tabs with grouped actions while keeping the control dock fixed inside its bottom', async () => {
  const f = await fixture({ width: 420, height: 280 }); const p = f.plugin; p.enter(); p.openMenu();
  assert.equal(p.menu.querySelectorAll('.sim-menu-tabs .sim-tab').length, 2);
  assert.ok(p.menu.querySelector('.sim-menu-other-scroll .sim-tab'));
  assert.equal(p.menu.querySelectorAll('.sim-menu-other-scroll .sim-window-actions').length, 0);
  assert.equal(p.windowActions.parentElement, p.menu);
  assert.equal(p.menu.lastElementChild, p.windowActions);
  assert.equal(p.menu.querySelectorAll('.sim-action[data-action-key="dock:things"]').length, 1);
  assert.ok(p.orb.classList.contains('sim-orb--active'));
  assert.ok(p.menu.querySelector('.sim-menu-other-scroll .sim-action[data-action-key="dock:things"]'));
  assert.equal(p.menu.querySelector('.sim-star, .sim-menu-favorites'), null);
  p.windowActions.querySelector('[data-control-key="exit"]').click();
  assert.equal(p.active, false);
  assert.equal(p.menu, null);
  f.dispose();
});

test('initialization failure restores chrome and mobile remains untouched', async () => {
  const f = await fixture({ frontend: 'desktop', saved: { windowsTopBar: true } }); f.plugin.markLayoutRows = () => { throw new Error('test'); };
  f.plugin.enter(); assert.equal(f.plugin.active, false);
  assert.equal(f.win.document.body.classList.contains('sim-active'), false);
  assert.equal(f.win.document.body.classList.contains('sim-keep-topbar'), false);
  assert.equal(f.win.document.querySelector('.sim-orb'), null); f.dispose();
  const m = await fixture({ frontend: 'mobile' }); m.plugin.enter();
  assert.equal(m.plugin.active, false); assert.equal(m.plugin.topButton, undefined); m.dispose();
});

test('save failure is surfaced without breaking exit', async () => {
  const f = await fixture({ failSave: true }); f.plugin.enter(); await f.plugin.savePreferences();
  assert.ok(f.messages.some(x => x[0].includes('保存失败'))); f.plugin.leave(); assert.equal(f.plugin.active, false); f.dispose();
});

test('full immersion hides the whole toolbar and leaves native controls untouched', async () => {
  const f = await fixture({ frontend: 'desktop' }); const p = f.plugin; const doc = f.win.document;
  const style = selector => f.win.getComputedStyle(doc.querySelector(selector));
  const toolbar = doc.getElementById('toolbar'); const originalChildren = [...toolbar.children];
  p.enter();
  assert.equal(doc.body.classList.contains('sim-window-strip'), false);
  assert.equal(style('#toolbar').display, 'none');
  assert.equal(f.win.getComputedStyle(doc.body).getPropertyValue('--sim-topbar-height'), '0px');
  assert.equal(doc.querySelector('.sim-minimize'), null); assert.equal(p.mergedRows.size, 0);
  p.openMenu(); assert.ok(p.menu.querySelector('[data-action-key="top:barSearch"]'));
  p.revealToolbar(); assert.equal(style('#toolbar').display, 'flex');
  p.clearNativeTools(); assert.equal(style('#toolbar').display, 'none');
  p.settingsData.windowsTopBar = true; p.applyTopBarSetting();
  assert.equal(style('#toolbar').display, 'flex'); assert.equal(style('#toolbar').height, '28px');
  p.settingsData.windowsTopBar = false; p.applyTopBarSetting();
  assert.ok(p.menu.querySelector('.sim-menu-tabs'));
  assert.equal(p.menu.querySelectorAll('.sim-window-button').length, 4);
  assert.equal(p.windowActions.querySelectorAll('.sim-window-button').length, 4);
  assert.equal(style('#toolbar').display, 'none');
  p.leave(); assert.equal(doc.body.classList.contains('sim-window-strip'), false);
  assert.notEqual(style('#barSearch').display, 'none'); assert.equal(style('#toolbar').height, '42px');
  assert.deepEqual([...toolbar.children], originalChildren);
  assert.equal(doc.body.classList.contains('body--maximize'), false, 'host window state is never overwritten');
  f.dispose();
  // Separate initial-state fixture avoids Happy DOM's stale ancestor matches;
  // live maximize/restore transitions are also exercised in Chromium preview.
  const maximized = await fixture({ frontend: 'desktop', maximized: true }); maximized.plugin.enter();
  maximized.plugin.leave(); assert.ok(maximized.win.document.body.classList.contains('body--maximize')); maximized.dispose();
});

test('panels use four equal borders without a second center-wrapper border and restore native styling', async () => {
  const f = await fixture(); const doc = f.win.document;
  const panel = doc.querySelector('.layout-tab-container'); panel.style.border = '2px solid red';
  f.plugin.enter();
  for (const node of [panel, doc.querySelector('#sidebar')]) {
    const style = f.win.getComputedStyle(node);
    assert.deepEqual(['Top', 'Right', 'Bottom', 'Left'].map(side => style['border' + side + 'Width']), ['1px', '1px', '1px', '1px']);
    assert.equal(style.borderRadius, '12px');
  }
  assert.equal(f.win.getComputedStyle(doc.querySelector('.layout__center')).borderTopWidth, '0px');
  f.plugin.leave(); assert.equal(f.win.getComputedStyle(panel).borderTopWidth, '2px'); f.dispose();
});

test('collapsed zero-size side and bottom Dock shells leave no gray outline', async () => {
  const f = await fixture(); const doc = f.win.document;
  const right = doc.createElement('div'); right.className = 'layout__dockr'; right.style.cssText = 'width: 0px; min-height: 8px;';
  const bottom = doc.createElement('div'); bottom.className = 'layout__dockb'; bottom.style.height = '0px';
  doc.querySelector('#main-row').append(right); doc.body.append(bottom); f.plugin.enter();
  for (const node of [right, bottom]) {
    const style = f.win.getComputedStyle(node);
    assert.deepEqual(['Top', 'Right', 'Bottom', 'Left'].map(side => style['border' + side + 'Width']), ['0px', '0px', '0px', '0px']);
    assert.equal(style.boxShadow, 'none');
  }
  f.dispose();
});

test('tab count setting clamps invalid values, applies live and survives reload', async () => {
  for (const [value, expected] of [[0, 1], [-9, 1], [2.9, 2], [200, 20], [NaN, 5], [Infinity, 5], ['2', 5]]) {
    assert.equal(normalizeSettings({ tabPreviewCount: value }).tabPreviewCount, expected);
  }
  const f = await fixture(); const p = f.plugin; p.enter(); p.openMenu();
  const input = p.setting.items.find(item => item.title === '页签默认展示数量').createActionElement();
  assert.equal(input.value, '5');
  input.value = '1'; input.dispatchEvent(new f.win.Event('input')); await p.pendingSave;
  assert.equal(p.menu.querySelectorAll('.sim-tab').length, 1);
  assert.equal(p.menu.querySelector('.sim-tabs-toggle').textContent, '展开其余页签（1）');
  assert.equal(f.saves.at(-1).data.tabPreviewCount, 1);
  const restarted = await fixture({ saved: f.saves.at(-1).data });
  assert.equal(restarted.plugin.settingsData.tabPreviewCount, 1); restarted.dispose();
  input.value = ''; input.dispatchEvent(new f.win.Event('change'));
  assert.equal(input.value, '5'); assert.equal(p.menu.querySelector('.sim-tabs-toggle'), null);
  await p.pendingSave; f.dispose();
});

test('tab folding preserves original nodes and active indicator; reopen resets to configured count', async () => {
  const f = await fixture({ saved: { tabPreviewCount: 1 } }); const p = f.plugin; const doc = f.win.document;
  const original = doc.querySelector('[data-id="doc-2"]'); const parent = original.parentElement;
  p.enter(); p.openMenu();
  assert.equal(p.menu.querySelectorAll('.sim-tab').length, 1);
  assert.equal(p.menu.querySelector('.sim-tab').getAttribute('aria-current'), 'true');
  p.menu.querySelector('.sim-tabs-toggle').click();
  assert.equal(p.menu.querySelectorAll('.sim-tab').length, 2);
  assert.equal(p.menu.querySelector('.sim-tabs-toggle').getAttribute('aria-expanded'), 'true');
  assert.equal(p.menu.querySelectorAll('[data-action-key="builtin:tabs"]').length, 0);
  p.menu.querySelector('.sim-menu-other-scroll').scrollTop = 80;
  p.menu.querySelector('.sim-tabs-toggle').click();
  assert.equal(p.menu.querySelectorAll('.sim-tab').length, 1);
  assert.equal(p.menu.querySelector('.sim-menu-other-scroll').scrollTop, 80);
  p.menu.querySelector('.sim-tabs-toggle').click(); p.closeMenu(); p.openMenu();
  assert.equal(p.menu.querySelectorAll('.sim-tab').length, 1);
  assert.equal(original.parentElement, parent); assert.equal(parent.children.length, 2);
  f.dispose();
});

test('open card observes tab title, additions, focus and removals but ignores editor typing', async () => {
  const f = await fixture({ saved: { tabPreviewCount: 1 } }); const p = f.plugin; const doc = f.win.document;
  p.enter(); p.openMenu(); p.menu.querySelector('.sim-tabs-toggle').click();
  const list = doc.querySelector('.layout-tab-bar:not(.layout-tab-bar--readonly)');
  const first = list.firstElementChild; first.classList.remove('item--focus');
  const second = list.lastElementChild; second.classList.add('item--focus');
  second.querySelector('.item__text').textContent = '改名后的页签';
  const third = first.cloneNode(true); third.dataset.id = 'doc-3'; list.append(third);
  await new Promise(resolve => setTimeout(resolve, 220));
  assert.equal(p.menu.querySelectorAll('.sim-tab').length, 3, 'expansion survives native updates');
  assert.equal(p.menu.querySelector('.sim-tab[aria-current="true"]').title, '改名后的页签');
  const rendered = p.menu.querySelector('.sim-menu-tabs');
  doc.getElementById('editor').textContent = '编辑器内容更新';
  await new Promise(resolve => setTimeout(resolve, 180));
  assert.equal(p.menu.querySelector('.sim-menu-tabs'), rendered, 'editor typing must not rebuild navigation');
  second.remove(); third.remove();
  await new Promise(resolve => setTimeout(resolve, 180));
  assert.equal(p.menu.querySelectorAll('.sim-tab').length, 1);
  assert.equal(p.menu.querySelector('.sim-tabs-toggle'), null);
  first.remove(); await new Promise(resolve => setTimeout(resolve, 180));
  assert.equal(p.menu.querySelectorAll('.sim-tab').length, 0);
  assert.equal(p.menu.querySelector('.sim-menu-tabs .sim-empty').textContent, '暂无已打开页签');
  p.leave(); assert.equal(p.observer, null); assert.equal(p.refreshTimer, null); f.dispose();
});

test('release archive is flat and contains executable CommonJS plugin', () => {
  const zip = unzipSync(readFileSync(new URL('../artifacts/siyuan-plugin-immersive-mode-0.1.0.zip', import.meta.url)));
  assert.deepEqual(Object.keys(zip).sort(), ['README.md', 'i18n/en-US.json', 'i18n/en_US.json', 'i18n/zh-CN.json', 'i18n/zh_CN.json', 'icon.png', 'index.js', 'plugin.json']);
  const manifest = JSON.parse(new TextDecoder().decode(zip['plugin.json']));
  assert.equal(manifest.name, 'siyuan-plugin-immersive-mode');
  assert.deepEqual(Object.values(manifest.displayName), ['Immersive 沉浸模式', 'Immersive 沉浸模式', 'Immersive 沉浸模式']);
  assert.ok(zip['index.js'].length > 1000);
});
