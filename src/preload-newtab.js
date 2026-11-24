(() => {
  if (window.location.protocol !== 'peak:') {
    return;
  }

  const { contextBridge, ipcRenderer } = require('electron');

  function subscribe(channel, callback) {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  }

  contextBridge.exposeInMainWorld('peakNewTab', {
    getInitialData: () => ipcRenderer.invoke('newtab:get-data'),
    navigate: (input) => ipcRenderer.invoke('newtab:navigate', input),
    addSpeedDial: (item) => ipcRenderer.invoke('newtab:add-speed-dial', item),
    removeSpeedDial: (id) => ipcRenderer.invoke('newtab:remove-speed-dial', id),
    setTheme: (theme) => ipcRenderer.invoke('newtab:set-theme', theme),
    onStateUpdate: (callback) => subscribe('newtab:state-updated', callback)
  });

  contextBridge.exposeInMainWorld('peakSettings', {
    getState: () => ipcRenderer.invoke('settings-page:get-state'),
    updateSettings: (partial) => ipcRenderer.invoke('settings-page:update', partial),
    addAllowlistHost: (host) => ipcRenderer.invoke('settings-page:allowlist-add', host),
    removeAllowlistHost: (host) => ipcRenderer.invoke('settings-page:allowlist-remove', host),
    updateFilterLists: () => ipcRenderer.invoke('settings-page:update-filters'),
    clearData: (options) => ipcRenderer.invoke('settings-page:clear-data', options),
    detectBrowsers: () => ipcRenderer.invoke('settings-page:detect-browsers'),
    importBrowser: (payload) => ipcRenderer.invoke('settings-page:import-browser', payload),
    importHtmlBookmarks: () => ipcRenderer.invoke('settings-page:import-html'),
    openIncognito: () => ipcRenderer.invoke('settings-page:open-incognito'),
    openDevTools: () => ipcRenderer.invoke('settings-page:open-devtools'),
    openExternal: (url) => ipcRenderer.invoke('settings-page:open-external', url),
    onStateUpdate: (callback) => subscribe('settings:state-updated', callback)
  });
})();
