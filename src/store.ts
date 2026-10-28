import { useSyncExternalStore } from 'react';
import { produce, type Draft } from 'immer';
import type { Doc, UI, View } from './types';
import { load, save } from './persist';
import { blankDoc, deleteElements, seedDoc } from './doc';
import { purgeOldTrash } from './projectActions';
import { cacheAll, moveAttachment, settlePending, storeAttachment, trashAttachment, uploadsPending } from './attachments';
import { nativeStorage, type NativeStorage, type StorageBatch } from './native';
import { driveStorage } from './driveStorage';
import { oneDriveStorage } from './oneDriveStorage';
import { allowWebFolder, currentWebFolder, FolderAccessNeeded, setCurrentWebFolder, webFolderStorage, webFoldersSupported } from './webFolderStorage';
import { microsoftAccount } from './microsoftAuth';
import { googleAccount, preloadGoogle, renewWebToken, SignInNeeded, webTokenExpiring } from './googleAuth';
import { INDEX_FILE, layoutWorkspace, parseIndex, readWorkspace, type Layout, type Listed } from './workspaceFiles';

export interface State {
  doc: Doc;
  ui: UI;
  canUndo: boolean;
  canRedo: boolean;
  saved: boolean;
  /** Why the workspace file in the storage folder couldn't be read or written (desktop apps). */
  storageError: string | null;
  /** Name of the folder the boards are saved in (in Google Drive or on this computer); null in browser storage. */
  storageName: string | null;
  /** How far the save under way has got (0–1), when the storage reports it; null otherwise. */
  saveProgress: number | null;
  /** Set while a place is being opened (signing in, reading Google Drive), to say so on screen. */
  opening: string | null;
}

let state: State;
const listeners = new Set<() => void>();
let past: Doc[] = [];
let future: Doc[] = [];
/** Snapshot taken at the start of a gesture or edit; pushed to history on its first change. */
let pendingBase: Doc | null = null;

const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export const getState = () => state;

export function useStore<T>(selector: (s: State) => T): T {
  return useSyncExternalStore(subscribe, () => selector(state));
}

function setState(next: Partial<State>) {
  state = { ...state, ...next, canUndo: past.length > 0, canRedo: future.length > 0 };
  emit();
}

/**
 * Applies a change to the document.
 * - 'push' records an undo step now.
 * - 'pending' records the snapshot taken by checkpoint(), once, so a whole drag or
 *   text edit undoes as one step.
 */
export function mutate(recipe: (d: Draft<Doc>) => void, history: 'push' | 'pending' | 'none' = 'push') {
  let next = produce(state.doc, recipe);
  if (next === state.doc) return;
  next = stampEdited(state.doc, next);
  if (history === 'push') record(state.doc);
  else if (history === 'pending' && pendingBase) {
    record(pendingBase);
    pendingBase = null;
  }
  setState({ doc: next, saved: false });
  schedulePersist();
}

/**
 * Marks boards whose record or cards changed with the time, for "Last edited" on the
 * Projects page. Unchanged objects are shared between versions (immer), so this only
 * compares references.
 */
function stampEdited(prev: Doc, next: Doc) {
  const touched = new Set<string>();
  if (next.elements !== prev.elements) {
    for (const id in next.elements) if (next.elements[id] !== prev.elements[id]) touched.add(next.elements[id].boardId);
    for (const id in prev.elements) if (!next.elements[id]) touched.add(prev.elements[id].boardId);
  }
  if (next.boards !== prev.boards) for (const id in next.boards) if (next.boards[id] !== prev.boards[id]) touched.add(id);
  const now = Date.now();
  const stale = [...touched].filter((id) => next.boards[id] && (next.boards[id].updatedAt ?? 0) < now - 1000);
  if (!stale.length) return next;
  return produce(next, (d) => {
    for (const id of stale) d.boards[id].updatedAt = now;
  });
}

function record(doc: Doc) {
  past.push(doc);
  if (past.length > 200) past.shift();
  future = [];
}

export function checkpoint() {
  pendingBase = state.doc;
}

export function undo() {
  const prev = past.pop();
  if (!prev) return;
  future.push(state.doc);
  pendingBase = null;
  restore(prev);
}

export function redo() {
  const next = future.pop();
  if (!next) return;
  past.push(state.doc);
  pendingBase = null;
  restore(next);
}

function restore(doc: Doc) {
  let boardId = state.ui.boardId;
  if (!doc.boards[boardId]) boardId = doc.rootId;
  const selection = state.ui.selection.filter((id) => doc.elements[id]);
  setState({ doc, ui: { ...state.ui, boardId, selection, editingId: null }, saved: false });
  schedulePersist();
}

