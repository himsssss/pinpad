/**
 * Files attached to boards (PDFs, videos, documents…). Each is kept as its own file in an
 * Attachments folder beside the board files (in Google Drive or the storage folder), not
 * inside a board, so editing a board never re-uploads them. This device keeps a copy in
 * IndexedDB; uploads wait in a queue until the storage takes them.
 */

import { load, save } from './persist';
import { nativeStorage } from './native';
import { driveStorage } from './driveStorage';
import { usingDrive } from './store';
import { uid } from './doc';
import type { Doc } from './types';

const PENDING_KEY = 'pinpad:attachments-pending';
const MAX_SIZE = 200 * 1024 * 1024;

const cacheKey = (ref: string) => `file:${ref}`;
const extension = (name: string) => (/\.[a-z0-9]{1,8}$/i.exec(name)?.[0] ?? '').toLowerCase();
/** Where a file is kept: Attachments/<id><ext>, so odd names never matter. */
export const attachmentPath = (ref: string, name: string) => `Attachments/${ref}${extension(name)}`;

type Pending = { ref: string; name: string };

function pending(): Pending[] {
  try {
    return JSON.parse(localStorage.getItem(PENDING_KEY) ?? '[]');
  } catch {
    return [];
  }
}

function setPending(list: Pending[]) {
  try {
    localStorage.setItem(PENDING_KEY, JSON.stringify(list));
  } catch {
    // Not remembered; files still in this device's copy are uploaded when next added.
  }
}

export const uploadsPending = () => pending().length > 0;

function toBase64(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function writeToStorage(path: string, blob: Blob) {
  if (usingDrive()) return driveStorage.writeAttachment(path, blob);
  const native = nativeStorage();
  if (native) await native.writeFile({ path, data: await toBase64(blob) });
}

async function readFromStorage(path: string, type: string): Promise<Blob | null> {
  if (usingDrive()) return driveStorage.readAttachment(path);
  const native = nativeStorage();
  const data = native ? await native.readFile(path) : null;
  return data == null ? null : (await fetch(`data:${type || 'application/octet-stream'};base64,${data}`)).blob();
}

let uploading: Promise<void> = Promise.resolve();

/** Sends queued files to the storage; anything that fails stays queued for next time. */
export function uploadPending() {
  uploading = uploading.then(async () => {
    for (const item of pending()) {
      const blob = await load<Blob>(cacheKey(item.ref)).catch(() => undefined);
      try {
        if (blob) await writeToStorage(attachmentPath(item.ref, item.name), blob);
        setPending(pending().filter((p) => p.ref !== item.ref));
      } catch {
        return; // Offline or signed out: try again later.
      }
    }
  });
  return uploading;
}

/** Keeps a new file on this device and queues it for the storage. Returns what the card needs. */
export async function addAttachment(file: File) {
  if (file.size > MAX_SIZE) throw new Error(`“${file.name}” is larger than 200 MB`);
  const ref = uid();
  await save(cacheKey(ref), file);
  setPending([...pending(), { ref, name: file.name }]);
  uploadPending();
  return { ref, name: file.name, mime: file.type || 'application/octet-stream', size: file.size };
}

/** A file's contents: this device's copy, else fetched from the storage (and kept). */
export async function getAttachment(ref: string, name: string, type: string): Promise<Blob | null> {
  const cached = await load<Blob>(cacheKey(ref)).catch(() => undefined);
  if (cached) return cached;
  const blob = await readFromStorage(attachmentPath(ref, name), type);
  if (blob) save(cacheKey(ref), blob).catch(() => {});
  return blob;
}

/** Every file card's file, so boards copied to another place can bring their files along. */
const filesIn = (doc: Doc) =>
  Object.values(doc.elements).filter((e): e is Extract<typeof e, { type: 'file' }> => e.type === 'file');

/** Makes sure this device has every file the boards use (before copying them elsewhere). */
export async function cacheAll(doc: Doc) {
  for (const el of filesIn(doc)) await getAttachment(el.ref, el.name, el.mime).catch(() => null);
}

/** Queues every file the boards use for upload to the place now in use. */
export function queueAll(doc: Doc) {
  const known = new Set(pending().map((p) => p.ref));
  setPending([...pending(), ...filesIn(doc).filter((el) => !known.has(el.ref)).map((el) => ({ ref: el.ref, name: el.name }))]);
  return uploadPending();
}
