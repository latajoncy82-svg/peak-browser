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
  shell,
  dialog
} = require('electron');

const store = require('./store');
const shield = require('./shield');
const importer = require('./importer');

const APP_ID = 'com.peakbrowser.app';
const NEWTAB_URL = 'peak://newtab';
const INCOGNITO_URL = 'peak://incognito';
const SETTINGS_URL = 'peak://settings';
const STARTUP_URL = 'https://peaklabstudio.vercel.app/#o-firmie';
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
  'alpine-dark': '#08101C',
  'alpine-royal': '#0B3475',
  'alpine-light': '#DCE6F3'
};

const SEARCH_ENGINES = {
  google: 'https://www.google.com/search?q=',
  duckduckgo: 'https://duckduckgo.com/?q=',
  bing: 'https://www.bing.com/search?q=',
  brave: 'https://search.brave.com/search?q='
};

let mainWindow = null;
let peakSession = null;
let incognitoSession = null;
let omniboxView = null;
let omniboxVisible = false;
let omniboxRect = null;

const tabs = [];
let activeTabId = null;
let nextTabSeq = 1;
const closedTabsStack = [];
const activeDownloadItems = new Map();

let layoutState = {
  topHeight: 78,
  rightPanelWidth: 0
};
let isHtmlFullScreen = false;
let shieldBroadcastTimer = null;
const upgradedHttpsHosts = new Set();
const failedHttpsHosts = new Set();

