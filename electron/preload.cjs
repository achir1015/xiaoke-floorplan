'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const inv = (ch) => (...a) => ipcRenderer.invoke(ch, ...a);
const on = (ch) => (fn) => {
  const h = (e, d) => fn(d);
  ipcRenderer.on(ch, h);
  return () => ipcRenderer.off(ch, h);
};

contextBridge.exposeInMainWorld('xk', {
  info: inv('app:info'),
  saveFile: inv('file:save'),
  update: {
    check: inv('update:check'),
    download: inv('update:download'),
    install: inv('update:install'),
    openPage: inv('update:openPage'),
    onProgress: on('update:progress'),
  },
  platform: process.platform,
});