export function setUI(patch: Partial<UI> | ((ui: UI) => Partial<UI>)) {
  const p = typeof patch === 'function' ? patch(state.ui) : patch;
  const wasEditing = state.ui.editingId;
  setState({ ui: { ...state.ui, ...p } });
  if ('views' in p || 'boardId' in p || 'sidebarOpen' in p || 'collapsedSections' in p || 'projectsView' in p || 'projectsSort' in p) saveUI();
  if (wasEditing && 'editingId' in p && p.editingId !== wasEditing) removeIfEmpty(wasEditing);
}

const textOf = (html: string) => html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();

/** Like Milanote, notes and comments left empty when editing ends are discarded. */
function removeIfEmpty(id: string) {
  const el = state.doc.elements[id];
  if (!el) return;
  const empty = (el.type === 'note' && !textOf(el.html) && !/<img/i.test(el.html)) || (el.type === 'comment' && !el.text.trim());
  if (!empty) return;
  mutate((d) => deleteElements(d, [id]), 'none');
  setState({ ui: { ...state.ui, selection: state.ui.selection.filter((s) => s !== id) } });
}

/** Starts boards clear of the floating panels on the left and top (on a phone, just the top bar). */
export const DEFAULT_VIEW: View = window.matchMedia('(max-width: 640px)').matches ? { x: 16, y: 72, zoom: 0.8 } : { x: 300, y: 40, zoom: 1 };

export function currentView(): View {
  return state.ui.views[state.ui.boardId] ?? DEFAULT_VIEW;
}

export function setView(view: View) {
  setUI((ui) => ({ views: { ...ui.views, [ui.boardId]: view } }));
}

export function select(ids: string[]) {
  setUI({ selection: ids, editingId: null, editPoint: null });
}

export function startEditing(id: string, point: { x: number; y: number } | null = null) {
  checkpoint();
  setUI({ selection: [id], editingId: id, editPoint: point });
}

/** Phone-sized screens, where the sidebar covers the board and closes once something is picked. */
export const isPhone = () => window.matchMedia('(max-width: 640px)').matches;
const closeSidebarOnPhone = () => (isPhone() ? { sidebarOpen: false } : {});

export function openBoard(boardId: string) {
  setUI({ boardId, browsing: null, selection: [], editingId: null, editPoint: null, dropTarget: null, draw: null, playingId: null, ...closeSidebarOnPhone() });
}

/** Shows the Projects page at a sidebar folder (null for all projects). */
export function browse(folderId: string | null) {
  setUI({ browsing: folderId ?? '', selection: [], editingId: null, editPoint: null, draw: null, playingId: null, ...closeSidebarOnPhone() });
}

// ---- persistence ----
// The document (which can hold images) lives in IndexedDB; the small view state goes to
// localStorage synchronously so a reload always reopens the board you were on. The desktop
// apps also keep the document as files in the user's storage folder (one per board, see
// workspaceFiles.ts), which is the copy they load; IndexedDB stays as a backup. Changes made to
// those files outside Pinpad (renaming a folder in Google Drive, say) are picked up when Pinpad
// comes back into focus.

// Original name kept so saved view state still loads.
const UI_KEY = 'milanote-clone:ui';
let persistTimer: number | undefined;

function saveUI() {
  try {
    const { boardId, views, sidebarOpen, collapsedSections, projectsView, projectsSort } = state.ui;
    localStorage.setItem(UI_KEY, JSON.stringify({ boardId, views, sidebarOpen, collapsedSections, projectsView, projectsSort }));
  } catch {
    // Storage can be unavailable (private mode); the board still works.
  }
}

function loadUI(): Partial<Pick<UI, 'boardId' | 'views' | 'sidebarOpen' | 'collapsedSections' | 'projectsView' | 'projectsSort'>> | undefined {
  try {
    return JSON.parse(localStorage.getItem(UI_KEY) ?? 'null') ?? undefined;
  } catch {
    return undefined;
  }
}

/** Where board files are saved: a storage folder (desktop apps), Google Drive, or nowhere. */
type Backend = Pick<NativeStorage, 'read' | 'list'> & {
  /** Google Drive reports each file done; the desktop apps write a batch in one go. */
  write(batch: StorageBatch, onProgress?: (done: number) => void): Promise<boolean>;
};
export type StorageTarget =
  | { kind: 'folder'; folder: string | null }
  | { kind: 'webfolder'; id: string; name: string }
  | { kind: 'drive' }
  | { kind: 'onedrive' }
  | { kind: 'browser' };
