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
import { INDEX_FILE, type Listed } from './workspaceFiles';

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

async function create(meta: Record<string, unknown>, text?: string): Promise<string> {
  if (text === undefined) return (await (await drive(`${API}?fields=id`, { method: 'POST', ...json(meta) })).json()).id;
  const boundary = `pinpad-${crypto.randomUUID()}`;
  const body =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n` +
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${text}\r\n--${boundary}--`;
  const res = await drive(`${UPLOAD}?uploadType=multipart&fields=id`, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  });
  return (await res.json()).id;
}

let rootId: string | null = null;
/** The Pinpad folder's name in Drive ("Pinpad" unless renamed there). */
let rootName: string | null = null;
/** Relative path (of files and folders, / separated) to Drive file id. */
let ids = new Map<string, string>();
/** The files and folders found by the last listing. */
let listing: Listed[] = [];
let loading: Promise<void> | null = null;

/** Finds (or creates) the Pinpad folder and maps every file in it by path. */
async function load() {
  const root = (await listAll(ROOT_QUERY))[0];
  rootId = root?.id ?? (await create({ name: 'Pinpad', mimeType: FOLDER, appProperties: { pinpad: 'root' } }));
  rootName = root?.name ?? 'Pinpad';
  const files = await listAll('trashed=false');
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
  for (const f of files) {
    const path = f.id === rootId ? null : pathOf(f);
    if (path === null || ids.has(path)) continue;
    ids.set(path, f.id);
    const dir = f.mimeType === FOLDER;
    // A board file renamed in Drive may have lost its .json ending; it's still JSON.
    // Files attached to cards aren't boards: they're looked up one at a time, never listed.
    if (path === 'Attachments' || path.startsWith('Attachments/')) continue;
    if (dir || f.name.endsWith('.json') || f.mimeType === 'application/json') {
      listing.push({ path, modified: dir ? 0 : Date.parse(f.modifiedTime ?? '') || 0, dir });
    }
  }
}

function ready() {
  loading ??= load().catch((err) => {
    loading = null;
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
  await drive(`${UPLOAD}/${hit[1]}?uploadType=media`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json; charset=UTF-8' },
    body: text,
  });
}

async function trash(path: string) {
  const id = ids.get(path);
  if (id) await drive(`${API}/${id}`, { method: 'PATCH', ...json({ trashed: true }) });
  ids.delete(path);
  // Folders Pinpad made that now hold nothing of its own go to the trash as well.
  for (let dir = dirname(path); dir; dir = dirname(dir)) {
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
    // A few downloads at a time keeps large workspaces quick without tripping rate limits.
    for (let i = 0; i < paths.length; i += 8) {
      await Promise.all(
        paths.slice(i, i + 8).map(async (path) => {
          const id = ids.get(path);
          out[path] = id ? await (await drive(`${API}/${id}?alt=media`)).text() : null;
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

  /** An attached file, or null when it isn't in Drive. */
  async readAttachment(path: string): Promise<Blob | null> {
    await ready();
    const hit = lookup(path);
    return hit ? (await drive(`${API}/${hit[1]}?alt=media`)).blob() : null;
  },

  /** Lists Drive afresh, so files renamed, moved or deleted there since are seen. */
  async list(): Promise<Listed[]> {
    driveStorage.reset();
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
    rootId = null;
    rootName = null;
    ids = new Map();
    loading = null;
  },
};
