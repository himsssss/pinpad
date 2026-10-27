import { useState } from 'react';
import { ChevronDown, ChevronRight, ChevronsLeft, Folder, FolderOpen, FolderPlus, Home, Plus, Trash2 } from 'lucide-react';
import type { Board } from '../types';
import { browse, getState, mutate, openBoard, setUI, useStore } from '../store';
import { boardPath, createElement, maxZ, projects, uid } from '../doc';
import { BoardIcon } from './BoardIcon';
import { MOD } from '../shortcuts';

export const BOARD_MIME = 'application/x-pinpad-board';
const FOLDER_MIME = 'application/x-pinpad-folder';

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

export function fileBoard(boardId: string, folderId: string) {
  mutate((d) => {
    if (d.boards[boardId]) d.boards[boardId].folderId = folderId || undefined;
  });
}

export function Sidebar() {
  const open = useStore((s) => s.ui.sidebarOpen);
  const doc = useStore((s) => s.doc);
  const boardId = useStore((s) => s.ui.boardId);
  const canvasDrop = useStore((s) => (s.ui.dropTarget?.kind === 'folder' ? s.ui.dropTarget.id : null));
  const [renaming, setRenaming] = useState<string | null>(null);
  const [htmlDrop, setHtmlDrop] = useState<string | null>(null);
  const collapsedSections = useStore((s) => s.ui.collapsedSections);
  const browsing = useStore((s) => s.ui.browsing);

  if (!open) return null;

  const isCollapsed = (section: string) => collapsedSections.includes(section);
  const toggleSection = (section: string) =>
    setUI((u) => ({
      collapsedSections: u.collapsedSections.includes(section)
        ? u.collapsedSections.filter((x) => x !== section)
        : [...u.collapsedSections, section],
    }));
  // The arrow folds the list; the label opens the Projects page.
  const sectionToggle = (section: string, label: string, count: number) => (
    <span className="section-toggle">
      <button
        className="section-arrow"
        aria-expanded={!isCollapsed(section)}
        aria-label={isCollapsed(section) ? `Expand ${label}` : `Collapse ${label}`}
        onClick={() => toggleSection(section)}
      >
        {isCollapsed(section) ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
      </button>
      <button className={`section-label ${browsing === '' ? 'current' : ''}`} onClick={() => browse(null)} title={`Show all ${label.toLowerCase()}`}>
        {label}
      </button>
      {isCollapsed(section) && count > 0 && <span className="section-count">{count}</span>}
    </span>
  );

  const openPath = new Set(boardPath(doc, boardId).map((b) => b.id));
  const allFolders = Object.values(doc.folders);
  const childFolders = (parentId?: string) =>
    allFolders
      .filter((f) => (f.parentId && doc.folders[f.parentId] ? f.parentId : undefined) === parentId)
      .sort((a, b) => a.order - b.order);
  const topFolders = childFolders(undefined);
  const byTitle = (a: Board, b: Board) => a.title.localeCompare(b.title);
  const inFolder = (folderId: string) => Object.values(doc.boards).filter((b) => b.folderId === folderId).sort(byTitle);
  /** Projects in a folder and all of its subfolders. */
  const totalIn = (folderId: string): number =>
    inFolder(folderId).length + childFolders(folderId).reduce((n, f) => n + totalIn(f.id), 0);
  const unfiled = projects(doc).filter((b) => !b.folderId || !doc.folders[b.folderId]);

  /** True if `folderId` is `ancestorId` or sits somewhere inside it. */
  const isWithin = (folderId: string | undefined, ancestorId: string) => {
    for (let id = folderId; id; id = doc.folders[id]?.parentId) if (id === ancestorId) return true;
    return false;
  };

  const createFolder = (parentId?: string) => {
    const id = uid();
    const order = Math.max(0, ...childFolders(parentId).map((f) => f.order)) + 1;
    mutate((d) => {
      d.folders[id] = { id, name: parentId ? 'New subfolder' : 'New folder', order, parentId };
      if (parentId) d.folders[parentId].collapsed = false;
    });
    if (isCollapsed('folders')) toggleSection('folders');
    setRenaming(id);
  };

  const moveFolder = (folderId: string, parentId?: string) => {
    if (parentId && isWithin(parentId, folderId)) return; // can't nest a folder inside itself
    const order = Math.max(0, ...childFolders(parentId).map((f) => f.order)) + 1;
    mutate((d) => {
      d.folders[folderId].parentId = parentId;
      d.folders[folderId].order = order;
      if (parentId) d.folders[parentId].collapsed = false;
    });
  };

  /**
   * Drop-target props shared by canvas drags (data-drop-*) and sidebar drags (HTML5).
   * `folderId` is the folder to file into; '' means "no folder".
   */
  const dropZone = (folderId: string, accepts: { boards: boolean; folders: boolean }, key = folderId) => ({
    ...(accepts.boards ? { 'data-drop-kind': 'folder', 'data-drop-id': folderId } : {}),
    onDragOver: (e: React.DragEvent) => {
      const types = e.dataTransfer.types;
      if (!(accepts.boards && types.includes(BOARD_MIME)) && !(accepts.folders && types.includes(FOLDER_MIME))) return;
      e.preventDefault();
      e.stopPropagation();
      setHtmlDrop(key);
    },
    onDragLeave: () => setHtmlDrop((cur) => (cur === key ? null : cur)),
    onDrop: (e: React.DragEvent) => {
      const board = accepts.boards && e.dataTransfer.getData(BOARD_MIME);
      const folder = accepts.folders && e.dataTransfer.getData(FOLDER_MIME);
      setHtmlDrop(null);
      if (!board && !folder) return;
      e.preventDefault();
      e.stopPropagation();
      if (board) fileBoard(board, folderId);
      if (folder && folder !== folderId) moveFolder(folder, folderId || undefined);
    },
  });
  const isDropping = (key: string) => canvasDrop === key || htmlDrop === key;

  const projectRow = (b: Board) => (
    <button
      key={b.id}
      className={`project-row ${browsing === null && b.id === boardId ? 'current' : browsing === null && openPath.has(b.id) ? 'in-path' : ''}`}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(BOARD_MIME, b.id);
        e.dataTransfer.effectAllowed = 'move';
      }}
      onDragEnd={() => setHtmlDrop(null)}
      onClick={() => openBoard(b.id)}
      title={b.title}
    >
      <BoardIcon icon={b.icon} color={b.color} size={20} />
      <span className="project-name">{b.title || 'Untitled'}</span>
    </button>
  );

  const commitRename = (folderId: string, value: string) => {
    const name = value.trim() || 'Untitled folder';
    if (name !== doc.folders[folderId]?.name) mutate((d) => { d.folders[folderId].name = name; });
    setRenaming(null);
  };

  /** Deleting a folder moves its subfolders and projects up one level. */
  const deleteFolder = (folderId: string) =>
    mutate((d) => {
      const parentId = d.folders[folderId].parentId;
      for (const f of Object.values(d.folders)) if (f.parentId === folderId) f.parentId = parentId;
      for (const b of Object.values(d.boards)) if (b.folderId === folderId) b.folderId = parentId;
      delete d.folders[folderId];
    });

  const folderNode = (f: (typeof allFolders)[number]) => {
    const items = inFolder(f.id);
    const subfolders = childFolders(f.id);
    return (
      <div key={f.id} className="folder">
        <div
          className={`folder-row ${isDropping(f.id) ? 'drop-over' : ''} ${browsing === f.id ? 'current' : ''}`}
          draggable={renaming !== f.id}
          onDragStart={(e) => {
            e.stopPropagation();
            e.dataTransfer.setData(FOLDER_MIME, f.id);
            e.dataTransfer.effectAllowed = 'move';
          }}
          onDragEnd={() => setHtmlDrop(null)}
          {...dropZone(f.id, { boards: true, folders: true })}
        >
          <button
            className="folder-toggle"
            aria-label={f.collapsed ? 'Expand folder' : 'Collapse folder'}
            onClick={() => mutate((d) => { d.folders[f.id].collapsed = !f.collapsed; }, 'none')}
          >
            {f.collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
          </button>
          <span className="sidebar-icon">{f.collapsed ? <Folder size={15} /> : <FolderOpen size={15} />}</span>
          {renaming === f.id ? (
            <input
              className="folder-rename"
              defaultValue={f.name}
              autoFocus
              onFocus={(e) => e.currentTarget.select()}
              onBlur={(e) => commitRename(f.id, e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur();
                if (e.key === 'Escape') setRenaming(null);
              }}
              aria-label="Folder name"
            />
          ) : (
            <span className="folder-name" onClick={() => browse(f.id)} onDoubleClick={() => setRenaming(f.id)} title="Open folder · double-click to rename">
              {f.name}
            </span>
          )}
          <span className="folder-count">{totalIn(f.id)}</span>
          <span className="row-actions">
            <button aria-label={`New project in ${f.name}`} title="New project" onClick={() => newProject(f.id)}>
              <Plus size={13} />
            </button>
            <button aria-label={`New subfolder in ${f.name}`} title="New subfolder" onClick={() => createFolder(f.id)}>
              <FolderPlus size={13} />
            </button>
            <button
              aria-label={`Delete folder ${f.name}`}
              title="Delete folder (its subfolders and projects move up a level)"
              onClick={() => deleteFolder(f.id)}
            >
              <Trash2 size={13} />
            </button>
          </span>
        </div>
        {!f.collapsed && (
          <div className="folder-items">
            {subfolders.map(folderNode)}
            {items.map(projectRow)}
            {items.length === 0 && subfolders.length === 0 && <p className="sidebar-empty">Drag projects here</p>}
          </div>
        )}
      </div>
    );
  };

  return (
    <nav className="sidebar" aria-label="Folders and projects">
      <div className="sidebar-top">
        <button className={`project-row home ${browsing === null && boardId === doc.rootId ? 'current' : ''}`} onClick={() => openBoard(doc.rootId)}>
          <span className="sidebar-icon"><Home size={15} /></span>
          <span className="project-name">Home</span>
        </button>
        <button className="sidebar-collapse" aria-label="Collapse sidebar" title={`Collapse sidebar (${MOD}\\)`} onClick={() => setUI({ sidebarOpen: false })}>
          <ChevronsLeft size={15} />
        </button>
      </div>

      {/* One list: folders first, then projects that aren't in a folder. Dropping a project
          or folder anywhere outside a folder moves it to the top level. */}
      <div
        className={`sidebar-section ${isDropping('') ? 'drop-over' : ''}`}
        {...dropZone('', { boards: true, folders: true })}
      >
        <div className="sidebar-heading">
          {sectionToggle('folders', 'Projects', topFolders.length + unfiled.length)}
          <button aria-label="New project" title="New project" onClick={() => newProject()}>
            <Plus size={14} />
          </button>
          <button aria-label="New folder" title="New folder" onClick={() => createFolder()}>
            <FolderPlus size={14} />
          </button>
        </div>
        {!isCollapsed('folders') && (
          <>
            {topFolders.map(folderNode)}
            {unfiled.map(projectRow)}
            {topFolders.length === 0 && unfiled.length === 0 && (
              <p className="sidebar-empty">Create a project, or a folder to group them.</p>
            )}
          </>
        )}
      </div>
    </nav>
  );
}
