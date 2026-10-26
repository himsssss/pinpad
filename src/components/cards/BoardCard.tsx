import type { BoardEl } from '../../types';
import { mutate, useStore } from '../../store';
import { countCards } from '../../doc';
import { BoardIcon } from '../BoardIcon';
import { Editable } from '../Editable';
import { ConnectHandle } from '../ConnectHandle';

export function BoardCard({ el, editing, selected }: { el: BoardEl; editing: boolean; selected: boolean }) {
  const board = useStore((s) => s.doc.boards[el.targetId]);
  const count = useStore((s) => countCards(s.doc, el.targetId));
  if (!board) return null;
  return (
    <div className="card-body board-card">
      <div className={`board-icon-wrap ${selected ? 'selected' : ''}`}>
        <BoardIcon icon={board.icon} color={board.color} />
        {!editing && <ConnectHandle id={el.id} />}
      </div>
      <Editable
        className="board-title"
        value={board.title}
        editing={editing}
        placeholder="Untitled"
        onEnter={() => (document.activeElement as HTMLElement | null)?.blur()}
        onChange={(title) => mutate((d) => { d.boards[el.targetId].title = title; }, 'pending')}
      />
      <div className="board-count">{count === 1 ? '1 card' : `${count} cards`}</div>
    </div>
  );
}
