// Lumen desktop preload — exposes the absolute API base so the web bundle
// (served from lumen://) can reach the loopback API with credentials.
'use strict';
const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('lumen', {
  desktop: true,
  apiBase: 'http://127.0.0.1:8757',
});
