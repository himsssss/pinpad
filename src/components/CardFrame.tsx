import { useEffect, useRef } from 'react';
import { getState, openBoard, startEditing, useStore } from '../store';
import { beginCardPointer, beginResize } from '../interactions';
import { isDark } from '../doc';
import { focusAtPoint } from './Editable';
import { ConnectHandle } from './ConnectHandle';
import { NoteCard } from './cards/NoteCard';
import { TodoCard } from './cards/TodoCard';
import { LinkCard } from './cards/LinkCard';
import { ImageCard } from './cards/ImageCard';
import { BoardCard } from './cards/BoardCard';
import { ColumnCard } from './cards/ColumnCard';
import { CommentCard } from './cards/CommentCard';
import { TableCard } from './cards/TableCard';
import { DrawingCard } from './cards/DrawingCard';

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
    requestAnimationFrame(() => focusAtPoint(node, point));
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
    beginCardPointer(e, id, (ev) => {
      if (el.type === 'board' || el.type === 'drawing') return;
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
      {!editing && el.type !== 'board' && <ConnectHandle id={id} />}
      {resizable && (
        <div className="resize-handle" onPointerDown={(e) => beginResize(e, id, el.type === 'image' || el.type === 'drawing' ? 40 : 160)} />
      )}
    </div>
  );
}
