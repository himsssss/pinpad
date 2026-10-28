/**
 * What can be done to projects (boards on Home) and sidebar folders, shared by the sidebar,
 * the Projects page and their right-click menus.
 */

import { getState, mutate, openBoard, setUI } from './store';
import { current, isDraft } from 'immer';
import { cloneElements, createElement, deleteElements, maxZ, needsProject, uid } from './doc';
import type { Board, Doc, El, Renaming, SavedTemplate, TrashEntry } from './types';
import { viewportCenter } from './interactions';

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

// ---- Saved templates ----

/** A board and every board inside it. */
function boardTree(doc: Doc, rootId: string) {
  const ids = new Set([rootId]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const b of Object.values(doc.boards)) {
      if (b.parentId && ids.has(b.parentId) && !ids.has(b.id)) {
        ids.add(b.id);
        grew = true;
      }
    }
  }
  return ids;
}

/** Saves a board (with the boards inside it) as a template, named after the board. */
export function saveAsTemplate(boardId: string) {
  const { doc } = getState();
  const board = doc.boards[boardId];
  if (!board) return;
  const ids = boardTree(doc, boardId);
  const plain = <T>(v: T): T => structuredClone(v);
  const boards: Board[] = [...ids].map((id) => {
    const { folderId: _folder, updatedAt: _edited, ...rest } = plain(doc.boards[id]);
    return rest;
  });
  const template: SavedTemplate = {
    id: uid(),
    name: board.title || 'Untitled',
    createdAt: Date.now(),
    rootId: boardId,
    boards,
    elements: Object.values(doc.elements).filter((e) => ids.has(e.boardId)).map(plain),
  };
  mutate((d) => {
    d.templates = [template, ...(d.templates ?? [])];
  });
  return template.id;
}

/**
 * Copies a template's cards into a board, with new ids throughout: boards inside it become
 * new boards inside the target, and cards, columns, lines and board cards keep pointing at
 * each other. Cards placed freely on the template board move by (dx, dy).
 */
function copyTemplate(d: Doc, template: SavedTemplate, targetId: string, dx: number, dy: number) {
  const boardIds = new Map<string, string>(template.boards.filter((b) => b.id !== template.rootId).map((b) => [b.id, uid()]));
  boardIds.set(template.rootId, targetId);
  const elIds = new Map<string, string>(template.elements.map((e) => [e.id, uid()]));
  for (const b of template.boards) {
    if (b.id === template.rootId) continue;
    d.boards[boardIds.get(b.id)!] = { ...structuredClone(b), id: boardIds.get(b.id)!, parentId: boardIds.get(b.parentId ?? '') ?? targetId };
  }
  let z = maxZ(d);
  for (const src of template.elements) {
    const el = structuredClone(src);
    el.id = elIds.get(src.id)!;
    el.boardId = boardIds.get(src.boardId) ?? targetId;
    if (el.boardId === targetId && !el.columnId) {
      el.x += dx;
      el.y += dy;
      el.z = ++z;
    }
    if (el.columnId) el.columnId = elIds.get(el.columnId);
    if (el.type === 'column') el.children = el.children.map((c) => elIds.get(c)!).filter(Boolean);
    if (el.type === 'board') el.targetId = boardIds.get(el.targetId) ?? el.targetId;
    if (el.type === 'todo') el.items = el.items.map((i) => ({ ...i, id: uid() }));
    if (el.type === 'line') {
      for (const end of [el.start, el.end]) if (end.elId) end.elId = elIds.get(end.elId);
    }
    d.elements[el.id] = el;
  }
}

/** Adds a saved template's cards to the open board, centered on screen. */
export function addTemplateToBoard(templateId: string) {
  const { doc, ui } = getState();
  const template = doc.templates?.find((t) => t.id === templateId);
  if (!template || needsProject(doc, ui.boardId)) return;
  const free = template.elements.filter((e) => e.boardId === template.rootId && !e.columnId && e.type !== 'line');
  const c = viewportCenter();
  const dx = free.length ? Math.round(c.x - (Math.min(...free.map((e) => e.x)) + Math.max(...free.map((e) => e.x + e.w))) / 2) : 0;
  const dy = free.length ? Math.round(c.y - 220 - Math.min(...free.map((e) => e.y))) : 0;
  mutate((d) => copyTemplate(d, template, ui.boardId, dx, dy));
}

/**
 * Copies of projects to send to someone (shareFile.ts): a project (or any board, which
 * arrives as a project), or every project in a sidebar folder (its subfolders included),
 * each with all its boards and cards.
 */
export function projectCopies(target: { kind: 'project' | 'board' | 'folder'; id: string }): SavedTemplate[] {
  const { doc } = getState();
  const ids = target.kind !== 'folder' ? [target.id] : projectsIn(doc, new Set(folderTree(doc, target.id).map((f) => f.id))).map((b) => b.id);
  const plain = <T>(v: T): T => structuredClone(v);
  return ids.filter((id) => doc.boards[id]).map((rootId) => {
    const tree = boardTree(doc, rootId);
    return {
      id: uid(),
      name: doc.boards[rootId].title || 'Untitled',
      createdAt: Date.now(),
      rootId,
      boards: [...tree].map((id) => plain(doc.boards[id])),
      elements: Object.values(doc.elements).filter((e) => tree.has(e.boardId)).map(plain),
    };
  });
}

/**
 * Adds copies of projects someone sent (shareFile.ts) as new projects, in a folder of their
 * own when a whole folder was sent. Returns the first one's id.
 */
export function importCopies(copies: SavedTemplate[], folderName: string | null) {
  const ids: string[] = [];
  mutate((d) => {
    let folderId: string | undefined;
    if (folderName) {
      folderId = uid();
      d.folders[folderId] = { id: folderId, name: folderName, order: Math.max(0, ...Object.values(d.folders).map((f) => f.order)) + 1 };
    }
    const onHome = Object.values(d.elements).filter((e) => e.boardId === d.rootId && !e.columnId && e.type !== 'line');
    let x = onHome.length ? Math.max(...onHome.map((e) => e.x + e.w)) + 40 : 80;
    for (const copy of copies) {
      const { el, board } = createElement('board', d.rootId, x, 80, maxZ(d) + 1);
      if (!board) continue;
      const look = copy.boards.find((b) => b.id === copy.rootId);
      Object.assign(board, { title: copy.name, folderId, ...(look ? { color: look.color, icon: look.icon } : {}) });
      d.elements[el.id] = el;
      d.boards[board.id] = board;
      copyTemplate(d, copy, board.id, 0, 0);
      ids.push(board.id);
      x += 140;
    }
  });
  return { first: ids[0], count: ids.length };
}

export function deleteTemplate(templateId: string) {
  mutate((d) => {
    d.templates = (d.templates ?? []).filter((t) => t.id !== templateId);
  });
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
