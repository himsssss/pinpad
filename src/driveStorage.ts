/**
 * The workspace kept in Google Drive, in the same layout as a storage folder on disk
 * (workspaceFiles.ts) under "My Drive/Pinpad". It offers the same read/write calls as the
 * desktop apps' folder storage, so the store treats both alike.
 *
 * Pinpad asks only for the drive.file scope, so it sees just the files and folders it
 * created itself; deleted boards go to the Drive trash, which keeps them for 30 days.
 */

import { accessToken, dropToken } from './googleAuth';
import type { StorageBatch } from './native';
import { INDEX_FILE, isAttachmentPath, type Listed } from './workspaceFiles';
import { load as loadLocal, save as saveLocal } from './persist';

const API = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const FOLDER = 'application/vnd.google-apps.folder';
/** Marks the top-level Pinpad folder so it's found again even if renamed or moved. */
const ROOT_QUERY = "appProperties has { key='pinpad' and value='root' } and trashed=false";

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  parents?: string[];
  modifiedTime?: string;
}

async function drive(url: string, init: RequestInit = {}, retried = false): Promise<Response> {
  const res = await fetch(url, {
    ...init,
    headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${await accessToken()}` },
  });
  if (res.status === 401 && !retried) {
    dropToken();
    return drive(url, init, true);
  }
  if (!res.ok) {
    let message = res.statusText;
    try {
      message = (await res.json()).error?.message ?? message;
    } catch {
      // Not JSON; keep the status text.
    }
    throw new Error(`Google Drive: ${message || res.status}`);
  }
  return res;
}

const json = (body: unknown) => ({ headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const dirname = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');
const basename = (path: string) => path.slice(path.lastIndexOf('/') + 1);

async function listAll(query: string) {
  const files: DriveFile[] = [];
  let page = '';
  do {
    const url = `${API}?q=${encodeURIComponent(query)}&spaces=drive&pageSize=1000&fields=nextPageToken,files(id,name,mimeType,parents,modifiedTime)${page ? `&pageToken=${page}` : ''}`;
    const body = await (await drive(url)).json();
    files.push(...body.files);
    page = body.nextPageToken ?? '';
  } while (page);
  return files;
}

/**
 * This device's copy of each board file, by Drive file id, with the change time it had. A
 * file Drive lists with the same time is read from here instead of downloaded again, so
 * opening Pinpad only downloads the boards that changed elsewhere.
 */
const cacheKey = (id: string) => `drive-file:${id}`;
type Cached = { modified: string; text: string };

function remember(id: string, modified: string | undefined, text: string) {
  if (!modified) return;
  changed.set(id, modified);
  saveLocal(cacheKey(id), { modified, text } satisfies Cached).catch(() => {});
}

async function create(meta: Record<string, unknown>, text?: string): Promise<string> {
  if (text === undefined) return (await (await drive(`${API}?fields=id`, { method: 'POST', ...json(meta) })).json()).id;
  const boundary = `pinpad-${crypto.randomUUID()}`;
  const body =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n` +
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${text}\r\n--${boundary}--`;
  const res = await drive(`${UPLOAD}?uploadType=multipart&fields=id,modifiedTime`, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  });
  const file: DriveFile = await res.json();
  remember(file.id, file.modifiedTime, text);
  return file.id;
}

let rootId: string | null = null;
/** The Pinpad folder's name in Drive ("Pinpad" unless renamed there). */
let rootName: string | null = null;
/** Relative path (of files and folders, / separated) to Drive file id. */
let ids = new Map<string, string>();
/** The files and folders found by the last listing. */
let listing: Listed[] = [];
/** Drive file id to its last change time, as listed (or as returned by a save). */
let changed = new Map<string, string>();
let loading: Promise<void> | null = null;
/** When the last listing finished: one made a moment ago (say, to check for a workspace) is reused. */
let loadedAt = 0;

/** Counts resets, so a listing still under way for an account switched away from is dropped. */
let generation = 0;

/** Finds (or creates) the Pinpad folder and maps every file in it by path. */
async function load() {
  const mine = generation;
  const root = (await listAll(ROOT_QUERY))[0];
  const folderId = root?.id ?? (await create({ name: 'Pinpad', mimeType: FOLDER, appProperties: { pinpad: 'root' } }));
  const files = await listAll('trashed=false');
  if (mine !== generation) return;
  rootId = folderId;
  rootName = root?.name ?? 'Pinpad';
  const byId = new Map(files.map((f) => [f.id, f]));
  const pathOf = (f: DriveFile, depth = 0): string | null => {
    const parent = f.parents?.[0];
    if (!parent || depth > 32) return null;
    if (parent === rootId) return f.name;
    const up = byId.get(parent);
    const upPath = up ? pathOf(up, depth + 1) : null;
    return upPath === null ? null : `${upPath}/${f.name}`;
  };
  ids = new Map();
  listing = [];
  changed = new Map(files.filter((f) => f.modifiedTime).map((f) => [f.id, f.modifiedTime!]));
  for (const f of files) {
    const path = f.id === rootId ? null : pathOf(f);
    if (path === null || ids.has(path)) continue;
    ids.set(path, f.id);
    const dir = f.mimeType === FOLDER;
    // A board file renamed in Drive may have lost its .json ending; it's still JSON.
    // Files attached to cards aren't boards: they're looked up one at a time, never listed.
    if (isAttachmentPath(path)) continue;
    if (dir || f.name.endsWith('.json') || f.mimeType === 'application/json') {
      listing.push({ path, modified: dir ? 0 : Date.parse(f.modifiedTime ?? '') || 0, dir });
    }
  }
}

function ready() {
  const mine = generation;
  loading ??= load().then(() => void (mine === generation && (loadedAt = Date.now()))).catch((err) => {
    if (mine === generation) loading = null;
    throw err;
  });
  return loading;
}

/**
 * Looks a path up ignoring case: the store treats "Plan.json" and "plan.json" as one file
 * (as macOS and Windows do), but Drive names are case-sensitive, so a case-only rename has to
 * rename the Drive file rather than add a second one.
 */
function lookup(path: string): [string, string] | undefined {
  const exact = ids.get(path);
  if (exact) return [path, exact];
  const lower = path.toLowerCase();
  for (const entry of ids) if (entry[0].toLowerCase() === lower) return entry;
  return undefined;
}

function remap(from: string, to: string) {
  for (const [key, id] of [...ids]) {
    if (key === from || key.startsWith(`${from}/`)) {
      ids.delete(key);
      ids.set(to + key.slice(from.length), id);
    }
  }
}

async function ensureFolder(dir: string): Promise<string> {
  if (!dir) return rootId!;
  const hit = lookup(dir);
  if (hit) {
    if (hit[0] !== dir) {
      await drive(`${API}/${hit[1]}`, { method: 'PATCH', ...json({ name: basename(dir) }) });
      remap(hit[0], dir);
    }
    return hit[1];
  }
  const parent = await ensureFolder(dirname(dir));
  const id = await create({ name: basename(dir), mimeType: FOLDER, parents: [parent] });
  ids.set(dir, id);
  return id;
}

async function writeFile(path: string, text: string) {
  const parent = await ensureFolder(dirname(path));
  const hit = lookup(path);
  if (!hit) {
    ids.set(path, await create({ name: basename(path), parents: [parent], mimeType: 'application/json' }, text));
    return;
  }
  if (hit[0] !== path) {
    await drive(`${API}/${hit[1]}`, { method: 'PATCH', ...json({ name: basename(path) }) });
    remap(hit[0], path);
  }
  const res = await drive(`${UPLOAD}/${hit[1]}?uploadType=media&fields=modifiedTime`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json; charset=UTF-8' },
    body: text,
  });
  remember(hit[1], ((await res.json()) as DriveFile).modifiedTime, text);
}

/**
 * Looks for a file (or folder) Drive didn't list last time: one uploaded from another computer
 * since, say. Remembered once found.
 */
async function find(path: string): Promise<string | undefined> {
  const hit = lookup(path);
  if (hit) return hit[1];
  const parent = dirname(path) ? await find(dirname(path)) : rootId;
  if (!parent) return undefined;
  const name = basename(path).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const [file] = await listAll(`name='${name}' and '${parent}' in parents and trashed=false`);
  if (file) ids.set(path, file.id);
  return file?.id;
}

async function trash(path: string) {
  const id = ids.get(path);
  if (id) await drive(`${API}/${id}`, { method: 'PATCH', ...json({ trashed: true }) });
  ids.delete(path);
  await pruneFolders(dirname(path));
}

/** Folders Pinpad made that now hold nothing of its own go to the trash as well. */
async function pruneFolders(from: string) {
  for (let dir = from; dir; dir = dirname(dir)) {
    if ([...ids.keys()].some((key) => key.startsWith(`${dir}/`))) return;
    const folder = ids.get(dir);
    if (folder) await drive(`${API}/${folder}`, { method: 'PATCH', ...json({ trashed: true }) });
    ids.delete(dir);
  }
}

export const driveStorage = {
  async read(paths: string[]): Promise<Record<string, string | null>> {
    await ready();
    const out: Record<string, string | null> = {};
    // A dozen downloads at a time keeps large workspaces quick without tripping rate limits.
    for (let i = 0; i < paths.length; i += 12) {
      await Promise.all(
        paths.slice(i, i + 12).map(async (path) => {
          const id = ids.get(path);
          if (!id) return void (out[path] = null);
          const modified = changed.get(id);
          const cached = modified ? await loadLocal<Cached>(cacheKey(id)).catch(() => undefined) : undefined;
          if (cached && cached.modified === modified) return void (out[path] = cached.text);
          out[path] = await (await drive(`${API}/${id}?alt=media`)).text();
          remember(id, modified, out[path]!);
        }),
      );
    }
    return out;
  },

  /** Writes the batch file by file, reporting how many are done. */
  async write(batch: StorageBatch, onProgress?: (done: number) => void) {
    await ready();
    let done = 0;
    for (const [path, text] of batch.write) {
      await writeFile(path, text);
      onProgress?.(++done);
    }
    for (const path of [...batch.remove, ...batch.trash]) {
      await trash(path);
      onProgress?.(++done);
    }
    return true;
  },

  /**
   * Saves an attached file (PDF, video…) at Attachments/<name>, with a resumable upload so
   * large files go through.
   */
  async writeAttachment(path: string, blob: Blob) {
    await ready();
    if (lookup(path)) return;
    const parent = await ensureFolder(dirname(path));
    const type = blob.type || 'application/octet-stream';
    const start = await drive(`${UPLOAD}?uploadType=resumable&fields=id`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': type },
      body: JSON.stringify({ name: basename(path), parents: [parent], mimeType: type }),
    });
    const session = start.headers.get('Location');
    if (!session) throw new Error("Google Drive didn't accept the upload");
    const done = await drive(session, { method: 'PUT', headers: { 'Content-Type': type }, body: blob });
    ids.set(path, (await done.json()).id);
  },

  /** Moves an attached file, renaming it and changing its folder; false when it isn't there. */
  async moveFile(from: string, to: string) {
    await ready();
    const hit = lookup(from);
    if (!hit) return false;
    const oldParent = dirname(hit[0]) ? lookup(dirname(hit[0]))?.[1] : rootId;
    const parent = await ensureFolder(dirname(to));
    const reparent = oldParent && oldParent !== parent ? `&addParents=${parent}&removeParents=${oldParent}` : '';
    await drive(`${API}/${hit[1]}?fields=id${reparent}`, { method: 'PATCH', ...json({ name: basename(to) }) });
    ids.delete(hit[0]);
    ids.set(to, hit[1]);
    await pruneFolders(dirname(hit[0]));
    return true;
  },

  async trashFile(path: string) {
    await ready();
    const hit = lookup(path);
    if (hit) await trash(hit[0]);
  },

  /** An attached file, or null when it isn't in Drive. */
  async readAttachment(path: string): Promise<Blob | null> {
    await ready();
    const id = lookup(path)?.[1] ?? (await find(path));
    return id ? (await drive(`${API}/${id}?alt=media`)).blob() : null;
  },

  /** Lists Drive afresh, so files renamed, moved or deleted there since are seen. */
  async list(): Promise<Listed[]> {
    // A listing under way or just made is used as it is.
    if (!loading || (loadedAt && Date.now() - loadedAt > 5000)) driveStorage.reset();
    await ready();
    return listing;
  },

  async hasWorkspace() {
    await ready();
    return ids.has(INDEX_FILE);
  },

  /** The Pinpad folder in Google Drive's web app, once it's been found. */
  folderUrl() {
    return rootId ? `https://drive.google.com/drive/folders/${rootId}` : null;
  },

  /** The Pinpad folder's current name in Drive, once it's been found. */
  folderName() {
    return rootName;
  },

  /** Forgets what's cached, so the next call lists Drive again (after switching accounts). */
  reset() {
    generation++;
    rootId = null;
    rootName = null;
    ids = new Map();
    loading = null;
    loadedAt = 0;
  },
};
