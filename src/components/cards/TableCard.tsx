import { flushSync } from 'react-dom';
import { Plus } from 'lucide-react';
import type { TableEl } from '../../types';
import { getState, mutate, startEditing } from '../../store';
import { Editable, focusEnd } from '../Editable';

/** The cell that last had focus, so toolbar actions know which row/column to act on. */
let activeCell: { id: string; r: number; c: number } | null = null;

const cellKey = (id: string, r: number, c: number) => `${id}:${r}:${c}`;

function focusCell(id: string, r: number, c: number) {
  focusEnd(document.querySelector<HTMLElement>(`[data-item-id="${cellKey(id, r, c)}"]`));
}

function editTable(id: string, fn: (t: TableEl) => void) {
  flushSync(() => mutate((d) => fn(d.elements[id] as TableEl), 'pending'));
}

/** Row/column the toolbar should act on: the focused cell, else the last row/column. */
function target(id: string) {
  const t = getState().doc.elements[id] as TableEl;
  if (activeCell?.id === id && activeCell.r < t.cells.length && activeCell.c < t.cells[0].length) return activeCell;
  return { id, r: t.cells.length - 1, c: t.cells[0].length - 1 };
}

/**
 * Runs a structural change from the toolbar, entering edit mode first if needed. The card
 * focuses its first cell when editing starts (next frame), so focus moves after that.
 */
function fromToolbar(id: string, change: (r: number, c: number) => [number, number]) {
  const wasEditing = getState().ui.editingId === id;
  if (!wasEditing) flushSync(() => startEditing(id));
  const { r, c } = target(id);
  const [fr, fc] = change(r, c);
  if (wasEditing) focusCell(id, fr, fc);
  else requestAnimationFrame(() => focusCell(id, fr, fc));
}

export const tableOps = {
  addRow: (id: string) => fromToolbar(id, (r, c) => {
    editTable(id, (t) => { t.cells.splice(r + 1, 0, t.cells[0].map(() => '')); });
    return [r + 1, c];
  }),
  addColumn: (id: string) => fromToolbar(id, (r, c) => {
    editTable(id, (t) => { for (const row of t.cells) row.splice(c + 1, 0, ''); });
    return [r, c + 1];
  }),
  deleteRow: (id: string) => fromToolbar(id, (r, c) => {
    editTable(id, (t) => { if (t.cells.length > 1) t.cells.splice(r, 1); });
    activeCell = null;
    return [Math.max(0, r - 1), c];
  }),
  deleteColumn: (id: string) => fromToolbar(id, (r, c) => {
    editTable(id, (t) => { if (t.cells[0].length > 1) for (const row of t.cells) row.splice(c, 1); });
    activeCell = null;
    return [r, Math.max(0, c - 1)];
  }),
};

export function TableCard({ el, editing }: { el: TableEl; editing: boolean }) {
  const rows = el.cells.length;
  const cols = el.cells[0]?.length ?? 0;

  const move = (r: number, c: number, addRowIfNeeded: boolean) => {
    if (r >= rows) {
      if (!addRowIfNeeded) return;
      editTable(el.id, (t) => { t.cells.push(t.cells[0].map(() => '')); });
    }
    if (r >= 0) focusCell(el.id, r, c);
  };

  const onKeyDown = (r: number, c: number) => (e: React.KeyboardEvent) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const i = r * cols + c + (e.shiftKey ? -1 : 1);
      if (i < 0) return;
      move(Math.floor(i / cols), i % cols, true);
    } else if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      move(r + 1, c, true);
    } else if (e.key === 'ArrowUp' && r > 0 && !e.shiftKey) {
      e.preventDefault();
      move(r - 1, c, false);
    } else if (e.key === 'ArrowDown' && !e.shiftKey) {
      e.preventDefault();
      move(r + 1, c, false);
    }
  };

  return (
    <div className={`card-body table ${el.header ? 'has-header' : ''}`}>
      <table>
        <colgroup>
          {el.cells[0]?.map((_, c) => <col key={c} style={{ width: `${100 / cols}%` }} />)}
        </colgroup>
        <tbody>
          {el.cells.map((row, r) => (
            <tr key={r}>
              {row.map((cell, c) => (
                <td key={c}>
                  <Editable
                    dataId={cellKey(el.id, r, c)}
                    value={cell}
                    editing={editing}
                    onFocus={() => { activeCell = { id: el.id, r, c }; }}
                    onKeyDown={onKeyDown(r, c)}
                    onChange={(text) => mutate((d) => { (d.elements[el.id] as TableEl).cells[r][c] = text; }, 'pending')}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {editing && (
        <>
          <button className="table-add col" data-nodrag aria-label="Add column" onClick={() => tableOps.addColumn(el.id)}>
            <Plus size={12} />
          </button>
          <button className="table-add row" data-nodrag aria-label="Add row" onClick={() => tableOps.addRow(el.id)}>
            <Plus size={12} />
          </button>
        </>
      )}
    </div>
  );
}
