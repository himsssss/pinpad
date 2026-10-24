import type { Board, Doc, El, ElType, LineEl } from './types';

export const uid = () => crypto.randomUUID();

export const DEFAULT_WIDTH: Record<ElType, number> = {
  note: 260,
  todo: 260,
  link: 280,
  image: 300,
  board: 98,
  column: 300,
  comment: 240,
  line: 0,
  table: 390,
  drawing: 0,
};

export const PEN_COLORS = ['#323b4a', '#e8603c', '#f2a93b', '#6bbf59', '#4a90d9', '#7b6cd9', '#e05c8a', '#ffffff'];
export const PEN_SIZES = [2, 4, 8];

export const CARD_COLORS = [
  '#ffffff', '#fff3b0', '#ffe0c7', '#ffd1d1', '#f8d8ea',
  '#e4daf7', '#d3e5fb', '#cdeee7', '#dcf2cf', '#e6e8eb', '#2f3540',
];

export const BOARD_COLORS = [
  '#eaca8b', '#f4bca3', '#f2aebb', '#dabcea', '#b0c8f2',
  '#a6d6e6', '#a9cbc5', '#b6dea4', '#e3ec9a', '#c3cad3', '#323b4a',
];

/** Icon names available for board tiles (see BoardIcon). */
export const BOARD_ICONS = [
  'layout', 'lightbulb', 'palette', 'camera', 'rocket', 'book', 'music', 'film',
  'heart', 'star', 'globe', 'briefcase', 'pen', 'coffee', 'map', 'gift',
];

export const LINE_COLORS = ['#323b4a', '#8d929a', '#e8603c', '#f2a93b', '#6bbf59', '#4a90d9', '#7b6cd9', '#e05c8a'];

export function isDark(color?: string) {
  return color === '#2f3540' || color === '#323b4a';
}

/** Creates a new element (and its target board for board cards) inside `boardId`. */
export function createElement(
  type: ElType,
  boardId: string,
  x: number,
  y: number,
  z: number,
): { el: El; board?: Board } {
  const base = { id: uid(), boardId, x, y, z, w: DEFAULT_WIDTH[type] };
  switch (type) {
    case 'note':
      return { el: { ...base, type, html: '' } };
    case 'todo':
      return { el: { ...base, type, title: '', items: [{ id: uid(), text: '', done: false }] } };
    case 'link':
      return { el: { ...base, type, url: '', title: '' } };
    case 'image':
      return { el: { ...base, type, src: '', caption: '' } };
    case 'column':
      return { el: { ...base, type, title: '', children: [] } };
    case 'comment':
      return { el: { ...base, type, text: '', createdAt: Date.now() } };
    case 'table':
      return { el: { ...base, type, header: true, cells: [['', '', ''], ['', '', ''], ['', '', '']] } };
    case 'drawing':
      return { el: { ...base, type, vw: 1, vh: 1, strokes: [] } };
    case 'line':
      return {
        el: { ...base, type, start: { x, y }, end: { x: x + 220, y: y + 40 }, bend: 0, arrow: 'end', color: LINE_COLORS[0] },
      };
    case 'board': {
      const board: Board = {
        id: uid(),
        title: 'New Board',
        parentId: boardId,
        color: BOARD_COLORS[Math.floor(Math.random() * (BOARD_COLORS.length - 1))],
        icon: BOARD_ICONS[Math.floor(Math.random() * BOARD_ICONS.length)],
      };
      return { el: { ...base, type, targetId: board.id }, board };
    }
  }
}

export function maxZ(doc: Doc) {
  let z = 0;
  for (const el of Object.values(doc.elements)) z = Math.max(z, el.z);
  return z;
}

export function boardElements(doc: Doc, boardId: string) {
  return Object.values(doc.elements).filter((el) => el.boardId === boardId);
}

/** Path of boards from the root down to `boardId`. */
export function boardPath(doc: Doc, boardId: string): Board[] {
  const path: Board[] = [];
  let b: Board | undefined = doc.boards[boardId];
  while (b) {
    path.unshift(b);
    b = b.parentId ? doc.boards[b.parentId] : undefined;
  }
  return path;
}

