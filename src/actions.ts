import type { El, ElType, ImageEl } from './types';
import { getState, mutate, select, startEditing } from './store';
import { DEFAULT_WIDTH, cloneElements, createElement, deleteElements, hostname, maxZ, normalizeUrl } from './doc';
import { viewportCenter, worldRect } from './interactions';
import { readImage } from './images';

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Adds a card at a world position and, for text cards, starts editing it. */
export function addElement(type: ElType, x: number, y: number, content?: string) {
  const { doc, ui } = getState();
  const { el, board } = createElement(type, ui.boardId, Math.round(x), Math.round(y), maxZ(doc) + 1);
  if (content && el.type === 'note') el.html = content.split('\n').map((l) => `<div>${escapeHtml(l) || '<br>'}</div>`).join('');
  if (content && el.type === 'link') {
    el.url = normalizeUrl(content);
    el.title = hostname(el.url);
  }
  mutate((d) => {
    d.elements[el.id] = el;
    if (board) d.boards[board.id] = board;
  });
  if (content || type === 'board' || type === 'line' || type === 'image') select([el.id]);
  else startEditing(el.id);
  return el.id;
}

const ESTIMATED_HEIGHT: Record<ElType, number> = {
  note: 80, todo: 120, link: 170, image: 200, board: 125, column: 160, comment: 90, line: 60, table: 130, drawing: 0,
};

/** Nearest spot to `(x, y)` where a new card of this type won't overlap the visible cards. */
function freeSpot(type: ElType, x: number, y: number) {
  const w = type === 'line' ? 230 : DEFAULT_WIDTH[type];
  const h = ESTIMATED_HEIGHT[type];
  const gap = 20;
  const taken = [...document.querySelectorAll<HTMLElement>('.card.free')]
    .map((n) => worldRect(n.dataset.elId!))
    .filter((r): r is NonNullable<typeof r> => !!r);
  const fits = (cx: number, cy: number) =>
    taken.every((r) => cx + w + gap <= r.x || cx >= r.x + r.w + gap || cy + h + gap <= r.y || cy >= r.y + r.h + gap);
  for (let ring = 0; ring < 30; ring++) {
    const step = ring * 40;
    for (let i = 0; i < Math.max(1, ring * 8); i++) {
      const a = (i / Math.max(1, ring * 8)) * Math.PI * 2;
      const cx = x + Math.cos(a) * step;
      const cy = y + Math.sin(a) * step;
      if (fits(cx, cy)) return { x: cx, y: cy };
    }
  }
  return { x, y };
}

/** Adds a card near the middle of the screen, in the closest empty space. */
export function addElementAtCenter(type: ElType, content?: string) {
  const c = viewportCenter();
  const w = type === 'line' ? 220 : DEFAULT_WIDTH[type];
  const p = freeSpot(type, c.x - w / 2, c.y - ESTIMATED_HEIGHT[type] / 2);
  return addElement(type, p.x, p.y, content);
}

export function addImages(srcs: string[], at = viewportCenter()) {
  const { ui } = getState();
  let z = maxZ(getState().doc);
  const ids: string[] = [];
  mutate((d) => {
    srcs.forEach((src, i) => {
      const { el } = createElement('image', ui.boardId, Math.round(at.x - 150 + i * 330), Math.round(at.y - 100), ++z);
      (el as ImageEl).src = src;
      d.elements[el.id] = el;
      ids.push(el.id);
    });
  });
  select(ids);
}

export function deleteSelection() {
  const ids = getState().ui.selection;
  if (!ids.length) return;
  mutate((d) => deleteElements(d, ids));
  select([]);
}

/** Copies cards (with their contents) into the current board, offset from the originals. */
function cloneIntoBoard(ids: string[], dx: number, dy: number) {
  const { doc, ui } = getState();
  // Cards inside a column have no position of their own; place copies by where they appear.
  const positions = new Map(ids.filter((id) => doc.elements[id]?.columnId).map((id) => [id, worldRect(id)]));
  const created: string[] = [];
  mutate((d) => {
    for (const [id, r] of positions) {
      if (!r) continue;
      d.elements[id].x = Math.round(r.x);
      d.elements[id].y = Math.round(r.y);
    }
    created.push(...cloneElements(d, ids.filter((id) => d.elements[id]), ui.boardId, dx, dy));
  });
  select(created);
}

export function duplicateSelection() {
  const ids = getState().ui.selection;
  if (ids.length) cloneIntoBoard(ids, 24, 24);
}

export function selectAll() {
  const { doc, ui } = getState();
  select(Object.values(doc.elements).filter((e) => e.boardId === ui.boardId && !e.columnId).map((e) => e.id));
}

export function nudgeSelection(dx: number, dy: number) {
  const ids = getState().ui.selection;
  mutate((d) => {
    for (const id of ids) {
      const el = d.elements[id];
      if (!el || el.columnId) continue;
      if (el.type === 'line') {
        for (const p of [el.start, el.end]) if (!p.elId) { p.x += dx; p.y += dy; }
      } else {
        el.x += dx;
        el.y += dy;
      }
    }
  });
}

// ---- clipboard ----

let clip: { ids: string[]; text: string } | null = null;

const plainText = (el: El) => {
  switch (el.type) {
    case 'note': return new DOMParser().parseFromString(el.html, 'text/html').body.innerText;
    case 'todo': return [el.title, ...el.items.map((i) => `${i.done ? '[x]' : '[ ]'} ${i.text}`)].filter(Boolean).join('\n');
    case 'link': return el.url;
    case 'comment': return el.text;
    case 'column': return el.title;
    case 'board': return getState().doc.boards[el.targetId]?.title ?? '';
    case 'table': return el.cells.map((row) => row.join('\t')).join('\n');
    default: return '';
  }
};

export function copySelection(e: ClipboardEvent) {
  const { doc, ui } = getState();
  if (!ui.selection.length) return;
  const text = ui.selection.map((id) => doc.elements[id]).filter(Boolean).map(plainText).filter(Boolean).join('\n\n') || ' ';
  clip = { ids: [...ui.selection], text };
  e.clipboardData?.setData('text/plain', text);
  e.preventDefault();
}

export async function paste(e: ClipboardEvent) {
  const data = e.clipboardData;
  if (!data) return;
  const text = data.getData('text/plain');
  if (clip && text === clip.text) {
    e.preventDefault();
    const alive = clip.ids.filter((id) => getState().doc.elements[id]);
    if (alive.length) cloneIntoBoard(alive, 32, 32);
    return;
  }
  const files = [...data.files].filter((f) => f.type.startsWith('image/'));
  if (files.length) {
    e.preventDefault();
    addImages(await Promise.all(files.map(readImage)));
    return;
  }
  const trimmed = text.trim();
  if (!trimmed) return;
  e.preventDefault();
  addElementAtCenter(/^https?:\/\/\S+$/.test(trimmed) ? 'link' : 'note', trimmed);
}
