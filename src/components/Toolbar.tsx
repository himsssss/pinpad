import { useEffect, useRef, useState } from 'react';
import {
  AlignLeft, ArrowLeft, ArrowUpRight, Bold, ChevronsDownUp, Columns2, Copy, ExternalLink, Heading,
  Image, Italic, LayoutGrid, Link, List, ListChecks, ListOrdered, MessageSquare, MoveHorizontal,
  Pencil, Shapes, Spline, Strikethrough, Trash2, Table, Eraser, Rows3, Columns3, PanelTop,
  PanelLeftClose, PanelLeftOpen, type LucideIcon,
} from 'lucide-react';
import type { ElType, LineEl } from '../types';
import { getState, mutate, openBoard, select, setUI, startEditing, useStore } from '../store';
import { BOARD_COLORS, BOARD_ICONS, CARD_COLORS, LINE_COLORS, PEN_COLORS, PEN_SIZES } from '../doc';
import { tableOps } from './cards/TableCard';
import { MOD } from '../shortcuts';
import { addElementAtCenter, addImages, deleteSelection, duplicateSelection } from '../actions';
import { pickImages } from '../images';
import { BoardIcon } from './BoardIcon';
import { TOOL_MIME } from './Canvas';

const CREATE_TOOLS: { type: ElType; label: string; icon: LucideIcon; accent?: boolean }[] = [
  { type: 'note', label: 'Note', icon: AlignLeft },
  { type: 'link', label: 'Link', icon: Link },
  { type: 'todo', label: 'To-do', icon: ListChecks },
  { type: 'line', label: 'Line', icon: ArrowUpRight },
  { type: 'board', label: 'Board', icon: LayoutGrid, accent: true },
  { type: 'column', label: 'Column', icon: Columns2 },
  { type: 'comment', label: 'Comment', icon: MessageSquare },
  { type: 'table', label: 'Table', icon: Table },
];

function Tool({ label, icon: Icon, accent, active, onClick, onMouseDown, draggableType, swatch }: {
  label: string;
  icon?: LucideIcon;
  accent?: boolean;
  active?: boolean;
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  onMouseDown?: (e: React.MouseEvent) => void;
  draggableType?: string;
  swatch?: string;
}) {
  return (
    <button
      className={`tool ${active ? 'active' : ''}`}
      title={label}
      aria-label={label}
      onClick={onClick}
      onMouseDown={onMouseDown}
      draggable={!!draggableType}
      onDragStart={(e) => {
        if (!draggableType) return;
        e.dataTransfer.setData(TOOL_MIME, draggableType);
        e.dataTransfer.effectAllowed = 'copy';
      }}
    >
      <span className={`tool-icon ${accent ? 'accent' : ''}`} style={swatch ? { background: swatch } : undefined}>
        {Icon && <Icon size={15} strokeWidth={1.9} />}
      </span>
      <span className="tool-label">{label}</span>
    </button>
  );
}

/** Formatting commands keep focus in the note being edited. */
const format = (cmd: string, value?: string) => (e: React.MouseEvent) => {
  e.preventDefault();
  if (cmd === 'formatBlock') {
    const current = document.queryCommandValue('formatBlock').toLowerCase();
    document.execCommand('formatBlock', false, current === value ? 'div' : value);
  } else document.execCommand(cmd, false, value);
};

