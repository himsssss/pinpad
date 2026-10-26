// Exposes the native capabilities the page needs: fetching a page's HTML for link previews,
// and the loopback address of the media wrapper server (see startEmbedServer in main.cjs).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pinpadNative', {
  fetchPage: (url) => ipcRenderer.invoke('pinpad:fetch-page', String(url)),
  embedBase: ipcRenderer.sendSync('pinpad:embed-base'),
});
