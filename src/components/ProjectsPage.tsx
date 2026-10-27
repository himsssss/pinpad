import { useState } from 'react';
import { ArrowDown, ArrowUp, ChevronRight, Folder, FolderPlus, LayoutGrid, List, Plus } from 'lucide-react';
import type { Board, Doc, El } from '../types';
import { browse, openBoard, setUI, useStore } from '../store';
import { countCards, projects } from '../doc';
import { BoardIcon } from './BoardIcon';
import { BOARD_MIME, FOLDER_MIME, createFolder, fileBoard, moveFolder, newProject, renameFolder, renameProject } from '../projectActions';
import { folderMenu, openContextMenu, placeMenu, projectMenu } from './ContextMenu';
import { RenameInput } from './Sidebar';

/** Rough on-board height of a card, for the thumbnails (cards size their own height). */
function cardHeight(el: El) {
  if (el.type === 'board') return 120;
  if (el.type === 'image') return el.w * 0.66;
  if (el.type === 'drawing') return (el.w * el.vh) / el.vw;
  if (el.type === 'column') return 80 + el.children.length * 70;
  if (el.type === 'todo') return 60 + el.items.length * 28;
  return 90;
}

/** A miniature of the board's cards, like a file thumbnail in Google Drive. */
function Thumbnail({ doc, board }: { doc: Doc; board: Board }) {
  const cards = Object.values(doc.elements).filter((el) => el.boardId === board.id && !el.columnId && el.type !== 'line');
  if (!cards.length) {
    return (
      <div className="thumb empty">
        <BoardIcon icon={board.icon} color={board.color} size={44} />
      </div>
    );
  }
  const boxes = cards.map((el) => ({ el, h: cardHeight(el) }));
  const minX = Math.min(...boxes.map((b) => b.el.x));
  const minY = Math.min(...boxes.map((b) => b.el.y));
  const maxX = Math.max(...boxes.map((b) => b.el.x + b.el.w));
  const maxY = Math.max(...boxes.map((b) => b.el.y + b.h));
  // At least a screenful of board, so a lone card doesn't fill the whole thumbnail.
  const w = Math.max(maxX - minX + 80, 800);
  const h = Math.max(maxY - minY + 80, 500);
  const view = `${(minX + maxX - w) / 2} ${(minY + maxY - h) / 2} ${w} ${h}`;
  return (
    <div className="thumb">
      <svg viewBox={view} preserveAspectRatio="xMidYMid meet" aria-hidden="true">
        {boxes.map(({ el, h: height }) => (
          <rect
            key={el.id}
            className={`thumb-card ${el.type}`}
            x={el.x}
            y={el.y}
            width={el.w}
            height={height}
            rx={el.type === 'board' ? 24 : 10}
            style={{ fill: el.type === 'board' ? doc.boards[el.targetId]?.color : el.color }}
          />
        ))}
      </svg>
    </div>
  );
}

/** "Last edited" the way Google Drive writes it: a time today, then dates. */
function edited(t: number | undefined) {
  if (!t) return '—';
  const d = new Date(t);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (d.toDateString() === new Date(now.getTime() - 86_400_000).toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) });
}

/**
 * All projects laid out like a Google Drive folder: sidebar folders as folder tiles, then
 * the projects in this folder as cards. Opened from the Projects heading in the sidebar.
 */
