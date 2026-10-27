/**
 * What can be done to projects (boards on Home) and sidebar folders, shared by the sidebar,
 * the Projects page and their right-click menus.
 */

import { getState, mutate, openBoard, setUI } from './store';
import { cloneElements, createElement, deleteElements, maxZ, uid } from './doc';
import type { Doc, Renaming } from './types';

export const BOARD_MIME = 'application/x-pinpad-board';
export const FOLDER_MIME = 'application/x-pinpad-folder';

/** True if `folderId` is `ancestorId` or sits somewhere inside it. */
export function isWithin(doc: Doc, folderId: string | undefined, ancestorId: string) {
  for (let id = folderId; id; id = doc.folders[id]?.parentId) if (id === ancestorId) return true;
  return false;
}

const childFolders = (doc: Doc, parentId?: string) =>
  Object.values(doc.folders).filter((f) => (f.parentId && doc.folders[f.parentId] ? f.parentId : undefined) === parentId);

/** The card on Home that opens a project. */
const homeCard = (doc: Doc, boardId: string) =>
  Object.values(doc.elements).find((e) => e.type === 'board' && e.boardId === doc.rootId && e.targetId === boardId);

/** Adds a board to Home (right of everything already there), files it, and opens it. */
export function newProject(folderId?: string) {
  const { doc } = getState();
  const onHome = Object.values(doc.elements).filter((e) => e.boardId === doc.rootId && !e.columnId && e.type !== 'line');
  const x = onHome.length ? Math.max(...onHome.map((e) => e.x + e.w)) + 40 : 80;
  const { el, board } = createElement('board', doc.rootId, x, 80, maxZ(doc) + 1);
  if (!board) return;
  board.title = 'Untitled project';
  board.folderId = folderId;
  mutate((d) => {
    d.elements[el.id] = el;
    d.boards[board.id] = board;
  });
  openBoard(board.id);
  // Let the user name it straight away in the board title field.
  requestAnimationFrame(() => document.querySelector<HTMLInputElement>('.board-heading')?.select());
}

/** Files a project in a folder ('' for the top level). */
export function fileBoard(boardId: string, folderId: string) {
  mutate((d) => {
    if (d.boards[boardId]) d.boards[boardId].folderId = folderId || undefined;
  });
}

/** Adds a folder (inside `parentId`, if given) and starts renaming it where it was asked for. */
export function createFolder(parentId?: string, where: Renaming['where'] = 'sidebar') {
  const { doc } = getState();
  const id = uid();
  const order = Math.max(0, ...childFolders(doc, parentId).map((f) => f.order)) + 1;
  mutate((d) => {
    d.folders[id] = { id, name: parentId ? 'New subfolder' : 'New folder', order, ...(parentId ? { parentId } : {}) };
    if (parentId) d.folders[parentId].collapsed = false;
  });
  setUI((u) => ({ renaming: { id, where }, collapsedSections: u.collapsedSections.filter((s) => s !== 'folders') }));
  return id;
}

/** Moves a folder into another (or to the top level); never into itself. */
export function moveFolder(folderId: string, parentId?: string) {
  const { doc } = getState();
  if (parentId && isWithin(doc, parentId, folderId)) return;
  const order = Math.max(0, ...childFolders(doc, parentId).map((f) => f.order)) + 1;
  mutate((d) => {
    if (parentId) d.folders[folderId].parentId = parentId;
    else delete d.folders[folderId].parentId;
    d.folders[folderId].order = order;
    if (parentId) d.folders[parentId].collapsed = false;
  });
}

/** Deleting a folder moves its subfolders and projects up one level. */
export function deleteFolder(folderId: string) {
  const { ui } = getState();
  mutate((d) => {
    const parentId = d.folders[folderId].parentId;
    for (const f of Object.values(d.folders)) if (f.parentId === folderId) f.parentId = parentId;
    for (const b of Object.values(d.boards)) if (b.folderId === folderId) b.folderId = parentId;
    delete d.folders[folderId];
  });
  if (ui.browsing === folderId) setUI({ browsing: '' });
}

export function renameFolder(folderId: string, value: string) {
  const name = value.trim() || 'Untitled folder';
  if (name !== getState().doc.folders[folderId]?.name) mutate((d) => { d.folders[folderId].name = name; });
}

export function renameProject(boardId: string, value: string) {
  const title = value.trim() || 'Untitled';
  if (title !== getState().doc.boards[boardId]?.title) mutate((d) => { d.boards[boardId].title = title; });
}

/** Copies a project with everything in it, next to the original and in the same folder. */
export function duplicateProject(boardId: string) {
  const { doc } = getState();
  const card = homeCard(doc, boardId);
  if (!card) return;
  mutate((d) => {
    const [copyId] = cloneElements(d, [card.id], d.rootId, 40, 40);
    const copy = d.elements[copyId];
    if (copy?.type === 'board') d.boards[copy.targetId].title = `${d.boards[boardId].title || 'Untitled'} copy`;
  });
}

/** Deletes a project and everything in it, after asking (it can be undone). */
export function deleteProject(boardId: string) {
  const { doc } = getState();
  const card = homeCard(doc, boardId);
  const title = doc.boards[boardId]?.title || 'Untitled';
  if (!card || !confirm(`Delete “${title}” and everything in it? You can undo this.`)) return;
  mutate((d) => deleteElements(d, [card.id]));
}

/** Folders to offer under "Move to", indented by depth, leaving out `exclude` and its subfolders. */
export function folderChoices(exclude?: string) {
  const { doc } = getState();
  const out: { id: string; name: string; depth: number }[] = [];
  const walk = (parentId: string | undefined, depth: number) => {
    for (const f of childFolders(doc, parentId).sort((a, b) => a.order - b.order)) {
      if (f.id === exclude) continue;
      out.push({ id: f.id, name: f.name, depth });
      walk(f.id, depth + 1);
    }
  };
  walk(undefined, 0);
  return out;
}
