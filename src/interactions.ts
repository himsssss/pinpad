import { checkpoint, currentView, getState, mutate, select, setUI } from './store';
import { deleteElements, maxZ, moveElementsToBoard } from './doc';
import type { DropTarget } from './types';

let canvasEl: HTMLElement | null = null;

export function registerCanvas(el: HTMLElement | null) {
  canvasEl = el;
}

export function screenToWorld(clientX: number, clientY: number) {
  const r = canvasEl?.getBoundingClientRect() ?? { left: 0, top: 0 };
  const v = currentView();
  return { x: (clientX - r.left - v.x) / v.zoom, y: (clientY - r.top - v.y) / v.zoom };
}

export function worldToScreen(x: number, y: number) {
  const r = canvasEl?.getBoundingClientRect() ?? { left: 0, top: 0 };
  const v = currentView();
  return { x: x * v.zoom + v.x + r.left, y: y * v.zoom + v.y + r.top };
}

/** Center of the visible canvas in world coordinates. */
export function viewportCenter() {
  const r = canvasEl?.getBoundingClientRect();
  if (!r) return { x: 200, y: 200 };
  return screenToWorld(r.left + r.width / 2, r.top + r.height / 2);
}

export function domFor(id: string) {
  return document.querySelector<HTMLElement>(`[data-el-id="${id}"]`);
}

/** An element's rectangle in world coordinates, measured from the DOM. */
export function worldRect(id: string) {
  const node = domFor(id);
  if (!node) return null;
  const r = node.getBoundingClientRect();
  const tl = screenToWorld(r.left, r.top);
  const zoom = currentView().zoom;
  return { x: tl.x, y: tl.y, w: r.width / zoom, h: r.height / zoom };
}

const DRAG_THRESHOLD = 4;

/**
 * Handles a pointer-down on a card: a short press is a click (passed to onClick), a move
 * past the threshold drags the whole selection. Column children are lifted out on drag
 * start; on drop, cards can land in a column or be moved into a board card.
 */
export function beginCardPointer(e: React.PointerEvent, id: string, onClick: (ev: PointerEvent) => void) {
  if (e.button !== 0) return;
  e.stopPropagation();
  const { ui } = getState();
  if (e.shiftKey) {
    // Shift-press toggles membership on click; dragging keeps it selected.
  } else if (!ui.selection.includes(id)) {
    select([id]);
  }

  const startX = e.clientX;
  const startY = e.clientY;
  let dragging = false;
  let origins = new Map<string, { x: number; y: number }>();
  let lineOrigins = new Map<string, { s?: { x: number; y: number }; e?: { x: number; y: number } }>();
  let ids: string[] = [];

  const begin = () => {
    dragging = true;
    let sel = getState().ui.selection;
    if (!sel.includes(id)) sel = [...sel, id];
    select(sel);
    checkpoint();
    const doc = getState().doc;
    const lifted = sel.filter((sid) => doc.elements[sid]?.columnId);
    const rects = new Map(lifted.map((sid) => [sid, worldRect(sid)]));
    let z = maxZ(doc);
    mutate((d) => {
      for (const sid of sel) {
        const el = d.elements[sid];
        if (!el) continue;
        el.z = ++z;
        if (el.columnId) {
          const col = d.elements[el.columnId];
          if (col?.type === 'column') col.children = col.children.filter((c) => c !== sid);
          const r = rects.get(sid);
          if (r) {
            el.x = r.x;
            el.y = r.y;
          }
          el.columnId = undefined;
        }
      }
    }, 'pending');
    const fresh = getState().doc;
    ids = sel.filter((sid) => fresh.elements[sid]);
    origins = new Map(ids.map((sid) => [sid, { x: fresh.elements[sid].x, y: fresh.elements[sid].y }]));
    lineOrigins = new Map();
    for (const sid of ids) {
      const el = fresh.elements[sid];
      if (el.type !== 'line') continue;
      lineOrigins.set(sid, {
        s: el.start.elId ? undefined : { x: el.start.x, y: el.start.y },
        e: el.end.elId ? undefined : { x: el.end.x, y: el.end.y },
      });
    }
    document.body.classList.add('is-dragging');
  };

  const move = (ev: PointerEvent) => {
    if (!dragging) {
      if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < DRAG_THRESHOLD) return;
      begin();
    }
    const zoom = currentView().zoom;
    const dx = (ev.clientX - startX) / zoom;
    const dy = (ev.clientY - startY) / zoom;
    mutate((d) => {
      for (const [sid, o] of origins) {
        const el = d.elements[sid];
        if (!el) continue;
        if (el.type === 'line') {
          const lo = lineOrigins.get(sid);
          if (lo?.s) Object.assign(el.start, { x: lo.s.x + dx, y: lo.s.y + dy });
          if (lo?.e) Object.assign(el.end, { x: lo.e.x + dx, y: lo.e.y + dy });
        } else {
          el.x = Math.round(o.x + dx);
          el.y = Math.round(o.y + dy);
        }
      }
    }, 'pending');
    updateDropTarget(ev, ids);
  };

  const up = (ev: PointerEvent) => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    document.body.classList.remove('is-dragging');
    if (!dragging) {
      if (ev.shiftKey) {
        const sel = getState().ui.selection;
        select(sel.includes(id) ? sel.filter((s) => s !== id) : [...sel, id]);
      } else onClick(ev);
      return;
    }
    finishDrop(ids);
  };

  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}

