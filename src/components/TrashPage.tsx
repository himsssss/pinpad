import { Folder, RotateCcw, Trash2 } from 'lucide-react';
import type { TrashEntry } from '../types';
import { browse, useStore } from '../store';
import { deleteForever, emptyTrash, restoreFromTrash } from '../projectActions';
import { BoardIcon } from './BoardIcon';
import { askConfirm } from './ConfirmDialog';

/** The `browsing` value that shows the Trash instead of a folder. */
export const TRASH = '#trash';

const DAY = 24 * 60 * 60 * 1000;
const NONE: TrashEntry[] = [];

function when(t: number) {
  const days = Math.floor((Date.now() - t) / DAY);
  return days === 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;
}

function details(entry: TrashEntry) {
  const projects = entry.boards.filter((b) => entry.elements.some((e) => e.type === 'board' && e.targetId === b.id && !entry.boards.some((p) => p.id === e.boardId)));
  const cards = entry.elements.filter((e) => e.type !== 'line' && !(e.type === 'board' && projects.some((p) => p.id === e.targetId))).length;
  if (entry.kind === 'folder') {
    const n = projects.length;
    return `Folder · ${n === 1 ? '1 project' : `${n} projects`}`;
  }
  return `Project · ${cards === 1 ? '1 card' : `${cards} cards`}`;
}

/** Deleted folders and projects, with Restore and Delete forever; each is kept 30 days. */
export function TrashPage() {
  const trash = useStore((s) => s.doc.trash ?? NONE);

  const forever = async (entry: TrashEntry) => {
    const ok = await askConfirm({
      title: `Delete “${entry.name}” forever?`,
      message: "You won't be able to restore it.",
      confirm: 'Delete forever',
      danger: true,
    });
    if (ok) deleteForever(entry.id);
  };

  const empty = async () => {
    const ok = await askConfirm({
      title: 'Empty the Trash?',
      message:
        trash.length === 1
          ? "The item in the Trash will be deleted forever. You won't be able to restore it."
          : `All ${trash.length} items in the Trash will be deleted forever. You won't be able to restore them.`,
      confirm: 'Empty Trash',
      danger: true,
    });
    if (ok) emptyTrash();
  };

  return (
    <main className="projects-page trash-page" aria-label="Trash">
      <div className="projects-head">
        <nav className="projects-trail" aria-label="Folder path">
          <span className="projects-current">Trash</span>
        </nav>
        {trash.length > 0 && (
          <div className="projects-actions">
            <button className="btn-secondary danger" onClick={empty}><Trash2 size={16} /> Empty Trash</button>
          </div>
        )}
      </div>
      <p className="trash-note">Deleted folders and projects stay here for 30 days, then they're deleted for good.</p>

      {trash.length === 0 ? (
        <div className="trash-empty">
          <Trash2 size={32} strokeWidth={1.5} />
          <p>The Trash is empty.</p>
          <button className="btn-secondary" onClick={() => browse(null)}>Back to projects</button>
        </div>
      ) : (
        <ul className="trash-list">
          {trash.map((entry) => {
            const left = Math.max(0, 30 - Math.floor((Date.now() - entry.deletedAt) / DAY));
            const board = entry.boards[0];
            return (
              <li key={entry.id} className="trash-item">
                <span className="trash-icon">
                  {entry.kind === 'folder' || !board ? <Folder size={20} /> : <BoardIcon icon={board.icon} color={board.color} size={28} />}
                </span>
                <span className="trash-text">
                  <span className="trash-name">{entry.name}</span>
                  <span className="trash-meta">
                    {details(entry)} · deleted {when(entry.deletedAt)} · {left === 1 ? '1 day left' : `${left} days left`}
                  </span>
                </span>
                <button className="btn-secondary" onClick={() => restoreFromTrash(entry.id)}><RotateCcw size={15} /> Restore</button>
                <button className="icon-btn danger" aria-label={`Delete ${entry.name} forever`} title="Delete forever" onClick={() => forever(entry)}>
                  <Trash2 size={17} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