/** Deletes elements, their column children, attached lines and (for board cards) the boards they open. */
export function deleteElements(doc: Doc, ids: string[]) {
  const queue = [...ids];
  while (queue.length) {
    const id = queue.pop()!;
    const el = doc.elements[id];
    if (!el) continue;
    if (el.columnId) {
      const col = doc.elements[el.columnId];
      if (col?.type === 'column') col.children = col.children.filter((c) => c !== id);
    }
    if (el.type === 'column') queue.push(...el.children);
    if (el.type === 'board') deleteBoard(doc, el.targetId);
    delete doc.elements[id];
    for (const other of Object.values(doc.elements)) {
      if (other.type === 'line' && (other.start.elId === id || other.end.elId === id)) queue.push(other.id);
    }
  }
}

function deleteBoard(doc: Doc, boardId: string) {
  const inside = boardElements(doc, boardId).map((e) => e.id);
  deleteElements(doc, inside);
  delete doc.boards[boardId];
}

/**
 * Deep-copies elements into `targetBoardId`, offsetting free positions. Column children,
 * nested boards and lines between copied elements come along. Returns the new top-level ids.
 */
export function cloneElements(doc: Doc, ids: string[], targetBoardId: string, dx: number, dy: number): string[] {
  const idMap = new Map<string, string>();
  const created: string[] = [];
  let z = maxZ(doc);

  const copyBoard = (boardId: string, parentId: string): string => {
    const src = doc.boards[boardId];
    const nb: Board = { ...src, id: uid(), parentId };
    doc.boards[nb.id] = nb;
    const inner = boardElements(doc, boardId).filter((e) => !e.columnId);
    copyAll(inner, nb.id, 0, 0);
    return nb.id;
  };

  const copyOne = (src: El, boardId: string, ox: number, oy: number, columnId?: string): string => {
    const copy = structuredClone(src) as El;
    copy.id = uid();
    copy.boardId = boardId;
    copy.x += ox;
    copy.y += oy;
    copy.z = ++z;
    copy.columnId = columnId;
    idMap.set(src.id, copy.id);
    if (copy.type === 'board') copy.targetId = copyBoard(copy.targetId, boardId);
    if (copy.type === 'column' && src.type === 'column') {
      copy.children = src.children.filter((c) => doc.elements[c]).map((c) => copyOne(doc.elements[c], boardId, 0, 0, copy.id));
    }
    if (copy.type === 'todo') copy.items = copy.items.map((i) => ({ ...i, id: uid() }));
    doc.elements[copy.id] = copy;
    return copy.id;
  };

  const copyAll = (els: El[], boardId: string, ox: number, oy: number) => {
    const lines = els.filter((e): e is LineEl => e.type === 'line');
    const out = els.filter((e) => e.type !== 'line').map((e) => copyOne(e, boardId, ox, oy));
    for (const line of lines) {
      const ends = [line.start, line.end];
      // Skip lines attached to something that wasn't copied.
      if (ends.some((p) => p.elId && !idMap.has(p.elId))) continue;
      const id = copyOne(line, boardId, ox, oy);
      const copy = doc.elements[id] as LineEl;
      for (const p of [copy.start, copy.end]) {
        if (p.elId) p.elId = idMap.get(p.elId);
        else {
          p.x += ox;
          p.y += oy;
        }
      }
      out.push(id);
    }
    return out;
  };

  created.push(...copyAll(ids.map((id) => doc.elements[id]).filter(Boolean), targetBoardId, dx, dy));
  return created;
}

/** Moves top-level elements into another board, keeping their relative layout. */
export function moveElementsToBoard(doc: Doc, ids: string[], targetBoardId: string) {
  const els = ids.map((id) => doc.elements[id]).filter((e) => e && e.type !== 'line');
  if (!els.length) return;
  // Don't allow moving a board into itself or its descendants.
  const forbidden = new Set<string>();
  for (const el of els) if (el.type === 'board') forbidden.add(el.targetId);
  let b: Board | undefined = doc.boards[targetBoardId];
  while (b) {
    if (forbidden.has(b.id)) return;
    b = b.parentId ? doc.boards[b.parentId] : undefined;
  }

  const minX = Math.min(...els.map((e) => e.x));
  const minY = Math.min(...els.map((e) => e.y));
  const existing = boardElements(doc, targetBoardId).filter((e) => !e.columnId && e.type !== 'line');
  const baseY = existing.length ? Math.max(...existing.map((e) => e.y)) + 220 : 120;
  const moved = new Set<string>();
  for (const el of els) {
    el.x = el.x - minX + 120;
    el.y = el.y - minY + baseY;
    el.boardId = targetBoardId;
    moved.add(el.id);
    if (el.type === 'column') {
      for (const c of el.children) if (doc.elements[c]) doc.elements[c].boardId = targetBoardId;
    }
    if (el.type === 'board') doc.boards[el.targetId].parentId = targetBoardId;
  }
  // Lines that now span two boards are removed; lines between moved cards come along.
  const wasMoved = (p: { elId?: string }) => {
    if (!p.elId) return null;
    const target = doc.elements[p.elId];
    return moved.has(p.elId) || (!!target?.columnId && moved.has(target.columnId));
  };
  const stale: string[] = [];
  for (const el of Object.values(doc.elements)) {
    if (el.type !== 'line' || el.boardId === targetBoardId) continue;
    const ends = [wasMoved(el.start), wasMoved(el.end)];
    if (!ends.includes(true)) continue;
    if (ends.includes(false)) stale.push(el.id);
    else el.boardId = targetBoardId;
  }
  deleteElements(doc, stale);
}

