import { useSyncExternalStore } from 'react';
import { produce, type Draft } from 'immer';
import type { Doc, UI, View } from './types';
import { load, save } from './persist';
import { deleteElements, seedDoc } from './doc';

export interface State {
  doc: Doc;
  ui: UI;
  canUndo: boolean;
  canRedo: boolean;
  saved: boolean;
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
  if ('views' in p || 'boardId' in p) saveUI();
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

export const DEFAULT_VIEW: View = { x: 0, y: 0, zoom: 1 };

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
  setUI({ boardId, selection: [], editingId: null, editPoint: null, dropTarget: null, draw: null });
}

// ---- persistence ----
// The document (which can hold images) lives in IndexedDB; the small view state goes to
// localStorage synchronously so a reload always reopens the board you were on.

const UI_KEY = 'milanote-clone:ui';
let persistTimer: number | undefined;

function saveUI() {
  try {
    localStorage.setItem(UI_KEY, JSON.stringify({ boardId: state.ui.boardId, views: state.ui.views }));
  } catch {
    // Storage can be unavailable (private mode); the board still works.
  }
}

function loadUI(): Pick<UI, 'boardId' | 'views'> | undefined {
  try {
    return JSON.parse(localStorage.getItem(UI_KEY) ?? 'null') ?? undefined;
  } catch {
    return undefined;
  }
}

async function flush() {
  clearTimeout(persistTimer);
  persistTimer = undefined;
  await save('doc', state.doc);
  if (persistTimer === undefined) setState({ saved: true });
}

function schedulePersist() {
  clearTimeout(persistTimer);
  persistTimer = window.setTimeout(flush, 300);
}

export async function initStore() {
  let doc = await load<Doc>('doc').catch(() => undefined);
  const savedUI = loadUI();
  const flushPending = () => persistTimer !== undefined && flush();
  window.addEventListener('pagehide', flushPending);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && flushPending());
  if (!doc?.boards?.[doc.rootId]) doc = seedDoc();
  const boardId = savedUI && doc.boards[savedUI.boardId] ? savedUI.boardId : doc.rootId;
  state = {
    doc,
    ui: {
      boardId,
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
  };
  save('doc', doc);
}
