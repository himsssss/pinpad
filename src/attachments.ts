/**
 * Files attached to boards (PDFs, videos, documents…). Each is kept as its own file under its
 * own name, in a "Files" folder in its project's folder (in Google Drive, OneDrive or the
 * storage folder; see layoutWorkspace), not inside a board, so editing a board never
 * re-uploads them. Saving moves a file along when its card or project moves (store.ts).
 * This device keeps a copy in IndexedDB; files not yet in the storage are listed as pending.
 */

import { load, save } from './persist';
import { nativeStorage } from './native';
import { driveStorage } from './driveStorage';
import { oneDriveStorage } from './oneDriveStorage';
import { attachmentLocation, retrySave, usingDrive, usingOneDrive } from './store';
import { uid } from './doc';
import { legacyAttachmentPath } from './workspaceFiles';

const PENDING_KEY = 'pinpad:attachments-pending';
const MAX_SIZE = 200 * 1024 * 1024;

const cacheKey = (ref: string) => `file:${ref}`;

function pending(): string[] {
  try {
    // Older versions kept { ref, name } entries.
    return (JSON.parse(localStorage.getItem(PENDING_KEY) ?? '[]') as (string | { ref: string })[]).map((p) => (typeof p === 'string' ? p : p.ref));
  } catch {
    return [];
  }
}

function setPending(list: string[]) {
  try {
    localStorage.setItem(PENDING_KEY, JSON.stringify([...new Set(list)]));
  } catch {
    // Not remembered; files still in this device's copy are uploaded with the next save.
  }
}

export const uploadsPending = () => pending().length > 0;

/** Files that reached the storage (or whose cards are gone) are no longer pending. */
export function settlePending(stored: (ref: string) => boolean) {
  const left = pending().filter((ref) => !stored(ref));
  if (left.length !== pending().length) setPending(left);
}

function toBase64(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function readFromStorage(path: string, type: string): Promise<Blob | null> {
  if (usingDrive()) return driveStorage.readAttachment(path);
  if (usingOneDrive()) return oneDriveStorage.readAttachment(path);
  const native = nativeStorage();
  const data = native ? await native.readFile(path) : null;
  return data == null ? null : (await fetch(`data:${type || 'application/octet-stream'};base64,${data}`)).blob();
}

/** Uploads this device's copy of a file to a path; false when this device doesn't have it. */
export async function storeAttachment(ref: string, path: string) {
  const blob = await load<Blob>(cacheKey(ref)).catch(() => undefined);
  if (!blob) return false;
  if (usingDrive()) await driveStorage.writeAttachment(path, blob);
  else if (usingOneDrive()) await oneDriveStorage.writeAttachment(path, blob);
  else await nativeStorage()?.writeFile({ path, data: await toBase64(blob) });
  return true;
}

/** Moves a file in the storage; false when there's nothing at `from`. */
export async function moveAttachment(from: string, to: string): Promise<boolean> {
  if (usingDrive()) return driveStorage.moveFile(from, to);
  if (usingOneDrive()) return oneDriveStorage.moveFile(from, to);
  return (await nativeStorage()?.moveFile({ from, to })) ?? false;
}

/**
 * Sends a file whose card is gone to the storage's trash, keeping a copy on this device
 * first so undoing the deletion can put it back.
 */
export async function trashAttachment(ref: string, path: string) {
  if (!(await load<Blob>(cacheKey(ref)).catch(() => undefined))) {
    const blob = await readFromStorage(path, '').catch(() => null);
    if (blob) await save(cacheKey(ref), blob).catch(() => {});
  }
  if (usingDrive()) await driveStorage.trashFile(path);
  else if (usingOneDrive()) await oneDriveStorage.trashFile(path);
  else await nativeStorage()?.trashFile(path);
}

/** Saves now, which uploads any files still waiting (after coming back online, say). */
export const uploadPending = () => retrySave();

/** Keeps a new file on this device; the save that adds its card uploads it. Returns what the card needs. */
export async function addAttachment(file: File) {
  if (file.size > MAX_SIZE) throw new Error(`“${file.name}” is larger than 200 MB`);
  const ref = uid();
  await save(cacheKey(ref), file);
  setPending([...pending(), ref]);
  return { ref, name: file.name, mime: file.type || 'application/octet-stream', size: file.size };
}

/** A file's contents: this device's copy, else fetched from the storage (and kept). */
export async function getAttachment(ref: string, name: string, type: string): Promise<Blob | null> {
  const cached = await load<Blob>(cacheKey(ref)).catch(() => undefined);
  if (cached) return cached;
  const where = attachmentLocation(ref);
  let blob = where ? await readFromStorage(where, type) : null;
  if (!blob && where !== legacyAttachmentPath(ref, name)) blob = await readFromStorage(legacyAttachmentPath(ref, name), type).catch(() => null);
  if (blob) save(cacheKey(ref), blob).catch(() => {});
  return blob;
}

/** Every attached file's card, so boards copied to another place can bring their files along. */
const filesIn = (doc: import('./types').Doc) =>
  [...Object.values(doc.elements), ...(doc.trash ?? []).flatMap((t) => t.elements), ...(doc.templates ?? []).flatMap((t) => t.elements)]
    .filter((e): e is import('./types').FileEl => e.type === 'file');

/** Makes sure this device has every file the boards use (before copying them elsewhere). */
export async function cacheAll(doc: import('./types').Doc) {
  for (const el of filesIn(doc)) await getAttachment(el.ref, el.name, el.mime).catch(() => null);
}
