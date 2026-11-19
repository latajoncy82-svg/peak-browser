(() => {
  if (window.location.protocol !== 'peak:') {
    return;
  }

  const { contextBridge, ipcRenderer } = require('electron');

  contextBridge.exposeInMainWorld('peakNewTab', {
    getInitialData: () => ipcRenderer.invoke('newtab:get-data'),
    navigate: (input) => ipcRenderer.invoke('newtab:navigate', input),
    addSpeedDial: (item) => ipcRenderer.invoke('newtab:add-speed-dial', item),
    removeSpeedDial: (id) => ipcRenderer.invoke('newtab:remove-speed-dial', id),
    setTheme: (theme) => ipcRenderer.invoke('newtab:set-theme', theme),
    onStateUpdate: (callback) => {
      const listener = (_event, data) => callback(data);
      ipcRenderer.on('newtab:state-updated', listener);
      return () => ipcRenderer.removeListener('newtab:state-updated', listener);
    }
  });
})();
