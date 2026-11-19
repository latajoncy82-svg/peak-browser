const path = require('path');
const fs = require('fs');
const assert = require('assert');
const { pathToFileURL } = require('url');
const {
  app,
  BrowserWindow,
  WebContentsView,
  ipcMain,
  session,
  protocol,
  net,
  Menu,
  clipboard,
  shell
} = require('electron');

const store = require('./store');
const { shouldBlockRequest } = require('./shield');

const APP_ID = 'com.peakbrowser.app';
const NEWTAB_URL = 'peak://newtab';
const ROOT_DIR = path.resolve(__dirname, '..');
const PAGES_DIR = path.join(__dirname, 'pages');
const ASSETS_DIR = path.join(ROOT_DIR, 'assets');
const ICON_ICO_PATH = path.join(ASSETS_DIR, 'icon.ico');

if (process.platform === 'win32') {
  app.setAppUserModelId(APP_ID);
}

if (process.env.PEAK_VERIFY_DIR) {
  app.setPath('userData', path.join(process.env.PEAK_VERIFY_DIR, 'user-data'));
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'peak',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true
    }
  }
]);

const THEME_BG_COLORS = {
  'alpine-light': '#E3EBF5',
  'alpine-royal': '#0E3C86',
  'alpine-dark': '#0B111B'
};

const SEARCH_ENGINES = {
  google: 'https://www.google.com/search?q=',
  duckduckgo: 'https://duckduckgo.com/?q=',
  bing: 'https://www.bing.com/search?q=',
  brave: 'https://search.brave.com/search?q='
};

let mainWindow = null;
let peakSession = null;
let omniboxView = null;
let omniboxVisible = false;
let omniboxRect = null;

const tabs = [];
let activeTabId = null;
let nextTabSeq = 1;
const closedTabsStack = [];
const activeDownloadItems = new Map();

let layoutState = {
  topHeight: 80,
  rightPanelWidth: 0
};
let isHtmlFullScreen = false;
let shieldBroadcastTimer = null;

function getThemeBg(theme) {
  return THEME_BG_COLORS[theme] || THEME_BG_COLORS['alpine-light'];
}

function isPeakPageUrl(rawUrl) {
  return typeof rawUrl === 'string' && rawUrl.startsWith('peak://');
}

function getSearchUrl(query, engine) {
  const base = SEARCH_ENGINES[engine] || SEARCH_ENGINES.google;
  return `${base}${encodeURIComponent(query)}`;
}

function resolveInputToUrl(rawInput, engine = 'google') {
  const text = (rawInput || '').trim();
  if (!text) return NEWTAB_URL;

  if (/^(peak|https?|file|about):\/\//i.test(text) || /^about:/i.test(text)) {
    return text;
  }

  const noSpaces = !/\s/.test(text);
  if (noSpaces) {
    if (/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/.*)?$/i.test(text)) {
      return `http://${text}`;
    }
    if (/^(\d{1,3}\.){3}\d{1,3}(:\d+)?(\/.*)?$/.test(text)) {
      return `http://${text}`;
    }
    if (/^[a-zA-Z0-9-]+(\.[a-zA-Z0-9-]+)+(:\d+)?(\/.*)?$/.test(text)) {
      return `https://${text}`;
    }
  }

  return getSearchUrl(text, engine);
}

function safeResolveInDir(baseDir, relPath) {
  const cleaned = relPath.replace(/^\/+/, '');
  const resolved = path.resolve(baseDir, cleaned);
  const normalizedBase = path.resolve(baseDir) + path.sep;
  if (resolved !== path.resolve(baseDir) && !resolved.startsWith(normalizedBase)) {
    return null;
  }
  return resolved;
}

function resolvePeakFile(requestUrl) {
  let parsed;
  try {
    parsed = new URL(requestUrl);
  } catch {
    return null;
  }

  const host = (parsed.hostname || '').toLowerCase();
  const pathname = decodeURIComponent(parsed.pathname || '/');

  if (host === 'newtab') {
    if (pathname === '/' || pathname === '') {
      return path.join(PAGES_DIR, 'newtab.html');
    }
    return safeResolveInDir(PAGES_DIR, pathname);
  }

  if (host === 'error') {
    if (pathname === '/' || pathname === '') {
      return path.join(PAGES_DIR, 'error.html');
    }
    return safeResolveInDir(PAGES_DIR, pathname);
  }

  if (host === 'assets') {
    return safeResolveInDir(ASSETS_DIR, pathname);
  }

  return null;
}

function registerPeakProtocolOnSession(targetSession) {
  targetSession.protocol.handle('peak', (request) => {
    const filePath = resolvePeakFile(request.url);
    if (!filePath || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      return new Response('Nie znaleziono zasobu Peak Browser', { status: 404 });
    }
    return net.fetch(pathToFileURL(filePath).href);
  });
}

function getActiveTab() {
  return tabs.find((t) => t.id === activeTabId) || null;
}

function getTabByWebContentsId(wcId) {
  return tabs.find((t) => !t.view.webContents.isDestroyed() && t.view.webContents.id === wcId) || null;
}

function serializeTab(tab) {
  return {
    id: tab.id,
    url: tab.url,
    displayUrl: tab.displayUrl,
    title: tab.title,
    favicon: tab.favicon,
    isLoading: tab.isLoading,
    canGoBack: tab.canGoBack,
    canGoForward: tab.canGoForward,
    isMuted: tab.isMuted,
    audible: tab.audible,
    zoomFactor: tab.zoomFactor,
    blockedCount: tab.blockedCount,
    isSecure: tab.isSecure
  };
}

function broadcastTabs() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('tabs:updated', {
    tabs: tabs.map(serializeTab),
    activeTabId
  });
}

