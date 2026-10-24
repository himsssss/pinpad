import { useState } from 'react';
import { ChevronDown, ChevronRight, Folder, FolderOpen, FolderPlus, Home, Plus, Trash2 } from 'lucide-react';
import type { Board } from '../types';
import { getState, mutate, openBoard, useStore } from '../store';
import { boardPath, createElement, maxZ, projects, uid } from '../doc';
import { BoardIcon } from './BoardIcon';

const BOARD_MIME = 'application/x-milanote-board';

/** Adds a board to Home (right of everything already there), files it, and opens it. */
function newProject(folderId?: string) {
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

function fileBoard(boardId: string, folderId: string) {
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

  if (!open) return null;

  const openPath = new Set(boardPath(doc, boardId).map((b) => b.id));
  const folders = Object.values(doc.folders).sort((a, b) => a.order - b.order);
  const byTitle = (a: Board, b: Board) => a.title.localeCompare(b.title);
  const inFolder = (folderId: string) => Object.values(doc.boards).filter((b) => b.folderId === folderId).sort(byTitle);
  const unfiled = projects(doc).filter((b) => !b.folderId || !doc.folders[b.folderId]);

  /** Drop-target props shared by canvas drags (data-drop-*) and sidebar drags (HTML5). */
  const dropZone = (folderId: string) => ({
    'data-drop-kind': 'folder',
    'data-drop-id': folderId,
    onDragOver: (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes(BOARD_MIME)) return;
      e.preventDefault();
      setHtmlDrop(folderId);
    },
    onDragLeave: () => setHtmlDrop((cur) => (cur === folderId ? null : cur)),
    onDrop: (e: React.DragEvent) => {
      const id = e.dataTransfer.getData(BOARD_MIME);
      setHtmlDrop(null);
      if (!id) return;
      e.preventDefault();
      fileBoard(id, folderId);
    },
  });
  const isDropping = (folderId: string) => canvasDrop === folderId || htmlDrop === folderId;

  const projectRow = (b: Board) => (
    <button
      key={b.id}
      className={`project-row ${b.id === boardId ? 'current' : openPath.has(b.id) ? 'in-path' : ''}`}
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

  return (
    <nav className="sidebar" aria-label="Folders and projects">
      <button className={`project-row home ${boardId === doc.rootId ? 'current' : ''}`} onClick={() => openBoard(doc.rootId)}>
        <span className="sidebar-icon"><Home size={15} /></span>
        <span className="project-name">Home</span>
      </button>

      <div className="sidebar-section">
        <div className="sidebar-heading">
          <span>Folders</span>
          <button
            aria-label="New folder"
            title="New folder"
            onClick={() => {
              const id = uid();
              const order = Math.max(0, ...folders.map((f) => f.order)) + 1;
              mutate((d) => { d.folders[id] = { id, name: 'New folder', order }; });
              setRenaming(id);
            }}
          >
            <FolderPlus size={14} />
          </button>
        </div>
        {folders.length === 0 && <p className="sidebar-empty">Create a folder to group your projects.</p>}
        {folders.map((f) => {
          const items = inFolder(f.id);
          return (
            <div key={f.id} className="folder">
              <div className={`folder-row ${isDropping(f.id) ? 'drop-over' : ''}`} {...dropZone(f.id)}>
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
                  <span className="folder-name" onDoubleClick={() => setRenaming(f.id)} title="Double-click to rename">
                    {f.name}
                  </span>
                )}
                <span className="folder-count">{items.length}</span>
                <span className="row-actions">
                  <button aria-label={`New project in ${f.name}`} title="New project" onClick={() => newProject(f.id)}>
                    <Plus size={13} />
                  </button>
                  <button
                    aria-label={`Delete folder ${f.name}`}
                    title="Delete folder (projects are kept)"
                    onClick={() => mutate((d) => {
                      delete d.folders[f.id];
                      for (const b of Object.values(d.boards)) if (b.folderId === f.id) b.folderId = undefined;
                    })}
                  >
                    <Trash2 size={13} />
                  </button>
                </span>
              </div>
              {!f.collapsed && (
                <div className="folder-items">
                  {items.map(projectRow)}
                  {items.length === 0 && <p className="sidebar-empty">Drag projects here</p>}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="sidebar-section">
        <div className={`sidebar-heading ${isDropping('') ? 'drop-over' : ''}`} {...dropZone('')}>
          <span>Projects</span>
          <button aria-label="New project" title="New project" onClick={() => newProject()}>
            <Plus size={14} />
          </button>
        </div>
        {unfiled.map(projectRow)}
        {unfiled.length === 0 && <p className="sidebar-empty">Every project is in a folder.</p>}
      </div>
    </nav>
  );
}
