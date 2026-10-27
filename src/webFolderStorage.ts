/**
 * A folder on this computer as the website's storage, through the browser's folder access
 * (Chrome and Edge): the user picks a folder and Pinpad keeps its board files and attached
 * files there, in the same layout as the desktop apps (workspaceFiles.ts), so the folder can
 * also be opened by the Mac and Windows apps or synced by iCloud Drive, OneDrive or Dropbox.
 *
 * The browser remembers the folder (its handle is kept in IndexedDB) but may ask again for
 * permission after a restart; until it's given, saving waits (FolderAccessNeeded). Files of
 * deleted boards go to a hidden ".pinpad-deleted" folder for 30 days, since a website can't
 * use the system Trash.
 */

import { load, save } from './persist';
import { SignInNeeded } from './googleAuth';
import type { StorageBatch } from './native';
import { INDEX_FILE, isAttachmentPath, type Listed } from './workspaceFiles';

type Dir = FileSystemDirectoryHandle;
type Permission = 'granted' | 'denied' | 'prompt';
interface PermissionHandle {
  queryPermission(options: { mode: 'readwrite' }): Promise<Permission>;
  requestPermission(options: { mode: 'readwrite' }): Promise<Permission>;
}
interface Saved { id: string; name: string; handle: Dir }

const LIST_KEY = 'web-folders';
const CURRENT_KEY = 'pinpad:web-folder';
const DELETED = '.pinpad-deleted';
const KEEP_DELETED_DAYS = 30;

export class FolderAccessNeeded extends SignInNeeded {
  constructor(name: string) {
    super();
    this.message = `Allow Pinpad to use the “${name}” folder again to keep saving there.`;
  }
}

/**
 * Whether this browser can keep boards in a folder (Chrome and Edge). Where it can, the
 * website offers a folder instead of "This browser"; Safari and Firefox keep "This browser".
 */