type Cloud = 'drive' | 'onedrive';

/**
 * Per device: whether this computer or browser keeps its boards in Google Drive or OneDrive,
 * or (website) in a folder on this computer the user picked ("folder").
 */
const MODE_KEY = 'pinpad:storage';
export function cloudInUse(): Cloud | null {
  try {
    const mode = localStorage.getItem(MODE_KEY);
    return mode === 'drive' || mode === 'onedrive' ? mode : null;
  } catch {
    return null;
  }
}
export const usingDrive = () => cloudInUse() === 'drive';
export const usingOneDrive = () => cloudInUse() === 'onedrive';
export function usingWebFolder() {
  try {
    return webFoldersSupported() && localStorage.getItem(MODE_KEY) === 'folder' && !!currentWebFolder();
  } catch {
    return false;
  }
}
function setMode(mode: Cloud | 'folder' | null) {
  try {
    if (mode) localStorage.setItem(MODE_KEY, mode);
    else localStorage.removeItem(MODE_KEY);
  } catch {
    // Without storage the choice lasts for this session only.
  }
}
/** The storage for a cloud place. */
const cloudStorage = (cloud: Cloud) => (cloud === 'drive' ? driveStorage : oneDriveStorage);
/**
 * This device's copy of the open workspace (IndexedDB) is kept per Google account, so
 * switching accounts never shows one account's boards in another's place. Browser-only
 * storage and the desktop apps' folders keep the original key.
 */
const docKey = () => {
  const cloud = cloudInUse();
  if (cloud === 'drive') return `doc:drive:${googleAccount() ?? ''}`;
  if (cloud === 'onedrive') return `doc:onedrive:${microsoftAccount() ?? ''}`;
  if (usingWebFolder()) return `doc:folder:${currentWebFolder()!.id}`;
  return 'doc';
};

const currentBackend = (): Backend | undefined => {
  const cloud = cloudInUse();
  if (cloud) return cloudStorage(cloud);
  return usingWebFolder() ? webFolderStorage : nativeStorage();
};
const placeName = () => {
  const cloud = cloudInUse();
  if (usingWebFolder()) return `the “${currentWebFolder()!.name}” folder`;
  return cloud === 'drive' ? 'Google Drive' : cloud === 'onedrive' ? 'OneDrive' : 'your storage folder';
};

let backend: Backend | undefined;
/** Set when the saved files exist but couldn't be read, so they're never overwritten. */
let fileBlocked = false;
/** File writes run one at a time, in order. */
let writing: Promise<unknown> = Promise.resolve();
/** Writes queued or running, so closing can tell whether a save is still on its way. */
let writesPending = 0;
/** The boards as loaded when saving to files was stopped; anything changed since isn't saved there. */
let blockedDoc: Doc | null = null;
/**
 * On the website with Google Drive, the copy on this device is shown at once while Drive is
 * read (finishStart). Until then this holds that copy and nothing is saved to Drive, since
 * Drive may have newer boards from another computer.
 */
let starting: Doc | null = null;
let startup: Promise<void> = Promise.resolve();
/** The files as of the last successful save, so each save writes only what changed. */
let onDisk: Layout = { files: new Map(), paths: new Map(), attachments: new Map() };
const nothingOnDisk = (): Layout => ({ files: new Map(), paths: new Map(), attachments: new Map() });

/** Where an attached file is kept in the storage now, as of the last read or save. */
export const attachmentLocation = (ref: string) => onDisk.attachments.get(ref) ?? null;
/** What the storage listed after the last read or save; anything else was changed outside Pinpad. */
let seen: Map<string, number> | null = null;
const snapshot = (listing: Listed[]) => new Map(listing.map((f) => [f.path, f.modified]));
const unchanged = (listing: Listed[]) =>
  !!seen && seen.size === listing.length && listing.every((f) => seen!.get(f.path) === f.modified);

/** An error as a short sentence: without the Windows app's IPC wrapping, and plain words for common file errors. */
function errorText(err: unknown) {
  const message = (err instanceof Error ? err.message : String(err)).replace(/^Error invoking remote method '[^']+': (\w*Error: )?/, '');
  if (/EACCES|EPERM|permission/i.test(message)) return 'Pinpad isn’t allowed to write in that folder';
  if (/ENOSPC/.test(message)) return 'the disk is full';
  if (/ENOENT/.test(message)) return 'the folder can’t be found';
  return message;
}

