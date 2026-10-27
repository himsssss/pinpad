// Electron shell for Pinpad (used for the Windows build): one window that loads the built web
// app from inside the package over a custom scheme, so IndexedDB and localStorage persist.

const { app, BrowserWindow, Menu, dialog, ipcMain, net, protocol, shell } = require('electron');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const SCHEME = 'pinpad';
const START_URL = `${SCHEME}://app/index.html`;
const WEB_ROOT = path.join(__dirname, '..', 'dist');

protocol.registerSchemesAsPrivileged([
  { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

if (!app.requestSingleInstanceLock()) app.quit();

/** Serves files from the bundled web build; anything outside it is a 404. */
function serveBundle(request) {
  const { pathname } = new URL(request.url);
  const relative = decodeURIComponent(pathname === '/' ? '/index.html' : pathname);
  const file = path.normalize(path.join(WEB_ROOT, relative));
  if (!file.startsWith(WEB_ROOT + path.sep)) return new Response('Not found', { status: 404 });
  return net.fetch(pathToFileURL(file).toString());
}

const PREVIEW_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 PinpadLinkPreview';
const MAX_PAGE_BYTES = 1_500_000;

/** Fetches a web page's HTML for a link preview (the page itself can't, across origins). */
async function fetchPage(_event, url) {
  if (!/^https?:\/\//i.test(url)) return null;
  try {
    const res = await net.fetch(url, {
      headers: { 'User-Agent': PREVIEW_UA, Accept: 'text/html' },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const html = (await res.text()).slice(0, MAX_PAGE_BYTES);
    // Electron can report an empty final URL; relative preview images resolve against it.
    return { url: res.url || url, html };
  } catch {
    return null;
  }
}

/** Mirrors EMBED_HOSTS in src/media.ts. */
const EMBED_HOSTS = new Set([
  'www.youtube-nocookie.com', 'player.vimeo.com', 'www.loom.com', 'www.dailymotion.com', 'fast.wistia.net',
  'streamable.com', 'player.twitch.tv', 'clips.twitch.tv', 'www.facebook.com', 'play.vidyard.com',
  'w.soundcloud.com', 'open.spotify.com', 'player-widget.mixcloud.com',
]);
let embedBase = null;

const escapeAttr = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/**
 * Serves a one-line wrapper page on 127.0.0.1 that frames a media player. YouTube and other
 * players refuse to play inside the app's custom-scheme page (it sends no referrer), but play
 * inside an http://127.0.0.1 page. Only players from known media hosts are framed.
 */
function startEmbedServer() {
  const server = http.createServer((req, res) => {
    let src = null;
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      const candidate = url.pathname === '/embed' ? url.searchParams.get('src') : null;
      const target = candidate && new URL(candidate);
      if (target && target.protocol === 'https:' && EMBED_HOSTS.has(target.hostname)) src = candidate;
    } catch {
      src = null;
    }
    if (!src) {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }).end(
      '<!doctype html><meta charset="utf-8"><meta name="referrer" content="strict-origin-when-cross-origin">' +
        '<style>html,body{margin:0;height:100%;background:#000;overflow:hidden}iframe{border:0;width:100%;height:100%}</style>' +
        `<iframe src="${escapeAttr(src)}" allow="autoplay; encrypted-media; picture-in-picture; fullscreen; clipboard-write" allowfullscreen></iframe>`,
    );
  });
  return new Promise((resolve) => {
    server.once('error', () => resolve(null));
    server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`));
  });
}

/**
 * Keeps the workspace as files in a folder the user picks (Documents\Pinpad by default):
 * an index plus one JSON file per board, laid out by src/workspaceFiles.ts. Same calls as
 * StorageBridge in the macOS shell; the choice lives in settings.json in the app's data folder.
 */
const INDEX_FILE = 'Pinpad Workspace.json';
const settingsPath = () => path.join(app.getPath('userData'), 'settings.json');
const defaultFolder = () => path.join(app.getPath('documents'), 'Pinpad');

async function readSettings() {
  try {
    return JSON.parse(await fs.readFile(settingsPath(), 'utf8'));
  } catch {
    return {};
  }
}

async function writeSettings(settings) {
  await fs.mkdir(path.dirname(settingsPath()), { recursive: true });
  await fs.writeFile(settingsPath(), JSON.stringify(settings, null, 2));
}

const exists = (file) => fs.access(file).then(() => true, () => false);
const sameFolder = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();

async function storageFolder() {
  return (await readSettings()).storageFolder || defaultFolder();
}

async function storageLocation() {
  const folder = await storageFolder();
  const file = path.join(folder, INDEX_FILE);
  return { folder, file, defaultFolder: defaultFolder(), isDefault: sameFolder(folder, defaultFolder()), exists: await exists(file) };
}

/** A page-supplied relative path inside the storage folder; anything else is refused. */
function resolveInside(folder, relative) {
  const parts = String(relative).split('/');
  if (!relative.endsWith('.json') || parts.some((p) => !p || p === '.' || p === '..' || /[\\:]/.test(p))) {
    throw new Error(`Bad workspace path ${relative}`);
  }
  return path.join(folder, ...parts);
}

/** Removes folders left empty by a moved or deleted board, up to the storage folder. */
async function pruneEmpty(folder, file) {
  for (let dir = path.dirname(file); dir.startsWith(folder + path.sep); dir = path.dirname(dir)) {
    const entries = (await fs.readdir(dir).catch(() => ['?'])).filter((e) => e !== '.DS_Store' && e !== 'desktop.ini');
    if (entries.length) return;
    await fs.rm(dir, { recursive: true, force: true });
  }
}

async function storage(event, op, arg) {
  const folder = await storageFolder();
  switch (op) {
    case 'location':
      return storageLocation();
    case 'inspect':
      return { hasWorkspace: await exists(path.join(arg || folder, INDEX_FILE)) };
    case 'read': {
      const out = {};
      for (const rel of arg || []) {
        const file = resolveInside(folder, rel);
        out[rel] = (await exists(file)) ? await fs.readFile(file, 'utf8') : null;
      }
      return out;
    }
    case 'write': {
      // Each file is written beside itself and swapped in, so a crash never leaves half a board.
      for (const [rel, text] of arg.write) {
        const file = resolveInside(folder, rel);
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(`${file}.tmp`, String(text));
        await fs.rename(`${file}.tmp`, file);
      }
      for (const rel of arg.remove) {
        const file = resolveInside(folder, rel);
        await fs.rm(file, { force: true });
        await pruneEmpty(folder, file);
      }
      for (const rel of arg.trash) {
        const file = resolveInside(folder, rel);
        if (await exists(file)) await shell.trashItem(file);
        await pruneEmpty(folder, file);
      }
      return true;
    }
    case 'choose': {
      const win = BrowserWindow.fromWebContents(event.sender);
      const result = await dialog.showOpenDialog(win, {
        title: 'Choose where Pinpad keeps your boards',
        buttonLabel: 'Use This Folder',
        defaultPath: folder,
        properties: ['openDirectory', 'createDirectory', 'promptToCreate'],
      });
      return result.canceled ? null : result.filePaths[0];
    }
    case 'use': {
      const settings = await readSettings();
      if (arg && !sameFolder(arg, defaultFolder())) settings.storageFolder = arg;
      else delete settings.storageFolder;
      await writeSettings(settings);
      return storageLocation();
    }
    case 'reveal':
      await fs.mkdir(folder, { recursive: true });
      await shell.openPath(folder);
      return true;
    default:
      throw new Error(`Unknown storage request ${op}`);
  }
}

const isAppUrl = (url) => url.startsWith(`${SCHEME}://`);
const isWebUrl = (url) => /^https?:\/\//i.test(url);

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 640,
    minHeight: 480,
    title: 'Pinpad',
    backgroundColor: '#f0f0f0',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      spellcheck: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  // Links to the web open in the default browser rather than inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isWebUrl(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (isAppUrl(url)) return;
    event.preventDefault();
    if (isWebUrl(url)) shell.openExternal(url);
  });

  // Give the page a moment to write its last pending change before the window goes away.
  let closing = false;
  win.on('close', (event) => {
    if (closing) return;
    event.preventDefault();
    closing = true;
    const flush = win.webContents.executeJavaScript('window.__flushSave?.()').catch(() => {});
    const timeout = new Promise((resolve) => setTimeout(resolve, 2000));
    Promise.race([flush, timeout]).finally(() => win.destroy());
  });

  win.loadURL(START_URL);
  return win;
}

/**
 * The page handles Ctrl+Z itself, so Undo/Redo show their shortcut without registering it
 * (registering would undo twice) and forward menu clicks to the board history.
 */
function buildMenu() {
  const toPage = (script) => (_item, win) => win?.webContents.executeJavaScript(script);
  return Menu.buildFromTemplate([
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
    { label: 'File', submenu: [process.platform === 'darwin' ? { role: 'close' } : { role: 'quit', label: 'Exit' }] },
    {
      label: 'Edit',
      submenu: [
        { label: 'Undo', accelerator: 'CmdOrCtrl+Z', registerAccelerator: false, click: toPage('window.__undo?.()') },
        { label: 'Redo', accelerator: 'CmdOrCtrl+Shift+Z', registerAccelerator: false, click: toPage('window.__redo?.()') },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    { label: 'View', submenu: [{ role: 'togglefullscreen' }, { type: 'separator' }, { role: 'toggleDevTools' }] },
    { role: 'windowMenu' },
  ]);
}

app.whenReady().then(async () => {
  protocol.handle(SCHEME, serveBundle);
  ipcMain.handle('pinpad:fetch-page', fetchPage);
  ipcMain.handle('pinpad:storage', storage);
  embedBase = await startEmbedServer();
  ipcMain.on('pinpad:embed-base', (event) => {
    event.returnValue = embedBase;
  });
  Menu.setApplicationMenu(buildMenu());
  createWindow();
});

app.on('second-instance', () => {
  const [win] = BrowserWindow.getAllWindows();
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

app.on('window-all-closed', () => app.quit());
