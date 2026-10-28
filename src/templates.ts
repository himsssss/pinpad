/**
 * Starting layouts offered on an empty board. Each builds plain cards (notes, columns,
 * to-dos, image slots, lines) at board positions, so everything stays editable.
 */

import { LayoutGrid, Lightbulb, Palette, CalendarDays, Clapperboard, type LucideIcon } from 'lucide-react';
import type { El } from './types';
import { LINE_COLORS, maxZ, needsProject, uid } from './doc';
import { getState, mutate, select } from './store';
import { viewportCenter } from './interactions';

export interface Template {
  id: string;
  name: string;
  icon: LucideIcon;
  build: (boardId: string) => El[];
}

const heading = (text: string) => `<h2>${text}</h2>`;
const para = (text: string) => `<div>${text}</div>`;

/** Helpers that make cards on one board; z order follows creation. */
function maker(boardId: string) {
  const els: El[] = [];
  let z = 0;
  const base = (x: number, y: number, w: number) => ({ id: uid(), boardId, x, y, w, z: ++z });
  return {
    els,
    note(x: number, y: number, w: number, html: string, color?: string) {
      const el: El = { ...base(x, y, w), type: 'note', html, ...(color ? { color } : {}) };
      els.push(el);
      return el.id;
    },
    image(x: number, y: number, w: number, caption = '') {
      const el: El = { ...base(x, y, w), type: 'image', src: '', caption };
      els.push(el);
      return el.id;
    },
    todo(x: number, y: number, w: number, title: string, items: string[]) {
      const el: El = { ...base(x, y, w), type: 'todo', title, items: items.map((text) => ({ id: uid(), text, done: false })) };
      els.push(el);
      return el.id;
    },
    column(x: number, y: number, w: number, title: string, cards: string[] = [], color?: string) {
      const id = uid();
      const children = cards.map((html) => {
        const child: El = { ...base(0, 0, w), type: 'note', html: para(html), columnId: id };
        els.push(child);
        return child.id;
      });
      els.push({ ...base(x, y, w), id, type: 'column', title, children, ...(color ? { color } : {}) });
      return id;
    },
    line(from: string, to: string, bend = 0) {
      els.push({
        ...base(0, 0, 0), type: 'line', color: LINE_COLORS[1], arrow: 'none', bend,
        start: { elId: from, x: 0, y: 0 }, end: { elId: to, x: 0, y: 0 },
      });
    },
  };
}

export const TEMPLATES: Template[] = [
  {
    id: 'moodboard',
    name: 'Moodboard',
    icon: Palette,
    build: (boardId) => {
      const m = maker(boardId);
      m.note(0, 0, 340, heading('Moodboard') + para('The feeling, look and references for this project.'));
      [0, 1, 2, 3].forEach((i) => m.image((i % 2) * 320, 150 + Math.floor(i / 2) * 260, 300));
      m.note(660, 0, 260, heading('Keywords') + para('Calm, bright, handmade…'), '#fff9b1');
      m.note(660, 170, 260, heading('Colors & textures') + para('Drop swatches or photos here.'), '#ffcee0');
      m.note(660, 340, 260, heading('Avoid') + para('What this should not feel like.'), '#e6e6e6');
      return m.els;
    },
  },
  {
    id: 'kanban',
    name: 'Kanban',
    icon: LayoutGrid,
    build: (boardId) => {
      const m = maker(boardId);
      m.column(0, 0, 280, 'To do', ['Write the brief', 'Collect references', 'Plan the first draft']);
      m.column(320, 0, 280, 'Doing', ['Sketch ideas']);
      m.column(640, 0, 280, 'Done', []);
      return m.els;
    },
  },
  {
    id: 'week',
    name: 'Weekly plan',
    icon: CalendarDays,
    build: (boardId) => {
      const m = maker(boardId);
      m.todo(0, 0, 280, 'Goals this week', ['', '', '']);
      ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'].forEach((day, i) => m.column(320 + i * 280, 0, 260, day));
      m.note(0, 260, 280, heading('Notes') + para('Anything to remember this week.'), '#fff9b1');
      return m.els;
    },
  },
  {
    id: 'brainstorm',
    name: 'Brainstorm',
    icon: Lightbulb,
    build: (boardId) => {
      const m = maker(boardId);
      const center = m.note(360, 260, 260, heading('Main idea') + para('What are we exploring?'), '#f5d128');
      const spots: [number, number, string][] = [
        [0, 0, '#a6ccf5'], [360, -40, '#d5f692'], [720, 0, '#ffcee0'],
        [0, 520, '#c6a2d2'], [360, 560, '#ff9d48'], [720, 520, '#6cd8fa'],
      ];
      for (const [x, y, color] of spots) m.line(center, m.note(x, y, 240, para('Idea'), color));
      return m.els;
    },
  },
  {
    id: 'storyboard',
    name: 'Storyboard',
    icon: Clapperboard,
    build: (boardId) => {
      const m = maker(boardId);
      m.note(0, 0, 360, heading('Storyboard') + para('One frame per shot. Add a caption under each image.'));
      for (let i = 0; i < 6; i++) m.image((i % 3) * 320, 140 + Math.floor(i / 3) * 280, 300, `Scene ${i + 1}`);
      return m.els;
    },
  },
];

/** Adds a template's cards to the current board, centered on screen, as one undo step. */
export function applyTemplate(t: Template) {
  const { doc, ui } = getState();
  if (needsProject(doc, ui.boardId)) return;
  const els = t.build(ui.boardId);
  const free = els.filter((e) => !e.columnId && e.type !== 'line');
  const minX = Math.min(...free.map((e) => e.x));
  const maxX = Math.max(...free.map((e) => e.x + e.w));
  const minY = Math.min(...free.map((e) => e.y));
  const c = viewportCenter();
  const dx = Math.round(c.x - (minX + maxX) / 2);
  const dy = Math.round(c.y - 260 - minY);
  const z = maxZ(doc);
  mutate((d) => {
    for (const el of els) {
      if (!el.columnId && el.type !== 'line') {
        el.x += dx;
        el.y += dy;
      }
      el.z += z;
      d.elements[el.id] = el;
    }
  });
  select([]);
}