export function ProjectsPage({ folderId }: { folderId: string | null }) {
  const doc = useStore((s) => s.doc);
  const rootName = useStore((s) => s.storageName) ?? 'Projects';
  const renaming = useStore((s) => (s.ui.renaming?.where === 'page' ? s.ui.renaming.id : null));
  const view = useStore((s) => s.ui.projectsView);
  const sort = useStore((s) => s.ui.projectsSort);
  const [dropOn, setDropOn] = useState<string | null>(null);
  const folder = folderId ? doc.folders[folderId] : undefined;

  const allProjects = projects(doc);
  const countIn = (id: string): number =>
    allProjects.filter((b) => b.folderId === id).length +
    Object.values(doc.folders).filter((f) => f.parentId === id).reduce((n, f) => n + countIn(f.id), 0);

  /** A board's last edit, counting every board inside it. */
  const boardEdited = (id: string): number =>
    Math.max(doc.boards[id]?.updatedAt ?? 0, ...Object.values(doc.boards).filter((b) => b.parentId === id).map((b) => boardEdited(b.id)));
  /** A folder's last edit: its most recently edited project, in it or its subfolders. */
  const folderEdited = (id: string): number =>
    Math.max(0, ...allProjects.filter((b) => b.folderId === id).map((b) => boardEdited(b.id)),
      ...Object.values(doc.folders).filter((f) => f.parentId === id).map((f) => folderEdited(f.id)));

  // Like Drive: folders first, each group in the chosen order.
  const order = <T,>(list: T[], name: (x: T) => string, time: (x: T) => number) =>
    [...list].sort((a, b) => {
      const c = sort.by === 'name' ? name(a).localeCompare(name(b), undefined, { numeric: true }) : time(a) - time(b);
      return sort.desc ? -c : c;
    });
  const subfolders = order(
    Object.values(doc.folders).filter((f) => (f.parentId && doc.folders[f.parentId] ? f.parentId : null) === (folder ? folder.id : null)),
    (f) => f.name,
    (f) => folderEdited(f.id),
  );
  const filed = (b: Board) => (b.folderId && doc.folders[b.folderId] ? b.folderId : null);
  const items = order(
    allProjects.filter((b) => filed(b) === (folder ? folder.id : null)),
    (b) => b.title,
    (b) => boardEdited(b.id),
  );
  const setSort = (by: 'name' | 'edited') =>
    // Clicking the current column flips the order; a new column starts A–Z or newest first.
    setUI({ projectsSort: sort.by === by ? { by, desc: !sort.desc } : { by, desc: by === 'edited' } });

  const trail = [];
  for (let f = folder; f; f = f.parentId ? doc.folders[f.parentId] : undefined) trail.unshift(f);

  /** Projects and folders dragged onto a folder tile or a folder in the path move into it. */
  const dropTarget = (id: string) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes(BOARD_MIME) && !e.dataTransfer.types.includes(FOLDER_MIME)) return;
      e.preventDefault();
      setDropOn(id);
    },
    onDragLeave: () => setDropOn((cur) => (cur === id ? null : cur)),
    onDrop: (e: React.DragEvent) => {
      const board = e.dataTransfer.getData(BOARD_MIME);
      const moved = e.dataTransfer.getData(FOLDER_MIME);
      setDropOn(null);
      if (!board && !moved) return;
      e.preventDefault();
      if (board) fileBoard(board, id);
      if (moved && moved !== id) moveFolder(moved, id || undefined);
    },
  });

  return (
    <main
      className="projects-page"
      aria-label="Projects"
      onContextMenu={(e) => !(e.target as Element).closest('.folder-tile, .project-tile, .list-row') && openContextMenu(e, placeMenu(folder?.id, 'page'))}
    >
      <div className="projects-head">
        <nav className="projects-trail" aria-label="Folder path">
          <button onClick={() => browse(null)} {...(folder ? dropTarget('') : {})} className={dropOn === '' ? 'drop-over' : ''}>
            {rootName}
          </button>
          {trail.map((f, i) => (
            <span key={f.id} className="projects-crumb">
              <ChevronRight size={18} aria-hidden="true" />
              {i === trail.length - 1 ? (
                <span className="projects-current">{f.name}</span>
              ) : (
                <button onClick={() => browse(f.id)} {...dropTarget(f.id)} className={dropOn === f.id ? 'drop-over' : ''}>
                  {f.name}
                </button>
              )}
            </span>
          ))}
        </nav>
        <div className="projects-actions">
          <button className="btn-secondary" onClick={() => createFolder(folder?.id, 'page')}>
            <FolderPlus size={16} /> New folder
          </button>
          <button className="btn-primary" onClick={() => newProject(folder?.id)}>
            <Plus size={16} /> New project
          </button>
        </div>
      </div>

      <div className="projects-tools">
        <label className="sort-by">
          Sort by
          <select value={sort.by} onChange={(e) => setSort(e.target.value as 'name' | 'edited')}>
            <option value="name">Name</option>
            <option value="edited">Last edited</option>
          </select>
        </label>
        <button
          className="icon-btn"
          onClick={() => setUI({ projectsSort: { ...sort, desc: !sort.desc } })}
          aria-label={sort.desc ? 'Sort ascending' : 'Sort descending'}
          title={sort.by === 'name' ? (sort.desc ? 'Z to A' : 'A to Z') : sort.desc ? 'Newest first' : 'Oldest first'}
        >
          {sort.desc ? <ArrowDown size={16} /> : <ArrowUp size={16} />}
        </button>
        <div className="view-switch" role="group" aria-label="View">
          <button aria-pressed={view === 'grid'} onClick={() => setUI({ projectsView: 'grid' })} title="Grid view" aria-label="Grid view">
            <LayoutGrid size={16} />
          </button>
          <button aria-pressed={view === 'list'} onClick={() => setUI({ projectsView: 'list' })} title="List view" aria-label="List view">
            <List size={16} />
          </button>
        </div>
      </div>

      {view === 'list' && (
        <div className="file-list" role="table" aria-label="Folders and projects">
          <div className="list-head" role="row">
            <button role="columnheader" onClick={() => setSort('name')} aria-sort={sort.by === 'name' ? (sort.desc ? 'descending' : 'ascending') : 'none'}>
              Name {sort.by === 'name' && (sort.desc ? <ArrowDown size={13} /> : <ArrowUp size={13} />)}
            </button>
            <span role="columnheader">Type</span>
            <span role="columnheader">Contents</span>
            <button role="columnheader" onClick={() => setSort('edited')} aria-sort={sort.by === 'edited' ? (sort.desc ? 'descending' : 'ascending') : 'none'}>
              Last edited {sort.by === 'edited' && (sort.desc ? <ArrowDown size={13} /> : <ArrowUp size={13} />)}
            </button>
          </div>
          {subfolders.map((f) => {
            const n = countIn(f.id);
            return (
              <div
                key={f.id}
                role="row"
                className={`list-row ${dropOn === f.id ? 'drop-over' : ''}`}
                onClick={() => renaming !== f.id && browse(f.id)}
                onContextMenu={(e) => openContextMenu(e, folderMenu(f.id, 'page'))}
                draggable={renaming !== f.id}
                onDragStart={(e) => {
                  e.dataTransfer.setData(FOLDER_MIME, f.id);
                  e.dataTransfer.effectAllowed = 'move';
                }}
                onDragEnd={() => setDropOn(null)}
                {...dropTarget(f.id)}
              >
                <span className="list-name">
                  <Folder size={18} className="folder-tile-icon" aria-hidden="true" />
                  {renaming === f.id ? <RenameInput value={f.name} label="Folder name" onCommit={(v) => renameFolder(f.id, v)} /> : f.name}
                </span>
                <span>Folder</span>
                <span>{n === 1 ? '1 project' : `${n} projects`}</span>
                <span>{edited(folderEdited(f.id))}</span>
              </div>
            );
          })}
          {items.map((b) => {
            const n = countCards(doc, b.id);
            return (
              <div
                key={b.id}
                role="row"
                className="list-row"
                onClick={() => renaming !== b.id && openBoard(b.id)}
                onContextMenu={(e) => openContextMenu(e, projectMenu(b.id, 'page'))}
                draggable={renaming !== b.id}
                onDragStart={(e) => {
                  e.dataTransfer.setData(BOARD_MIME, b.id);
                  e.dataTransfer.effectAllowed = 'move';
                }}
                onDragEnd={() => setDropOn(null)}
              >
                <span className="list-name">
                  <BoardIcon icon={b.icon} color={b.color} size={22} />
                  {renaming === b.id ? <RenameInput value={b.title} label="Project name" onCommit={(v) => renameProject(b.id, v)} /> : b.title || 'Untitled'}
                </span>
                <span>Project</span>
                <span>{n === 1 ? '1 card' : `${n} cards`}</span>
                <span>{edited(boardEdited(b.id))}</span>
              </div>
            );
          })}
          {!subfolders.length && !items.length && folder && (
            <p className="projects-empty list-empty">No projects in this folder yet. Drag one here, or create a new one.</p>
          )}
        </div>
      )}

      {view === 'grid' && subfolders.length > 0 && (
        <section>
          <h2 className="projects-label">Folders</h2>
          <div className="folder-grid">
            {subfolders.map((f) => {
              const n = countIn(f.id);
              const count = <span className="folder-tile-count">{n === 1 ? '1 project' : `${n} projects`}</span>;
              if (renaming === f.id) {
                return (
                  <div key={f.id} className="folder-tile">
                    <Folder size={20} className="folder-tile-icon" aria-hidden="true" />
                    <RenameInput value={f.name} label="Folder name" onCommit={(v) => renameFolder(f.id, v)} />
                    {count}
                  </div>
                );
              }
              return (
                <button
                  key={f.id}
                  className={`folder-tile ${dropOn === f.id ? 'drop-over' : ''}`}
                  onClick={() => browse(f.id)}
                  onContextMenu={(e) => openContextMenu(e, folderMenu(f.id, 'page'))}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData(FOLDER_MIME, f.id);
                    e.dataTransfer.effectAllowed = 'move';
                  }}
                  onDragEnd={() => setDropOn(null)}
                  title={f.name}
                  {...dropTarget(f.id)}
                >
                  <Folder size={20} className="folder-tile-icon" aria-hidden="true" />
                  <span className="folder-tile-name">{f.name}</span>
                  {count}
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* At the top level, a list where every project is in a folder needs no empty section. */}
      {view === 'grid' && (items.length > 0 || folder || subfolders.length === 0) && (
        <section>
          <h2 className="projects-label">Projects</h2>
          {items.length ? (
            <div className="project-grid">
              {items.map((b) => {
                const n = countCards(doc, b.id);
                // While its name is edited the card isn't a button, so typing goes to the name.
                const Tile = renaming === b.id ? 'div' : 'button';
                return (
                  <Tile
                    key={b.id}
                    className="project-tile"
                    onClick={() => renaming !== b.id && openBoard(b.id)}
                    onContextMenu={(e) => openContextMenu(e, projectMenu(b.id, 'page'))}
                    draggable={renaming !== b.id}
                    onDragStart={(e) => {
                      e.dataTransfer.setData(BOARD_MIME, b.id);
                      e.dataTransfer.effectAllowed = 'move';
                    }}
                    onDragEnd={() => setDropOn(null)}
                    title={b.title}
                  >
                    <Thumbnail doc={doc} board={b} />
                    <span className="project-tile-info">
                      <BoardIcon icon={b.icon} color={b.color} size={22} />
                      <span className="project-tile-text">
                        {renaming === b.id ? (
                          <RenameInput value={b.title} label="Project name" onCommit={(v) => renameProject(b.id, v)} />
                        ) : (
                          <span className="project-tile-name">{b.title || 'Untitled'}</span>
                        )}
                        <span className="project-tile-meta">{n === 1 ? '1 card' : `${n} cards`}</span>
                      </span>
                    </span>
                  </Tile>
                );
              })}
            </div>
          ) : (
            <p className="projects-empty">
              {folder ? 'No projects in this folder yet. Drag one here, or create a new one.' : 'No projects yet.'}
            </p>
          )}
        </section>
      )}
    </main>
  );
}