/** Whether saving is stopped because the saved files couldn't be loaded. */
export const storageBlocked = () => fileBlocked;

/** What to write, and which old files to clear away, to go from onDisk to the next layout. */
function changesTo(next: Layout): StorageBatch {
  const write = [...next.files].filter(([path, text]) => onDisk.files.get(path) !== text);
  // Compared ignoring case: on macOS and Windows "Plan.json" and "plan.json" are one file,
  // so renaming a board's case rewrites the file in place and nothing may be removed.
  const kept = new Set([...next.files.keys()].map((p) => p.toLowerCase()));
  const remove: string[] = [];
  const trash: string[] = [];
  for (const [id, path] of onDisk.paths) {
    if (kept.has(path.toLowerCase())) continue;
    (next.paths.has(id) ? remove : trash).push(path);
  }
  return { write, remove, trash };
}

/** Attached files to move (their card or project moved), upload (new here) and trash (card gone). */
function attachmentChanges(next: Layout) {
  const move: [string, string, string][] = [];
  const upload: [string, string][] = [];
  const trash: [string, string][] = [];
  for (const [ref, to] of next.attachments) {
    const from = onDisk.attachments.get(ref);
    if (from === undefined) upload.push([ref, to]);
    else if (from !== to) move.push([ref, from, to]);
  }
  for (const [ref, from] of onDisk.attachments) if (!next.attachments.has(ref)) trash.push([ref, from]);
  return { move, upload, trash };
}

function writeFiles(doc: Doc) {
  const target = backend;
  // Kept only in this browser: there's nowhere else for files to go.
  if (!target) settlePending(() => true);
  if (!target || fileBlocked || starting) return writing;
  writesPending++;
  writing = writing.then(async () => {
    const next = layoutWorkspace(doc);
    const batch = changesTo(next);
    const files = attachmentChanges(next);
    const fileCount = files.move.length + files.upload.length + files.trash.length;
    if (!batch.write.length && !batch.remove.length && !batch.trash.length && !fileCount) return;
    const total = batch.write.length + batch.remove.length + batch.trash.length + fileCount;
    let done = 0;
    const step = () => setState({ saveProgress: ++done / total });
    setState({ saveProgress: 0 });
    try {
      // Files first, so the index never points at a file that isn't there yet. Removed files
      // go first, freeing their names; a file moving onto a name another file still has (two
      // files trading names) steps aside to a temporary name first.
      for (const [ref, from] of files.trash) {
        await trashAttachment(ref, from);
        step();
      }
      const taken = new Set(
        [...onDisk.attachments].filter(([ref]) => next.attachments.has(ref)).map(([, path]) => path.toLowerCase()),
      );
      const moves = files.move.map(([ref, from, to]) => ({ ref, from, to }));
      if (moves.some((m) => taken.has(m.to.toLowerCase()))) {
        for (const m of moves) {
          const aside = `${m.from.slice(0, m.from.lastIndexOf('/') + 1)}~${m.ref.slice(0, 8)}-${m.to.slice(m.to.lastIndexOf('/') + 1)}`;
          if (await moveAttachment(m.from, aside)) m.from = aside;
        }
      }
      // A file missing from where it was is uploaded from this device's copy, if there is one.
      for (const { ref, from, to } of moves) {
        if (!(await moveAttachment(from, to))) await storeAttachment(ref, to);
        step();
      }
      for (const [ref, to] of files.upload) {
        await storeAttachment(ref, to);
        step();
      }
      const before = done;
      await target.write(batch, (n) => setState({ saveProgress: (before + n) / total }));
      onDisk = next;
      // Saved, or no longer on any board.
      const inUse = new Set(Object.values(state.doc.elements).flatMap((e) => (e.type === 'file' ? [e.ref] : [])));
      settlePending((ref) => next.attachments.has(ref) || !inUse.has(ref));
      setState({ saveProgress: null, ...(state.storageError ? { storageError: null } : {}) });
    } catch (err) {
      // onDisk stays as it was, so the next save retries everything that didn't go through.
      setState({
        saveProgress: null,
        storageError: err instanceof SignInNeeded ? err.message : `Couldn't save to ${placeName()}: ${errorText(err)}`,
      });
      return;
    }
    try {
      seen = snapshot(await target.list());
    } catch {
      // Without a fresh listing the next check just reads everything again.
      seen = null;
    }
  }).finally(() => {
    writesPending--;
  });
  return writing;
}

/**
 * After Google or Microsoft sign-in is renewed: saves what's waiting, or, when the boards
 * there couldn't be read before, opens them (they're the saved copy).
 */
