import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  AlignCenterHorizontal, AlignCenterVertical, AlignEndHorizontal, AlignEndVertical, AlignHorizontalDistributeCenter,
  AlignStartHorizontal, AlignStartVertical, AlignVerticalDistributeCenter, ArrowDownToLine, ArrowUpToLine, Copy,
  FolderOpen, LayoutTemplate, Pencil, Trash2, type LucideIcon,
} from 'lucide-react';
import { saveAsTemplate } from '../projectActions';
import { worldRect } from '../interactions';
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

type Edge = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom';

/** The selected cards on the board itself (not lines, not cards inside columns), with their boxes. */
function selectedBoxes() {
  const { doc, ui } = getState();
  return ui.selection
    .map((id) => doc.elements[id])
    .filter((el) => el && el.type !== 'line' && !el.columnId)
    .map((el) => ({ id: el.id, box: worldRect(el.id) }))
    .filter((c): c is { id: string; box: NonNullable<ReturnType<typeof worldRect>> } => !!c.box);
}

/** Lines up the selected cards on one edge or center of the group. */
function align(edge: Edge) {
  const cards = selectedBoxes();
  if (cards.length < 2) return;
  const left = Math.min(...cards.map((c) => c.box.x));
  const right = Math.max(...cards.map((c) => c.box.x + c.box.w));
  const top = Math.min(...cards.map((c) => c.box.y));
  const bottom = Math.max(...cards.map((c) => c.box.y + c.box.h));
  mutate((d) => {
    for (const { id, box } of cards) {
      const el = d.elements[id];
      if (edge === 'left') el.x = Math.round(left);
      if (edge === 'hcenter') el.x = Math.round((left + right) / 2 - box.w / 2);
      if (edge === 'right') el.x = Math.round(right - box.w);
      if (edge === 'top') el.y = Math.round(top);
      if (edge === 'vcenter') el.y = Math.round((top + bottom) / 2 - box.h / 2);
      if (edge === 'bottom') el.y = Math.round(bottom - box.h);
    }
  });
}

/** Spaces the selected cards evenly between the outermost two, keeping their order. */
function distribute(axis: 'x' | 'y') {
  const cards = selectedBoxes();
  if (cards.length < 3) return;
  const size = (c: (typeof cards)[number]) => (axis === 'x' ? c.box.w : c.box.h);
  cards.sort((a, b) => a.box[axis] - b.box[axis]);
  const start = cards[0].box[axis];
  const end = cards[cards.length - 1].box[axis] + size(cards[cards.length - 1]);
  const gap = (end - start - cards.reduce((n, c) => n + size(c), 0)) / (cards.length - 1);
  let at = start;
  mutate((d) => {
    for (const c of cards) {
      d.elements[c.id][axis] = Math.round(at);
      at += size(c) + gap;
    }
  });
}

const ALIGN: [Edge, LucideIcon, string][] = [
  ['left', AlignStartVertical, 'Align left'],
  ['hcenter', AlignCenterVertical, 'Align centers horizontally'],
  ['right', AlignEndVertical, 'Align right'],
  ['top', AlignStartHorizontal, 'Align top'],
  ['vcenter', AlignCenterHorizontal, 'Align centers vertically'],
  ['bottom', AlignEndHorizontal, 'Align bottom'],
];

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
  const placeable = selected.filter((el) => el.type !== 'line' && !el.columnId).length;
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
      {single?.type === 'board' && (
        <button role="menuitem" onClick={run(() => saveAsTemplate(single.targetId))}><LayoutTemplate size={14} /> Save as template</button>
      )}
      {placeable >= 2 && (
        <>
          <div className="menu-sep" />
          <div className="menu-icons" role="group" aria-label="Align">
            {ALIGN.map(([edge, Icon, label]) => (
              <button key={edge} role="menuitem" aria-label={label} title={label} onClick={run(() => align(edge))}>
                <Icon size={16} />
              </button>
            ))}
          </div>
          {placeable >= 3 && (
            <div className="menu-icons" role="group" aria-label="Spread evenly">
              <button role="menuitem" title="Spread evenly across" aria-label="Spread evenly across" onClick={run(() => distribute('x'))}>
                <AlignHorizontalDistributeCenter size={16} /> <span>Spread across</span>
              </button>
              <button role="menuitem" title="Spread evenly down" aria-label="Spread evenly down" onClick={run(() => distribute('y'))}>
                <AlignVerticalDistributeCenter size={16} /> <span>Spread down</span>
              </button>
            </div>
          )}
          <div className="menu-sep" />
        </>
      )}
      <button role="menuitem" onClick={run(() => restack(true))}><ArrowUpToLine size={14} /> Bring to front</button>
      <button role="menuitem" onClick={run(() => restack(false))}><ArrowDownToLine size={14} /> Send to back</button>
      <div className="menu-sep" />
      <button role="menuitem" className="danger" onClick={run(deleteSelection)}>
        <Trash2 size={14} /> Delete{selected.length > 1 ? ` ${selected.length} cards` : ''} <kbd className="menu-kbd">Del</kbd>
      </button>
    </div>
  );
}
