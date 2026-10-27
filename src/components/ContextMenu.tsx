import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  ChevronLeft, ChevronRight, Copy, Folder, FolderInput, FolderOpen, FolderPlus, Home, LayoutTemplate, Pencil, Plus, Trash2,
  type LucideIcon,
} from 'lucide-react';
import { browse, getState, openBoard, setUI } from '../store';
import type { Renaming } from '../types';
import {
  createFolder, duplicateProject, fileBoard, folderChoices, folderContents, moveFolder, newProject, saveAsTemplate, trashFolder,
  trashProject,
} from '../projectActions';
import { askConfirm } from './ConfirmDialog';

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Warns, then moves a folder and everything in it to the Trash. */
export async function confirmTrashFolder(folderId: string) {
  const folder = getState().doc.folders[folderId];
  if (!folder) return;
  const { projects, folders } = folderContents(folderId);
  const holds = [projects && plural(projects, 'project', 'projects'), folders && plural(folders, 'folder', 'folders')].filter(Boolean).join(' and ');
  const ok = await askConfirm({
    title: `Delete “${folder.name}”?`,
    message: `${holds ? `It holds ${holds}. The folder and everything in it go` : 'The folder goes'} to the Trash, where you can restore it for 30 days.`,
    confirm: 'Move to Trash',
    danger: true,
  });
  if (ok) trashFolder(folderId);
}

/** Warns, then moves a project with all its boards and cards to the Trash. */
export async function confirmTrashProject(boardId: string) {
  const board = getState().doc.boards[boardId];
  if (!board) return;
  const ok = await askConfirm({
    title: `Delete “${board.title || 'Untitled'}”?`,
    message: 'The project and all its boards and cards go to the Trash, where you can restore them for 30 days.',
    confirm: 'Move to Trash',
    danger: true,
  });
  if (ok) trashProject(boardId);
}

export type MenuItem =
  | { label: string; icon?: LucideIcon; onSelect?: () => void; danger?: boolean; items?: MenuItem[]; indent?: number; current?: boolean }
  | 'sep';

let show: ((menu: { x: number; y: number; items: MenuItem[] }) => void) | null = null;

/** Opens a right-click menu at a screen point. */
export function openContextMenu(e: React.MouseEvent, items: MenuItem[]) {
  e.preventDefault();
  e.stopPropagation();
  show?.({ x: e.clientX, y: e.clientY, items });
}

const moveTargets = (current: string | undefined, exclude: string | undefined, move: (folderId: string) => void): MenuItem[] => [
  { label: 'Top level', icon: Home, current: !current, onSelect: () => move('') },
  ...folderChoices(exclude).map((f) => ({ label: f.name, icon: Folder, indent: f.depth, current: f.id === current, onSelect: () => move(f.id) })),
];

/** Right-click menu for a sidebar folder (sidebar row or Projects page tile). */
export function folderMenu(folderId: string, where: Renaming['where']): MenuItem[] {
  const folder = getState().doc.folders[folderId];
  if (!folder) return [];
  return [
    { label: 'Open', icon: FolderOpen, onSelect: () => browse(folderId) },
    { label: 'Rename', icon: Pencil, onSelect: () => setUI({ renaming: { id: folderId, where } }) },
    'sep',
    { label: 'New project here', icon: Plus, onSelect: () => newProject(folderId) },
    { label: 'New folder inside', icon: FolderPlus, onSelect: () => createFolder(folderId, where) },
    { label: 'Move to', icon: FolderInput, items: moveTargets(folder.parentId, folderId, (to) => moveFolder(folderId, to || undefined)) },
    'sep',
    { label: 'Delete folder', icon: Trash2, danger: true, onSelect: () => confirmTrashFolder(folderId) },
  ];
}

/** Right-click menu for a project (sidebar row or Projects page card). */
export function projectMenu(boardId: string, where: Renaming['where']): MenuItem[] {
  const board = getState().doc.boards[boardId];
  if (!board) return [];
  return [
    { label: 'Open', icon: FolderOpen, onSelect: () => openBoard(boardId) },
    { label: 'Rename', icon: Pencil, onSelect: () => setUI({ renaming: { id: boardId, where } }) },
    { label: 'Duplicate', icon: Copy, onSelect: () => duplicateProject(boardId) },
    { label: 'Save as template', icon: LayoutTemplate, onSelect: () => saveAsTemplate(boardId) },
    { label: 'Move to', icon: FolderInput, items: moveTargets(board.folderId, undefined, (to) => fileBoard(boardId, to)) },
    'sep',
    { label: 'Delete project', icon: Trash2, danger: true, onSelect: () => confirmTrashProject(boardId) },
  ];
}

/** Right-click menu for empty space in a folder (or the top level). */
export function placeMenu(folderId: string | undefined, where: Renaming['where']): MenuItem[] {
  return [
    { label: 'New project', icon: Plus, onSelect: () => newProject(folderId) },
    { label: folderId ? 'New folder inside' : 'New folder', icon: FolderPlus, onSelect: () => createFolder(folderId, where) },
  ];
}

/** The open right-click menu; "Move to" swaps in a list of folders. */
export function ContextMenu() {
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const [sub, setSub] = useState<{ label: string; items: MenuItem[] } | null>(null);
  const [pos, setPos] = useState({ left: 0, top: 0 });
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    show = (m) => {
      setSub(null);
      setMenu(m);
    };
    return () => { show = null; };
  }, []);

  useEffect(() => {
    if (!menu) return;
    const close = (e: Event) => !ref.current?.contains(e.target as Node) && setMenu(null);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenu(null);
    window.addEventListener('pointerdown', close, true);
    window.addEventListener('wheel', close, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', close, true);
      window.removeEventListener('wheel', close, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [menu]);

  // Keep the menu on screen near the edges.
  useLayoutEffect(() => {
    if (!menu || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    setPos({
      left: Math.max(8, Math.min(menu.x, window.innerWidth - r.width - 8)),
      top: Math.max(8, Math.min(menu.y, window.innerHeight - r.height - 8)),
    });
  }, [menu, sub]);

  if (!menu) return null;
  const items = sub ? sub.items : menu.items;
  const choose = (item: Exclude<MenuItem, 'sep'>) => {
    if (item.items) return setSub({ label: item.label, items: item.items });
    setMenu(null);
    item.onSelect?.();
  };

  return (
    <div ref={ref} className="menu card-menu" role="menu" style={pos} onContextMenu={(e) => e.preventDefault()}>
      {sub && (
        <>
          <button className="menu-back" onClick={() => setSub(null)}><ChevronLeft size={14} /> {sub.label}</button>
          <div className="menu-sep" />
        </>
      )}
      {items.map((item, i) =>
        item === 'sep' ? (
          <div key={i} className="menu-sep" />
        ) : (
          <button
            key={i}
            role="menuitem"
            className={`${item.danger ? 'danger' : ''} ${item.current ? 'current' : ''}`}
            style={item.indent ? { paddingLeft: 10 + item.indent * 16 } : undefined}
            disabled={item.current}
            onClick={() => choose(item)}
          >
            {item.icon && <item.icon size={14} />} <span className="menu-label">{item.label}</span>
            {item.items && <ChevronRight size={14} className="menu-more" />}
            {item.current && <span className="menu-kbd">Here</span>}
          </button>
        ),
      )}
    </div>
  );
}