export async function afterSignIn() {
  if (!fileBlocked) return retrySave();
  if (backend === webFolderStorage) {
    // Read the folder as on opening: edits made meanwhile stay unless it changed elsewhere.
    webFolderStorage.reset();
    fileBlocked = false;
    starting = blockedDoc ?? state.doc;
    setState({ storageError: null });
    startup = finishStart(backend);
    return startup;
  }
  const cloud = cloudInUse() ?? 'drive';
  const storage = cloudStorage(cloud);
  storage.reset();
  await switchStorage({ kind: cloud }, (await storage.hasWorkspace()) ? 'open' : 'replace');
}

/** Saves the current boards again after a failure (say, once Google sign-in is renewed). */
export function retrySave() {
  return writeFiles(state.doc);
}

/**
 * Loads the saved workspace, following changes made to its files outside Pinpad; null when
 * there's none there yet. Also remembers the listing, to notice the next outside change.
 */
async function readFiles(from: Backend, listing?: Listed[]): Promise<{ doc: Doc; disk: Layout } | null> {
  listing ??= await from.list();
  const indexText = (await from.read([INDEX_FILE]))[INDEX_FILE];
  seen = snapshot(listing);
  if (indexText == null) return null;
  const parsed = parseIndex(indexText);
  // The earlier single-file format: the next save splits it into board files.
  if ('doc' in parsed) return { doc: parsed.doc, disk: nothingOnDisk() };
  const { doc, files, paths, attachments } = await readWorkspace(parsed.index, listing, (p) => from.read(p));
  files.set(INDEX_FILE, indexText);
  return { doc, disk: { files, paths, attachments } };
}

const sameFiles = (a: Layout, b: Layout) =>
  a.files.size === b.files.size && [...a.files].every(([path, text]) => b.files.get(path) === text);

let syncing = false;
let lastSync = 0;
const SYNC_ERROR = "Couldn't read changes from";
const clearSyncError = () => state.storageError?.startsWith(SYNC_ERROR) && setState({ storageError: null });

/**
 * Picks up changes made to the board files outside Pinpad since the last read or save: a
 * folder or board renamed, moved or deleted in Google Drive or the storage folder, or boards
 * edited on another computer. Runs when Pinpad comes back into focus and now and then while
 * it's open; it waits while there are unsaved changes, so it never overwrites an edit.
 */
async function syncFromStorage() {
  const from = backend;
  if (!state || !from || fileBlocked || starting || syncing || Date.now() - lastSync < 3000) return;
  syncing = true;
  lastSync = Date.now();
  try {
    await writing;
    const before = state.doc;
    const busy = () => from !== backend || state.doc !== before || !state.saved || persistTimer !== undefined || !!state.ui.editingId;
    if (busy()) return;
    const listing = await from.list();
    refreshStorageName().catch(() => {});
    if (unchanged(listing)) return void clearSyncError();
    const found = await readFiles(from, listing);
    clearSyncError();
    if (busy()) {
      seen = null;
      return;
    }
    if (!found) {
      // The whole workspace was deleted there: save it again from this copy.
      onDisk = nothingOnDisk();
      await writeFiles(state.doc);
      return;
    }
    if (sameFiles(found.disk, onDisk)) return;
    const { doc, disk } = found;
    onDisk = disk;
    // Undo puts back what was here before the outside change (and saves that back there).
    record(state.doc);
    pendingBase = null;
    const boardId = doc.boards[state.ui.boardId] ? state.ui.boardId : doc.rootId;
    const selection = state.ui.selection.filter((id) => doc.elements[id]);
    setState({ doc, ui: { ...state.ui, boardId, selection, dropTarget: null }, storageError: null });
    await saveLocal(doc);
    // Writes back what following the change needs, like the index's new folder names.
    await writeFiles(doc);
  } catch (err) {
    // Offline or signed out: saving reports that, and the next check tries again.
    if (!(err instanceof SignInNeeded)) setState({ storageError: `${SYNC_ERROR} ${placeName()}: ${errorText(err)}` });
  } finally {
    syncing = false;
  }
}

const LOCAL_ERROR = "Couldn't save in this browser";

/** Saves to this device; without a storage folder or Drive, a failure here means unsaved work, so it's shown. */
async function saveLocal(doc: Doc) {
  try {
    await save(docKey(), doc);
    if (state.storageError?.startsWith(LOCAL_ERROR)) setState({ storageError: null });
  } catch (err) {
    if (backend) return;
    const full = err instanceof DOMException && err.name === 'QuotaExceededError';
    setState({
      storageError: `${LOCAL_ERROR} (${full ? 'its storage is full' : errorText(err)}). Use Export to keep a copy, or connect Google Drive in Storage location.`,
    });
  }
}

