const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('peakOverlay', {
  onUpdate: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('overlay:update', listener);
    return () => ipcRenderer.removeListener('overlay:update', listener);
  },
  selectItem: (item) => ipcRenderer.send('overlay:select', item),
  hoverItem: (index) => ipcRenderer.send('overlay:hover', index),
  dismiss: () => ipcRenderer.send('overlay:dismiss')
});
