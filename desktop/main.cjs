// Electron shell for Pinpad (used for the Windows build): one window that loads the built web
// app from inside the package over a custom scheme, so IndexedDB and localStorage persist.

const { app, BrowserWindow, Menu, dialog, ipcMain, net, protocol, safeStorage, shell } = require('electron');
const crypto = require('node:crypto');
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

/** Folders that hold attached files (a project's "Files", and "Attachments"); never boards. */
const ATTACHMENT_DIR = /^(files|attachments)$/i;

/** A page-supplied path to an attached file: only directly inside a Files or Attachments folder. */
function resolveAttachment(folder, relative) {
  const parts = String(relative).split('/');
  const bad = parts.length < 2 || parts.some((p) => !p || p.startsWith('.') || /[\\:]/.test(p)) || !ATTACHMENT_DIR.test(parts.at(-2));
  if (bad) throw new Error(`Bad attachment path ${relative}`);
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

/**
 * Every board file and folder in the storage folder with when it last changed, so the page
 * notices changes made outside Pinpad. Bounded, in case the folder is a big synced one.
 */
async function listFolder(folder) {
  const out = [];
  const walk = async (dir, rel, depth) => {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (out.length >= 5000) return;
      if (entry.name.startsWith('.') || /[\\:]/.test(entry.name)) continue;
      // Files attached to cards, not boards; the page reads them one at a time.
      if (entry.isDirectory() && ATTACHMENT_DIR.test(entry.name)) continue;
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        out.push({ path: relPath, modified: 0, dir: true });
        if (depth < 8) await walk(full, relPath, depth + 1);
      } else if (entry.isFile() && entry.name.endsWith('.json')) {
        const stat = await fs.stat(full).catch(() => null);
        if (stat) out.push({ path: relPath, modified: stat.mtimeMs });
      }
    }
  };
  await walk(folder, '', 0);
  return out;
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
    case 'list':
      return listFolder(folder);
    case 'writeFile': {
      // An attached file (PDF, video…), sent as base64, kept beside the boards.
      const file = resolveAttachment(folder, arg.path);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(`${file}.tmp`, Buffer.from(String(arg.data), 'base64'));
      await fs.rename(`${file}.tmp`, file);
      return true;
    }
    case 'readFile': {
      const file = resolveAttachment(folder, arg);
      return (await exists(file)) ? (await fs.readFile(file)).toString('base64') : null;
    }
    case 'moveFile': {
      // An attached file follows its card or project to another folder.
      const from = resolveAttachment(folder, arg.from);
      const to = resolveAttachment(folder, arg.to);
      if (!(await exists(from))) return false;
      await fs.mkdir(path.dirname(to), { recursive: true });
      await fs.rename(from, to);
      await pruneEmpty(folder, from);
      return true;
    }
    case 'trashFile': {
      const file = resolveAttachment(folder, arg);
      if (await exists(file)) {
        await shell.trashItem(file);
        await pruneEmpty(folder, file);
      }
      return true;
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

/**
 * Sign-in for saving boards to Google Drive or OneDrive, using the providers' flow for
 * installed apps: the system browser opens the consent page, which redirects back to a
 * one-off loopback address with a code (PKCE). The refresh token is kept encrypted in the
 * app's data folder so later launches get access tokens without asking again. Mirrors
 * OAuthBridge in macos/main.swift.
 */
const PROVIDERS = {
  google: {
    place: 'Google Drive',
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scope: 'https://www.googleapis.com/auth/drive.file',
    authParams: { access_type: 'offline', prompt: 'consent' },
    scopeOnExchange: false,
    revokeUrl: 'https://oauth2.googleapis.com/revoke?token=',
    // Microsoft only accepts "localhost" for installed apps' loopback addresses.
    loopbackHost: '127.0.0.1',
    emailUrl: 'https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)',
    email: (json) => json.user?.emailAddress ?? null,
    tokenFile: 'google-token',
  },
  microsoft: {
    place: 'OneDrive',
    authUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    scope: 'offline_access User.Read Files.ReadWrite.AppFolder',
    authParams: { prompt: 'select_account', response_mode: 'query' },
    scopeOnExchange: true,
    revokeUrl: null,
    loopbackHost: 'localhost',
    emailUrl: 'https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName',
    email: (json) => (json.mail || json.userPrincipalName || '').toLowerCase() || null,
    tokenFile: 'microsoft-token',
  },
};
/** One encrypted file per account; google-token.bin is the older single Google sign-in. */
const tokenPath = (provider, account) =>
  path.join(
    app.getPath('userData'),
    account ? `${provider.tokenFile}-${crypto.createHash('sha256').update(account).digest('hex').slice(0, 16)}.bin` : `${provider.tokenFile}.bin`,
  );
const base64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
let pendingSignIn = null;

async function saveRefreshToken(provider, token, account) {
  const data = safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(token) : Buffer.from(token);
  await fs.writeFile(tokenPath(provider, account), data);
}

async function loadRefreshToken(provider, account) {
  try {
    const data = await fs.readFile(tokenPath(provider, account));
    return safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(data) : data.toString();
  } catch {
    return null;
  }
}

async function tokenRequest(provider, params) {
  const body = Object.fromEntries(Object.entries(params).filter(([, v]) => v));
  if (provider.scopeOnExchange) body.scope = provider.scope;
  const res = await fetch(provider.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(json.error_description || json.error || `Sign-in failed (${res.status})`), { code: json.error });
  return json;
}

const signInPage = (message) =>
  `<!doctype html><meta charset="utf-8"><title>Pinpad</title><body style="font:16px system-ui;display:grid;place-items:center;height:90vh;color:#050038">${message}</body>`;

async function oauthSignIn(provider, { clientId, clientSecret }) {
  pendingSignIn?.(new Error('Sign-in was restarted'));
  const verifier = base64url(crypto.randomBytes(32));
  const challenge = base64url(crypto.createHash('sha256').update(verifier).digest());
  const state = base64url(crypto.randomBytes(16));
  const server = http.createServer();
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  const redirectUri = `http://${provider.loopbackHost}:${server.address().port}`;
  try {
    const code = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Sign-in timed out')), 5 * 60 * 1000);
      pendingSignIn = (err) => { clearTimeout(timer); reject(err); };
      server.on('request', (req, res) => {
        const url = new URL(req.url, redirectUri);
        if (url.pathname !== '/') return res.writeHead(404).end();
        const ok = url.searchParams.get('state') === state && url.searchParams.get('code');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
          .end(signInPage(ok ? `Signed in to ${provider.place}. You can close this tab and go back to Pinpad.` : 'Sign-in was cancelled. You can close this tab.'));
        clearTimeout(timer);
        if (ok) resolve(url.searchParams.get('code'));
        else reject(new Error(url.searchParams.get('error') === 'access_denied' ? 'Sign-in was cancelled' : 'Sign-in failed'));
      });
      const auth = new URL(provider.authUrl);
      for (const [k, v] of Object.entries({
        client_id: clientId, redirect_uri: redirectUri, response_type: 'code', scope: provider.scope, state,
        code_challenge: challenge, code_challenge_method: 'S256', ...provider.authParams,
      })) auth.searchParams.set(k, v);
      shell.openExternal(auth.toString());
    });
    const tokens = await tokenRequest(provider, {
      grant_type: 'authorization_code', code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, code_verifier: verifier,
    });
    // Which account signed in decides where its sign-in is kept.
    const about = await fetch(provider.emailUrl, { headers: { Authorization: `Bearer ${tokens.access_token}` } })
      .then((r) => r.json()).catch(() => ({}));
    const account = provider.email(about);
    if (tokens.refresh_token) await saveRefreshToken(provider, tokens.refresh_token, account);
    BrowserWindow.getAllWindows()[0]?.focus();
    return { accessToken: tokens.access_token, expiresIn: tokens.expires_in, account };
  } finally {
    pendingSignIn = null;
    server.close();
  }
}