export function Toolbar() {
  const selection = useStore((s) => s.ui.selection);
  const editingId = useStore((s) => s.ui.editingId);
  const elements = useStore((s) => s.doc.elements);
  const boards = useStore((s) => s.doc.boards);
  const dropTarget = useStore((s) => s.ui.dropTarget);
  const draw = useStore((s) => s.ui.draw);
  const sidebarOpen = useStore((s) => s.ui.sidebarOpen);
  const [popover, setPopover] = useState<{ kind: 'color' | 'icon'; top: number } | null>(null);
  const popRef = useRef<HTMLDivElement>(null);

  useEffect(() => setPopover(null), [selection]);
  useEffect(() => {
    if (!popover) return;
    const close = (e: PointerEvent) => {
      if (!popRef.current?.contains(e.target as Node) && !(e.target as HTMLElement).closest('.tool')) setPopover(null);
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [popover]);

  const selected = selection.map((id) => elements[id]).filter(Boolean);
  const single = selected.length === 1 ? selected[0] : undefined;
  const allLines = selected.length > 0 && selected.every((e) => e.type === 'line');
  const allBoards = selected.length > 0 && selected.every((e) => e.type === 'board');
  const allDrawings = selected.length > 0 && selected.every((e) => e.type === 'drawing');
  const editingNote = single?.type === 'note' && editingId === single.id;
  const board = single?.type === 'board' ? boards[single.targetId] : undefined;

  const palette = allLines ? LINE_COLORS : allBoards ? BOARD_COLORS : allDrawings ? PEN_COLORS : CARD_COLORS;
  const currentColor =
    single?.type === 'board' ? board?.color
    : single?.type === 'drawing' ? single.strokes[0]?.color
    : single?.color ?? (allLines ? LINE_COLORS[0] : '#ffffff');

  const setColor = (color: string) =>
    mutate((d) => {
      for (const id of getState().ui.selection) {
        const el = d.elements[id];
        if (!el) continue;
        if (el.type === 'board') d.boards[el.targetId].color = color;
        else if (el.type === 'drawing') el.strokes.forEach((st) => { st.color = color; });
        else el.color = color === '#ffffff' ? undefined : color;
      }
    });

  const openPopover = (kind: 'color' | 'icon') => (e: React.MouseEvent<HTMLButtonElement>) => {
    const top = e.currentTarget.offsetTop;
    setPopover((p) => (p?.kind === kind ? null : { kind, top }));
  };

  // Folders toggle sits alone at the top of the rail, separated from the tools.
  const foldersToggle = (
    <div className="toolbar-top">
      <button
        className={`tool folders-toggle ${sidebarOpen ? 'active' : ''}`}
        onClick={() => setUI({ sidebarOpen: !sidebarOpen })}
        aria-pressed={sidebarOpen}
        title={`${sidebarOpen ? 'Minimize' : 'Show'} folders (${MOD}\\)`}
      >
        <span className="tool-icon plain">
          {sidebarOpen ? <PanelLeftClose size={17} strokeWidth={1.7} /> : <PanelLeftOpen size={17} strokeWidth={1.7} />}
        </span>
        <span className="tool-label">Folders</span>
      </button>
    </div>
  );

  const trash = (
    <div className="toolbar-bottom">
      <button
        className={`tool trash ${dropTarget?.kind === 'trash' ? 'drop-over' : ''}`}
        title="Delete cards: drop them here, or click to delete the selected cards (Delete key)"
        data-drop-kind="trash"
        onClick={() => selection.length && deleteSelection()}
      >
        <span className="tool-icon plain"><Trash2 size={17} strokeWidth={1.7} /></span>
        <span className="tool-label">Delete cards</span>
      </button>
    </div>
  );

  if (draw) {
    const setDraw = (patch: Partial<typeof draw>) => setUI((u) => ({ draw: u.draw && { ...u.draw, ...patch } }));
    const done = () => {
      const id = draw.drawingId;
      setUI({ draw: null });
      select(id && getState().doc.elements[id] ? [id] : []);
    };
    return (
      <aside className="toolbar contextual">
        <div className="toolbar-tools">
          <button className="tool done" onClick={done}>Done</button>
          <Tool label="Pen" icon={Pencil} active={draw.tool === 'pen'} onClick={() => setDraw({ tool: 'pen' })} />
          <Tool label="Eraser" icon={Eraser} active={draw.tool === 'eraser'} onClick={() => setDraw({ tool: 'eraser' })} />
          <div className="toolbar-divider" />
          <div className="pen-colors">
            {PEN_COLORS.map((c) => (
              <button
                key={c}
                className={`swatch small ${draw.tool === 'pen' && draw.color === c ? 'current' : ''}`}
                style={{ background: c }}
                aria-label={`Pen color ${c}`}
                onClick={() => setDraw({ color: c, tool: 'pen' })}
              />
            ))}
          </div>
          <div className="toolbar-divider" />
          {PEN_SIZES.map((size) => (
            <button
              key={size}
              className={`pen-size ${draw.tool === 'pen' && draw.size === size ? 'current' : ''}`}
              aria-label={`Pen size ${size}`}
              onClick={() => setDraw({ size, tool: 'pen' })}
            >
              <span style={{ width: size + 3, height: size + 3, background: draw.color === '#ffffff' ? '#c3c7cd' : draw.color }} />
            </button>
          ))}
        </div>
      </aside>
    );
  }

  if (!selected.length) {
    return (
      <aside className="toolbar">
        {foldersToggle}
        <div className="toolbar-tools">
          {CREATE_TOOLS.map((t) => (
            <Tool key={t.type} label={t.label} icon={t.icon} accent={t.accent} draggableType={t.type} onClick={() => addElementAtCenter(t.type)} />
          ))}
          <div className="toolbar-divider" />
          <Tool label="Add image" icon={Image} onClick={async () => addImages(await pickImages())} />
          <Tool
            label="Draw"
            icon={Pencil}
            onClick={() => setUI({ draw: { tool: 'pen', color: PEN_COLORS[0], size: PEN_SIZES[1], drawingId: null }, selection: [], editingId: null })}
          />
        </div>
        {trash}
      </aside>
    );
  }

  return (
    <aside className="toolbar contextual">
      {foldersToggle}
      <div className="toolbar-tools">
        <button className="tool back" onClick={() => select([])} aria-label="Back to tools">
          <ArrowLeft size={15} />
        </button>
        <Tool label="Color" swatch={currentColor} active={popover?.kind === 'color'} onClick={openPopover('color')} />
        {board && single && (
          <>
            <Tool label="Icon" icon={Shapes} active={popover?.kind === 'icon'} onClick={openPopover('icon')} />
            <Tool label="Rename" icon={Pencil} onClick={() => startEditing(single.id)} />
            <Tool label="Open" icon={ExternalLink} onClick={() => openBoard(board.id)} />
          </>
        )}
        {editingNote && (
          <>
            <div className="toolbar-divider" />
            <Tool label="Bold" icon={Bold} onMouseDown={format('bold')} />
            <Tool label="Italic" icon={Italic} onMouseDown={format('italic')} />
            <Tool label="Strike" icon={Strikethrough} onMouseDown={format('strikeThrough')} />
            <Tool label="Heading" icon={Heading} onMouseDown={format('formatBlock', 'h2')} />
            <Tool label="Bullets" icon={List} onMouseDown={format('insertUnorderedList')} />
            <Tool label="Numbers" icon={ListOrdered} onMouseDown={format('insertOrderedList')} />
          </>
        )}
        {allLines && (
          <>
            <Tool
              label="Arrows"
              icon={MoveHorizontal}
              onClick={() => mutate((d) => {
                for (const id of selection) {
                  const l = d.elements[id] as LineEl;
                  l.arrow = l.arrow === 'end' ? 'both' : l.arrow === 'both' ? 'none' : 'end';
                }
              })}
            />
            <Tool label="Straight" icon={Spline} onClick={() => mutate((d) => { for (const id of selection) (d.elements[id] as LineEl).bend = 0; })} />
          </>
        )}
        {single?.type === 'table' && (
          <>
            <div className="toolbar-divider" />
            <Tool label="Add row" icon={Rows3} onMouseDown={(e) => { e.preventDefault(); tableOps.addRow(single.id); }} />
            <Tool label="Add col" icon={Columns3} onMouseDown={(e) => { e.preventDefault(); tableOps.addColumn(single.id); }} />
            <Tool label="Del row" icon={Rows3} onMouseDown={(e) => { e.preventDefault(); tableOps.deleteRow(single.id); }} />
            <Tool label="Del col" icon={Columns3} onMouseDown={(e) => { e.preventDefault(); tableOps.deleteColumn(single.id); }} />
            <Tool
              label="Header"
              icon={PanelTop}
              active={single.header}
              onClick={() => mutate((d) => { const t = d.elements[single.id]; if (t.type === 'table') t.header = !t.header; })}
            />
          </>
        )}
        {single?.type === 'column' && (
          <Tool
            label={single.collapsed ? 'Expand' : 'Collapse'}
            icon={ChevronsDownUp}
            onClick={() => mutate((d) => { const c = d.elements[single.id]; if (c.type === 'column') c.collapsed = !c.collapsed; })}
          />
        )}
        <div className="toolbar-divider" />
        <Tool label="Duplicate" icon={Copy} onClick={duplicateSelection} />
        <Tool label="Delete" icon={Trash2} onClick={deleteSelection} />
      </div>
      {trash}

      {popover?.kind === 'color' && (
        <div ref={popRef} className="popover" style={{ top: popover.top }}>
          <div className="swatches">
            {palette.map((c) => (
              <button
                key={c}
                className={`swatch ${c === (currentColor ?? '#ffffff') ? 'current' : ''}`}
                style={{ background: c }}
                aria-label={`Color ${c}`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setColor(c)}
              />
            ))}
          </div>
        </div>
      )}
      {popover?.kind === 'icon' && board && (
        <div ref={popRef} className="popover" style={{ top: popover.top }}>
          <div className="icon-grid">
            {BOARD_ICONS.map((icon) => (
              <button
                key={icon}
                className={icon === board.icon ? 'current' : ''}
                aria-label={icon}
                onClick={() => mutate((d) => { d.boards[board.id].icon = icon; })}
              >
                <BoardIcon icon={icon} color={board.color} size={34} />
              </button>
            ))}
          </div>
        </div>
      )}
    </aside>
  );
}