function updateDropTarget(ev: PointerEvent, ids: string[]) {
  const doc = getState().doc;
  const dragged = new Set(ids);
  const hasColumn = ids.some((i) => doc.elements[i]?.type === 'column');
  const onlyLines = ids.every((i) => doc.elements[i]?.type === 'line');
  let target: DropTarget | null = null;
  const overTrash = document.elementsFromPoint(ev.clientX, ev.clientY).some((n) => n.closest('[data-drop-kind="trash"]'));
  if (overTrash) target = { kind: 'trash', id: 'trash' };
  else if (!onlyLines) {
    for (const node of document.elementsFromPoint(ev.clientX, ev.clientY)) {
      const host = node.closest<HTMLElement>('[data-drop-kind]');
      if (!host) continue;
      const hostId = host.dataset.dropId!;
      if (dragged.has(hostId) || host.closest(ids.map((i) => `[data-el-id="${i}"]`).join(','))) continue;
      const kind = host.dataset.dropKind as DropTarget['kind'];
      if (kind === 'column') {
        if (hasColumn) continue;
        const kids = [...host.querySelectorAll<HTMLElement>('[data-col-child]')];
        const index = kids.filter((k) => {
          const r = k.getBoundingClientRect();
          return r.top + r.height / 2 < ev.clientY;
        }).length;
        target = { kind, id: hostId, index };
      } else {
        target = { kind, id: hostId };
      }
      break;
    }
  }
  const prev = getState().ui.dropTarget;
  if (JSON.stringify(prev) !== JSON.stringify(target)) setUI({ dropTarget: target });
}

function finishDrop(ids: string[]) {
  const target = getState().ui.dropTarget;
  setUI({ dropTarget: null });
  if (!target) return;
  if (target.kind === 'trash') {
    mutate((d) => deleteElements(d, ids), 'pending');
    select([]);
    return;
  }
  const doc = getState().doc;
  const cards = ids
    .filter((i) => doc.elements[i] && doc.elements[i].type !== 'line')
    .sort((a, b) => doc.elements[a].y - doc.elements[b].y);
  if (!cards.length) return;
  if (target.kind === 'column') {
    mutate((d) => {
      const col = d.elements[target.id];
      if (col?.type !== 'column') return;
      col.children.splice(target.index ?? col.children.length, 0, ...cards);
      for (const c of cards) d.elements[c].columnId = col.id;
    }, 'pending');
  } else {
    const card = doc.elements[target.id];
    if (card?.type !== 'board') return;
    mutate((d) => moveElementsToBoard(d, cards, card.targetId), 'pending');
    select([]);
  }
}

/** Drag the right edge of a card to change its width. */
export function beginResize(e: React.PointerEvent, id: string, minW = 160) {
  e.stopPropagation();
  e.preventDefault();
  const startX = e.clientX;
  const startW = getState().doc.elements[id].w;
  checkpoint();
  const move = (ev: PointerEvent) => {
    const w = Math.max(minW, Math.round(startW + (ev.clientX - startX) / currentView().zoom));
    mutate((d) => {
      d.elements[id].w = w;
    }, 'pending');
  };
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}