async function flush() {
  clearTimeout(persistTimer);
  persistTimer = undefined;
  const doc = state.doc;
  await Promise.all([saveLocal(doc), writeFiles(doc)]);
  if (persistTimer === undefined) setState({ saved: true });
}

/** Whether some change hasn't reached storage yet (checked without waiting, for the website's leave warning). */
function hasUnsavedNow() {
  const error = state.storageError && !state.storageError.startsWith(SYNC_ERROR);
  return !state.saved || persistTimer !== undefined || writesPending > 0 || !!error || (fileBlocked && state.doc !== blockedDoc) || (!!starting && state.doc !== starting) || uploadsPending();
}

/**
 * Saves anything pending, then says why closing now would lose changes, or null when
 * everything is saved. The desktop apps ask this before closing the window or quitting.
 */
export async function unsavedReason(): Promise<string | null> {
  await startup;
  await flushNow();
  if (fileBlocked && state.doc !== blockedDoc) {
    return `Your latest changes are only on this device: Pinpad couldn't open your boards in ${placeName()}, so it isn't saving there.`;
  }
  const error = state.storageError;
  if (error && !error.startsWith(SYNC_ERROR)) return error;
  if (uploadsPending()) await writeFiles(state.doc);
  if (uploadsPending()) return `Some attached files haven't been uploaded to ${placeName()} yet. They stay on this device and upload next time Pinpad is open.`;
  return null;
}

/** Says on screen that a place is being opened (null when done). */
export const setOpening = (opening: string | null) => setState({ opening });

/** Resolves once the boards shown are the saved ones (after reading Google Drive, say). */
export const whenOpened = () => startup;

/** Writes any pending change now (the desktop apps call this before quitting). */
export async function flushNow() {
  if (persistTimer !== undefined) await flush();
  await writing;
}

/**
 * Moves where boards are saved: another storage folder, Google Drive, or (on the website)
 * just this browser. "open" loads the workspace already at the new place; "replace" sends
 * that workspace's board files to the Trash and saves the current boards there. The old
 * place is left alone either way.
 */
export async function switchStorage(target: StorageTarget, keep: 'open' | 'replace' | 'fresh') {
  try {
    await moveStorage(target, keep);
  } finally {
    refreshStorageName().catch(() => {});
  }
}

/** Shows the name of the folder the boards are in now; it follows a rename done in Drive or Finder. */
async function refreshStorageName() {
  let name: string | null = null;
  if (backend === driveStorage) name = driveStorage.folderName() ?? 'Google Drive';
  else if (backend === oneDriveStorage) name = 'OneDrive';
  else if (backend === webFolderStorage) name = webFolderStorage.folderName();
  else if (backend) name = (await nativeStorage()!.location()).folder.split(/[\\/]/).filter(Boolean).pop() ?? null;
  if (name !== state.storageName) setState({ storageName: name });
}

/** Whether this browser has its own boards saved (the website's "This browser" place). */
export async function browserHasBoards() {
  return !!(await load<Doc>('doc').catch(() => undefined));
}

/** Shows another workspace, with a clean undo history. */
function showDoc(doc: Doc) {
  past = [];
  future = [];
  pendingBase = null;
  const boardId = doc.boards[state.ui.boardId] ? state.ui.boardId : doc.rootId;
  setState({
    doc,
    ui: { ...state.ui, boardId, selection: [], editingId: null, playingId: null, dropTarget: null, browsing: state.ui.browsing === null ? null : '' },
    canUndo: false,
    canRedo: false,
    storageError: null,
  });
}

