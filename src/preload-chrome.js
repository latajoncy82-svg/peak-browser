const { contextBridge, ipcRenderer } = require('electron');

function subscribe(channel, callback) {
  const listener = (_event, data) => callback(data);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('peak', {
  // Window controls
  minimizeWindow: () => ipcRenderer.send('window:minimize'),
  toggleMaximizeWindow: () => ipcRenderer.send('window:maximize-toggle'),
  closeWindow: () => ipcRenderer.send('window:close'),
  isWindowMaximized: () => ipcRenderer.invoke('window:is-maximized'),
  toggleFullScreen: () => ipcRenderer.send('window:toggle-fullscreen'),
  setLayout: (layout) => ipcRenderer.send('ui:set-layout', layout),
  openSettings: (section = '') => ipcRenderer.invoke('ui:open-settings', section),

  // Tabs & navigation
  getInitialState: () => ipcRenderer.invoke('tabs:get-state'),
  newTab: (url) => ipcRenderer.invoke('tabs:new', url),
  closeTab: (tabId) => ipcRenderer.invoke('tabs:close', tabId),
  activateTab: (tabId) => ipcRenderer.invoke('tabs:activate', tabId),
  reorderTabs: (fromId, toId) => ipcRenderer.invoke('tabs:reorder', { fromId, toId }),
  reopenClosedTab: () => ipcRenderer.invoke('tabs:reopen'),
  toggleMuteTab: (tabId) => ipcRenderer.invoke('tabs:mute-toggle', tabId),
  navigate: (input) => ipcRenderer.invoke('nav:go', input),
  goBack: () => ipcRenderer.invoke('nav:back'),
  goForward: () => ipcRenderer.invoke('nav:forward'),
  reload: (hard = false) => ipcRenderer.invoke('nav:reload', hard),
  stop: () => ipcRenderer.invoke('nav:stop'),
  goHome: () => ipcRenderer.invoke('nav:home'),
  zoom: (direction) => ipcRenderer.invoke('nav:zoom', direction),
  toggleDevTools: () => ipcRenderer.invoke('devtools:toggle'),

  // Find in page
  findInPage: (payload) => ipcRenderer.send('find:query', payload),
  stopFindInPage: () => ipcRenderer.send('find:stop'),

  // Omnibox overlay
  showOmniboxOverlay: (payload) => ipcRenderer.send('omnibox:show', payload),
  updateOmniboxOverlay: (payload) => ipcRenderer.send('omnibox:update', payload),
  hideOmniboxOverlay: () => ipcRenderer.send('omnibox:hide'),

  // Bookmarks, history, downloads, settings & shield
  toggleCurrentBookmark: () => ipcRenderer.invoke('bookmarks:toggle-current'),
  addBookmark: (item) => ipcRenderer.invoke('bookmarks:add', item),
  removeBookmark: (urlOrId) => ipcRenderer.invoke('bookmarks:remove', urlOrId),
  clearHistory: () => ipcRenderer.invoke('history:clear'),
  openDownload: (id) => ipcRenderer.invoke('downloads:open', id),
  showDownloadInFolder: (id) => ipcRenderer.invoke('downloads:show', id),
  cancelDownload: (id) => ipcRenderer.invoke('downloads:cancel', id),
  clearDownloads: () => ipcRenderer.invoke('downloads:clear'),
  updateSettings: (partial) => ipcRenderer.invoke('settings:update', partial),
  toggleSiteShield: (host) => ipcRenderer.invoke('shield:toggle-site', host),
  updateFilters: () => ipcRenderer.invoke('settings-page:update-filters'),
  clearBrowsingData: () => ipcRenderer.invoke('privacy:clear-data'),

  // Event listeners
  onTabsUpdated: (cb) => subscribe('tabs:updated', cb),
  onDataUpdated: (cb) => subscribe('data:updated', cb),
  onWindowState: (cb) => subscribe('window:state', cb),
  onShortcut: (cb) => subscribe('ui:shortcut', cb),
  onFindResult: (cb) => subscribe('find:result', cb),
  onOmniboxHover: (cb) => subscribe('omnibox:hover', cb),
  onOmniboxClosed: (cb) => subscribe('omnibox:closed', cb)
});
