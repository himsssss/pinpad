import { useState } from 'react';
import { ChevronRight, Folder, FolderPlus, Home, Plus } from 'lucide-react';
import type { Board, Doc, El } from '../types';
import { browse, mutate, openBoard, useStore } from '../store';
import { countCards, projects, uid } from '../doc';
import { BoardIcon } from './BoardIcon';
import { BOARD_MIME, fileBoard, newProject } from './Sidebar';

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

/**
 * All projects laid out like a Google Drive folder: sidebar folders as folder tiles, then
 * the projects in this folder as cards. Opened from the Projects heading in the sidebar.
 */
export function ProjectsPage({ folderId }: { folderId: string | null }) {
  const doc = useStore((s) => s.doc);
  const rootName = useStore((s) => s.storageName) ?? 'Projects';
  const [dropOn, setDropOn] = useState<string | null>(null);
  const folder = folderId ? doc.folders[folderId] : undefined;

  const subfolders = Object.values(doc.folders)
    .filter((f) => (f.parentId && doc.folders[f.parentId] ? f.parentId : null) === (folder ? folder.id : null))
    .sort((a, b) => a.order - b.order);
  const filed = (b: Board) => (b.folderId && doc.folders[b.folderId] ? b.folderId : null);
  const items = projects(doc)
    .filter((b) => filed(b) === (folder ? folder.id : null))
    .sort((a, b) => a.title.localeCompare(b.title));
  const countIn = (id: string): number =>
    projects(doc).filter((b) => b.folderId === id).length +
    Object.values(doc.folders).filter((f) => f.parentId === id).reduce((n, f) => n + countIn(f.id), 0);

  const trail = [];
  for (let f = folder; f; f = f.parentId ? doc.folders[f.parentId] : undefined) trail.unshift(f);

  const newFolder = () => {
    const id = uid();
    const order = Math.max(0, ...subfolders.map((f) => f.order)) + 1;
    mutate((d) => {
      d.folders[id] = { id, name: 'New folder', order, ...(folder ? { parentId: folder.id } : {}) };
    });
  };

  const dropTarget = (id: string) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes(BOARD_MIME)) return;
      e.preventDefault();
      setDropOn(id);
    },
    onDragLeave: () => setDropOn((cur) => (cur === id ? null : cur)),
    onDrop: (e: React.DragEvent) => {
      const board = e.dataTransfer.getData(BOARD_MIME);
      setDropOn(null);
      if (!board) return;
      e.preventDefault();
      fileBoard(board, id);
    },
  });

  return (
    <main className="projects-page" aria-label="Projects">
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
          <button className="btn-secondary" onClick={newFolder}>
            <FolderPlus size={16} /> New folder
          </button>
          <button className="btn-primary" onClick={() => newProject(folder?.id)}>
            <Plus size={16} /> New project
          </button>
        </div>
      </div>

      {!folder && doc.boards[doc.rootId] && (
        <section>
          <h2 className="projects-label">Home</h2>
          <div className="project-grid">
            <button className="project-tile" onClick={() => openBoard(doc.rootId)} title="Home">
              <Thumbnail doc={doc} board={doc.boards[doc.rootId]} />
              <span className="project-tile-info">
                <span className="home-tile-icon"><Home size={14} /></span>
                <span className="project-tile-text">
                  <span className="project-tile-name">Home</span>
                  <span className="project-tile-meta">
                    {countCards(doc, doc.rootId) === 1 ? '1 card' : `${countCards(doc, doc.rootId)} cards`}
                  </span>
                </span>
              </span>
            </button>
          </div>
        </section>
      )}

      {subfolders.length > 0 && (
        <section>
          <h2 className="projects-label">Folders</h2>
          <div className="folder-grid">
            {subfolders.map((f) => {
              const n = countIn(f.id);
              return (
                <button
                  key={f.id}
                  className={`folder-tile ${dropOn === f.id ? 'drop-over' : ''}`}
                  onClick={() => browse(f.id)}
                  title={f.name}
                  {...dropTarget(f.id)}
                >
                  <Folder size={20} className="folder-tile-icon" aria-hidden="true" />
                  <span className="folder-tile-name">{f.name}</span>
                  <span className="folder-tile-count">{n === 1 ? '1 project' : `${n} projects`}</span>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* At the top level, a list where every project is in a folder needs no empty section. */}
      {(items.length > 0 || folder || subfolders.length === 0) && (
        <section>
          <h2 className="projects-label">Projects</h2>
          {items.length ? (
            <div className="project-grid">
              {items.map((b) => {
                const n = countCards(doc, b.id);
                return (
                  <button
                    key={b.id}
                    className="project-tile"
                    onClick={() => openBoard(b.id)}
                    draggable
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
                        <span className="project-tile-name">{b.title || 'Untitled'}</span>
                        <span className="project-tile-meta">{n === 1 ? '1 card' : `${n} cards`}</span>
                      </span>
                    </span>
                  </button>
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
