/**
 * The workspace kept in OneDrive, in Pinpad's own app folder ("Apps/Pinpad"), in the same
 * layout as a storage folder on disk (workspaceFiles.ts). It offers the same calls as
 * driveStorage, so the store treats both alike. Deleted boards go to OneDrive's recycle bin.
 *
 * OneDrive treats names case-insensitively, like macOS and Windows. Board files and attached
 * files are uploaded by path (folders are made as needed); large ones go up in pieces.
 */

import { dropMicrosoftToken, microsoftToken } from './microsoftAuth';
import type { StorageBatch } from './native';
import { INDEX_FILE, isAttachmentPath, type Listed } from './workspaceFiles';
import { load as loadLocal, save as saveLocal } from './persist';

const GRAPH = 'https://graph.microsoft.com/v1.0/me/drive';
const FIELDS = 'id,name,folder,file,cTag,lastModifiedDateTime,parentReference';
/** Files up to this size go up in one request; bigger ones use an upload session. */
const SIMPLE_LIMIT = 4 * 1024 * 1024;
/** Upload session pieces must be a multiple of 320 KB. */
const CHUNK = 320 * 1024 * 32;

interface Item {
  id: string;
  name: string;
  folder?: unknown;
  file?: unknown;
  cTag?: string;
  lastModifiedDateTime?: string;
  webUrl?: string;
}

async function graph(url: string, init: RequestInit = {}, retried = false): Promise<Response> {
  const res = await fetch(url.startsWith('https://') ? url : `${GRAPH}${url}`, {
    ...init,
    headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${await microsoftToken()}` },
  });
  if (res.status === 401 && !retried) {
    dropMicrosoftToken();
    return graph(url, init, true);
  }
  if (!res.ok && res.status !== 404) {
    let message = res.statusText;
    try {
      message = (await res.json()).error?.message ?? message;
    } catch {
      // Not JSON; keep the status text.
    }
    throw new Error(`OneDrive: ${message || res.status}`);
  }
  return res;
}

const dirname = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');
const encodePath = (path: string) => path.split('/').map(encodeURIComponent).join('/');
/** The app folder item at a path (relative to Apps/Pinpad). */
const byPath = (path: string) => `/special/approot:/${encodePath(path)}:`;

let root: Item | null = null;
/** Relative path (files and folders, / separated) to item id. */
let ids = new Map<string, string>();
/** Item id to what changes when its contents do, to know a cached copy is current. */
let versions = new Map<string, string>();
let listing: Listed[] = [];
let loading: Promise<void> | null = null;

/** Finds (or makes) the app folder and maps everything in it by path. */
async function load() {
  root = await (await graph('/special/approot?$select=id,name,webUrl')).json();
  ids = new Map();
  versions = new Map();
  listing = [];
  // Folder by folder, a few at a time.
  let level: [string, string][] = [['', root!.id]];
  for (let depth = 0; level.length && depth < 10; depth++) {
    const next: [string, string][] = [];
    for (let i = 0; i < level.length; i += 6) {
      await Promise.all(
        level.slice(i, i + 6).map(async ([dir, id]) => {
          let url: string | null = `/items/${id}/children?$select=${FIELDS}&$top=999`;
          while (url) {
            const page: { value: Item[]; '@odata.nextLink'?: string } = await (await graph(url)).json();
            for (const item of page.value) {
              const path = dir ? `${dir}/${item.name}` : item.name;
              ids.set(path, item.id);
              const version = item.cTag ?? item.lastModifiedDateTime;
              if (version) versions.set(item.id, version);
              const dirItem = !!item.folder;
              if (dirItem) next.push([path, item.id]);
              // Files attached to cards are mapped (to find and move them) but never listed as boards.
              if (isAttachmentPath(path)) continue;
              if (dirItem || item.name.endsWith('.json')) {
                listing.push({ path, modified: dirItem ? 0 : Date.parse(item.lastModifiedDateTime ?? '') || 0, dir: dirItem });
              }
            }
            url = page['@odata.nextLink'] ?? null;
          }
        }),
      );
    }
    level = next;
  }
}

function ready() {
  loading ??= load().catch((err) => {
    loading = null;
    throw err;
  });
  return loading;
}

/** Looks a path up ignoring case, as OneDrive does. */
function lookup(path: string): [string, string] | undefined {
  const exact = ids.get(path);
  if (exact) return [path, exact];
  const lower = path.toLowerCase();
  for (const entry of ids) if (entry[0].toLowerCase() === lower) return entry;
  return undefined;
}

/** This device's copy of each board file, by item id, like driveStorage's. */
const cacheKey = (id: string) => `onedrive-file:${id}`;
type Cached = { version: string; text: string };

function remember(item: Item, path: string, text?: string) {
  ids.set(path, item.id);
  const version = item.cTag ?? item.lastModifiedDateTime;
  if (!version) return;
  versions.set(item.id, version);
  if (text !== undefined) saveLocal(cacheKey(item.id), { version, text } satisfies Cached).catch(() => {});
}

/** Uploads a file by path, replacing what's there; big files go up in pieces. */
async function upload(path: string, body: Blob): Promise<Item> {
  if (body.size <= SIMPLE_LIMIT) {
    const res = await graph(`${byPath(path)}/content?@microsoft.graph.conflictBehavior=replace`, {
      method: 'PUT',
      headers: { 'Content-Type': body.type || 'application/octet-stream' },
      body,
    });
    return res.json();
  }
  const session = await (
    await graph(`${byPath(path)}/createUploadSession`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item: { '@microsoft.graph.conflictBehavior': 'replace' } }),
    })
  ).json();
  let last: Response | null = null;
  for (let start = 0; start < body.size; start += CHUNK) {
    const end = Math.min(start + CHUNK, body.size);
    // The upload address carries its own permission: no sign-in header.
    last = await fetch(session.uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Range': `bytes ${start}-${end - 1}/${body.size}` },
      body: body.slice(start, end),
    });
    if (!last.ok && last.status !== 202) throw new Error(`OneDrive: upload failed (${last.status})`);
  }
  return last!.json();
}

async function writeFile(path: string, text: string) {
  const hit = lookup(path);
  // A name that only changed case is renamed, since writing to it would keep the old name.
  if (hit && hit[0] !== path && hit[0].split('/').pop() !== path.split('/').pop()) {
    await graph(`/items/${hit[1]}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: path.split('/').pop() }) });
    ids.delete(hit[0]);
  }
  const item = await upload(path, new Blob([text], { type: 'application/json' }));
  remember(item, path, text);
}

