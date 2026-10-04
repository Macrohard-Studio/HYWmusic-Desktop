'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('hyw', {
  /* 音乐接口 */
  search: (params) => ipcRenderer.invoke('music:search', params),
  playUrl: (params) => ipcRenderer.invoke('music:url', params),
  lyrics: (params) => ipcRenderer.invoke('music:lyrics', params),
  playlist: (params) => ipcRenderer.invoke('music:playlist', params),
  config: () => ipcRenderer.invoke('music:config'),
  download: (params) => ipcRenderer.invoke('music:download', params),

  /* 本地配置 */
  storeGet: () => ipcRenderer.invoke('store:get'),
  storeSet: (patch) => ipcRenderer.invoke('store:set', patch),
  storeReset: () => ipcRenderer.invoke('store:reset'),

  /* 窗口 / 托盘 */
  info: () => ipcRenderer.invoke('app:info'),
  openExternal: (url) => ipcRenderer.invoke('app:openExternal', url),
  setTheme: (theme, bgColor) => ipcRenderer.invoke('app:theme', theme, bgColor),
  closePrefs: () => ipcRenderer.invoke('app:closePrefs'),
  setClosePrefs: (action, askDisabled) => ipcRenderer.invoke('app:setClosePrefs', { action, askDisabled }),
  minimizeToTray: () => ipcRenderer.invoke('app:minimizeToTray'),
  onVisibility: (cb) => {
    ipcRenderer.on('app:visibility', (_e, payload) => cb(payload));
  },

  /* 服务端地址 */
  getServer: () => ipcRenderer.invoke('app:getServer'),
  setServer: (target) => ipcRenderer.invoke('app:setServer', target),
  testServer: (target) => ipcRenderer.invoke('app:testServer', target),
});