function getHostname(rawUrl) {
  if (!rawUrl) return '';
  try {
    return new URL(rawUrl).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function getThemeBg(theme) {
  return THEME_BG_COLORS[theme] || THEME_BG_COLORS['alpine-dark'];
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

  if (host === 'incognito') {
    if (pathname === '/' || pathname === '') {
      return path.join(PAGES_DIR, 'incognito.html');
    }
    return safeResolveInDir(PAGES_DIR, pathname);
  }

  if (host === 'settings') {
    if (pathname === '/' || pathname === '') {
      return path.join(PAGES_DIR, 'settings.html');
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
  const blockedDomains = Array.from(tab.blockedDomains.entries())
    .map(([host, count]) => ({ host, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 40);

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
    blockedDomains,
    isSecure: tab.isSecure,
    isIncognito: Boolean(tab.isIncognito)
  };
}

function getSettingsPageState() {
  return {
    settings: store.getSettings(),
    shieldStats: store.getShieldStats(),
    shieldInfo: shield.getShieldInfo(),
    appVersion: app.getVersion(),
    versions: {
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node
    }
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
    shieldStats: store.getShieldStats(),
    shieldInfo: shield.getShieldInfo()
  };
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('data:updated', payload);
  }
  const newTabPayload = {
    settings: payload.settings,
    speedDial: store.getSpeedDial(),
    shieldStats: payload.shieldStats
  };
  const settingsPagePayload = getSettingsPageState();
  for (const tab of tabs) {
    if (!tab.view.webContents.isDestroyed() && isPeakPageUrl(tab.url)) {
      if (tab.url.startsWith(SETTINGS_URL)) {
        tab.view.webContents.send('settings:state-updated', settingsPagePayload);
      } else {
        tab.view.webContents.send('newtab:state-updated', newTabPayload);
      }
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
  } else if (url.startsWith('peak://incognito')) {
    tab.displayUrl = '';
    tab.title = 'Karta Incognito';
    tab.isSecure = true;
  } else if (url.startsWith('peak://settings')) {
    tab.displayUrl = 'peak://settings';
    tab.title = 'Ustawienia';
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
  if (ctrl && shift && key === 'n') {
    createTab(INCOGNITO_URL, true, { incognito: true });
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
  if (ctrl && !shift && key === ',') {
    openSettingsTab('');
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
          click: () => createTab(params.linkURL, true, { incognito: tab.isIncognito })
        },
        {
          label: 'Otwórz link w karcie Incognito',
          click: () => createTab(params.linkURL, true, { incognito: true })
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
          click: () => createTab(params.srcURL, true, { incognito: tab.isIncognito })
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
            createTab(url, true, { incognito: tab.isIncognito });
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

function injectPageProtections(tab) {
  if (!tab || tab.view.webContents.isDestroyed() || isPeakPageUrl(tab.url)) return;
  const settings = store.getSettings();
  if (!settings.shieldEnabled || settings.shieldLevel === 'off') return;
  const host = getHostname(tab.url);
  if (!host || store.isHostAllowlisted(host)) return;

  if (settings.cosmeticBlocking) {
    const css = shield.getCosmeticCssForUrl(tab.url, settings.shieldLevel);
    if (css) {
      tab.view.webContents.insertCSS(css).catch(() => {});
    }
  }

  if (settings.shieldLevel === 'aggressive' && (host === 'youtube.com' || host.endsWith('.youtube.com'))) {
    tab.view.webContents.executeJavaScript(shield.getYoutubeAdSkipScript()).catch(() => {});
  }
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
            session: tab.isIncognito ? incognitoSession : peakSession,
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true
          }
        }
      };
    }
    if (details.url) {
      createTab(details.url, true, { incognito: tab.isIncognito });
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
    tab.blockedDomains = new Map();
    updateTabUrlMeta(tab, url);
    updateTabNavState(tab);
    if (!isPeakPageUrl(url) && !tab.isIncognito) {
      store.recordHistory({ url, title: tab.title });
      broadcastData();
    }
    broadcastTabs();
  });

  wc.on('dom-ready', () => {
    injectPageProtections(tab);
  });

  wc.on('did-navigate-in-page', (_event, url, isMainFrame) => {
    if (!isMainFrame) return;
    updateTabUrlMeta(tab, url);
    updateTabNavState(tab);
    const host = getHostname(url);
    if (host === 'youtube.com' || host.endsWith('.youtube.com')) {
      injectPageProtections(tab);
    }
    if (!isPeakPageUrl(url) && !tab.isIncognito) {
      store.recordHistory({ url, title: tab.title });
      broadcastData();
    }
    broadcastTabs();
  });

  wc.on('page-title-updated', (_event, title) => {
    if (!tab.url.startsWith('peak://error')) {
      tab.title = title || tab.title || 'Nowa karta';
    }
    if (!isPeakPageUrl(tab.url) && !tab.isIncognito) {
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
    if (validatedURL && validatedURL.startsWith('https://')) {
      const host = getHostname(validatedURL);
      if (host && upgradedHttpsHosts.has(host) && !failedHttpsHosts.has(host)) {
        failedHttpsHosts.add(host);
        const fallbackHttp = validatedURL.replace(/^https:/i, 'http:');
        wc.loadURL(fallbackHttp);
        return;
      }
    }
    tab.isLoading = false;
    const errorUrl = `peak://error/?url=${encodeURIComponent(validatedURL || '')}&code=${encodeURIComponent(
      String(errorCode)
    )}&desc=${encodeURIComponent(errorDescription || '')}`;
    wc.loadURL(errorUrl);
  });
}

function createTab(initialUrl = NEWTAB_URL, activate = true, options = {}) {
  const id = `tab-${nextTabSeq++}`;
  const isIncognito = Boolean(options && options.incognito);
  const defaultZoom = store.getSettings().defaultZoom || 1;
  const view = new WebContentsView({
    webPreferences: {
      session: isIncognito ? incognitoSession : peakSession,
      preload: path.join(__dirname, 'preload-newtab.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  const tab = {
    id,
    view,
    isIncognito,
    url: initialUrl,
    displayUrl: initialUrl === NEWTAB_URL || initialUrl === INCOGNITO_URL ? '' : initialUrl,
    title:
      initialUrl === NEWTAB_URL
        ? 'Nowa karta'
        : initialUrl === INCOGNITO_URL
          ? 'Karta Incognito'
          : 'Ładowanie…',
    favicon: '',
    isLoading: true,
    canGoBack: false,
    canGoForward: false,
    isMuted: false,
    audible: false,
    zoomFactor: defaultZoom,
    blockedCount: 0,
    blockedDomains: new Map(),
    isSecure: initialUrl.startsWith('https://') || initialUrl.startsWith('peak://'),
    errorTargetUrl: null
  };

  tabs.push(tab);
  wireTabEvents(tab);

  if (defaultZoom !== 1) {
    view.webContents.setZoomFactor(defaultZoom);
  }

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
  if (removed.url && !isPeakPageUrl(removed.url) && !removed.isIncognito) {
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

  if (removed.isIncognito && incognitoSession && tabs.every((t) => !t.isIncognito)) {
    incognitoSession.clearStorageData().catch(() => {});
    incognitoSession.clearCache().catch(() => {});
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

function applySettingsSideEffects(prevSettings, nextSettings) {
  if (mainWindow && !mainWindow.isDestroyed() && prevSettings.theme !== nextSettings.theme) {
    mainWindow.setBackgroundColor(getThemeBg(nextSettings.theme));
  }
  if (prevSettings.defaultZoom !== nextSettings.defaultZoom) {
    for (const tab of tabs) {
      if (!tab.view.webContents.isDestroyed()) {
        tab.zoomFactor = nextSettings.defaultZoom;
        tab.view.webContents.setZoomFactor(nextSettings.defaultZoom);
      }
    }
    broadcastTabs();
  }
}

function openSettingsTab(section = '') {
  const hash = section ? (section.startsWith('#') ? section : `#${section}`) : '';
  const existing = tabs.find((t) => t.url && t.url.startsWith(SETTINGS_URL));
  if (existing) {
    switchTab(existing.id);
    if (hash && !existing.view.webContents.isDestroyed()) {
      existing.view.webContents.executeJavaScript(`window.location.hash = ${JSON.stringify(hash)};`).catch(() => {});
    }
    return existing.id;
  }
  const created = createTab(`${SETTINGS_URL}${hash}`, true);
  return created.id;
}

function configureSessionProtections(targetSession, { isIncognito = false } = {}) {
  const cleanUA = targetSession
    .getUserAgent()
    .replace(/\s*Electron\/\S+/gi, '')
    .replace(/\s*peak-browser\/\S+/gi, '');
  targetSession.setUserAgent(cleanUA);

  registerPeakProtocolOnSession(targetSession);

  targetSession.webRequest.onBeforeRequest((details, callback) => {
    const rawUrl = details.url || '';
    if (!rawUrl.startsWith('http://') && !rawUrl.startsWith('https://')) {
      callback({ cancel: false });
      return;
    }

    const settings = store.getSettings();
    const tab = typeof details.webContentsId === 'number' ? getTabByWebContentsId(details.webContentsId) : null;
    const sourceUrl = tab ? tab.url : details.initiator || details.referrer || '';
    const pageHost = getHostname(sourceUrl) || getHostname(rawUrl);
    const allowlisted = Boolean(pageHost && store.isHostAllowlisted(pageHost));

    if (details.resourceType === 'mainFrame') {
      const targetHost = getHostname(rawUrl);
      const targetAllowlisted = Boolean(targetHost && store.isHostAllowlisted(targetHost));

      if (settings.httpsUpgrade && !targetAllowlisted) {
        const upgraded = shield.shouldUpgradeToHttps(rawUrl, failedHttpsHosts);
        if (upgraded) {
          upgradedHttpsHosts.add(getHostname(upgraded));
          callback({ redirectURL: upgraded });
          return;
        }
      }

      if (settings.stripTrackingParams && !targetAllowlisted) {
        const cleaned = shield.stripTrackingParams(rawUrl);
        if (cleaned) {
          callback({ redirectURL: cleaned });
          return;
        }
      }

      callback({ cancel: false });
      return;
    }

    if (allowlisted || !settings.shieldEnabled || settings.shieldLevel === 'off') {
      callback({ cancel: false });
      return;
    }

    const result = shield.shouldBlockRequest(rawUrl, details.resourceType, sourceUrl, {
      level: settings.shieldLevel
    });
    if (result.blocked) {
      if (tab) {
        tab.blockedCount += 1;
        if (result.host) {
          tab.blockedDomains.set(result.host, (tab.blockedDomains.get(result.host) || 0) + 1);
        }
      }
      store.incrementShieldBlocked();
      scheduleShieldBroadcast();
      callback({ cancel: true });
      return;
    }

    callback({ cancel: false });
  });

  targetSession.webRequest.onBeforeSendHeaders((details, callback) => {
    const settings = store.getSettings();
    const rawUrl = details.url || '';
    if (!settings.privacyHeaders || (!rawUrl.startsWith('http://') && !rawUrl.startsWith('https://'))) {
      callback({ requestHeaders: details.requestHeaders });
      return;
    }

    const tab = typeof details.webContentsId === 'number' ? getTabByWebContentsId(details.webContentsId) : null;
    const pageHost = getHostname(tab ? tab.url : '') || getHostname(rawUrl);
    if (pageHost && store.isHostAllowlisted(pageHost)) {
      callback({ requestHeaders: details.requestHeaders });
      return;
    }

    const headers = { ...details.requestHeaders };
    headers['DNT'] = '1';
    headers['Sec-GPC'] = '1';

    for (const key of Object.keys(headers)) {
      const lower = key.toLowerCase();
      if (lower === 'x-client-data') {
        delete headers[key];
      } else if (lower === 'referer' && headers[key]) {
        try {
          const refUrl = new URL(headers[key]);
          const reqHost = getHostname(rawUrl);
          if (refUrl.hostname.toLowerCase() !== reqHost) {
            headers[key] = `${refUrl.origin}/`;
          }
        } catch {
          // Keep original if unparseable
        }
      }
    }

    callback({ requestHeaders: headers });
  });

  targetSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    if (permission === 'fullscreen' || permission === 'pointerLock' || permission === 'clipboard-sanitized-write') {
      callback(true);
      return;
    }

    const settings = store.getSettings();
    if (
      settings.blockNotifications &&
      ['notifications', 'midiSysex', 'idle-detection', 'serial', 'usb', 'hid', 'openExternal'].includes(permission)
    ) {
      callback(false);
      return;
    }

    if (permission === 'media' || permission === 'geolocation') {
      const reqUrl = (details && details.requestingUrl) || webContents.getURL();
      const host = getHostname(reqUrl) || 'Nieznana strona';
      const permLabel = permission === 'media' ? 'kamery lub mikrofonu' : 'lokalizacji';
      dialog
        .showMessageBox(mainWindow, {
          type: 'question',
          buttons: ['Odmów', 'Zezwól'],
          defaultId: 0,
          cancelId: 0,
          title: 'Uprawnienia witryny',
          message: `Witryna ${host} prosi o dostęp do ${permLabel}.`
        })
        .then(({ response }) => callback(response === 1))
        .catch(() => callback(false));
      return;
    }

    callback(false);
  });

  if (!isIncognito) {
    targetSession.on('will-download', (_event, item) => {
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
}

function setupSession() {
  peakSession = session.fromPartition('persist:peak');
  incognitoSession = session.fromPartition('peak-incognito');

  registerPeakProtocolOnSession(session.defaultSession);
  configureSessionProtections(peakSession, { isIncognito: false });
  configureSessionProtections(incognitoSession, { isIncognito: true });
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

  ipcMain.handle('ui:open-settings', (_event, section) => {
    return openSettingsTab(section || '');
  });

  // Tabs & Navigation
  ipcMain.handle('tabs:get-state', () => ({
    tabs: tabs.map(serializeTab),
    activeTabId,
    settings: store.getSettings(),
    bookmarks: store.getBookmarks(),
    history: store.getHistory(),
    downloads: store.getDownloads(),
    shieldStats: store.getShieldStats(),
    shieldInfo: shield.getShieldInfo()
  }));

  ipcMain.handle('tabs:new', (_event, url) => {
    const tab = createTab(url || NEWTAB_URL, true);
    return tab.id;
  });

  ipcMain.handle('tabs:new-incognito', (_event, url) => {
    const tab = createTab(url || INCOGNITO_URL, true, { incognito: true });
    return tab.id;
  });

  ipcMain.handle('tabs:close', (_event, tabId) => {
    closeTab(tabId);
  });

  ipcMain.handle('tabs:activate', (_event, tabId) => {
    switchTab(tabId);
  });

  ipcMain.handle('tabs:reorder', (_event, { fromId, toId } = {}) => {
    const fromIdx = tabs.findIndex((t) => t.id === fromId);
    const toIdx = tabs.findIndex((t) => t.id === toId);
    if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return;
    const [moved] = tabs.splice(fromIdx, 1);
    tabs.splice(toIdx, 0, moved);
    broadcastTabs();
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
      tab.view.webContents.loadURL(tab.isIncognito ? INCOGNITO_URL : NEWTAB_URL);
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
    const prev = store.getSettings();
    const next = store.updateSettings(partial);
    applySettingsSideEffects(prev, next);
    broadcastData();
    return next;
  });

  ipcMain.handle('shield:toggle-site', (_event, host) => {
    const targetHost = (host || '').trim().toLowerCase();
    if (!targetHost) return store.getSettings();
    if (store.isHostAllowlisted(targetHost)) {
      store.removeAllowlistHost(targetHost);
    } else {
      store.addAllowlistHost(targetHost);
    }
    const active = getActiveTab();
    if (active && !active.view.webContents.isDestroyed() && !isPeakPageUrl(active.url)) {
      active.view.webContents.reload();
    }
    broadcastData();
    return store.getSettings();
  });

  ipcMain.handle('privacy:clear-data', async () => {
    store.clearHistory();
    await peakSession.clearStorageData();
    await peakSession.clearCache();
    broadcastData();
    return { ok: true };
  });

  // Dedicated peak://settings handlers (strictly gated)
  ipcMain.handle('settings-page:get-state', (event) => {
    assertPeakSender(event);
    return getSettingsPageState();
  });

  ipcMain.handle('settings-page:update', (event, partial) => {
    assertPeakSender(event);
    const prev = store.getSettings();
    const next = store.updateSettings(partial);
    applySettingsSideEffects(prev, next);
    broadcastData();
    return getSettingsPageState();
  });

  ipcMain.handle('settings-page:allowlist-add', (event, host) => {
    assertPeakSender(event);
    store.addAllowlistHost(host);
    broadcastData();
    return getSettingsPageState();
  });

  ipcMain.handle('settings-page:allowlist-remove', (event, host) => {
    assertPeakSender(event);
    store.removeAllowlistHost(host);
    broadcastData();
    return getSettingsPageState();
  });

  ipcMain.handle('settings-page:update-filters', async (event) => {
    if (event.senderFrame && event.senderFrame.url && !event.senderFrame.url.startsWith('peak://') && !event.senderFrame.url.startsWith('file://')) {
      throw new Error('Dostęp zabroniony');
    }
    const info = await shield.updateFilterLists(app.getPath('userData'));
    broadcastData();
    return info;
  });

  ipcMain.handle('settings-page:clear-data', async (event, options = {}) => {
    assertPeakSender(event);
    if (options.history) {
      store.clearHistory();
    }
    if (options.cookies) {
      await peakSession.clearStorageData();
      if (incognitoSession) await incognitoSession.clearStorageData();
    }
    if (options.cache) {
      await peakSession.clearCache();
      if (incognitoSession) await incognitoSession.clearCache();
    }
    broadcastData();
    return { ok: true };
  });

  ipcMain.handle('settings-page:detect-browsers', (event) => {
    assertPeakSender(event);
    return importer.detectBrowsers();
  });

  ipcMain.handle('settings-page:import-browser', (event, payload = {}) => {
    assertPeakSender(event);
    const result = importer.importFromSource(
      payload.sourceId,
      {
        bookmarks: payload.bookmarks !== false,
        history: payload.history !== false,
        speedDial: Boolean(payload.speedDial)
      },
      store
    );
    if (result.ok) {
      broadcastData();
    }
    return result;
  });

  ipcMain.handle('settings-page:import-html', async (event) => {
    assertPeakSender(event);
    const picked = await dialog.showOpenDialog(mainWindow, {
      title: 'Importuj zakładki z pliku HTML',
      filters: [{ name: 'Pliki zakładek HTML', extensions: ['html', 'htm'] }],
      properties: ['openFile']
    });
    if (picked.canceled || !picked.filePaths || picked.filePaths.length === 0) {
      return { ok: false, canceled: true };
    }
    const result = importer.importFromHtmlFile(picked.filePaths[0], store, { speedDial: false });
    if (result.ok) {
      broadcastData();
    }
    return result;
  });

  ipcMain.handle('settings-page:open-incognito', (event) => {
    assertPeakSender(event);
    const tab = createTab(INCOGNITO_URL, true, { incognito: true });
    return tab.id;
  });

  ipcMain.handle('settings-page:open-devtools', (event) => {
    assertPeakSender(event);
    toggleActiveDevTools(event.sender);
  });

  ipcMain.handle('settings-page:open-external', (event, rawUrl) => {
    assertPeakSender(event);
    if (
      typeof rawUrl === 'string' &&
      (rawUrl.startsWith('https://peakbrowser.vercel.app') ||
        rawUrl.startsWith('https://github.com/latajoncy82-svg/peak-browser'))
    ) {
      createTab(rawUrl, true);
    }
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
    createTab(STARTUP_URL, true);
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

  // Unit assertions for shield.js (full @ghostery/adblocker engine + privacy)
  assert.strictEqual(
    shield.shouldBlockRequest(
      'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js',
      'script',
      'https://example.com/'
    ).blocked,
    true,
    'Shield should block adsbygoogle script'
  );
  assert.strictEqual(
    shield.shouldBlockRequest(
      'https://securepubads.g.doubleclick.net/tag/js/gpt.js',
      'script',
      'https://example.com/'
    ).blocked,
    true,
    'Shield should block doubleclick GPT script'
  );
  assert.strictEqual(
    shield.shouldBlockRequest('https://hit.gemius.pl/xgemius.js', 'script', 'https://onet.pl/').blocked,
    true,
    'Shield should block Polish gemius tracker'
  );
  assert.strictEqual(
    shield.shouldBlockRequest('https://example.com/index.html', 'mainFrame', 'https://example.com/').blocked,
    false,
    'Shield must allow mainFrame navigation'
  );
  assert.strictEqual(
    shield.shouldBlockRequest('peak://newtab/', 'subFrame', 'peak://newtab/').blocked,
    false,
    'Shield must allow peak:// requests'
  );
  assert.ok(
    shield.getCosmeticCssForUrl('https://www.youtube.com/watch?v=test', 'aggressive').length > 100,
    'Cosmetic CSS for YouTube should be non-empty'
  );
  assert.strictEqual(
    shield.stripTrackingParams('https://example.com/page?utm_source=ads&fbclid=123&id=42'),
    'https://example.com/page?id=42',
    'Tracking params should be stripped cleanly'
  );
  assert.strictEqual(
    shield.shouldUpgradeToHttps('http://example.com/test', new Set()),
    'https://example.com/test',
    'HTTP should upgrade to HTTPS'
  );
  assert.strictEqual(
    shield.shouldUpgradeToHttps('http://localhost:3000/', new Set()),
    null,
    'Localhost must not auto-upgrade to HTTPS'
  );

  // Unit assertions for store.js
  const unitStoreDir = path.join(verifyDir, 'unit-store');
  fs.rmSync(unitStoreDir, { recursive: true, force: true });
  const testStore = new store.PeakStore().init(unitStoreDir);
  assert.strictEqual(testStore.getSettings().theme, 'alpine-dark');
  assert.strictEqual(testStore.getSettings().shieldLevel, 'aggressive');
  testStore.updateSettings({ theme: 'alpine-light', searchEngine: 'duckduckgo', defaultZoom: 1.1 });
  testStore.addAllowlistHost('https://www.bank.pl/login');
  testStore.addBookmark({ title: 'Example', url: 'https://example.com' });
  testStore.recordHistory({ url: 'https://example.com', title: 'Example' });
  testStore.flushSync();

  const reloadedStore = new store.PeakStore().init(unitStoreDir);
  assert.strictEqual(reloadedStore.getSettings().theme, 'alpine-light');
  assert.strictEqual(reloadedStore.getSettings().searchEngine, 'duckduckgo');
  assert.strictEqual(reloadedStore.getSettings().defaultZoom, 1.1);
  assert.strictEqual(reloadedStore.isHostAllowlisted('bank.pl'), true);
  assert.strictEqual(reloadedStore.isBookmarked('https://example.com'), true);
  assert.strictEqual(reloadedStore.getHistory().length, 1);

  // Unit assertions for importer.js (Chromium Bookmarks + SQLite History + HTML)
  const { DatabaseSync } = require('node:sqlite');
  const mockProfileDir = path.join(verifyDir, 'mock-chrome-profile');
  fs.rmSync(mockProfileDir, { recursive: true, force: true });
  fs.mkdirSync(mockProfileDir, { recursive: true });

  fs.writeFileSync(
    path.join(mockProfileDir, 'Bookmarks'),
    JSON.stringify({
      roots: {
        bookmark_bar: {
          type: 'folder',
          children: [
            { type: 'url', name: 'PEAK LABS', url: 'https://peaklabstudio.vercel.app/#o-firmie', date_added: '13370000000000000' },
            { type: 'url', name: 'GitHub', url: 'https://github.com/latajoncy82-svg', date_added: '13370000000000000' },
            { type: 'url', name: 'ChromeInternal', url: 'chrome://settings' }
          ]
        }
      }
    })
  );

  const histDbPath = path.join(mockProfileDir, 'History');
  const mockDb = new DatabaseSync(histDbPath);
  mockDb.exec('CREATE TABLE urls (id INTEGER PRIMARY KEY, url TEXT, title TEXT, last_visit_time INTEGER);');
  mockDb
    .prepare('INSERT INTO urls (url, title, last_visit_time) VALUES (?, ?, ?)')
    .run('https://peakbrowser.vercel.app/', 'Peak Browser', 13370000000000000);
  mockDb.close();

  const htmlBmPath = path.join(verifyDir, 'mock-bookmarks.html');
  fs.writeFileSync(
    htmlBmPath,
    '<DL><p><DT><A HREF="https://peakbrowser.vercel.app/#telefon">Peak na telefon</A><DT><A HREF="https://github.com/latajoncy82-svg">GitHub</A></DL>'
  );

  const importStoreDir = path.join(verifyDir, 'unit-import-store');
  fs.rmSync(importStoreDir, { recursive: true, force: true });
  const importTestStore = new store.PeakStore().init(importStoreDir);
  const srcRes = importer.importFromSource(
    { id: 'mock:chrome', browserName: 'Google Chrome', label: 'Google Chrome (Mock)', type: 'chromium', profileDir: mockProfileDir },
    { bookmarks: true, history: true, speedDial: true },
    importTestStore
  );
  assert.strictEqual(srcRes.ok, true);
  assert.strictEqual(srcRes.bookmarksAdded, 2);
  assert.strictEqual(srcRes.historyAdded, 1);
  assert.strictEqual(srcRes.speedDialAdded, 2);

  const dupRes = importer.importFromHtmlFile(htmlBmPath, importTestStore, { speedDial: false });
  assert.strictEqual(dupRes.ok, true);
  assert.strictEqual(dupRes.bookmarksAdded, 1, 'HTML import should add 1 new and deduplicate existing GitHub URL');
  assert.strictEqual(dupRes.bookmarksSkipped, 1);

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

  // 1. Initial startup tab (company page)
  await new Promise((r) => setTimeout(r, 700));
  const initialTab = getActiveTab();
  await waitForTabLoad(initialTab);
  await new Promise((r) => setTimeout(r, 500));
  const startupUrl = initialTab.url;
  const startupTitle = initialTab.title;
  assert.ok(
    startupUrl.startsWith('https://peaklabstudio.vercel.app') && startupUrl.includes('#o-firmie'),
    `Startup tab should open company page #o-firmie, got: ${startupUrl}`
  );
  await capturePair('1-startup-company');

  // 2. Open full-page Settings (peak://settings) via gear button
  await mainWindow.webContents.executeJavaScript(`
    document.getElementById('btn-settings').click();
  `);
  await new Promise((r) => setTimeout(r, 350));
  const settingsTab = getActiveTab();
  await waitForTabLoad(settingsTab);
  await new Promise((r) => setTimeout(r, 350));
  await capturePair('2-settings-page');

  // 3. Scroll / navigate peak://settings to #ochrona section
  await settingsTab.view.webContents.executeJavaScript(`
    document.getElementById('ochrona').scrollIntoView({ behavior: 'instant', block: 'start' });
    document.querySelector('[data-section="ochrona"]').click();
  `);
  await new Promise((r) => setTimeout(r, 350));
  await capturePair('3-settings-shield');

  // 4. Switch back to initial tab, load https://example.com, and open quick Ochrona drawer
  closeTab(settingsTab.id);
  initialTab.view.webContents.loadURL('https://example.com');
  await waitForTabLoad(initialTab);
  await mainWindow.webContents.executeJavaScript(`
    document.getElementById('btn-shield').click();
  `);
  await new Promise((r) => setTimeout(r, 400));

  const verifyChromeState = await mainWindow.webContents.executeJavaScript(`
    (() => ({
      omniboxValue: document.getElementById('omnibox-input').value,
      omniboxDomain: document.getElementById('omnibox-display')?.textContent || '',
      backDisabled: document.getElementById('btn-back').disabled,
      activeTabTitle: document.querySelector('.tab.active .tab-title')?.textContent || '',
      shieldHost: document.getElementById('shield-site-host')?.textContent || '',
      rulesBadge: document.getElementById('shield-rules-badge')?.textContent || ''
    }))();
  `);
  assert.ok(verifyChromeState.omniboxValue.includes('example.com'), 'Omnibox should display example.com');
  assert.ok(verifyChromeState.omniboxDomain.includes('example.com'), 'Formatted omnibox should display example.com');
  assert.strictEqual(verifyChromeState.backDisabled, false, 'Back button should be enabled after navigating');
  assert.strictEqual(verifyChromeState.shieldHost, 'example.com', 'Shield drawer should show example.com');
  assert.ok(verifyChromeState.rulesBadge.length > 0, 'Shield drawer should show active rules count');

  await capturePair('4-shield-drawer');

  // Close drawer cleanly before Incognito & Settings Import checks
  await mainWindow.webContents.executeJavaScript(`
    document.getElementById('drawer-close')?.click();
  `);
  await new Promise((r) => setTimeout(r, 200));

  // 5. Incognito tab & zero-history isolation test
  store.clearHistory();
  const incTab = createTab(INCOGNITO_URL, true, { incognito: true });
  await waitForTabLoad(incTab);
  await new Promise((r) => setTimeout(r, 350));
  assert.strictEqual(incTab.isIncognito, true, 'Created incognito tab must set isIncognito=true');
  const incognitoPillVisible = await mainWindow.webContents.executeJavaScript(`
    !document.getElementById('incognito-pill')?.classList.contains('hidden')
  `);
  assert.strictEqual(incognitoPillVisible, true, 'Omnibox Incognito pill must be visible');
  await capturePair('5-incognito-tab');

  incTab.view.webContents.loadURL('https://example.com/?peak_incognito_check=1');
  await waitForTabLoad(incTab);
  assert.strictEqual(
    store.getHistory().length,
    0,
    'Incognito navigation must never record entries into persistent history'
  );
  closeTab(incTab.id);

  // 6. Full-page Settings #import section
  openSettingsTab('#import');
  await new Promise((r) => setTimeout(r, 350));
  const importSettingsTab = getActiveTab();
  await waitForTabLoad(importSettingsTab);
  await importSettingsTab.view.webContents.executeJavaScript(`
    document.getElementById('import')?.scrollIntoView({ behavior: 'instant', block: 'start' });
    document.querySelector('[data-section="import"]')?.click();
  `);
  await new Promise((r) => setTimeout(r, 500));
  const importSelectCount = await importSettingsTab.view.webContents.executeJavaScript(`
    document.getElementById('import-browser-select')?.options?.length || 0
  `);
  assert.ok(importSelectCount >= 1, 'Import browser select should render at least 1 option');
  await capturePair('6-settings-import');

  fs.writeFileSync(
    path.join(verifyDir, 'summary.json'),
    JSON.stringify(
      {
        ok: true,
        startupUrl,
        startupTitle,
        verifyChromeState,
        importerTest: srcRes,
        incognitoZeroHistory: true,
        importSelectCount,
        shieldInfo: shield.getShieldInfo()
      },
      null,
      2
    )
  );
}

app.whenReady().then(() => {
  store.init(app.getPath('userData'));
  shield.initShield(app.getPath('userData'), ASSETS_DIR);
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
