import type { DrawingEl, Stroke } from './types';
import { getState, mutate, setUI } from './store';
import { createElement, deleteElements, maxZ } from './doc';

/** Smooth SVG path through stroke points (quadratic curves via midpoints). */
export function strokePath(points: number[]) {
  if (points.length < 2) return '';
  const [x0, y0] = points;
  if (points.length <= 4) {
    const x1 = points[2] ?? x0 + 0.01;
    const y1 = points[3] ?? y0;
    return `M ${x0} ${y0} L ${x1 === x0 && y1 === y0 ? x0 + 0.01 : x1} ${y1}`;
  }
  let d = `M ${x0} ${y0}`;
  for (let i = 2; i < points.length - 2; i += 2) {
    const mx = (points[i] + points[i + 2]) / 2;
    const my = (points[i + 1] + points[i + 3]) / 2;
    d += ` Q ${points[i]} ${points[i + 1]} ${mx} ${my}`;
  }
  return `${d} L ${points[points.length - 2]} ${points[points.length - 1]}`;
}

function bounds(strokes: Stroke[]) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const s of strokes) {
    const pad = s.size / 2 + 2;
    for (let i = 0; i < s.points.length; i += 2) {
      minX = Math.min(minX, s.points[i] - pad);
      maxX = Math.max(maxX, s.points[i] + pad);
      minY = Math.min(minY, s.points[i + 1] - pad);
      maxY = Math.max(maxY, s.points[i + 1] + pad);
    }
  }
  return { minX, minY, maxX, maxY };
}

/** Shifts strokes so the drawing's box starts at 0,0 and fits them exactly, keeping them in place on the board. */
function refit(el: DrawingEl) {
  if (!el.strokes.length) return;
  const { minX, minY, maxX, maxY } = bounds(el.strokes);
  const scale = el.w / el.vw;
  for (const s of el.strokes) {
    for (let i = 0; i < s.points.length; i += 2) {
      s.points[i] = Math.round((s.points[i] - minX) * 10) / 10;
      s.points[i + 1] = Math.round((s.points[i + 1] - minY) * 10) / 10;
    }
  }
  el.x += minX * scale;
  el.y += minY * scale;
  el.vw = maxX - minX;
  el.vh = maxY - minY;
  el.w = el.vw * scale;
}

/** Adds a stroke drawn in world coordinates to this draw session's drawing, creating it if needed. */
export function addStroke(worldPoints: number[], color: string, size: number) {
  const { doc, ui } = getState();
  if (!ui.draw || worldPoints.length < 2) return;
  const existing = ui.draw.drawingId ? doc.elements[ui.draw.drawingId] : undefined;
  let id = existing?.type === 'drawing' && existing.boardId === ui.boardId ? existing.id : null;
  mutate((d) => {
    if (!id) {
      const { el } = createElement('drawing', ui.boardId, worldPoints[0], worldPoints[1], maxZ(d) + 1);
      el.w = 1;
      d.elements[el.id] = el;
      id = el.id;
    }
    const el = d.elements[id] as DrawingEl;
    const scale = el.w / el.vw;
    el.strokes.push({
      color,
      size: size / scale,
      points: worldPoints.map((v, i) => (v - (i % 2 ? el.y : el.x)) / scale),
    });
    refit(el);
  });
  if (id !== ui.draw.drawingId) setUI((u) => ({ draw: u.draw && { ...u.draw, drawingId: id } }));
}

function segmentDistance(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Removes strokes on the current board that pass near a world point. Call checkpoint() first. */
export function eraseAt(wx: number, wy: number, radius: number) {
  const { doc, ui } = getState();
  const hits = new Map<string, number[]>();
  for (const el of Object.values(doc.elements)) {
    if (el.type !== 'drawing' || el.boardId !== ui.boardId || el.columnId) continue;
    const scale = el.w / el.vw;
    const lx = (wx - el.x) / scale;
    const ly = (wy - el.y) / scale;
    const r = radius / scale;
    if (lx < -r || ly < -r || lx > el.vw + r || ly > el.vh + r) continue;
    const gone = el.strokes.flatMap((s, si) => {
      const p = s.points;
      const reach = r + s.size / 2;
      if (p.length === 2) return Math.hypot(lx - p[0], ly - p[1]) < reach ? [si] : [];
      for (let i = 0; i + 3 < p.length; i += 2) {
        if (segmentDistance(lx, ly, p[i], p[i + 1], p[i + 2], p[i + 3]) < reach) return [si];
      }
      return [];
    });
    if (gone.length) hits.set(el.id, gone);
  }
  if (!hits.size) return;
  mutate((d) => {
    const empty: string[] = [];
    for (const [id, idx] of hits) {
      const el = d.elements[id] as DrawingEl;
      el.strokes = el.strokes.filter((_, i) => !idx.includes(i));
      if (el.strokes.length) refit(el);
      else empty.push(id);
    }
    deleteElements(d, empty);
  }, 'pending');
}
