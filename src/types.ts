export type ElType = 'note' | 'todo' | 'link' | 'image' | 'board' | 'column' | 'comment' | 'line' | 'table' | 'drawing';

export interface Endpoint {
  /** Attached element; when set, x/y are ignored. */
  elId?: string;
  x: number;
  y: number;
}

export interface TodoItem {
  id: string;
  text: string;
  done: boolean;
}

interface BaseEl {
  id: string;
  boardId: string;
  x: number;
  y: number;
  w: number;
  z: number;
  /** Set when the element sits inside a column; x/y are then ignored. */
  columnId?: string;
  color?: string;
}

export interface NoteEl extends BaseEl { type: 'note'; html: string }
export interface TodoEl extends BaseEl { type: 'todo'; title: string; items: TodoItem[] }
export interface LinkEl extends BaseEl {
  type: 'link';
  url: string;
  title: string;
  /** Rich preview (image, description, video), fetched once per URL. */
  preview?: LinkPreview;
  /** The URL the preview was fetched for; a different url means it's stale. */
  previewFor?: string;
}

export interface LinkPreview {
  title?: string;
  description?: string;
  image?: string;
  siteName?: string;
}
export interface ImageEl extends BaseEl { type: 'image'; src: string; caption: string }
export interface BoardEl extends BaseEl { type: 'board'; targetId: string }
export interface ColumnEl extends BaseEl { type: 'column'; title: string; children: string[]; collapsed?: boolean }
export interface CommentEl extends BaseEl { type: 'comment'; text: string; createdAt: number }
export interface LineEl extends BaseEl {
  type: 'line';
  start: Endpoint;
  end: Endpoint;
  /** Perpendicular offset of the curve's midpoint from the straight line. */
  bend: number;
  arrow: 'none' | 'end' | 'both';
}

export interface TableEl extends BaseEl {
  type: 'table';
  /** Rows of cell text; every row has the same length. */
  cells: string[][];
  /** Style the first row as a header. */
  header: boolean;
}

export interface Stroke {
  color: string;
  size: number;
  /** Flat [x0, y0, x1, y1, ...] in the drawing's own coordinates. */
  points: number[];
}

export interface DrawingEl extends BaseEl {
  type: 'drawing';
  /** Natural size of the drawing; it's displayed at width `w`, scaled to fit. */
  vw: number;
  vh: number;
  strokes: Stroke[];
}

export type El = NoteEl | TodoEl | LinkEl | ImageEl | BoardEl | ColumnEl | CommentEl | LineEl | TableEl | DrawingEl;

export interface Board {
  id: string;
  title: string;
  parentId: string | null;
  color: string;
  icon: string;
  /** Sidebar folder this board is filed in; filing doesn't move it on any canvas. */
  folderId?: string;
}

export interface Folder {
  id: string;
  name: string;
  /** Containing folder; top-level folders have none. */
  parentId?: string;
  order: number;
  collapsed?: boolean;
}

export interface Doc {
  rootId: string;
  boards: Record<string, Board>;
  elements: Record<string, El>;
  folders: Record<string, Folder>;
}

export interface View {
  x: number;
  y: number;
  zoom: number;
}

export interface DropTarget {
  kind: 'column' | 'board' | 'trash' | 'folder';
  id: string;
  index?: number;
}

export interface DrawMode {
  tool: 'pen' | 'eraser';
  color: string;
  size: number;
  /** Drawing that strokes from this session are added to. */
  drawingId: string | null;
}

export interface UI {
  boardId: string;
  /** Link card whose media player is open; only one plays at a time. */
  playingId: string | null;
  sidebarOpen: boolean;
  /** Sidebar sections ('folders', 'projects') the user has collapsed. */
  collapsedSections: string[];
  /** Set while freehand drawing on the board. */
  draw: DrawMode | null;
  selection: string[];
  editingId: string | null;
  /** Screen point of the click that started editing, used to place the caret. */
  editPoint: { x: number; y: number } | null;
  views: Record<string, View>;
  dropTarget: DropTarget | null;
}
