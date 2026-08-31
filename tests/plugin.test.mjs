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
  class Setting { items = []; addItem(item) { this.items.push(item); } open() { this.opened = true; } }
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
  assert.deepEqual(normalizeSettings({ favorites: ['x', 7, 'x', 'y'], side: 'invalid', y: 9 }), { favorites: ['x', 'y'], side: 'right', y: 1, windowsTopBar: false, tabPreviewCount: 5 });
  assert.equal(normalizeSettings({ windowsTopBar: 'true' }).windowsTopBar, false);
  assert.equal(normalizeSettings({ windowsTopBar: true }).windowsTopBar, true);
  assert.equal(normalizeSettings({ y: NaN }).y, 0.65);
  assert.equal(normalizeSettings(null).favorites.length, 0);
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
  buttons[0].click(); assert.equal(calls, 1); assert.equal(moved.parentNode, container);
  moved.remove();
  assert.equal(f.plugin.actions().some(x => x.key === 'top:plugin_relocated'), false);
  f.dispose();
});

test('top entry uses Apple-style zoom affordance', async () => {
  const f = await fixture();
  assert.ok(f.plugin.topButton.classList.contains('sim-apple-zoom'));
  assert.match(f.plugin.topButton.innerHTML, /34c759|circle/);
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
  assert.deepEqual([...p.menu.querySelectorAll('[data-action-group]')].map(el => el.dataset.actionGroup), ['left', 'top', 'page']);
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
  assert.equal(style(row).position, 'fixed'); assert.equal(style(row).top, '0px');
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

test('visible full toolbar removes top actions; minimal strip keeps those actions in the card', async () => {
  const f = await fixture({ frontend: 'desktop', saved: { favorites: ['top:barSearch', 'dock:file', 'builtin:toolbar'] } });
  const p = f.plugin; p.enter(); p.openMenu();
  assert.ok(p.menu.querySelector('[data-action-group="top"] [data-action-key="top:barSearch"]'));
  p.settingsData.windowsTopBar = true; p.applyTopBarSetting();
  assert.equal(p.actions().some(action => action.group === 'top'), false);
  assert.equal(p.menu.querySelector('[data-action-key="top:barSearch"]'), null);
  assert.equal(p.menu.querySelector('[data-action-group="top"]'), null);
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
  assert.deepEqual(groups(), ['left', 'top', 'right', 'bottom', 'page']);
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
  const before = parseFloat(row1.style.getPropertyValue('--sim-tabs-width'));
  doc.getElementById('drag').getBoundingClientRect = () => ({ left: 250, right: 950, top: 0, bottom: 32, width: 700, height: 32 });
  p.syncMergedTabs(); assert.ok(parseFloat(row1.style.getPropertyValue('--sim-tabs-width')) > before);
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

test('resizing an open card keeps its page actions and footer available', async () => {
  const f = await fixture(); f.plugin.enter(); f.plugin.openMenu();
  f.sandbox.innerWidth = 420; f.sandbox.innerHeight = 280;
  f.win.dispatchEvent(new f.win.Event('resize'));
  assert.ok([...f.plugin.menu.querySelectorAll('button')].some(x => x.textContent.includes('文档二')));
  assert.equal(f.plugin.menu.querySelector('.sim-footer button:last-child').textContent, '退出沉浸');
  f.dispose();
});

test('card pins tabs independently from grouped actions, with footer exit and active orb', async () => {
  const f = await fixture({ width: 420, height: 280 }); const p = f.plugin; p.enter(); p.openMenu();
  assert.equal(p.menu.querySelectorAll('.sim-menu-tabs .sim-tab').length, 2);
  assert.equal(p.menu.querySelector('.sim-menu-other-scroll .sim-tab'), null);
  assert.equal(p.menu.querySelectorAll('.sim-action[data-action-key="dock:things"]').length, 1);
  assert.ok(p.orb.classList.contains('sim-orb--active'));
  assert.ok(p.menu.querySelector('.sim-menu-other-scroll .sim-action[data-action-key="dock:things"]'));
  assert.equal(p.menu.querySelector('.sim-star, .sim-menu-favorites'), null);
  p.menu.querySelector('.sim-footer button:last-child').click();
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

test('full immersion keeps only native window controls and drag; restore follows host state', async () => {
  const f = await fixture({ frontend: 'desktop' }); const p = f.plugin; const doc = f.win.document;
  const style = selector => f.win.getComputedStyle(doc.querySelector(selector));
  const toolbar = doc.getElementById('toolbar'); const originalChildren = [...toolbar.children];
  const extra = doc.createElement('button'); extra.textContent = '宿主其他控制'; doc.getElementById('windowControls').append(extra);
  let clicks = 0;
  for (const id of ['minWindow', 'maxWindow', 'restoreWindow', 'closeWindow']) doc.getElementById(id).onclick = () => clicks++;
  p.enter();
  assert.ok(doc.body.classList.contains('sim-window-strip'));
  assert.equal(style('#toolbar').height, '28px');
  assert.equal(style('#toolbar').getPropertyValue('-webkit-app-region'), 'drag');
  assert.equal(style('#drag').getPropertyValue('-webkit-app-region'), 'drag');
  for (const selector of ['#barSearch', '#barMore', '#plugin_immersive']) assert.equal(style(selector).display, 'none');
  assert.equal(f.win.getComputedStyle(extra).display, 'none');
  assert.equal(style('#maxWindow').display, 'flex'); assert.equal(style('#restoreWindow').display, 'none');
  for (const id of ['minWindow', 'maxWindow', 'restoreWindow', 'closeWindow']) {
    assert.equal(style('#' + id).getPropertyValue('-webkit-app-region'), 'no-drag');
    doc.getElementById(id).click();
  }
  assert.equal(clicks, 4); assert.equal(p.mergedRows.size, 0);
  p.openMenu(); assert.ok(p.menu.querySelector('[data-action-key="top:barSearch"]'));
  p.revealToolbar(); assert.notEqual(style('#barSearch').display, 'none');
  p.clearNativeTools(); assert.equal(style('#barSearch').display, 'none');
  p.leave(); assert.equal(doc.body.classList.contains('sim-window-strip'), false);
  assert.notEqual(style('#barSearch').display, 'none'); assert.equal(style('#toolbar').height, '42px');
  assert.deepEqual([...toolbar.children], originalChildren);
  assert.equal(doc.body.classList.contains('body--maximize'), false, 'host window state is never overwritten');
  f.dispose();
  // Separate initial-state fixture avoids Happy DOM's stale ancestor matches;
  // live maximize/restore transitions are also exercised in Chromium preview.
  const maximized = await fixture({ frontend: 'desktop', maximized: true }); maximized.plugin.enter();
  assert.equal(maximized.win.getComputedStyle(maximized.win.document.getElementById('maxWindow')).display, 'none');
  assert.equal(maximized.win.getComputedStyle(maximized.win.document.getElementById('restoreWindow')).display, 'flex');
  maximized.plugin.leave(); assert.ok(maximized.win.document.body.classList.contains('body--maximize')); maximized.dispose();
});

test('panels use four equal borders without a second center-wrapper border and restore native styling', async () => {
  const f = await fixture(); const doc = f.win.document;
  const panel = doc.querySelector('.layout-tab-container'); panel.style.border = '2px solid red';
  f.plugin.enter();
  for (const node of [panel, doc.querySelector('#sidebar')]) {
    const style = f.win.getComputedStyle(node);
    assert.deepEqual(['Top', 'Right', 'Bottom', 'Left'].map(side => style['border' + side + 'Width']), ['1px', '1px', '1px', '1px']);
  }
  assert.equal(f.win.getComputedStyle(doc.querySelector('.layout__center')).borderTopWidth, '0px');
  f.plugin.leave(); assert.equal(f.win.getComputedStyle(panel).borderTopWidth, '2px'); f.dispose();
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
  assert.equal(manifest.name, 'siyuan-plugin-immersive-mode'); assert.ok(zip['index.js'].length > 1000);
});
