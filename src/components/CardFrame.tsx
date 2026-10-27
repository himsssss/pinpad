import { useEffect, useRef } from 'react';
import { getState, openBoard, select, startEditing, useStore } from '../store';
import { beginCardPointer, beginResize } from '../interactions';
import { isDark } from '../doc';
import { focusAtPoint } from './Editable';
import { ConnectHandle } from './ConnectHandle';
import { openCardMenu } from './CardMenu';
import { NoteCard } from './cards/NoteCard';
import { TodoCard } from './cards/TodoCard';
import { LinkCard } from './cards/LinkCard';
import { ImageCard } from './cards/ImageCard';
import { BoardCard } from './cards/BoardCard';
import { ColumnCard } from './cards/ColumnCard';
import { CommentCard } from './cards/CommentCard';
import { TableCard } from './cards/TableCard';
import { DrawingCard } from './cards/DrawingCard';
import { FileCard } from './cards/FileCard';

export function CardFrame({ id, inColumn }: { id: string; inColumn?: boolean }) {
  const el = useStore((s) => s.doc.elements[id]);
  const selected = useStore((s) => s.ui.selection.includes(id));
  const editing = useStore((s) => s.ui.editingId === id);
  const isDropTarget = useStore((s) => s.ui.dropTarget?.kind === 'board' && s.ui.dropTarget.id === id);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!editing || !ref.current) return;
    const node = ref.current;
    const point = getState().ui.editPoint;
    requestAnimationFrame(() => {
      focusAtPoint(node, point);
      // Renaming a board from its menu or toolbar selects the whole name, like a file name.
      const title = node.querySelector('.board-title');
      if (!point && title && document.activeElement === title) window.getSelection()?.selectAllChildren(title);
    });
  }, [editing]);

  if (!el || el.type === 'line') return null;

  const onPointerDown = (e: React.PointerEvent) => {
    const target = e.target as HTMLElement;
    if (editing && target.closest('[data-editor]')) {
      e.stopPropagation();
      return;
    }
    if (target.closest('[data-nodrag]')) {
      e.stopPropagation();
      return;
    }
    // Column children are their own cards; let the innermost frame handle the press.
    if (target.closest('[data-el-id]') !== ref.current) return;
    const wasSelected = getState().ui.selection.includes(id);
    // Long-press on a touch screen opens the card menu (iPhone and iPad send no contextmenu).
    let longPressed = false;
    if (e.pointerType === 'touch') {
      const start = { x: e.clientX, y: e.clientY };
      const timer = window.setTimeout(() => {
        longPressed = true;
        if (!getState().ui.selection.includes(id)) select([id]);
        openCardMenu(start.x, start.y);
      }, 500);
      const stop = (ev: PointerEvent) => {
        if (ev.type === 'pointermove' && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 8) return;
        clearTimeout(timer);
        window.removeEventListener('pointermove', stop);
        window.removeEventListener('pointerup', stop);
        window.removeEventListener('pointercancel', stop);
      };
      window.addEventListener('pointermove', stop);
      window.addEventListener('pointerup', stop);
      window.addEventListener('pointercancel', stop);
    }
    beginCardPointer(e, id, (ev) => {
      if (longPressed) return;
      // A board's title is renamed by clicking it once the card is selected, like a file name.
      if (el.type === 'board' && wasSelected && target.closest('.board-title')) return startEditing(id, { x: ev.clientX, y: ev.clientY });
      if (el.type === 'board' || el.type === 'drawing' || el.type === 'file') return;
      if (el.type === 'column' && !target.closest('[data-column-head]')) return;
      startEditing(id, { x: ev.clientX, y: ev.clientY });
    });
  };

  const style: React.CSSProperties = inColumn
    ? { background: el.color }
    : { left: el.x, top: el.y, width: el.w, zIndex: el.z, background: el.type === 'board' ? undefined : el.color };

  const dropProps =
    el.type === 'board' ? { 'data-drop-kind': 'board', 'data-drop-id': id }
    : el.type === 'column' ? { 'data-drop-kind': 'column', 'data-drop-id': id }
    : {};

  const resizable = !inColumn && el.type !== 'board';
  const minWidth = el.type === 'image' || el.type === 'drawing' ? 40 : 160;

  return (
    <div
      ref={ref}
      data-el-id={id}
      {...dropProps}
      className={[
        'card',
        `card-${el.type}`,
        inColumn ? 'in-column' : 'free',
        selected ? 'selected' : '',
        editing ? 'editing' : '',
        isDropTarget ? 'drop-over' : '',
        isDark(el.color) ? 'dark' : '',
      ].join(' ')}
      style={style}
      onPointerDown={onPointerDown}
      // A native drag (of a link, image or selected text) would take the pointer away mid-move.
      onDragStart={(e) => !editing && e.preventDefault()}
      onContextMenu={(e) => {
        // While typing, keep the browser's own menu (spelling, paste).
        if (editing && (e.target as HTMLElement).closest('[data-editor]')) return;
        e.preventDefault();
        e.stopPropagation();
        if (!getState().ui.selection.includes(id)) select([id]);
        openCardMenu(e.clientX, e.clientY);
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        if (el.type === 'board') openBoard(el.targetId);
      }}
    >
      {el.type === 'note' && <NoteCard el={el} editing={editing} />}
      {el.type === 'todo' && <TodoCard el={el} editing={editing} />}
      {el.type === 'link' && <LinkCard el={el} editing={editing} />}
      {el.type === 'image' && <ImageCard el={el} editing={editing} />}
      {el.type === 'board' && <BoardCard el={el} editing={editing} selected={selected} />}
      {el.type === 'column' && <ColumnCard el={el} editing={editing} />}
      {el.type === 'comment' && <CommentCard el={el} editing={editing} />}
      {el.type === 'table' && <TableCard el={el} editing={editing} />}
      {el.type === 'drawing' && <DrawingCard el={el} />}
      {el.type === 'file' && <FileCard el={el} />}
      {!editing && el.type !== 'board' && <ConnectHandle id={id} />}
      {resizable && (
        <>
          <div className="resize-handle" onPointerDown={(e) => beginResize(e, id, minWidth)} />
          <div className="resize-grip" data-nodrag title="Drag to resize" onPointerDown={(e) => beginResize(e, id, minWidth)}>
            <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
              <path d="M11 4 4 11M11 8 8 11" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            </svg>
          </div>
        </>
      )}
    </div>
  );
}