async function moveStorage(target: StorageTarget, keep: 'open' | 'replace' | 'fresh') {
  await flushNow();
  starting = null;
  // Boards copied to the new place bring their attached files: get them here first.
  if (keep === 'replace') await cacheAll(state.doc);
  const native = nativeStorage();
  const wasMode = cloudInUse() ?? (usingWebFolder() ? 'folder' : null);
  const wasFolder = currentWebFolder();
  const previous = target.kind === 'folder' && native ? await native.location() : null;
  if (target.kind === 'folder') await native?.use(target.folder);
  const cloud = target.kind === 'drive' || target.kind === 'onedrive' ? target.kind : null;
  // Opening keeps the listing just made to see whether there's a workspace there (it's
  // listed afresh anyway once a few seconds old).
  if (cloud && keep !== 'open') cloudStorage(cloud).reset();
  if (target.kind === 'webfolder') setCurrentWebFolder(target);
  setMode(cloud ?? (target.kind === 'webfolder' ? 'folder' : null));
  backend = currentBackend();
  fileBlocked = false;
  if (!backend) {
    // The website without Drive: the boards kept in this browser (or a new, empty workspace).
    onDisk = nothingOnDisk();
    if (keep !== 'replace') showDoc((keep === 'open' && (await load<Doc>('doc').catch(() => undefined))) || blankDoc());
    setState({ storageError: null });
    await saveLocal(state.doc);
    return;
  }
  if (keep === 'fresh') {
    // A new place starts empty; anything already there is left alone.
    onDisk = nothingOnDisk();
    showDoc(blankDoc());
    await saveLocal(state.doc);
    await writeFiles(state.doc);
    return;
  }
  if (keep === 'replace') {
    // Its board files go to the Trash first, even ones a current board is about to reuse
    // the name of (every workspace has a Home.json), so nothing is overwritten unrecoverably.
    let replaced: string[] = [];
    try {
      const indexText = (await backend.read([INDEX_FILE]))[INDEX_FILE];
      const parsed = indexText ? parseIndex(indexText) : null;
      if (parsed && 'index' in parsed) replaced = Object.values(parsed.index.boards);
    } catch {
      // An unreadable index there just gets overwritten.
    }
    if (replaced.length) await backend.write({ write: [], remove: [], trash: replaced });
    onDisk = nothingOnDisk();
    setState({ storageError: null });
    await saveLocal(state.doc);
    await writeFiles(state.doc);
    return;
  }
  // Opened here before: its copy on this device shows at once, and the storage is read just
  // after (finishStart), as when Pinpad starts.
  if (cloud || target.kind === 'webfolder') {
    const own = await load<Doc>(docKey()).catch(() => undefined);
    if (own?.boards?.[own.rootId]) {
      onDisk = nothingOnDisk();
      showDoc(own);
      starting = own;
      startup = finishStart(backend);
      return;
    }
  }
  let found: Awaited<ReturnType<typeof readFiles>>;
  try {
    found = await readFiles(backend);
    if (!found) throw new Error(cloud ? `No Pinpad workspace in ${placeName()}` : 'No Pinpad workspace in that folder');
  } catch (err) {
    if (previous && native) await native.use(previous.isDefault ? null : previous.folder);
    setMode(wasMode);
    setCurrentWebFolder(wasFolder);
    backend = currentBackend();
    throw err;
  }
  const { doc, disk } = found;
  onDisk = disk;
  past = [];
  future = [];
  pendingBase = null;
  const boardId = doc.boards[state.ui.boardId] ? state.ui.boardId : doc.rootId;
  setState({
    doc,
    ui: { ...state.ui, boardId, selection: [], editingId: null, playingId: null, dropTarget: null },
    canUndo: false,
    canRedo: false,
    storageError: null,
  });
  await saveLocal(doc);
}

function schedulePersist() {
  clearTimeout(persistTimer);
  persistTimer = window.setTimeout(flush, 300);
}

