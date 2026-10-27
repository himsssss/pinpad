import { useEffect, useMemo, useRef } from 'react';
import type { LineEl } from '../types';
import { checkpoint, getState, mutate, useStore } from '../store';
import { beginCardPointer, cardUnder, screenToWorld, trackPointer, worldRect } from '../interactions';

type Pt = { x: number; y: number };
type Rect = { x: number; y: number; w: number; h: number };

const GAP = 7;

/** Where the ray from a rect's center toward `p` leaves the rect, plus a small gap. */
function clip(r: Rect, p: Pt): Pt {
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const dx = p.x - cx;
  const dy = p.y - cy;
  const len = Math.hypot(dx, dy);
  if (len < 1) return { x: cx, y: cy };
  const t = Math.min(dx ? r.w / 2 / Math.abs(dx) : Infinity, dy ? r.h / 2 / Math.abs(dy) : Infinity);
  const k = Math.min(1, t + GAP / len);
  return { x: cx + dx * k, y: cy + dy * k };
}

function geometry(line: LineEl) {
  const ra = line.start.elId ? worldRect(line.start.elId) : null;
  const rb = line.end.elId ? worldRect(line.end.elId) : null;
  const center = (r: Rect) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
  const p0 = ra ? center(ra) : line.start;
  const p1 = rb ? center(rb) : line.end;
  const m = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
  const len = Math.hypot(p1.x - p0.x, p1.y - p0.y) || 1;
  const n = { x: -(p1.y - p0.y) / len, y: (p1.x - p0.x) / len };
  const c = { x: m.x + n.x * line.bend * 2, y: m.y + n.y * line.bend * 2 };
  const s = ra ? clip(ra, line.bend ? c : p1) : p0;
  const e = rb ? clip(rb, line.bend ? c : p0) : p1;
  const mid = { x: 0.25 * s.x + 0.5 * c.x + 0.25 * e.x, y: 0.25 * s.y + 0.5 * c.y + 0.25 * e.y };
  return { s, c, e, mid, m, n };
}

type Refs = { path?: SVGPathElement | null; hit?: SVGPathElement | null; hs?: SVGCircleElement | null; he?: SVGCircleElement | null; hm?: SVGCircleElement | null };

function dragEndpoint(e: React.PointerEvent, line: LineEl, which: 'start' | 'end') {
  e.stopPropagation();
  e.preventDefault();
  checkpoint();
  const other = which === 'start' ? line.end.elId : line.start.elId;
  const move = (ev: PointerEvent) => {
    const p = screenToWorld(ev.clientX, ev.clientY);
    mutate((d) => {
      (d.elements[line.id] as LineEl)[which] = { x: p.x, y: p.y };
    }, 'pending');
  };
  trackPointer(move, (ev, cancelled) => {
    const target = !cancelled && cardUnder(ev.clientX, ev.clientY, [line.id, other]);
    if (target) mutate((d) => { (d.elements[line.id] as LineEl)[which].elId = target; }, 'pending');
  });
}

function dragBend(e: React.PointerEvent, line: LineEl) {
  e.stopPropagation();
  e.preventDefault();
  checkpoint();
  const move = (ev: PointerEvent) => {
    const current = getState().doc.elements[line.id] as LineEl;
    const { m, n } = geometry(current);
    const p = screenToWorld(ev.clientX, ev.clientY);
    let bend = (p.x - m.x) * n.x + (p.y - m.y) * n.y;
    if (Math.abs(bend) < 6) bend = 0;
    mutate((d) => { (d.elements[line.id] as LineEl).bend = Math.round(bend); }, 'pending');
  };
  trackPointer(move);
}

/**
 * Lines are drawn from live DOM measurements each frame, so they follow cards while they
 * are dragged, resized or reflowed inside columns.
 */
export function LinesLayer({ boardId, layer }: { boardId: string; layer: 'under' | 'over' }) {
  const elements = useStore((s) => s.doc.elements);
  const selection = useStore((s) => s.ui.selection);
  const lines = useMemo(
    () => Object.values(elements).filter((e): e is LineEl => e.type === 'line' && e.boardId === boardId),
    [elements, boardId],
  );
  const refs = useRef(new Map<string, Refs>());

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      for (const line of lines) {
        const r = refs.current.get(line.id);
        if (!r) continue;
        const { s, c, e, mid } = geometry(line);
        const d = `M ${s.x} ${s.y} Q ${c.x} ${c.y} ${e.x} ${e.y}`;
        r.path?.setAttribute('d', d);
        r.hit?.setAttribute('d', d);
        for (const [h, p] of [[r.hs, s], [r.he, e], [r.hm, mid]] as const) {
          h?.setAttribute('cx', String(p.x));
          h?.setAttribute('cy', String(p.y));
        }
      }
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [lines]);

  const ref = (id: string, key: keyof Refs) => (node: SVGPathElement | SVGCircleElement | null) => {
    const entry = refs.current.get(id) ?? {};
    (entry as Record<string, unknown>)[key] = node;
    refs.current.set(id, entry);
  };

  if (layer === 'under') {
    return (
      <svg className="lines-layer">
        <defs>
          {lines.map((l) => (
            <marker key={l.id} id={`arrow-${l.id}`} viewBox="0 0 10 10" refX="9" refY="5" markerUnits="userSpaceOnUse" markerWidth="11" markerHeight="11" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill={l.color} />
            </marker>
          ))}
        </defs>
        {lines.map((l) => {
          const selected = selection.includes(l.id);
          return (
            <g key={l.id} className={selected ? 'line selected' : 'line'}>
              <path
                ref={ref(l.id, 'path')}
                className="line-path"
                stroke={l.color}
                markerEnd={l.arrow !== 'none' ? `url(#arrow-${l.id})` : undefined}
                markerStart={l.arrow === 'both' ? `url(#arrow-${l.id})` : undefined}
              />
              <path ref={ref(l.id, 'hit')} className="line-hit" data-line-id={l.id} onPointerDown={(e) => beginCardPointer(e, l.id, () => {})} />
            </g>
          );
        })}
      </svg>
    );
  }

  const active = selection.length === 1 ? lines.find((l) => l.id === selection[0]) : undefined;
  return (
    <svg className="lines-layer handles">
      {active && (
        <g key={active.id}>
          <circle ref={ref(active.id, 'hm')} r={5} className="line-handle mid" onPointerDown={(e) => dragBend(e, active)} />
          <circle ref={ref(active.id, 'hs')} r={6} className="line-handle" onPointerDown={(e) => dragEndpoint(e, active, 'start')} />
          <circle ref={ref(active.id, 'he')} r={6} className="line-handle" onPointerDown={(e) => dragEndpoint(e, active, 'end')} />
        </g>
      )}
    </svg>
  );
}
