import { useEffect, useMemo, useRef, useState } from 'react';
import { Minus, Plus, Maximize } from 'lucide-react';
import type { ElType } from '../types';
import { DEFAULT_VIEW, checkpoint, currentView, getState, select, setView, useStore } from '../store';
import { registerCanvas, screenToWorld } from '../interactions';
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
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  /** Follows the pointer until it's released. */
  const track = (onMove: (ev: PointerEvent) => void, onUp?: (ev: PointerEvent) => void) => {
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', up);
      onUp?.(ev);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', up);
  };

  const pan = (e: React.PointerEvent) => {
    const v0 = currentView();
    track((ev) => setView({ ...v0, x: v0.x + ev.clientX - e.clientX, y: v0.y + ev.clientY - e.clientY }));
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
      track(erase);
      return;
    }
    const p0 = screenToWorld(e.clientX, e.clientY);
    const pts = [p0.x, p0.y];
    setLiveStroke([...pts]);
    track(
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
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setMarquee(null);
      if (!moved) select(base);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('[data-el-id], .line-hit, .zoom-controls')) return;
    const p = screenToWorld(e.clientX, e.clientY);
    addElement('note', p.x - 20, p.y - 20);
  };

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    const p = screenToWorld(e.clientX, e.clientY);
    const tool = e.dataTransfer.getData(TOOL_MIME) as ElType | 'image-upload';
    if (tool === 'image-upload') return;
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
    const box = ref.current!.getBoundingClientRect();
    const zoom = clampZoom(Math.min(1.25, (box.width - 120) / (rr - l), (box.height - 120) / (b - t)));
    setView({ zoom, x: box.width / 2 - ((l + rr) / 2) * zoom, y: box.height / 2 - ((t + b) / 2) * zoom });
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
      <div className="world" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})` }}>
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