export const webFoldersSupported = () =>
  !window.pinpadNative &&
  typeof (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function';

/** The folder in use, kept by id and name so its name is known without waiting. */
export function currentWebFolder(): { id: string; name: string } | null {
  try {
    return JSON.parse(localStorage.getItem(CURRENT_KEY) ?? 'null');
  } catch {
    return null;
  }
}

export function setCurrentWebFolder(folder: { id: string; name: string } | null) {
  try {
    if (folder) localStorage.setItem(CURRENT_KEY, JSON.stringify({ id: folder.id, name: folder.name }));
    else localStorage.removeItem(CURRENT_KEY);
  } catch {
    // Without storage the choice lasts for this session only.
  }
  handle = null;
}

/** Every folder picked on this browser. */
export async function webFolders(): Promise<Saved[]> {
  return (await load<Saved[]>(LIST_KEY).catch(() => undefined)) ?? [];
}

async function find(id: string) {
  return (await webFolders()).find((f) => f.id === id) ?? null;
}

/** Shows the browser's folder picker and remembers the folder; null when cancelled. */
export async function chooseWebFolder(): Promise<{ id: string; name: string } | null> {
  let dir: Dir;
  try {
    dir = await (window as unknown as { showDirectoryPicker(o: object): Promise<Dir> }).showDirectoryPicker({ id: 'pinpad', mode: 'readwrite' });
  } catch (err) {
    if ((err as DOMException).name === 'AbortError') return null;
    throw err;
  }
  const list = await webFolders();
  for (const f of list) if (await f.handle.isSameEntry(dir)) return { id: f.id, name: f.name };
  const folder = { id: crypto.randomUUID(), name: dir.name, handle: dir };
  await save(LIST_KEY, [...list, folder]);
  return { id: folder.id, name: folder.name };
}

export async function forgetWebFolder(id: string) {
  await save(LIST_KEY, (await webFolders()).filter((f) => f.id !== id));
}

/**
 * Whether Pinpad may use a folder now. With `ask` (only from a click) the browser asks the
 * user if needed.
 */
export async function allowWebFolder(id: string, ask: boolean) {
  const folder = await find(id);
  if (!folder) return false;
  const h = folder.handle as Dir & PermissionHandle;
  if ((await h.queryPermission({ mode: 'readwrite' })) === 'granted') return true;
  return ask && (await h.requestPermission({ mode: 'readwrite' })) === 'granted';
}

/** Whether a folder already holds a Pinpad workspace (asks for permission, so from a click). */
export async function webFolderHasWorkspace(id: string) {
  const folder = await find(id);
  if (!folder || !(await allowWebFolder(id, true))) throw new Error('Pinpad needs permission to use that folder');
  return !!(await fileAt(folder.handle, INDEX_FILE, false).catch(() => null));
}

let handle: Dir | null = null;

/** The folder in use, once the user has allowed it. */
async function root(): Promise<Dir> {
  if (handle) return handle;
  const current = currentWebFolder();
  const folder = current && (await find(current.id));
  if (!current || !folder) throw new Error('The folder Pinpad saved to has been removed from this browser');
  if (!(await allowWebFolder(current.id, false))) throw new FolderAccessNeeded(folder.name);
  handle = folder.handle;
  return handle;
}

const parts = (path: string) => path.split('/').filter(Boolean);

async function dirAt(base: Dir, names: string[], create: boolean) {
  let dir = base;
  for (const name of names) dir = await dir.getDirectoryHandle(name, { create });
  return dir;
}

async function fileAt(base: Dir, path: string, create: boolean) {
  const names = parts(path);
  const dir = await dirAt(base, names.slice(0, -1), create);
  return dir.getFileHandle(names[names.length - 1], { create });
}

const missing = (err: unknown) => (err as DOMException)?.name === 'NotFoundError' || (err as DOMException)?.name === 'TypeMismatchError';

async function readBlob(base: Dir, path: string): Promise<File | null> {
  try {
    return await (await fileAt(base, path, false)).getFile();
  } catch (err) {
    if (missing(err)) return null;
    throw err;
  }
}

/** Written in full, then swapped in by the browser, so a crash never leaves half a file. */
async function writeBlob(base: Dir, path: string, data: Blob | string) {
  const writable = await (await fileAt(base, path, true)).createWritable();
  await writable.write(data);
  await writable.close();
}

type Entries = AsyncIterable<[string, FileSystemHandle]>;
const entries = (dir: Dir) => (dir as unknown as { entries(): Entries }).entries();

/** Removes folders left empty by a moved or deleted file, up to the storage folder. */
async function pruneEmpty(base: Dir, path: string) {
  const names = parts(path).slice(0, -1);
  while (names.length) {
    const dir = await dirAt(base, names, false).catch(() => null);
    if (!dir) return;
    for await (const [name] of entries(dir)) if (name !== '.DS_Store') return;
    const parent = await dirAt(base, names.slice(0, -1), false);
    await parent.removeEntry(names[names.length - 1], { recursive: true });
    names.pop();
  }
}

/** Keeps a deleted file in the hidden deleted-files folder, then removes it; old ones are cleared. */
async function putAside(base: Dir, path: string) {
  const file = await readBlob(base, path);
  if (!file) return;
  const day = new Date().toISOString().slice(0, 10);
  await writeBlob(base, `${DELETED}/${day}/${path}`, file);
  const names = parts(path);
  await (await dirAt(base, names.slice(0, -1), false)).removeEntry(names[names.length - 1]);
  await pruneEmpty(base, path);
  const deleted = await dirAt(base, [DELETED], false);
  const cutoff = new Date(Date.now() - KEEP_DELETED_DAYS * 86_400_000).toISOString().slice(0, 10);
  for await (const [name] of entries(deleted)) if (name < cutoff) await deleted.removeEntry(name, { recursive: true });
}

export const webFolderStorage = {
  async read(paths: string[]): Promise<Record<string, string | null>> {
    const base = await root();
    const out: Record<string, string | null> = {};
    for (const path of paths) out[path] = (await (await readBlob(base, path))?.text()) ?? null;
    return out;
  },

  async write(batch: StorageBatch, onProgress?: (done: number) => void) {
    const base = await root();
    let done = 0;
    for (const [path, text] of batch.write) {
      await writeBlob(base, path, text);
      onProgress?.(++done);
    }
    for (const path of batch.remove) {
      const names = parts(path);
      await (await dirAt(base, names.slice(0, -1), false).catch(() => null))?.removeEntry(names[names.length - 1]).catch(() => {});
      await pruneEmpty(base, path);
      onProgress?.(++done);
    }
    for (const path of batch.trash) {
      await putAside(base, path);
      onProgress?.(++done);
    }
    return true;
  },

  /** Every board file and folder, to notice changes made outside Pinpad. Bounded, like the apps'. */
  async list(): Promise<Listed[]> {
    const base = await root();
    const out: Listed[] = [];
    const walk = async (dir: Dir, rel: string, depth: number) => {
      for await (const [name, entry] of entries(dir)) {
        if (out.length >= 5000) return;
        if (name.startsWith('.')) continue;
        const path = rel ? `${rel}/${name}` : name;
        if (entry.kind === 'directory') {
          // Files attached to cards, not boards; they're read one at a time.
          if (isAttachmentPath(name)) continue;
          out.push({ path, modified: 0, dir: true });
          if (depth < 8) await walk(entry as Dir, path, depth + 1);
        } else if (name.endsWith('.json')) {
          out.push({ path, modified: (await (entry as FileSystemFileHandle).getFile()).lastModified });
        }
      }
    };
    await walk(base, '', 0);
    return out;
  },

  async writeAttachment(path: string, blob: Blob) {
    await writeBlob(await root(), path, blob);
  },

  async readAttachment(path: string): Promise<Blob | null> {
    return readBlob(await root(), path);
  },

  /** Moves an attached file; false when there's nothing at `from`. */
  async moveFile(from: string, to: string) {
    const base = await root();
    const file = await readBlob(base, from);
    if (!file) return false;
    await writeBlob(base, to, file);
    if (from.toLowerCase() !== to.toLowerCase()) {
      const names = parts(from);
      await (await dirAt(base, names.slice(0, -1), false)).removeEntry(names[names.length - 1]);
      await pruneEmpty(base, from);
    }
    return true;
  },

  async trashFile(path: string) {
    await putAside(await root(), path);
  },

  async hasWorkspace() {
    return !!(await readBlob(await root(), INDEX_FILE));
  },

  folderName() {
    return currentWebFolder()?.name ?? null;
  },

  reset() {
    handle = null;
  },
};