function broadcastData() {
  const payload = {
    settings: store.getSettings(),
    bookmarks: store.getBookmarks(),
    history: store.getHistory(),
    downloads: store.getDownloads(),
    shieldStats: store.getShieldStats()
  };
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('data:updated', payload);
  }
  const newTabPayload = {
    settings: payload.settings,
    speedDial: store.getSpeedDial(),
    shieldStats: payload.shieldStats
  };
  for (const tab of tabs) {
    if (!tab.view.webContents.isDestroyed() && isPeakPageUrl(tab.url)) {
      tab.view.webContents.send('newtab:state-updated', newTabPayload);
    }
  }
}

function broadcastWindowState() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('window:state', {
    isMaximized: mainWindow.isMaximized(),
    isFullScreen: mainWindow.isFullScreen(),
    isHtmlFullScreen
  });
}

function scheduleShieldBroadcast() {
  if (shieldBroadcastTimer) return;
  shieldBroadcastTimer = setTimeout(() => {
    shieldBroadcastTimer = null;
    broadcastTabs();
    broadcastData();
  }, 180);
}

function layoutViews() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const { width, height } = mainWindow.getContentBounds();
  const activeTab = getActiveTab();

  if (activeTab && !activeTab.view.webContents.isDestroyed()) {
    if (isHtmlFullScreen) {
      activeTab.view.setBounds({ x: 0, y: 0, width: Math.max(0, width), height: Math.max(0, height) });
    } else {
      const top = Math.max(0, Math.min(height, layoutState.topHeight));
      const right = Math.max(0, Math.min(width, layoutState.rightPanelWidth));
      activeTab.view.setBounds({
        x: 0,
        y: top,
        width: Math.max(0, width - right),
        height: Math.max(0, height - top)
      });
    }
  }

  if (omniboxVisible && omniboxView && omniboxRect && !isHtmlFullScreen) {
    const safeX = Math.max(0, Math.round(omniboxRect.x));
    const safeY = Math.max(0, Math.round(omniboxRect.y));
    const safeW = Math.max(200, Math.min(width - safeX, Math.round(omniboxRect.width)));
    const safeH = Math.max(0, Math.min(height - safeY, Math.round(omniboxRect.height)));
    omniboxView.setBounds({ x: safeX, y: safeY, width: safeW, height: safeH });
  }
}

function computeOmniboxHeight(count) {
  return Math.min(240, count * 36 + 12);
}

function ensureOmniboxView() {
  if (omniboxView && !omniboxView.webContents.isDestroyed()) return omniboxView;
  omniboxView = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, 'preload-overlay.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  omniboxView.setBackgroundColor('#00000000');
  if (typeof omniboxView.setBorderRadius === 'function') {
    omniboxView.setBorderRadius(10);
  }
  omniboxView.webContents.loadFile(path.join(__dirname, 'overlay', 'suggestions.html'));
  return omniboxView;
}

function showOmniboxOverlay({ rect, items, activeIndex, theme }) {
  if (!mainWindow || mainWindow.isDestroyed() || isHtmlFullScreen) return;
  if (!Array.isArray(items) || items.length === 0) {
    hideOmniboxOverlay(false);
    return;
  }

  const view = ensureOmniboxView();
  const desiredHeight = computeOmniboxHeight(items.length);

  omniboxRect = {
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: desiredHeight
  };

  if (!omniboxVisible) {
    try {
      mainWindow.contentView.addChildView(view);
      omniboxVisible = true;
    } catch {
      // Ignore if already attached
    }
  }

  layoutViews();
  const sendPayload = () => {
    if (!view.webContents.isDestroyed()) {
      view.webContents.send('overlay:update', { items, activeIndex, theme });
    }
  };
  if (view.webContents.isLoading()) {
    view.webContents.once('did-finish-load', sendPayload);
  } else {
    sendPayload();
  }
}

function hideOmniboxOverlay(notifyChrome = false) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (omniboxVisible && omniboxView) {
    try {
      mainWindow.contentView.removeChildView(omniboxView);
    } catch {
      // Ignore if already detached
    }
  }
  omniboxVisible = false;
  omniboxRect = null;
  if (notifyChrome && !mainWindow.webContents.isDestroyed()) {
    mainWindow.webContents.send('omnibox:closed');
  }
}

function updateTabNavState(tab) {
  if (!tab || tab.view.webContents.isDestroyed()) return;
  const nav = tab.view.webContents.navigationHistory;
  if (nav && typeof nav.canGoBack === 'function') {
    tab.canGoBack = nav.canGoBack();
    tab.canGoForward = nav.canGoForward();
  } else {
    tab.canGoBack = tab.view.webContents.canGoBack();
    tab.canGoForward = tab.view.webContents.canGoForward();
  }
}

function updateTabUrlMeta(tab, url) {
  tab.url = url;
  if (url.startsWith('peak://newtab')) {
    tab.displayUrl = '';
    tab.title = 'Nowa karta';
    tab.isSecure = true;
  } else if (url.startsWith('peak://error')) {
    try {
      const parsed = new URL(url);
      const target = parsed.searchParams.get('url') || '';
      tab.displayUrl = target;
      tab.errorTargetUrl = target;
    } catch {
      tab.displayUrl = '';
    }
    tab.title = 'Błąd połączenia';
    tab.isSecure = false;
  } else {
    tab.errorTargetUrl = null;
    tab.displayUrl = url;
    tab.isSecure = url.startsWith('https://') || url.startsWith('peak://');
  }
}

function sendShortcutToChrome(action) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('ui:shortcut', { action });
}

