// Exposes the one native capability the page needs: fetching a page's HTML for link previews.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pinpadNative', {
  fetchPage: (url) => ipcRenderer.invoke('pinpad:fetch-page', String(url)),
});
