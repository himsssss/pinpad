import { useSyncExternalStore } from 'react';
import { produce, type Draft } from 'immer';
import type { Doc, UI, View } from './types';
import { load, save } from './persist';
import { deleteElements, seedDoc } from './doc';
import { nativeStorage, type NativeStorage, type StorageBatch } from './native';
import { assembleWorkspace, INDEX_FILE, layoutWorkspace, parseIndex, type Layout } from './workspaceFiles';

export interface State {
  doc: Doc;
  ui: UI;
  canUndo: boolean;
  canRedo: boolean;
  saved: boolean;
  /** Why the workspace file in the storage folder couldn't be read or written (desktop apps). */
  storageError: string | null;
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
  const next = produce(state.doc, recipe);
  if (next === state.doc) return;
  if (history === 'push') record(state.doc);
  else if (history === 'pending' && pendingBase) {
    record(pendingBase);
    pendingBase = null;
  }
  setState({ doc: next, saved: false });
  schedulePersist();
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
  if ('views' in p || 'boardId' in p || 'sidebarOpen' in p || 'collapsedSections' in p) saveUI();
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

/** Starts boards clear of the floating panels on the left and top. */
export const DEFAULT_VIEW: View = { x: 300, y: 40, zoom: 1 };

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

export function openBoard(boardId: string) {
  setUI({ boardId, selection: [], editingId: null, editPoint: null, dropTarget: null, draw: null, playingId: null });
}

// ---- persistence ----
// The document (which can hold images) lives in IndexedDB; the small view state goes to
// localStorage synchronously so a reload always reopens the board you were on. The desktop
// apps also keep the document as files in the user's storage folder (one per board, see
// workspaceFiles.ts), which is the copy they load; IndexedDB stays as a backup.

// Original name kept so saved view state still loads.
const UI_KEY = 'milanote-clone:ui';
let persistTimer: number | undefined;

function saveUI() {
  try {
    const { boardId, views, sidebarOpen, collapsedSections } = state.ui;
    localStorage.setItem(UI_KEY, JSON.stringify({ boardId, views, sidebarOpen, collapsedSections }));
  } catch {
    // Storage can be unavailable (private mode); the board still works.
  }
}

function loadUI(): Partial<Pick<UI, 'boardId' | 'views' | 'sidebarOpen' | 'collapsedSections'>> | undefined {
  try {
    return JSON.parse(localStorage.getItem(UI_KEY) ?? 'null') ?? undefined;
  } catch {
    return undefined;
  }
}

/** Set when the workspace files exist but couldn't be read, so they're never overwritten. */
let fileBlocked = false;
/** File writes run one at a time, in order. */
let writing: Promise<unknown> = Promise.resolve();
/** The files as of the last successful save, so each save writes only what changed. */
let onDisk: Layout = { files: new Map(), paths: new Map() };
const nothingOnDisk = (): Layout => ({ files: new Map(), paths: new Map() });

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

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

function writeFiles(doc: Doc) {
  const storage = nativeStorage();
  if (!storage || fileBlocked) return writing;
  writing = writing.then(async () => {
    const next = layoutWorkspace(doc);
    const batch = changesTo(next);
    if (!batch.write.length && !batch.remove.length && !batch.trash.length) return;
    try {
      await storage.write(batch);
      onDisk = next;
      if (state.storageError) setState({ storageError: null });
    } catch (err) {
      setState({ storageError: `Couldn't save to your storage folder: ${errorText(err)}` });
    }
  });
  return writing;
}

/** Loads the workspace from the storage folder; null when the folder has none yet. */
async function readFiles(storage: NativeStorage): Promise<{ doc: Doc; disk: Layout } | null> {
  const indexText = (await storage.read([INDEX_FILE]))[INDEX_FILE];
  if (indexText == null) return null;
  const parsed = parseIndex(indexText);
  // The earlier single-file format: the next save splits it into board files.
  if ('doc' in parsed) return { doc: parsed.doc, disk: nothingOnDisk() };
  const paths = Object.values(parsed.index.boards);
  const texts = await storage.read(paths);
  const doc = assembleWorkspace(parsed.index, texts);
  const files = new Map(paths.map((p) => [p, texts[p] ?? '']));
  files.set(INDEX_FILE, indexText);
  return { doc, disk: { files, paths: new Map(Object.entries(parsed.index.boards)) } };
}

async function flush() {
  clearTimeout(persistTimer);
  persistTimer = undefined;
  const doc = state.doc;
  await Promise.all([save('doc', doc), writeFiles(doc)]);
  if (persistTimer === undefined) setState({ saved: true });
}

/** Writes any pending change now (the desktop apps call this before quitting). */
export async function flushNow() {
  if (persistTimer !== undefined) await flush();
  await writing;
}

/**
 * Points the desktop app at another storage folder. "open" loads the workspace already in
 * that folder; "replace" sends that workspace's board files to the Trash and writes the
 * current boards there. The old folder is left alone either way.
 */
export async function switchStorageFolder(folder: string | null, keep: 'open' | 'replace') {
  const storage = nativeStorage();
  if (!storage) return;
  await flushNow();
  const previous = await storage.location();
  await storage.use(folder);
  if (keep === 'replace') {
    // Its board files go to the Trash first, even ones a current board is about to reuse
    // the name of (every workspace has a Home.json), so nothing is overwritten unrecoverably.
    let replaced: string[] = [];
    try {
      const indexText = (await storage.read([INDEX_FILE]))[INDEX_FILE];
      const parsed = indexText ? parseIndex(indexText) : null;
      if (parsed && 'index' in parsed) replaced = Object.values(parsed.index.boards);
    } catch {
      // An unreadable index there just gets overwritten.
    }
    if (replaced.length) await storage.write({ write: [], remove: [], trash: replaced });
    onDisk = nothingOnDisk();
    fileBlocked = false;
    setState({ storageError: null });
    await writeFiles(state.doc);
    return;
  }
  let found: Awaited<ReturnType<typeof readFiles>>;
  try {
    found = await readFiles(storage);
    if (!found) throw new Error('No Pinpad workspace in that folder');
  } catch (err) {
    await storage.use(previous.isDefault ? null : previous.folder);
    throw err;
  }
  const { doc, disk } = found;
  onDisk = disk;
  fileBlocked = false;
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
  await save('doc', doc);
}

function schedulePersist() {
  clearTimeout(persistTimer);
  persistTimer = window.setTimeout(flush, 300);
}

export async function initStore() {
  let doc = await load<Doc>('doc').catch(() => undefined);
  let storageError: string | null = null;
  const storage = nativeStorage();
  if (storage) {
    // The files in the storage folder win; IndexedDB is the fallback and, the first time
    // folder storage is used, the boards that get written out as files.
    try {
      const found = await readFiles(storage);
      if (found) {
        doc = found.doc;
        onDisk = found.disk;
      }
    } catch (err) {
      fileBlocked = true;
      storageError = `Couldn't read the workspace in your storage folder (${errorText(err)}). Showing the copy saved in the app; nothing will be written to that folder until you choose one in Storage location.`;
    }
  }
  const savedUI = loadUI();
  const flushPending = () => persistTimer !== undefined && flush();
  (window as Window & { __flushSave?: () => Promise<void> }).__flushSave = flushNow;
  window.addEventListener('pagehide', flushPending);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && flushPending());
  if (!doc?.boards?.[doc.rootId]) doc = seedDoc();
  // Workspaces saved before folders existed.
  doc.folders ??= {};
  const boardId = savedUI?.boardId && doc.boards[savedUI.boardId] ? savedUI.boardId : doc.rootId;
  state = {
    doc,
    ui: {
      boardId,
      playingId: null,
      sidebarOpen: savedUI?.sidebarOpen ?? true,
      collapsedSections: savedUI?.collapsedSections ?? [],
      draw: null,
      selection: [],
      editingId: null,
      editPoint: null,
      views: savedUI?.views ?? {},
      dropTarget: null,
    },
    canUndo: false,
    canRedo: false,
    saved: true,
    storageError,
  };
  save('doc', doc);
  writeFiles(doc);
}