/** A folder's id, making it (and the folders above it) when it isn't there. */
async function ensureFolder(dir: string): Promise<string> {
  if (!dir) return root!.id;
  const hit = lookup(dir);
  if (hit) return hit[1];
  // Uploading by path makes folders without telling their ids, so look before making one.
  const found = await graph(`${byPath(dir)}?$select=id`);
  if (found.status !== 404) {
    const id = ((await found.json()) as Item).id;
    ids.set(dir, id);
    return id;
  }
  const parent = await ensureFolder(dirname(dir));
  const made: Item = await (
    await graph(`/items/${parent}/children`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: dir.split('/').pop(), folder: {}, '@microsoft.graph.conflictBehavior': 'fail' }),
    })
  ).json();
  ids.set(dir, made.id);
  return made.id;
}

async function trash(path: string) {
  const id = ids.get(path);
  if (id) await graph(`/items/${id}`, { method: 'DELETE' });
  ids.delete(path);
  await pruneFolders(dirname(path));
}

/** Folders that now hold nothing of Pinpad's go to the recycle bin as well. */
async function pruneFolders(from: string) {
  for (let dir = from; dir; dir = dirname(dir)) {
    if ([...ids.keys()].some((key) => key.startsWith(`${dir}/`))) return;
    const folder = ids.get(dir);
    if (folder) await graph(`/items/${folder}`, { method: 'DELETE' });
    ids.delete(dir);
  }
}

export const oneDriveStorage = {
  async read(paths: string[]): Promise<Record<string, string | null>> {
    await ready();
    const out: Record<string, string | null> = {};
    for (let i = 0; i < paths.length; i += 8) {
      await Promise.all(
        paths.slice(i, i + 8).map(async (path) => {
          const id = lookup(path)?.[1];
          if (!id) return void (out[path] = null);
          const version = versions.get(id);
          const cached = version ? await loadLocal<Cached>(cacheKey(id)).catch(() => undefined) : undefined;
          if (cached && cached.version === version) return void (out[path] = cached.text);
          const res = await graph(`/items/${id}/content`);
          out[path] = res.status === 404 ? null : await res.text();
          if (out[path] !== null && version) saveLocal(cacheKey(id), { version, text: out[path]! } satisfies Cached).catch(() => {});
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

  /** Saves an attached file at Attachments/<name>, unless it's there already. */
  async writeAttachment(path: string, blob: Blob) {
    await ready();
    if (lookup(path)) return;
    remember(await upload(path, blob), path);
  },

  /** Moves an attached file, renaming it and changing its folder; false when it isn't there. */
  async moveFile(from: string, to: string) {
    await ready();
    let hit = lookup(from);
    if (!hit) {
      const res = await graph(`${byPath(from)}?$select=id`);
      if (res.status === 404) return false;
      hit = [from, ((await res.json()) as Item).id];
    }
    const parent = await ensureFolder(dirname(to));
    await graph(`/items/${hit[1]}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: to.split('/').pop(), parentReference: { id: parent } }),
    });
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

  /** An attached file, or null when it isn't in OneDrive. */
  async readAttachment(path: string): Promise<Blob | null> {
    await ready();
    let id = lookup(path)?.[1];
    if (!id) {
      // Uploaded from another computer since the last listing.
      const res = await graph(`${byPath(path)}?$select=id`);
      if (res.status === 404) return null;
      id = ((await res.json()) as Item).id;
    }
    const res = await graph(`/items/${id}/content`);
    return res.status === 404 ? null : res.blob();
  },

  /** Lists OneDrive afresh, so files renamed, moved or deleted there since are seen. */
  async list(): Promise<Listed[]> {
    oneDriveStorage.reset();
    await ready();
    return listing;
  },

  async hasWorkspace() {
    await ready();
    return !!lookup(INDEX_FILE);
  },

  /** The app folder in OneDrive on the web, once it's been found. */
  folderUrl() {
    return root?.webUrl ?? null;
  },

  folderName() {
    return root?.name ?? null;
  },

  /** Forgets what's cached, so the next call lists OneDrive again (after switching accounts). */
  reset() {
    root = null;
    ids = new Map();
    loading = null;
  },
};
