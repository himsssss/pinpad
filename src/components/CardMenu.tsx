import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowUpToLine, Copy, FolderOpen, Pencil, Trash2 } from 'lucide-react';
import { getState, mutate, openBoard, startEditing } from '../store';
import { deleteSelection, duplicateSelection } from '../actions';
import { MOD } from '../shortcuts';

let show: ((at: { x: number; y: number }) => void) | null = null;

/** Opens the card menu at a screen point, for the current selection. */
export function openCardMenu(x: number, y: number) {
  show?.({ x, y });
}

function restack(toFront: boolean) {
  const { doc, ui } = getState();
  const ids = ui.selection.filter((id) => doc.elements[id]);
  const zs = Object.values(doc.elements).filter((e) => e.boardId === ui.boardId).map((e) => e.z);
  let z = toFront ? Math.max(0, ...zs) : Math.min(0, ...zs) - ids.length;
  mutate((d) => {
    for (const id of [...ids].sort((a, b) => d.elements[a].z - d.elements[b].z)) d.elements[id].z = ++z;
  });
}

/** Right-click (or long-press) menu for the selected cards. */
export function CardMenu() {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: 0, top: 0 });

  useEffect(() => {
    show = setAt;
    return () => { show = null; };
  }, []);

  useEffect(() => {
    if (!at) return;
    const close = (e: Event) => !ref.current?.contains(e.target as Node) && setAt(null);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setAt(null);
    window.addEventListener('pointerdown', close, true);
    window.addEventListener('wheel', close, true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('blur', () => setAt(null), { once: true });
    return () => {
      window.removeEventListener('pointerdown', close, true);
      window.removeEventListener('wheel', close, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [at]);

  // Keep the menu on screen near the edges.
  useLayoutEffect(() => {
    if (!at || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    setPos({
      left: Math.max(8, Math.min(at.x, window.innerWidth - r.width - 8)),
      top: Math.max(8, Math.min(at.y, window.innerHeight - r.height - 8)),
    });
  }, [at]);

  if (!at) return null;
  const { doc, ui } = getState();
  const selected = ui.selection.map((id) => doc.elements[id]).filter(Boolean);
  if (!selected.length) return null;
  const single = selected.length === 1 ? selected[0] : null;
  const run = (fn: () => void) => () => {
    setAt(null);
    fn();
  };

  return (
    <div ref={ref} className="menu card-menu" role="menu" style={pos} onContextMenu={(e) => e.preventDefault()}>
      {single?.type === 'board' && (
        <button role="menuitem" onClick={run(() => openBoard(single.targetId))}><FolderOpen size={14} /> Open</button>
      )}
      {single && single.type !== 'line' && single.type !== 'drawing' && (
        <button role="menuitem" onClick={run(() => startEditing(single.id))}>
          <Pencil size={14} /> {single.type === 'board' ? 'Rename' : 'Edit'}
        </button>
      )}
      <button role="menuitem" onClick={run(duplicateSelection)}><Copy size={14} /> Duplicate <kbd className="menu-kbd">{MOD}D</kbd></button>
      <button role="menuitem" onClick={run(() => restack(true))}><ArrowUpToLine size={14} /> Bring to front</button>
      <button role="menuitem" onClick={run(() => restack(false))}><ArrowDownToLine size={14} /> Send to back</button>
      <div className="menu-sep" />
      <button role="menuitem" className="danger" onClick={run(deleteSelection)}>
        <Trash2 size={14} /> Delete{selected.length > 1 ? ` ${selected.length} cards` : ''} <kbd className="menu-kbd">Del</kbd>
      </button>
    </div>
  );
}