function handleAppShortcut(input, sourceWebContents) {
  if (input.type !== 'keyDown') return false;
  const ctrl = (input.control || input.meta) && !input.alt;
  const shift = input.shift;
  const alt = input.alt && !input.control && !input.meta;
  const key = (input.key || '').toLowerCase();

  if (key === 'escape' && omniboxVisible) {
    hideOmniboxOverlay(true);
    return true;
  }

  if (ctrl && !shift && key === 't') {
    createTab(NEWTAB_URL, true);
    return true;
  }
  if (ctrl && shift && key === 't') {
    reopenClosedTab();
    return true;
  }
  if (ctrl && !shift && key === 'w') {
    if (activeTabId) closeTab(activeTabId);
    return true;
  }
  if (ctrl && key === 'tab') {
    if (tabs.length > 1) {
      const idx = tabs.findIndex((t) => t.id === activeTabId);
      const step = shift ? -1 : 1;
      const nextIdx = (idx + step + tabs.length) % tabs.length;
      switchTab(tabs[nextIdx].id);
    }
    return true;
  }
  if (ctrl && !shift && /^[1-9]$/.test(key)) {
    const num = Number(key);
    if (num === 9) {
      if (tabs.length > 0) switchTab(tabs[tabs.length - 1].id);
    } else if (tabs[num - 1]) {
      switchTab(tabs[num - 1].id);
    }
    return true;
  }
  if ((ctrl && !shift && key === 'l') || (alt && key === 'd')) {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.focus();
    }
    sendShortcutToChrome('focus-omnibox');
    return true;
  }
  if ((ctrl && !shift && key === 'r') || (!ctrl && !shift && !alt && input.key === 'F5')) {
    reloadActiveTab(false);
    return true;
  }
  if (ctrl && shift && key === 'r') {
    reloadActiveTab(true);
    return true;
  }
  if (alt && key === 'arrowleft') {
    goBackActiveTab();
    return true;
  }
  if (alt && key === 'arrowright') {
    goForwardActiveTab();
    return true;
  }
  if (ctrl && !shift && key === 'f') {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.focus();
    }
    sendShortcutToChrome('open-find');
    return true;
  }
  if (ctrl && (key === '=' || key === '+')) {
    zoomActiveTab('in');
    return true;
  }
  if (ctrl && !shift && key === '-') {
    zoomActiveTab('out');
    return true;
  }
  if (ctrl && !shift && key === '0') {
    zoomActiveTab('reset');
    return true;
  }
  if (ctrl && !shift && key === 'd') {
    toggleCurrentBookmark();
    return true;
  }
  if (ctrl && !shift && key === 'h') {
    sendShortcutToChrome('open-history');
    return true;
  }
  if (ctrl && !shift && key === 'j') {
    sendShortcutToChrome('open-downloads');
    return true;
  }
  if (ctrl && shift && key === 'b') {
    sendShortcutToChrome('toggle-bookmarks-bar');
    return true;
  }
  if (!ctrl && !alt && input.key === 'F11') {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setFullScreen(!mainWindow.isFullScreen());
    }
    return true;
  }
  if ((!ctrl && !alt && input.key === 'F12') || (ctrl && shift && key === 'i')) {
    toggleActiveDevTools(sourceWebContents);
    return true;
  }
  return false;
}

function attachKeyboardInterceptor(wc) {
  wc.on('before-input-event', (event, input) => {
    if (handleAppShortcut(input, wc)) {
      event.preventDefault();
    }
  });
}

function attachTabContextMenu(tab) {
  const wc = tab.view.webContents;
  wc.on('context-menu', (_event, params) => {
    const template = [
      {
        label: 'Wstecz',
        enabled: tab.canGoBack,
        click: () => {
          if (wc.canGoBack()) wc.goBack();
        }
      },
      {
        label: 'Dalej',
        enabled: tab.canGoForward,
        click: () => {
          if (wc.canGoForward()) wc.goForward();
        }
      },
      {
        label: 'Odśwież',
        click: () => reloadTab(tab, false)
      },
      { type: 'separator' }
    ];

    if (params.linkURL) {
      template.push(
        {
          label: 'Otwórz link w nowej karcie',
          click: () => createTab(params.linkURL, true)
        },
        {
          label: 'Kopiuj adres linku',
          click: () => clipboard.writeText(params.linkURL)
        },
        { type: 'separator' }
      );
    }

    if (params.mediaType === 'image' && params.srcURL) {
      template.push(
        {
          label: 'Otwórz obraz w nowej karcie',
          click: () => createTab(params.srcURL, true)
        },
        {
          label: 'Zapisz obraz jako...',
          click: () => wc.downloadURL(params.srcURL)
        },
        { type: 'separator' }
      );
    }

    if (params.isEditable) {
      template.push(
        { label: 'Wytnij', role: 'cut', enabled: params.editFlags.canCut },
        { label: 'Kopiuj', role: 'copy', enabled: params.editFlags.canCopy },
        { label: 'Wklej', role: 'paste', enabled: params.editFlags.canPaste },
        { label: 'Zaznacz wszystko', role: 'selectAll' },
        { type: 'separator' }
      );
    } else if (params.selectionText && params.selectionText.trim()) {
      const selected = params.selectionText.trim();
      const preview = selected.length > 26 ? `${selected.slice(0, 26)}…` : selected;
      template.push(
        { label: 'Kopiuj', role: 'copy' },
        {
          label: `Szukaj „${preview}” w wyszukiwarce`,
          click: () => {
            const url = getSearchUrl(selected, store.getSettings().searchEngine);
            createTab(url, true);
          }
        },
        { type: 'separator' }
      );
    }

    template.push({
      label: 'Zbadaj element',
      click: () => {
        wc.inspectElement(params.x, params.y);
      }
    });

    const menu = Menu.buildFromTemplate(template);
    menu.popup({ window: mainWindow });
  });
}

