import { useEffect, useMemo, useRef, useState } from 'react';
import { Minus, Plus, Maximize } from 'lucide-react';
import type { ElType } from '../types';
import { DEFAULT_VIEW, checkpoint, currentView, getState, select, setView, useStore } from '../store';
import { registerCanvas, screenToWorld, trackPointer } from '../interactions';
import { addElement, addImages } from '../actions';
import { readImage } from '../images';
import { addStroke, eraseAt, strokePath } from '../drawing';
import { CardFrame } from './CardFrame';
import { LinesLayer } from './LinesLayer';

const clampZoom = (z: number) => Math.min(3, Math.max(0.2, z));

export const TOOL_MIME = 'application/x-pinpad-tool';

export function Canvas() {
  const boardId = useStore((s) => s.ui.boardId);
  const view = useStore((s) => s.ui.views[s.ui.boardId] ?? DEFAULT_VIEW);
  const elements = useStore((s) => s.doc.elements);
  const ref = useRef<HTMLDivElement>(null);
  const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [spaceDown, setSpaceDown] = useState(false);
  const draw = useStore((s) => s.ui.draw);
  const [liveStroke, setLiveStroke] = useState<number[] | null>(null);

  const isEmpty = useMemo(() => !Object.values(elements).some((e) => e.boardId === boardId), [elements, boardId]);
  const cards = useMemo(
    () => Object.values(elements).filter((e) => e.boardId === boardId && !e.columnId && e.type !== 'line').map((e) => e.id),
    [elements, boardId],
  );

  useEffect(() => {
    registerCanvas(ref.current);
    const node = ref.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const v = currentView();
      if (e.ctrlKey || e.metaKey) {
        const r = node.getBoundingClientRect();
        const sx = e.clientX - r.left;
        const sy = e.clientY - r.top;
        const zoom = clampZoom(v.zoom * Math.exp(-e.deltaY * 0.01));
        const wx = (sx - v.x) / v.zoom;
        const wy = (sy - v.y) / v.zoom;
        setView({ zoom, x: sx - wx * zoom, y: sy - wy * zoom });
      } else {
        setView({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY });
      }
    };
    node.addEventListener('wheel', onWheel, { passive: false });
    return () => node.removeEventListener('wheel', onWheel);
  }, []);

  useEffect(() => {
    const isTyping = () => (document.activeElement as HTMLElement | null)?.closest('input, textarea, [contenteditable="true"]');
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !isTyping()) {
        e.preventDefault();
        setSpaceDown(true);
      }
    };
    const up = (e: KeyboardEvent) => e.code === 'Space' && setSpaceDown(false);
    // Space released in another window never reaches us; don't stay stuck in panning.
    const reset = () => setSpaceDown(false);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', reset);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', reset);
    };
  }, []);

  /**
   * Touch: one finger pans (a marquee makes no sense under a finger), two fingers pinch to
   * zoom, and a double tap adds a note, like a double-click.
   */
  const touch = useRef({
    points: new Map<number, { x: number; y: number }>(),
    lastTap: { t: 0, x: 0, y: 0 },
    at: 0,
    /** Restarts the gesture from where the fingers are now, when one lands or lifts. */
    rebase: () => {},
  });
  const onTouchDown = (e: React.PointerEvent) => {
    const { points } = touch.current;
    touch.current.at = Date.now();
    points.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (points.size > 1) return touch.current.rebase();
    const start = { x: e.clientX, y: e.clientY };
    let base = { v: currentView(), pts: new Map(points) };
    let moved = false;
    const rebase = () => (base = { v: currentView(), pts: new Map(points) });
    touch.current.rebase = rebase;
    const move = (ev: PointerEvent) => {
      if (ev.pointerType !== 'touch' || !points.has(ev.pointerId)) return;
      points.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      if (Math.hypot(ev.clientX - start.x, ev.clientY - start.y) > 8) moved = true;
      if (points.size !== base.pts.size) rebase();
      const now = [...points.values()];
      const was = [...base.pts.values()];
      const r = ref.current!.getBoundingClientRect();
      if (now.length === 1) {
        setView({ ...base.v, x: base.v.x + now[0].x - was[0].x, y: base.v.y + now[0].y - was[0].y });
        return;
      }
      const mid = (p: typeof now) => ({ x: (p[0].x + p[1].x) / 2 - r.left, y: (p[0].y + p[1].y) / 2 - r.top });
      const dist = (p: typeof now) => Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) || 1;
      const m0 = mid(was);
      const m1 = mid(now);
      const zoom = clampZoom((base.v.zoom * dist(now)) / dist(was));
      const wx = (m0.x - base.v.x) / base.v.zoom;
      const wy = (m0.y - base.v.y) / base.v.zoom;
      setView({ zoom, x: m1.x - wx * zoom, y: m1.y - wy * zoom });
    };
    const up = (ev: PointerEvent) => {
      if (!points.delete(ev.pointerId)) return;
      if (points.size) return rebase();
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      if (moved || ev.type === 'pointercancel') return;
      const last = touch.current.lastTap;
      if (Date.now() - last.t < 350 && Math.hypot(ev.clientX - last.x, ev.clientY - last.y) < 30) {
        touch.current.lastTap = { t: 0, x: 0, y: 0 };
        const p = screenToWorld(ev.clientX, ev.clientY);
        addElement('note', p.x - 20, p.y - 20);
      } else {
        touch.current.lastTap = { t: Date.now(), x: ev.clientX, y: ev.clientY };
        select([]);
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  const pan = (e: React.PointerEvent) => {
    const v0 = currentView();
    trackPointer((ev) => setView({ ...v0, x: v0.x + ev.clientX - e.clientX, y: v0.y + ev.clientY - e.clientY }));
  };

  const onDrawPointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    if (spaceDown || e.button === 1) return pan(e);
    if (e.button !== 0 || !draw) return;
    e.preventDefault();
    const zoom = currentView().zoom;
    if (draw.tool === 'eraser') {
      checkpoint();
      const erase = (ev: { clientX: number; clientY: number }) => {
        const p = screenToWorld(ev.clientX, ev.clientY);
        eraseAt(p.x, p.y, 8 / zoom);
      };
      erase(e);
      trackPointer(erase);
      return;
    }
    const p0 = screenToWorld(e.clientX, e.clientY);
    const pts = [p0.x, p0.y];
    setLiveStroke([...pts]);
    trackPointer(
      (ev) => {
        const p = screenToWorld(ev.clientX, ev.clientY);
        if (Math.hypot(p.x - pts[pts.length - 2], p.y - pts[pts.length - 1]) < 1.5 / zoom) return;
        pts.push(p.x, p.y);
        setLiveStroke([...pts]);
      },
      () => {
        setLiveStroke(null);
        addStroke(pts, draw.color, draw.size);
      },
    );
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('[data-el-id], .line-hit, .line-handle, .zoom-controls')) return;
    (document.activeElement as HTMLElement | null)?.blur?.();
    window.getSelection()?.removeAllRanges();
    const startX = e.clientX;
    const startY = e.clientY;

    if (e.pointerType === 'touch') return onTouchDown(e);
    if (spaceDown || e.button === 1) return pan(e);
    if (e.button !== 0) return;

    const base = e.shiftKey ? getState().ui.selection : [];
    const canvasRect = ref.current!.getBoundingClientRect();
    let moved = false;
    const move = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - startX, ev.clientY - startY) < 4) return;
      moved = true;
      const box = {
        left: Math.min(startX, ev.clientX), right: Math.max(startX, ev.clientX),
        top: Math.min(startY, ev.clientY), bottom: Math.max(startY, ev.clientY),
      };
      setMarquee({ x: box.left - canvasRect.left, y: box.top - canvasRect.top, w: box.right - box.left, h: box.bottom - box.top });
      const hit = [...document.querySelectorAll<HTMLElement>('.card.free')]
        .filter((n) => {
          const r = n.getBoundingClientRect();
          return r.left < box.right && r.right > box.left && r.top < box.bottom && r.bottom > box.top;
        })
        .map((n) => n.dataset.elId!);
      select([...new Set([...base, ...hit])]);
    };
    trackPointer(move, (_ev, cancelled) => {
      setMarquee(null);
      if (!moved && !cancelled) select(base);
    });
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('[data-el-id], .line-hit, .zoom-controls')) return;
    // A double tap is handled as touch already; some browsers also report it as a double-click.
    if (Date.now() - touch.current.at < 800) return;
    const p = screenToWorld(e.clientX, e.clientY);
    addElement('note', p.x - 20, p.y - 20);
  };

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    const p = screenToWorld(e.clientX, e.clientY);
    const tool = e.dataTransfer.getData(TOOL_MIME) as ElType | 'image-upload';
    // An empty image card where it was dropped; clicking it picks the image (a drop
    // can't open the file picker itself).
    if (tool === 'image-upload') {
      addElement('image', p.x - 20, p.y - 20);
      return;
    }
    if (tool) {
      addElement(tool, p.x - 20, p.y - 20);
      return;
    }
    const files = [...e.dataTransfer.files].filter((f) => f.type.startsWith('image/'));
    if (files.length) {
      addImages(await Promise.all(files.map(readImage)), p);
      return;
    }
    const text = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
    if (text) addElement(/^https?:\/\//.test(text.trim()) ? 'link' : 'note', p.x, p.y, text.trim());
  };

  const zoomBy = (factor: number) => {
    const r = ref.current!.getBoundingClientRect();
    const v = currentView();
    const zoom = clampZoom(v.zoom * factor);
    const cx = r.width / 2;
    const cy = r.height / 2;
    setView({ zoom, x: cx - ((cx - v.x) / v.zoom) * zoom, y: cy - ((cy - v.y) / v.zoom) * zoom });
  };

  const fit = () => {
    const nodes = [...document.querySelectorAll<HTMLElement>('.card.free')];
    if (!nodes.length) return setView(DEFAULT_VIEW);
    const rects = nodes.map((n) => {
      const r = n.getBoundingClientRect();
      const tl = screenToWorld(r.left, r.top);
      const br = screenToWorld(r.right, r.bottom);
      return { l: tl.x, t: tl.y, r: br.x, b: br.y };
    });
    const l = Math.min(...rects.map((r) => r.l)), t = Math.min(...rects.map((r) => r.t));
    const rr = Math.max(...rects.map((r) => r.r)), b = Math.max(...rects.map((r) => r.b));
    // Fit into the area left uncovered by the floating panels.
    const box = ref.current!.getBoundingClientRect();
    const left = (document.querySelector('.toolbar')?.getBoundingClientRect().right ?? box.left) - box.left + 32;
    const top = 88;
    const w = box.width - left - 32;
    const h = box.height - top - 32;
    const zoom = clampZoom(Math.min(1.25, w / (rr - l), h / (b - t)));
    setView({ zoom, x: left + w / 2 - ((l + rr) / 2) * zoom, y: top + h / 2 - ((t + b) / 2) * zoom });
  };

  return (
    <div
      ref={ref}
      className={`canvas ${spaceDown ? 'panning' : ''}`}
      style={{
        backgroundPosition: `${view.x}px ${view.y}px`,
        backgroundSize: `${9 * view.zoom}px ${9 * view.zoom}px`,
      }}
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
    >
      <div
        className="world"
        style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`, ['--inv-zoom' as string]: 1 / view.zoom }}
      >
        <LinesLayer boardId={boardId} layer="under" />
        {cards.map((id) => (
          <CardFrame key={id} id={id} />
        ))}
        <LinesLayer boardId={boardId} layer="over" />
        {liveStroke && draw && (
          <svg className="lines-layer live-stroke">
            <path d={strokePath(liveStroke)} stroke={draw.color} strokeWidth={draw.size} />
          </svg>
        )}
      </div>
      {draw && (
        <>
          <div className={`draw-surface ${draw.tool}`} onPointerDown={onDrawPointerDown} onDoubleClick={(e) => e.stopPropagation()} />
          <div className="draw-banner">
            {draw.tool === 'eraser' ? 'Erasing' : 'Drawing'} · press <kbd>Esc</kbd> or Done when finished
          </div>
        </>
      )}
      {marquee && <div className="marquee" style={{ left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h }} />}
      {isEmpty && (
        <div className="empty-hint">
          <p>This board is empty</p>
          <span>Drag something from the toolbar, or double-click to add a note</span>
        </div>
      )}
      <div className="zoom-controls">
        <button onClick={() => zoomBy(1 / 1.2)} aria-label="Zoom out"><Minus size={14} /></button>
        <button className="zoom-value" onClick={() => setView({ ...view, zoom: 1 })}>{Math.round(view.zoom * 100)}%</button>
        <button onClick={() => zoomBy(1.2)} aria-label="Zoom in"><Plus size={14} /></button>
        <button onClick={fit} aria-label="Fit to screen"><Maximize size={13} /></button>
      </div>
    </div>
  );
}
