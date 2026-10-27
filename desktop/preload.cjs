// Exposes the native capabilities the page needs: fetching a page's HTML for link previews,
// the loopback address of the media wrapper server (see startEmbedServer in main.cjs), and
// the workspace files in the user's chosen folder (see storage in main.cjs), and Google
// sign-in for saving to Google Drive (see google in main.cjs).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pinpadNative', {
  fetchPage: (url) => ipcRenderer.invoke('pinpad:fetch-page', String(url)),
  embedBase: ipcRenderer.sendSync('pinpad:embed-base'),
  storage: Object.fromEntries(
    ['location', 'inspect', 'read', 'write', 'list', 'choose', 'use', 'reveal'].map((op) => [
      op,
      (arg) => ipcRenderer.invoke('pinpad:storage', op, arg ?? null),
    ]),
  ),
  google: {
    signIn: (config) => ipcRenderer.invoke('pinpad:google', 'signIn', config),
    token: (config) => ipcRenderer.invoke('pinpad:google', 'token', config),
    signOut: (config) => ipcRenderer.invoke('pinpad:google', 'signOut', config ?? null),
  },
});