function wireTabEvents(tab) {
  const wc = tab.view.webContents;
  attachKeyboardInterceptor(wc);
  attachTabContextMenu(tab);

  wc.on('focus', () => {
    if (omniboxVisible) hideOmniboxOverlay(true);
  });

  wc.setWindowOpenHandler((details) => {
    const features = details.features || '';
    const isPopup = /width=|height=/i.test(features);
    if (isPopup) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 960,
          height: 680,
          icon: ICON_ICO_PATH,
          title: 'Peak Browser',
          autoHideMenuBar: true,
          webPreferences: {
            session: peakSession,
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true
          }
        }
      };
    }
    if (details.url) {
      createTab(details.url, true);
    }
    return { action: 'deny' };
  });

  wc.on('did-start-loading', () => {
    tab.isLoading = true;
    broadcastTabs();
  });

  wc.on('did-stop-loading', () => {
    tab.isLoading = false;
    updateTabNavState(tab);
    broadcastTabs();
  });

  wc.on('did-navigate', (_event, url) => {
    tab.blockedCount = 0;
    updateTabUrlMeta(tab, url);
    updateTabNavState(tab);
    if (!isPeakPageUrl(url)) {
      store.recordHistory({ url, title: tab.title });
      broadcastData();
    }
    broadcastTabs();
  });

  wc.on('did-navigate-in-page', (_event, url, isMainFrame) => {
    if (!isMainFrame) return;
    updateTabUrlMeta(tab, url);
    updateTabNavState(tab);
    if (!isPeakPageUrl(url)) {
      store.recordHistory({ url, title: tab.title });
      broadcastData();
    }
    broadcastTabs();
  });

  wc.on('page-title-updated', (_event, title) => {
    if (!tab.url.startsWith('peak://error')) {
      tab.title = title || tab.title || 'Nowa karta';
    }
    if (!isPeakPageUrl(tab.url)) {
      store.recordHistory({ url: tab.url, title: tab.title });
      broadcastData();
    }
    broadcastTabs();
  });

  wc.on('page-favicon-updated', (_event, favicons) => {
    if (Array.isArray(favicons) && favicons.length > 0 && !isPeakPageUrl(tab.url)) {
      tab.favicon = favicons[0];
      broadcastTabs();
    }
  });

  wc.on('media-started-playing', () => {
    tab.audible = true;
    broadcastTabs();
  });

  wc.on('media-paused', () => {
    tab.audible = false;
    broadcastTabs();
  });

  wc.on('enter-html-full-screen', () => {
    isHtmlFullScreen = true;
    hideOmniboxOverlay(true);
    layoutViews();
    broadcastWindowState();
  });

  wc.on('leave-html-full-screen', () => {
    isHtmlFullScreen = false;
    layoutViews();
    broadcastWindowState();
  });

  wc.on('found-in-page', (_event, result) => {
    if (tab.id === activeTabId && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('find:result', {
        activeMatchOrdinal: result.activeMatchOrdinal || 0,
        matches: result.matches || 0
      });
    }
  });

  wc.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame || errorCode === -3) {
      return;
    }
    if (isPeakPageUrl(validatedURL)) {
      return;
    }
    tab.isLoading = false;
    const errorUrl = `peak://error/?url=${encodeURIComponent(validatedURL || '')}&code=${encodeURIComponent(
      String(errorCode)
    )}&desc=${encodeURIComponent(errorDescription || '')}`;
    wc.loadURL(errorUrl);
  });
}