export function countCards(doc: Doc, boardId: string) {
  return boardElements(doc, boardId).filter((e) => e.type !== 'line').length;
}

export function hostname(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

export function normalizeUrl(raw: string) {
  const s = raw.trim();
  if (!s) return '';
  return /^[a-z][a-z0-9+.-]*:/i.test(s) ? s : `https://${s}`;
}

export function looksLikeUrl(s: string) {
  return /^(https?:\/\/)?[\w-]+(\.[\w-]+)+(\/\S*)?$/i.test(s.trim());
}

export function seedDoc(): Doc {
  const rootId = uid();
  const doc: Doc = {
    rootId,
    boards: { [rootId]: { id: rootId, title: 'Home', parentId: null, color: '#eaca8b', icon: 'layout' } },
    elements: {},
  };
  let z = 0;
  const add = <T extends El>(el: T) => {
    doc.elements[el.id] = { ...el, z: ++z };
    return el.id;
  };

  const mood = createElement('board', rootId, 80, 80, 0);
  doc.boards[mood.board!.id] = { ...mood.board!, title: 'Moodboard', color: '#dabcea', icon: 'palette' };
  add(mood.el);
  const plan = createElement('board', rootId, 220, 80, 0);
  doc.boards[plan.board!.id] = { ...plan.board!, title: 'Project plan', color: '#a9cbc5', icon: 'rocket' };
  add(plan.el);

  const welcome = add({
    id: uid(), type: 'note', boardId: rootId, x: 80, y: 270, w: 300, z: 0, color: '#fff3b0',
    html: '<h2>Welcome 👋</h2><div>This is your board. Drag cards from the toolbar on the left, or double-click anywhere to add a note.</div><ul><li>Click a card to edit it</li><li>Drag cards into a column to stack them</li><li>Drop a card onto a board to move it there</li></ul>',
  });
  const todo = add({
    id: uid(), type: 'todo', boardId: rootId, x: 480, y: 270, w: 260, z: 0, title: 'Getting started',
    items: [
      { id: uid(), text: 'Create a board', done: true },
      { id: uid(), text: 'Add some notes and images', done: false },
      { id: uid(), text: 'Connect ideas with lines', done: false },
    ],
  });
  add({
    id: uid(), type: 'line', boardId: rootId, x: 0, y: 0, w: 0, z: 0, color: LINE_COLORS[0],
    start: { elId: welcome, x: 0, y: 0 }, end: { elId: todo, x: 0, y: 0 }, bend: -30, arrow: 'end',
  });

  const colId = uid();
  const c1 = add({ id: uid(), type: 'note', boardId: rootId, x: 0, y: 0, w: 260, z: 0, columnId: colId, html: '<div>Columns keep related cards together.</div>' });
  const c2 = add({ id: uid(), type: 'link', boardId: rootId, x: 0, y: 0, w: 260, z: 0, columnId: colId, url: 'https://milanote.com', title: 'Milanote — the tool for organizing creative projects' });
  const c3 = add({ id: uid(), type: 'note', boardId: rootId, x: 0, y: 0, w: 260, z: 0, columnId: colId, color: '#d3e5fb', html: '<div>Drag a card out to pull it from the column.</div>' });
  add({ id: colId, type: 'column', boardId: rootId, x: 840, y: 80, w: 300, z: 0, title: 'Ideas', children: [c1, c2, c3] });

  add({ id: uid(), type: 'comment', boardId: rootId, x: 480, y: 520, w: 240, z: 0, text: 'Comments are handy for feedback on a board.', createdAt: Date.now() });
  return doc;
}