export async function initStore() {
  // This place's own copy; before copies were kept per account, there was one shared copy.
  const own = await load<Doc>(docKey()).catch(() => undefined);
  let doc = own ?? (await load<Doc>('doc').catch(() => undefined));
  let storageError: string | null = null;
  backend = currentBackend();
  // Google Drive is a network away: open with this device's copy of it, and read Drive after.
  const quick = (backend === driveStorage || backend === oneDriveStorage || backend === webFolderStorage) && !!own?.boards?.[own.rootId];
  if (backend && !quick) {
    // The saved files win; IndexedDB is the fallback and, the first time files are used, the
    // boards that get written out.
    try {
      const found = await readFiles(backend);
      if (found) {
        doc = found.doc;
        onDisk = found.disk;
      }
    } catch (err) {
      fileBlocked = true;
      storageError = openError(err);
    }
  }
  const savedUI = loadUI();
  const flushPending = () => persistTimer !== undefined && flush();
  (window as Window & { __flushSave?: () => Promise<void> }).__flushSave = flushNow;
  (window as Window & { __unsavedReason?: () => Promise<string | null> }).__unsavedReason = unsavedReason;
  // The website asks the browser to warn before leaving with changes that aren't saved yet.
  window.addEventListener('beforeunload', (e) => {
    if (window.pinpadNative || !hasUnsavedNow()) return;
    flushPending();
    e.preventDefault();
    e.returnValue = '';
  });
  window.addEventListener('pagehide', flushPending);
  document.addEventListener('visibilitychange', () => (document.visibilityState === 'hidden' ? flushPending() : syncFromStorage()));
  window.addEventListener('focus', () => syncFromStorage());
  if (usingWebFolder()) {
    // The browser may want the folder allowed again after a restart, which needs a click: the
    // first click asks, and saving carries on.
    const askOnClick = () => {
      if (!(state.storageError && fileBlocked)) return;
      window.removeEventListener('pointerdown', askOnClick, true);
      allowWebFolder(currentWebFolder()!.id, true).then((ok) => ok && afterSignIn()).catch(() => {});
    };
    window.addEventListener('pointerdown', askOnClick, true);
  }
  if (usingDrive() && !nativeStorage()) {
    // The website's Google token lasts an hour and renewing it needs a click, so the next
    // click after it runs low renews it, instead of saving stopping until "Sign in again".
    preloadGoogle().catch(() => {});
    window.addEventListener(
      'pointerdown',
      (e) => {
        // Not from Storage location's own "Sign in again", which asks Google itself.
        if (!usingDrive() || !webTokenExpiring() || (e.target as Element).closest?.('.dialog')) return;
        renewWebToken().then((ok) => ok && afterSignIn().catch(() => {}));
      },
      true,
    );
  }
  window.setInterval(() => document.visibilityState === 'visible' && syncFromStorage(), 30_000);
  if (!doc?.boards?.[doc.rootId]) doc = seedDoc();
  // Workspaces saved before folders existed.
  doc.folders ??= {};
  purgeOldTrash(doc);
  const boardId = savedUI?.boardId && doc.boards[savedUI.boardId] ? savedUI.boardId : doc.rootId;
  state = {
    doc,
    ui: {
      boardId,
      playingId: null,
      sidebarOpen: !isPhone() && (savedUI?.sidebarOpen ?? true),
      collapsedSections: savedUI?.collapsedSections ?? [],
      projectsView: savedUI?.projectsView === 'list' ? 'list' : 'grid',
      projectsSort: savedUI?.projectsSort ?? { by: 'name', desc: false },
      draw: null,
      selection: [],
      editingId: null,
      editPoint: null,
      views: savedUI?.views ?? {},
      dropTarget: null,
      guides: null,
      renaming: null,
      browsing: null,
    },
    canUndo: false,
    canRedo: false,
    saved: true,
    storageError,
    storageName: null,
    saveProgress: null,
    opening: null,
  };
  if (fileBlocked) blockedDoc = doc;
  refreshStorageName().catch(() => {});
  saveLocal(doc);
  if (quick && backend) {
    starting = doc;
    startup = finishStart(backend);
    return;
  }
  writeFiles(doc);
}

function openError(err: unknown) {
  if (err instanceof FolderAccessNeeded) return `${err.message} Click anywhere to allow it; until then you're seeing the copy saved in this browser.`;
  const reason = err instanceof SignInNeeded ? 'you need to sign in again' : errorText(err);
  return `Couldn't open your boards in ${placeName()} (${reason}). Showing the copy saved on this device; nothing will be saved to ${placeName()} until you open Storage location and fix this.`;
}

/**
 * Reads Google Drive after opening with this device's copy. Usually nothing changed there
 * and the copy stays as it is; boards changed on another computer replace it, and anything
 * edited in the moment before is one undo away (and saved back if undone).
 */
async function finishStart(from: Backend) {
  const shown = starting!;
  try {
    const found = await readFiles(from);
    if (from !== backend || starting !== shown) return;
    starting = null;
    if (!found) {
      // No workspace there (it was deleted): save it again from this copy.
      onDisk = nothingOnDisk();
    } else {
      onDisk = found.disk;
      if (!sameFiles(found.disk, layoutWorkspace(shown))) {
        const { doc } = found;
        if (state.doc !== shown) record(state.doc);
        pendingBase = null;
        const boardId = doc.boards[state.ui.boardId] ? state.ui.boardId : doc.rootId;
        const selection = state.ui.selection.filter((id) => doc.elements[id]);
        setState({ doc, ui: { ...state.ui, boardId, selection, editingId: null, dropTarget: null } });
        await saveLocal(doc);
      }
    }
    await writeFiles(state.doc);
  } catch (err) {
    if (from !== backend || starting !== shown) return;
    starting = null;
    fileBlocked = true;
    blockedDoc = shown;
    setState({ storageError: openError(err) });
  }
}