function createTab(initialUrl = NEWTAB_URL, activate = true) {
  const id = `tab-${nextTabSeq++}`;
  const view = new WebContentsView({
    webPreferences: {
      session: peakSession,
      preload: path.join(__dirname, 'preload-newtab.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  const tab = {
    id,
    view,
    url: initialUrl,
    displayUrl: initialUrl === NEWTAB_URL ? '' : initialUrl,
    title: initialUrl === NEWTAB_URL ? 'Nowa karta' : 'Ładowanie…',
    favicon: '',
    isLoading: true,
    canGoBack: false,
    canGoForward: false,
    isMuted: false,
    audible: false,
    zoomFactor: 1,
    blockedCount: 0,
    isSecure: initialUrl.startsWith('https://') || initialUrl.startsWith('peak://'),
    errorTargetUrl: null
  };

  tabs.push(tab);
  wireTabEvents(tab);

  const targetUrl = resolveInputToUrl(initialUrl, store.getSettings().searchEngine);
  updateTabUrlMeta(tab, targetUrl);
  view.webContents.loadURL(targetUrl);

  if (activate) {
    switchTab(id);
  } else {
    broadcastTabs();
  }
  return tab;
}

function switchTab(tabId) {
  const nextTab = tabs.find((t) => t.id === tabId);
  if (!nextTab || !mainWindow || mainWindow.isDestroyed()) return;

  const prevTab = getActiveTab();
  if (prevTab && prevTab.id !== nextTab.id) {
    try {
      mainWindow.contentView.removeChildView(prevTab.view);
    } catch {
      // Ignore if not attached
    }
  }

  activeTabId = nextTab.id;
  try {
    mainWindow.contentView.addChildView(nextTab.view);
  } catch {
    // Ignore if already attached
  }

  if (omniboxVisible && omniboxView) {
    try {
      mainWindow.contentView.removeChildView(omniboxView);
      mainWindow.contentView.addChildView(omniboxView);
    } catch {
      // Ignore
    }
  }

  layoutViews();
  broadcastTabs();
}

function closeTab(tabId) {
  const idx = tabs.findIndex((t) => t.id === tabId);
  if (idx === -1) return;

  const [removed] = tabs.splice(idx, 1);
  if (removed.url && !isPeakPageUrl(removed.url)) {
    closedTabsStack.push(removed.url);
    if (closedTabsStack.length > 20) {
      closedTabsStack.shift();
    }
  }

  if (mainWindow && !mainWindow.isDestroyed()) {
    try {
      mainWindow.contentView.removeChildView(removed.view);
    } catch {
      // Ignore
    }
  }
  if (!removed.view.webContents.isDestroyed()) {
    removed.view.webContents.close();
  }

  if (tabs.length === 0) {
    activeTabId = null;
    createTab(NEWTAB_URL, true);
    return;
  }

  if (activeTabId === tabId) {
    const nextIdx = Math.min(idx, tabs.length - 1);
    switchTab(tabs[nextIdx].id);
  } else {
    broadcastTabs();
  }
}

function reopenClosedTab() {
  if (closedTabsStack.length === 0) return;
  const url = closedTabsStack.pop();
  createTab(url, true);
}

function reloadTab(tab, hard = false) {
  if (!tab || tab.view.webContents.isDestroyed()) return;
  if (tab.errorTargetUrl) {
    const target = tab.errorTargetUrl;
    tab.errorTargetUrl = null;
    tab.view.webContents.loadURL(target);
    return;
  }
  if (hard) {
    tab.view.webContents.reloadIgnoringCache();
  } else {
    tab.view.webContents.reload();
  }
}

function reloadActiveTab(hard = false) {
  const tab = getActiveTab();
  if (tab) reloadTab(tab, hard);
}

function goBackActiveTab() {
  const tab = getActiveTab();
  if (tab && !tab.view.webContents.isDestroyed() && tab.view.webContents.canGoBack()) {
    tab.view.webContents.goBack();
  }
}

function goForwardActiveTab() {
  const tab = getActiveTab();
  if (tab && !tab.view.webContents.isDestroyed() && tab.view.webContents.canGoForward()) {
    tab.view.webContents.goForward();
  }
}

function zoomActiveTab(direction) {
  const tab = getActiveTab();
  if (!tab || tab.view.webContents.isDestroyed()) return;
  let next = tab.zoomFactor || 1;
  if (direction === 'in') next = Math.min(2.5, Math.round((next + 0.1) * 10) / 10);
  else if (direction === 'out') next = Math.max(0.5, Math.round((next - 0.1) * 10) / 10);
  else next = 1;

  tab.zoomFactor = next;
  tab.view.webContents.setZoomFactor(next);
  broadcastTabs();
}

function toggleActiveDevTools(preferredWc) {
  const tab = getActiveTab();
  const target = tab && !tab.view.webContents.isDestroyed() ? tab.view.webContents : preferredWc;
  if (!target || target.isDestroyed()) return;
  if (target.isDevToolsOpened()) {
    target.closeDevTools();
  } else {
    target.openDevTools({ mode: 'detach' });
  }
}

function toggleCurrentBookmark() {
  const tab = getActiveTab();
  if (!tab || isPeakPageUrl(tab.url)) {
    return { isBookmarked: false, bookmarks: store.getBookmarks() };
  }
  if (store.isBookmarked(tab.url)) {
    const bookmarks = store.removeBookmark(tab.url);
    broadcastData();
    return { isBookmarked: false, bookmarks };
  }
  const bookmarks = store.addBookmark({
    title: tab.title,
    url: tab.url,
    favicon: tab.favicon
  });
  broadcastData();
  return { isBookmarked: true, bookmarks };
}

function setupSession() {
  peakSession = session.fromPartition('persist:peak');
  const cleanUA = peakSession
    .getUserAgent()
    .replace(/\s*Electron\/\S+/gi, '')
    .replace(/\s*peak-browser\/\S+/gi, '');
  peakSession.setUserAgent(cleanUA);

  registerPeakProtocolOnSession(peakSession);
  registerPeakProtocolOnSession(session.defaultSession);

  peakSession.webRequest.onBeforeRequest((details, callback) => {
    const settings = store.getSettings();
    if (!settings.shieldEnabled) {
      callback({ cancel: false });
      return;
    }

    if (shouldBlockRequest(details.url, details.resourceType)) {
      if (typeof details.webContentsId === 'number') {
        const tab = getTabByWebContentsId(details.webContentsId);
        if (tab) {
          tab.blockedCount += 1;
        }
      }
      store.incrementShieldBlocked();
      scheduleShieldBroadcast();
      callback({ cancel: true });
      return;
    }
    callback({ cancel: false });
  });

  peakSession.on('will-download', (_event, item) => {
    const id = `dl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    activeDownloadItems.set(id, item);

    const record = {
      id,
      filename: item.getFilename(),
      url: item.getURL(),
      savePath: item.getSavePath(),
      totalBytes: item.getTotalBytes(),
      receivedBytes: 0,
      state: 'progressing',
      startedAt: Date.now()
    };

    const upsertDownload = (patch) => {
      Object.assign(record, patch);
      const list = store.getDownloads().filter((d) => d.id !== id);
      list.unshift({ ...record });
      store.saveDownloads(list);
      broadcastData();
    };

    upsertDownload({});

    item.on('updated', (_ev, state) => {
      upsertDownload({
        savePath: item.getSavePath(),
        totalBytes: item.getTotalBytes(),
        receivedBytes: item.getReceivedBytes(),
        state: state === 'interrupted' ? 'interrupted' : 'progressing'
      });
    });

    item.once('done', (_ev, state) => {
      activeDownloadItems.delete(id);
      upsertDownload({
        savePath: item.getSavePath(),
        totalBytes: item.getTotalBytes(),
        receivedBytes: item.getReceivedBytes(),
        state
      });
    });
  });
}

function assertPeakSender(event) {
  const senderUrl = event.senderFrame ? event.senderFrame.url : '';
  if (!senderUrl.startsWith('peak://')) {
    throw new Error('Dostęp zabroniony poza protokołem peak://');
  }
}

function registerIpcHandlers() {
  // Window controls
  ipcMain.on('window:minimize', () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.minimize();
  });
  ipcMain.on('window:maximize-toggle', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  });
  ipcMain.on('window:close', () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
  });
  ipcMain.handle('window:is-maximized', () => {
    return mainWindow && !mainWindow.isDestroyed() ? mainWindow.isMaximized() : false;
  });
  ipcMain.on('window:toggle-fullscreen', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setFullScreen(!mainWindow.isFullScreen());
    }
  });
  ipcMain.on('ui:set-layout', (_event, nextLayout) => {
    if (nextLayout && typeof nextLayout === 'object') {
      layoutState = {
        topHeight: typeof nextLayout.topHeight === 'number' ? nextLayout.topHeight : layoutState.topHeight,
        rightPanelWidth:
          typeof nextLayout.rightPanelWidth === 'number' ? nextLayout.rightPanelWidth : layoutState.rightPanelWidth
      };
      layoutViews();
    }
  });

  // Tabs & Navigation
  ipcMain.handle('tabs:get-state', () => ({
    tabs: tabs.map(serializeTab),
    activeTabId,
    settings: store.getSettings(),
    bookmarks: store.getBookmarks(),
    history: store.getHistory(),
    downloads: store.getDownloads(),
    shieldStats: store.getShieldStats()
  }));

  ipcMain.handle('tabs:new', (_event, url) => {
    const tab = createTab(url || NEWTAB_URL, true);
    return tab.id;
  });

  ipcMain.handle('tabs:close', (_event, tabId) => {
    closeTab(tabId);
  });

  ipcMain.handle('tabs:activate', (_event, tabId) => {
    switchTab(tabId);
  });

  ipcMain.handle('tabs:reopen', () => {
    reopenClosedTab();
  });

  ipcMain.handle('tabs:mute-toggle', (_event, tabId) => {
    const tab = tabs.find((t) => t.id === tabId);
    if (tab && !tab.view.webContents.isDestroyed()) {
      tab.isMuted = !tab.isMuted;
      tab.view.webContents.setAudioMuted(tab.isMuted);
      broadcastTabs();
    }
  });

  ipcMain.handle('nav:go', (_event, input) => {
    const tab = getActiveTab();
    if (!tab || tab.view.webContents.isDestroyed()) return;
    const url = resolveInputToUrl(input, store.getSettings().searchEngine);
    tab.errorTargetUrl = null;
    tab.view.webContents.loadURL(url);
    hideOmniboxOverlay(false);
  });

  ipcMain.handle('nav:back', () => goBackActiveTab());
  ipcMain.handle('nav:forward', () => goForwardActiveTab());
  ipcMain.handle('nav:reload', (_event, hard) => reloadActiveTab(Boolean(hard)));
  ipcMain.handle('nav:stop', () => {
    const tab = getActiveTab();
    if (tab && !tab.view.webContents.isDestroyed()) {
      tab.view.webContents.stop();
    }
  });
  ipcMain.handle('nav:home', () => {
    const tab = getActiveTab();
    if (tab && !tab.view.webContents.isDestroyed()) {
      tab.errorTargetUrl = null;
      tab.view.webContents.loadURL(NEWTAB_URL);
    }
  });
  ipcMain.handle('nav:zoom', (_event, direction) => zoomActiveTab(direction));
  ipcMain.handle('devtools:toggle', () => toggleActiveDevTools());

  // Find in page
  ipcMain.on('find:query', (_event, payload) => {
    const tab = getActiveTab();
    if (!tab || tab.view.webContents.isDestroyed() || !payload) return;
    const text = (payload.text || '').trim();
    if (!text) {
      tab.view.webContents.stopFindInPage('clearSelection');
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('find:result', { activeMatchOrdinal: 0, matches: 0 });
      }
      return;
    }
    tab.view.webContents.findInPage(text, {
      forward: payload.forward !== false,
      findNext: Boolean(payload.findNext)
    });
  });

  ipcMain.on('find:stop', () => {
    const tab = getActiveTab();
    if (tab && !tab.view.webContents.isDestroyed()) {
      tab.view.webContents.stopFindInPage('clearSelection');
    }
  });

  // Omnibox overlay
  ipcMain.on('omnibox:show', (_event, payload) => {
    if (payload) showOmniboxOverlay(payload);
  });
  ipcMain.on('omnibox:update', (_event, payload) => {
    if (!payload || !omniboxView || omniboxView.webContents.isDestroyed()) return;
    if (!Array.isArray(payload.items) || payload.items.length === 0) {
      hideOmniboxOverlay(false);
      return;
    }
    if (omniboxVisible) {
      const desiredHeight = computeOmniboxHeight(payload.items.length);
      if (omniboxRect) {
        omniboxRect.height = desiredHeight;
        layoutViews();
      }
      omniboxView.webContents.send('overlay:update', payload);
    }
  });
  ipcMain.on('omnibox:hide', () => hideOmniboxOverlay(false));

  ipcMain.on('overlay:select', (_event, item) => {
    const tab = getActiveTab();
    if (tab && !tab.view.webContents.isDestroyed() && item) {
      const target = item.url
        ? item.url
        : resolveInputToUrl(item.query || item.title || '', store.getSettings().searchEngine);
      tab.view.webContents.loadURL(target);
      tab.view.webContents.focus();
    }
    hideOmniboxOverlay(true);
  });

  ipcMain.on('overlay:hover', (_event, index) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('omnibox:hover', index);
    }
  });

  ipcMain.on('overlay:dismiss', () => {
    hideOmniboxOverlay(true);
  });

  // Bookmarks, history, downloads, settings, privacy
  ipcMain.handle('bookmarks:toggle-current', () => toggleCurrentBookmark());
  ipcMain.handle('bookmarks:add', (_event, item) => {
    const list = store.addBookmark(item || {});
    broadcastData();
    return list;
  });
  ipcMain.handle('bookmarks:remove', (_event, urlOrId) => {
    const list = store.removeBookmark(urlOrId);
    broadcastData();
    return list;
  });
  ipcMain.handle('history:clear', () => {
    const list = store.clearHistory();
    broadcastData();
    return list;
  });

  ipcMain.handle('downloads:open', (_event, id) => {
    const item = store.getDownloads().find((d) => d.id === id);
    if (item && item.savePath && fs.existsSync(item.savePath)) {
      shell.openPath(item.savePath);
    }
  });
  ipcMain.handle('downloads:show', (_event, id) => {
    const item = store.getDownloads().find((d) => d.id === id);
    if (item && item.savePath) {
      shell.showItemInFolder(item.savePath);
    }
  });
  ipcMain.handle('downloads:cancel', (_event, id) => {
    const dl = activeDownloadItems.get(id);
    if (dl) {
      dl.cancel();
    }
  });
  ipcMain.handle('downloads:clear', () => {
    const activeOnly = store.getDownloads().filter((d) => d.state === 'progressing');
    store.saveDownloads(activeOnly);
    broadcastData();
    return activeOnly;
  });

  ipcMain.handle('settings:update', (_event, partial) => {
    const next = store.updateSettings(partial);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setBackgroundColor(getThemeBg(next.theme));
    }
    broadcastData();
    return next;
  });

  ipcMain.handle('privacy:clear-data', async () => {
    store.clearHistory();
    await peakSession.clearStorageData();
    await peakSession.clearCache();
    broadcastData();
    return { ok: true };
  });

  // New Tab & peak:// handlers (strictly gated)
  ipcMain.handle('newtab:get-data', (event) => {
    assertPeakSender(event);
    return {
      settings: store.getSettings(),
      speedDial: store.getSpeedDial(),
      shieldStats: store.getShieldStats()
    };
  });

  ipcMain.handle('newtab:navigate', (event, input) => {
    assertPeakSender(event);
    const tab = getTabByWebContentsId(event.sender.id) || getActiveTab();
    if (!tab || tab.view.webContents.isDestroyed()) return;
    const url = resolveInputToUrl(input, store.getSettings().searchEngine);
    tab.errorTargetUrl = null;
    tab.view.webContents.loadURL(url);
  });

  ipcMain.handle('newtab:add-speed-dial', (event, item) => {
    assertPeakSender(event);
    const url = resolveInputToUrl(item && item.url, store.getSettings().searchEngine);
    const speedDial = store.addSpeedDial({ title: item && item.title, url });
    broadcastData();
    return speedDial;
  });

  ipcMain.handle('newtab:remove-speed-dial', (event, id) => {
    assertPeakSender(event);
    const speedDial = store.removeSpeedDial(id);
    broadcastData();
    return speedDial;
  });

  ipcMain.handle('newtab:set-theme', (event, theme) => {
    assertPeakSender(event);
    const next = store.updateSettings({ theme });
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setBackgroundColor(getThemeBg(next.theme));
    }
    broadcastData();
    return next;
  });
}

function createMainWindow() {
  const settings = store.getSettings();
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 780,
    minHeight: 520,
    frame: false,
    transparent: false,
    backgroundColor: getThemeBg(settings.theme),
    icon: ICON_ICO_PATH,
    title: 'Peak Browser',
    webPreferences: {
      preload: path.join(__dirname, 'preload-chrome.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  attachKeyboardInterceptor(mainWindow.webContents);

  if (process.platform === 'win32') {
    const iconPath = app.isPackaged ? process.execPath : ICON_ICO_PATH;
    const relaunchCommand = app.isPackaged
      ? `"${process.execPath}"`
      : `"${process.execPath}" "${ROOT_DIR}"`;
    mainWindow.setAppDetails({
      appId: APP_ID,
      appIconPath: iconPath,
      appIconIndex: 0,
      relaunchCommand,
      relaunchDisplayName: 'Peak Browser'
    });
  }

  mainWindow.on('resize', layoutViews);
  mainWindow.on('maximize', () => {
    layoutViews();
    setImmediate(layoutViews);
    broadcastWindowState();
  });
  mainWindow.on('unmaximize', () => {
    layoutViews();
    setImmediate(layoutViews);
    broadcastWindowState();
  });
  mainWindow.on('enter-full-screen', () => {
    layoutViews();
    broadcastWindowState();
  });
  mainWindow.on('leave-full-screen', () => {
    layoutViews();
    broadcastWindowState();
  });
  mainWindow.on('blur', () => {
    hideOmniboxOverlay(true);
  });

  mainWindow.loadFile(path.join(__dirname, 'chrome', 'index.html'));
  mainWindow.webContents.once('did-finish-load', () => {
    createTab(NEWTAB_URL, true);
    broadcastData();
    broadcastWindowState();
  });
}

function waitForTabLoad(tab, timeoutMs = 15000) {
  return new Promise((resolve) => {
    if (!tab || tab.view.webContents.isDestroyed()) {
      resolve();
      return;
    }
    const wc = tab.view.webContents;
    if (!wc.isLoading()) {
      setTimeout(resolve, 300);
      return;
    }
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      setTimeout(resolve, 350);
    };
    const timer = setTimeout(finish, timeoutMs);
    wc.once('did-stop-loading', finish);
  });
}

async function runVerificationSuite(verifyDir) {
  fs.mkdirSync(verifyDir, { recursive: true });

  // Unit assertions for shield.js
  assert.strictEqual(
    shouldBlockRequest('https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js', 'script'),
    true,
    'Shield should block adsbygoogle script'
  );
  assert.strictEqual(
    shouldBlockRequest('https://hit.gemius.pl/xgemius.js', 'script'),
    true,
    'Shield should block gemius tracker'
  );
  assert.strictEqual(
    shouldBlockRequest('https://example.com/index.html', 'mainFrame'),
    false,
    'Shield must allow mainFrame navigation'
  );
  assert.strictEqual(
    shouldBlockRequest('peak://newtab/', 'subFrame'),
    false,
    'Shield must allow peak:// requests'
  );

  // Unit assertions for store.js
  const unitStoreDir = path.join(verifyDir, 'unit-store');
  fs.rmSync(unitStoreDir, { recursive: true, force: true });
  const testStore = new store.PeakStore().init(unitStoreDir);
  assert.strictEqual(testStore.getSettings().theme, 'alpine-light');
  testStore.updateSettings({ theme: 'alpine-dark', searchEngine: 'duckduckgo' });
  testStore.addBookmark({ title: 'Example', url: 'https://example.com' });
  testStore.recordHistory({ url: 'https://example.com', title: 'Example' });
  testStore.flushSync();

  const reloadedStore = new store.PeakStore().init(path.join(verifyDir, 'unit-store'));
  assert.strictEqual(reloadedStore.getSettings().theme, 'alpine-dark');
  assert.strictEqual(reloadedStore.getSettings().searchEngine, 'duckduckgo');
  assert.strictEqual(reloadedStore.isBookmarked('https://example.com'), true);
  assert.strictEqual(reloadedStore.getHistory().length, 1);

  const capturePair = async (name) => {
    const active = getActiveTab();
    const bounds = mainWindow.getContentBounds();
    const chromePng = (await mainWindow.webContents.capturePage()).toPNG();
    const viewPng = active ? (await active.view.webContents.capturePage()).toPNG() : Buffer.alloc(0);
    fs.writeFileSync(path.join(verifyDir, `${name}-chrome.png`), chromePng);
    fs.writeFileSync(path.join(verifyDir, `${name}-view.png`), viewPng);
    fs.writeFileSync(
      path.join(verifyDir, `${name}-meta.json`),
      JSON.stringify({
        width: bounds.width,
        height: bounds.height,
        topHeight: layoutState.topHeight,
        rightPanelWidth: layoutState.rightPanelWidth,
        viewBounds: active ? active.view.getBounds() : null
      })
    );
  };

  // Wait for initial newtab load
  await new Promise((r) => setTimeout(r, 700));
  const initialTab = getActiveTab();
  await waitForTabLoad(initialTab);
  await capturePair('1-newtab-light');

  // Open Settings drawer via real chrome button & switch to alpine-dark theme
  await mainWindow.webContents.executeJavaScript(`
    (() => {
      document.getElementById('btn-settings').click();
    })();
  `);
  await new Promise((r) => setTimeout(r, 350));
  await mainWindow.webContents.executeJavaScript(`
    (() => {
      const darkBtn = document.querySelector('[data-theme-choice="alpine-dark"]');
      if (darkBtn) darkBtn.click();
    })();
  `);
  await new Promise((r) => setTimeout(r, 500));
  await capturePair('2-dark-settings');

  // Switch back to alpine-light, close drawer, and navigate to https://example.com
  await mainWindow.webContents.executeJavaScript(`
    (() => {
      const lightBtn = document.querySelector('[data-theme-choice="alpine-light"]');
      if (lightBtn) lightBtn.click();
      document.getElementById('drawer-close').click();
    })();
  `);
  await new Promise((r) => setTimeout(r, 300));
  initialTab.view.webContents.loadURL('https://example.com');
  await waitForTabLoad(initialTab);
  await new Promise((r) => setTimeout(r, 400));

  const verifyChromeState = await mainWindow.webContents.executeJavaScript(`
    (() => ({
      omniboxValue: document.getElementById('omnibox-input').value,
      backDisabled: document.getElementById('btn-back').disabled,
      activeTabTitle: document.querySelector('.tab.active .tab-title')?.textContent || ''
    }))();
  `);
  assert.ok(verifyChromeState.omniboxValue.includes('example.com'), 'Omnibox should display example.com');
  assert.strictEqual(verifyChromeState.backDisabled, false, 'Back button should be enabled after navigating');
  assert.ok(verifyChromeState.activeTabTitle.length > 0, 'Active tab should have a title');

  await capturePair('3-example');
  fs.writeFileSync(
    path.join(verifyDir, 'summary.json'),
    JSON.stringify({ ok: true, verifyChromeState }, null, 2)
  );
}

app.whenReady().then(() => {
  store.init(app.getPath('userData'));
  setupSession();
  registerIpcHandlers();
  createMainWindow();

  if (process.env.PEAK_VERIFY_DIR) {
    mainWindow.webContents.once('did-finish-load', async () => {
      try {
        await runVerificationSuite(process.env.PEAK_VERIFY_DIR);
        app.exit(0);
      } catch (err) {
        console.error('PEAK_VERIFY_FAILED:', err);
        app.exit(1);
      }
    });
  }
});

app.on('before-quit', () => {
  store.flushSync();
});

app.on('window-all-closed', () => {
  store.flushSync();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
