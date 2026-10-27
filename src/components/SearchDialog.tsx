import { useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import type { El } from '../types';
import { getState, openBoard, select, setView, useStore } from '../store';
import { BoardIcon } from './BoardIcon';

interface Result {
  id: string;
  boardId: string;
  kind: string;
  text: string;
  elId?: string;
}

const stripHtml = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

function textOf(el: El): string {
  switch (el.type) {
    case 'note': return stripHtml(el.html);
    case 'todo': return [el.title, ...el.items.map((i) => i.text)].join(' · ');
    case 'link': return `${el.title} ${el.url}`;
    case 'image': return el.caption;
    case 'column': return el.title;
    case 'comment': return el.text;
    case 'table': return el.cells.flat().filter(Boolean).join(' · ');
    case 'file': return el.name;
    default: return '';
  }
}

function goTo(r: Result) {
  openBoard(r.boardId);
  if (!r.elId) return;
  const { doc } = getState();
  let el = doc.elements[r.elId];
  if (el.columnId) el = doc.elements[el.columnId] ?? el;
  // The canvas fills the window; it may not be on screen yet when coming from the Projects page.
  const canvas = document.querySelector('.canvas')?.getBoundingClientRect() ?? { width: window.innerWidth, height: window.innerHeight };
  setView({ zoom: 1, x: canvas.width / 2 - el.x - el.w / 2, y: canvas.height / 3 - el.y });
  select([r.elId]);
}

export function SearchDialog({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const doc = useStore((s) => s.doc);

  const results = useMemo<Result[]>(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return [];
    const out: Result[] = [];
    for (const b of Object.values(doc.boards)) {
      if (b.title.toLowerCase().includes(needle)) out.push({ id: b.id, boardId: b.id, kind: 'Board', text: b.title });
    }
    for (const el of Object.values(doc.elements)) {
      const text = textOf(el);
      if (text.toLowerCase().includes(needle)) out.push({ id: el.id, boardId: el.boardId, kind: el.type, text, elId: el.id });
    }
    return out.slice(0, 30);
  }, [q, doc]);

  useEffect(() => setActive(0), [q]);

  const choose = (r?: Result) => {
    if (!r) return;
    goTo(r);
    onClose();
  };

  return (
    <div className="search-backdrop" onPointerDown={onClose}>
      <div className="search-dialog" onPointerDown={(e) => e.stopPropagation()}>
        <div className="search-input">
          <Search size={16} />
          <input
            autoFocus
            placeholder="Search boards and cards"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onClose();
              else if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(results.length - 1, a + 1)); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
              else if (e.key === 'Enter') choose(results[active]);
            }}
          />
        </div>
        {q.trim() && (
          <ul className="search-results">
            {results.length === 0 && <li className="search-empty">No matches</li>}
            {results.map((r, i) => {
              const board = doc.boards[r.boardId];
              return (
                <li key={r.id} className={i === active ? 'active' : ''} onMouseEnter={() => setActive(i)} onClick={() => choose(r)}>
                  <span className="search-kind">{r.kind}</span>
                  <span className="search-text">{r.text || 'Untitled'}</span>
                  {board && (
                    <span className="search-board">
                      <BoardIcon icon={board.icon} color={board.color} size={14} />
                      {board.title}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