async function oauth(name, op, arg) {
  const provider = PROVIDERS[name];
  switch (op) {
    case 'signIn':
      return oauthSignIn(provider, arg);
    case 'token': {
      const account = arg.account ?? null;
      let refresh = await loadRefreshToken(provider, account);
      // A sign-in saved before accounts were kept apart moves to the first account that asks.
      if (!refresh && account) {
        refresh = await loadRefreshToken(provider, null);
        if (refresh) {
          await saveRefreshToken(provider, refresh, account);
          await fs.rm(tokenPath(provider, null), { force: true });
        }
      }
      if (!refresh) return null;
      try {
        const tokens = await tokenRequest(provider, { grant_type: 'refresh_token', refresh_token: refresh, client_id: arg.clientId, client_secret: arg.clientSecret });
        // Microsoft replaces the refresh token each time; the old one stops working.
        if (tokens.refresh_token) await saveRefreshToken(provider, tokens.refresh_token, account);
        return { accessToken: tokens.access_token, expiresIn: tokens.expires_in };
      } catch (err) {
        // A revoked or expired grant means signing in again; anything else (offline) is retried later.
        if (err.code === 'invalid_grant') {
          await fs.rm(tokenPath(provider, account), { force: true });
          return null;
        }
        throw err;
      }
    }
    case 'signOut': {
      const account = arg?.account ?? null;
      const refresh = (await loadRefreshToken(provider, account)) ?? (await loadRefreshToken(provider, null));
      await fs.rm(tokenPath(provider, account), { force: true });
      await fs.rm(tokenPath(provider, null), { force: true });
      if (refresh && provider.revokeUrl) await fetch(`${provider.revokeUrl}${encodeURIComponent(refresh)}`, { method: 'POST' }).catch(() => {});
      return true;
    }
    default:
      throw new Error(`Unknown sign-in request ${op}`);
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
      // Chromium's PDF viewer, for previews of attached PDFs.
      plugins: true,
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

  // Let the page save what's pending, then warn if something still isn't saved (it couldn't
  // reach Google Drive or the storage folder, or saving is taking too long).
  let checking = false;
  win.on('close', (event) => {
    event.preventDefault();
    if (checking) return;
    checking = true;
    const reason = win.webContents.executeJavaScript('window.__unsavedReason ? window.__unsavedReason() : null').catch(() => null);
    const slow = new Promise((resolve) => setTimeout(() => resolve('Pinpad is still saving your latest changes.'), 6000));
    Promise.race([reason, slow]).then(async (unsaved) => {
      if (unsaved) {
        const { response } = await dialog.showMessageBox(win, {
          type: 'warning',
          message: "Some changes aren't saved yet",
          detail: `${unsaved}\n\nIf you close Pinpad now, they may be lost.`,
          buttons: ['Keep Pinpad Open', 'Close Anyway'],
          defaultId: 0,
          cancelId: 0,
        });
        if (response !== 1) {
          checking = false;
          return;
        }
      }
      win.destroy();
    });
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
  ipcMain.handle('pinpad:google', (_event, op, arg) => oauth('google', op, arg));
  ipcMain.handle('pinpad:microsoft', (_event, op, arg) => oauth('microsoft', op, arg));
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
