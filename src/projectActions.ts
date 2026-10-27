/**
 * What can be done to projects (boards on Home) and sidebar folders, shared by the sidebar,
 * the Projects page and their right-click menus.
 */

import { getState, mutate, openBoard, setUI } from './store';
import { current, isDraft } from 'immer';
import { cloneElements, createElement, deleteElements, maxZ, uid } from './doc';
import type { Doc, El, Renaming, TrashEntry } from './types';

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

// ---- Trash ----

const TRASH_DAYS = 30;

/** A folder and every folder inside it. */
function folderTree(doc: Doc, folderId: string) {
  return Object.values(doc.folders).filter((f) => isWithin(doc, f.id, folderId));
}

/** Projects filed in any of these folders. */
const projectsIn = (doc: Doc, folderIds: Set<string>) =>
  Object.values(doc.elements)
    .filter((e) => e.type === 'board' && e.boardId === doc.rootId && doc.boards[e.targetId])
    .map((e) => doc.boards[(e as { targetId: string }).targetId])
    .filter((b) => b.folderId && folderIds.has(b.folderId));

/** What a folder holds, for the warning: its projects (including in subfolders). */
export function folderContents(folderId: string) {
  const { doc } = getState();
  const folders = folderTree(doc, folderId);
  return { folders: folders.length - 1, projects: projectsIn(doc, new Set(folders.map((f) => f.id))).length };
}

/** Moves projects (with all their boards and cards) and folders out of the workspace into the Trash. */
function toTrash(kind: TrashEntry['kind'], name: string, folderIds: string[], projectIds: string[]) {
  mutate((d) => {
    const plain = <T>(v: T): T => structuredClone(isDraft(v) ? current(v) : v);
    // Every board under the projects, and every card on them, plus the cards on Home that open them.
    const boardIds = new Set<string>();
    for (const b of Object.values(d.boards)) {
      for (let cur: string | null = b.id; cur; cur = d.boards[cur]?.parentId ?? null) {
        if (projectIds.includes(cur)) {
          boardIds.add(b.id);
          break;
        }
      }
    }
    const cards = Object.values(d.elements).filter((e) => e.type === 'board' && e.boardId === d.rootId && projectIds.includes(e.targetId));
    const elements = Object.values(d.elements).filter((e) => boardIds.has(e.boardId));
    const entry: TrashEntry = {
      id: uid(),
      kind,
      name,
      deletedAt: Date.now(),
      folders: folderIds.map((id) => plain(d.folders[id])),
      boards: [...projectIds, ...[...boardIds].filter((id) => !projectIds.includes(id))].map((id) => plain(d.boards[id])),
      elements: [...cards, ...elements].map(plain),
    };
    deleteElements(d, cards.map((c) => c.id));
    for (const id of folderIds) delete d.folders[id];
    d.trash = [entry, ...(d.trash ?? [])];
  });
}

/** Moves a folder, its subfolders and every project in them to the Trash. */
export function trashFolder(folderId: string) {
  const { doc, ui } = getState();
  const folder = doc.folders[folderId];
  if (!folder) return;
  const folders = folderTree(doc, folderId).map((f) => f.id);
  const projectIds = projectsIn(doc, new Set(folders)).map((b) => b.id);
  const parent = folder.parentId;
  toTrash('folder', folder.name, folders, projectIds);
  // Showing the deleted folder (or one inside it): go up to where it was.
  if (ui.browsing && folders.includes(ui.browsing)) setUI({ browsing: parent ?? '' });
}

/** Moves a project with all its boards and cards to the Trash. */
export function trashProject(boardId: string) {
  const { doc, ui } = getState();
  const board = doc.boards[boardId];
  if (!board || !homeCard(doc, boardId)) return;
  toTrash('project', board.title || 'Untitled', [], [boardId]);
  if (!getState().doc.boards[ui.boardId]) openBoard(getState().doc.rootId);
}

/** Puts something back where it was (at the top level if its folder is gone). */
export function restoreFromTrash(entryId: string) {
  mutate((d) => {
    const entry = d.trash?.find((t) => t.id === entryId);
    if (!entry) return;
    const restored = new Set(entry.folders.map((f) => f.id));
    for (const f of entry.folders) {
      d.folders[f.id] = { ...f };
      if (f.parentId && !d.folders[f.parentId] && !restored.has(f.parentId)) delete d.folders[f.id].parentId;
    }
    for (const b of entry.boards) {
      d.boards[b.id] = { ...b };
      if (b.folderId && !d.folders[b.folderId]) delete d.boards[b.id].folderId;
    }
    let z = maxZ(d);
    for (const el of entry.elements) d.elements[el.id] = { ...el, ...(el.boardId === d.rootId ? { z: ++z } : {}) } as El;
    d.trash = d.trash!.filter((t) => t.id !== entryId);
  });
}

/** Removes one item from the Trash for good. */
export function deleteForever(entryId: string) {
  mutate((d) => {
    d.trash = (d.trash ?? []).filter((t) => t.id !== entryId);
  });
}

export function emptyTrash() {
  mutate((d) => {
    d.trash = [];
  });
}

/** Drops Trash items older than 30 days. */
export function purgeOldTrash(doc: Doc) {
  const cutoff = Date.now() - TRASH_DAYS * 24 * 60 * 60 * 1000;
  if (doc.trash?.some((t) => t.deletedAt < cutoff)) doc.trash = doc.trash.filter((t) => t.deletedAt >= cutoff);
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
