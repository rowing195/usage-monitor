'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('monitor', {
  onState: (handler) => ipcRenderer.on('state', (_e, state) => handler(state)),
  dragStart: () => ipcRenderer.send('drag-start'),
  dragEnd: () => ipcRenderer.send('drag-end'),
  expand: () => ipcRenderer.send('expand'),
  settleDock: () => ipcRenderer.send('settle-dock'),
  closePanel: () => ipcRenderer.send('close-panel'),
  setSetting: (key, value) => ipcRenderer.send('set-setting', key, value),
  openClaudeUsage: () => ipcRenderer.send('open-claude-usage'),
  statuslineStatus: () => ipcRenderer.invoke('statusline-status'),
  statuslineInstall: () => ipcRenderer.invoke('statusline-install'),
  statuslineUninstall: () => ipcRenderer.invoke('statusline-uninstall'),
  autostartStatus: () => ipcRenderer.invoke('autostart-status'),
  autostartSet: (enabled) => ipcRenderer.invoke('autostart-set', enabled),
  quit: () => ipcRenderer.send('quit'),
});
