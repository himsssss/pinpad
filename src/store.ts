import { useSyncExternalStore } from 'react';
import { produce, type Draft } from 'immer';
import type { Doc, UI, View } from './types';
import { load, save } from './persist';
import { deleteElements, seedDoc } from './doc';
import { nativeStorage } from './native';

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
// apps also keep the document as a JSON file in the user's storage folder, which is the copy
// they load; IndexedDB stays as a backup.

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

/** Set when the workspace file exists but couldn't be read, so it's never overwritten. */
let fileBlocked = false;
/** File writes run one at a time, in order. */
let writing: Promise<unknown> = Promise.resolve();

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

function writeFile(doc: Doc) {
  const storage = nativeStorage();
  if (!storage || fileBlocked) return writing;
  const text = JSON.stringify(doc);
  writing = writing.then(() =>
    storage.write(text).then(
      () => state.storageError && setState({ storageError: null }),
      (err) => setState({ storageError: `Couldn't save to your storage folder: ${errorText(err)}` }),
    ),
  );
  return writing;
}

async function flush() {
  clearTimeout(persistTimer);
  persistTimer = undefined;
  const doc = state.doc;
  await Promise.all([save('doc', doc), writeFile(doc)]);
  if (persistTimer === undefined) setState({ saved: true });
}

/** Parses an exported or stored workspace, throwing if it isn't one. */
export function parseWorkspace(text: string): Doc {
  const doc = JSON.parse(text) as Doc;
  if (!doc?.boards?.[doc.rootId] || !doc.elements) throw new Error('Not a Pinpad workspace file');
  // Workspaces saved before folders existed.
  doc.folders ??= {};
  return doc;
}

/** Writes any pending change now (the desktop apps call this before quitting). */
export async function flushNow() {
  if (persistTimer !== undefined) await flush();
  await writing;
}

/**
 * Points the desktop app at another storage folder. "open" loads the workspace already in
 * that folder; "replace" writes the current boards there. The old folder's file is left
 * alone either way.
 */
export async function switchStorageFolder(folder: string | null, keep: 'open' | 'replace') {
  const storage = nativeStorage();
  if (!storage) return;
  await flushNow();
  const previous = await storage.location();
  await storage.use(folder);
  if (keep === 'replace') {
    fileBlocked = false;
    setState({ storageError: null });
    await writeFile(state.doc);
    return;
  }
  let doc: Doc;
  try {
    const text = await storage.read();
    if (text == null) throw new Error('No workspace file in that folder');
    doc = parseWorkspace(text);
  } catch (err) {
    await storage.use(previous.isDefault ? null : previous.folder);
    throw err;
  }
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
  let fileMissing = false;
  const storage = nativeStorage();
  if (storage) {
    // The file in the storage folder wins; IndexedDB is the fallback and, on the first
    // launch with folder storage, the boards that get moved into the file.
    try {
      const text = await storage.read();
      if (text == null) fileMissing = true;
      else doc = parseWorkspace(text);
    } catch (err) {
      fileBlocked = true;
      storageError = `Couldn't read the workspace file in your storage folder (${errorText(err)}). Showing the copy saved in the app; changes won't be written to that file until you choose a folder in Storage location.`;
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
  if (fileMissing) writeFile(doc);
}
