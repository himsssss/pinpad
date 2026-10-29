import { useState } from 'react';
import { ChevronDown, ChevronRight, ChevronsLeft, Folder, FolderOpen, FolderPlus, Plus, Trash2 } from 'lucide-react';
import type { Board } from '../types';
import { browse, mutate, openBoard, setUI, usingDrive, usingOneDrive, useStore } from '../store';
import { OneDriveIcon } from './OneDriveIcon';
import { DriveIcon } from './DriveIcon';
import { boardPath, projects } from '../doc';
import { BoardIcon } from './BoardIcon';
import { MOD } from '../shortcuts';
import {
  BOARD_MIME, FOLDER_MIME, createFolder, fileBoard, moveFolder, newProject, renameFolder, renameProject,
} from '../projectActions';
import { confirmTrashFolder, folderMenu, openContextMenu, placeMenu, projectMenu } from './ContextMenu';
import { TRASH } from './TrashPage';
import { PlaceSwitcher } from './PlaceSwitcher';
import { OtherPlaces } from './OtherPlaces';
import { SaveBar } from './SaveBar';
import { openStorageSettings } from './Header';

/** Inline name editor for a folder or project, committed on Enter or blur. */
export function RenameInput({ value, label, onCommit }: { value: string; label: string; onCommit: (value: string) => void }) {
  return (
    <input
      className="folder-rename"
      defaultValue={value}
      autoFocus
      onFocus={(e) => e.currentTarget.select()}
      onClick={(e) => e.stopPropagation()}
      onBlur={(e) => {
        onCommit(e.currentTarget.value);
        setUI({ renaming: null });
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') setUI({ renaming: null });
      }}
      aria-label={label}
    />
  );
}


export function Sidebar() {
  const open = useStore((s) => s.ui.sidebarOpen);
  const doc = useStore((s) => s.doc);
  const boardId = useStore((s) => s.ui.boardId);
  const canvasDrop = useStore((s) => (s.ui.dropTarget?.kind === 'folder' ? s.ui.dropTarget.id : null));
  const renaming = useStore((s) => (s.ui.renaming?.where === 'sidebar' ? s.ui.renaming.id : null));
  const [htmlDrop, setHtmlDrop] = useState<string | null>(null);
  const collapsedSections = useStore((s) => s.ui.collapsedSections);
  const browsing = useStore((s) => s.ui.browsing);
  // The list is named after where it's saved: the Drive folder or the folder on this computer.
  const storageName = useStore((s) => s.storageName);
  const trashCount = useStore((s) => s.doc.trash?.length ?? 0);

  if (!open) return null;

  const isCollapsed = (section: string) => collapsedSections.includes(section);
  const toggleSection = (section: string) =>
    setUI((u) => ({
      collapsedSections: u.collapsedSections.includes(section)
        ? u.collapsedSections.filter((x) => x !== section)
        : [...u.collapsedSections, section],
    }));
  // The arrow folds the list; the label opens the Projects page.
  const sectionToggle = (section: string, label: string, count: number) => (
    <span className="section-toggle">
      <button
        className="section-arrow"
        aria-expanded={!isCollapsed(section)}
        aria-label={isCollapsed(section) ? `Expand ${label}` : `Collapse ${label}`}
        onClick={() => toggleSection(section)}
      >
        {isCollapsed(section) ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
      </button>
      <button className={`section-label ${browsing === '' ? 'current' : ''}`} onClick={() => browse(null)} title={`Show everything in ${label}`}>
        {storageName && (usingDrive() ? <DriveIcon size={12} /> : usingOneDrive() ? <OneDriveIcon size={13} /> : <Folder size={12} />)}
        <span className="section-name">{label}</span>
      </button>
      {isCollapsed(section) && count > 0 && <span className="section-count">{count}</span>}
    </span>
  );

  const openPath = new Set(boardPath(doc, boardId).map((b) => b.id));
  const allFolders = Object.values(doc.folders);
  const childFolders = (parentId?: string) =>
    allFolders
      .filter((f) => (f.parentId && doc.folders[f.parentId] ? f.parentId : undefined) === parentId)
      .sort((a, b) => a.order - b.order);
  const topFolders = childFolders(undefined);
  const byTitle = (a: Board, b: Board) => a.title.localeCompare(b.title);
  const allProjects = projects(doc);
  const inFolder = (folderId: string) => allProjects.filter((b) => b.folderId === folderId).sort(byTitle);
  /** Projects in a folder and all of its subfolders. */
  const totalIn = (folderId: string): number =>
    inFolder(folderId).length + childFolders(folderId).reduce((n, f) => n + totalIn(f.id), 0);
  const unfiled = allProjects.filter((b) => !b.folderId || !doc.folders[b.folderId]);

  /**
   * Drop-target props shared by canvas drags (data-drop-*) and sidebar drags (HTML5).
   * `folderId` is the folder to file into; '' means "no folder".
   */
  const dropZone = (folderId: string, accepts: { boards: boolean; folders: boolean }, key = folderId) => ({
    ...(accepts.boards ? { 'data-drop-kind': 'folder', 'data-drop-id': folderId } : {}),
    onDragOver: (e: React.DragEvent) => {
      const types = e.dataTransfer.types;
      if (!(accepts.boards && types.includes(BOARD_MIME)) && !(accepts.folders && types.includes(FOLDER_MIME))) return;
      e.preventDefault();
      e.stopPropagation();
      setHtmlDrop(key);
    },
    onDragLeave: () => setHtmlDrop((cur) => (cur === key ? null : cur)),
    onDrop: (e: React.DragEvent) => {
      const board = accepts.boards && e.dataTransfer.getData(BOARD_MIME);
      const folder = accepts.folders && e.dataTransfer.getData(FOLDER_MIME);
      setHtmlDrop(null);
      if (!board && !folder) return;
      e.preventDefault();
      e.stopPropagation();
      if (board) fileBoard(board, folderId);
      if (folder && folder !== folderId) moveFolder(folder, folderId || undefined);
    },
  });
  const isDropping = (key: string) => canvasDrop === key || htmlDrop === key;

  const projectRow = (b: Board) =>
    renaming === b.id ? (
      <div key={b.id} className="project-row renaming">
        <BoardIcon icon={b.icon} color={b.color} size={20} />
        <RenameInput value={b.title} label="Project name" onCommit={(v) => renameProject(b.id, v)} />
      </div>
    ) : (
      <button
        key={b.id}
        className={`project-row ${browsing === null && b.id === boardId ? 'current' : browsing === null && openPath.has(b.id) ? 'in-path' : ''}`}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData(BOARD_MIME, b.id);
          e.dataTransfer.effectAllowed = 'move';
        }}
        onDragEnd={() => setHtmlDrop(null)}
        onClick={() => openBoard(b.id)}
        onContextMenu={(e) => openContextMenu(e, projectMenu(b.id, 'sidebar'))}
        title={b.title}
      >
        <BoardIcon icon={b.icon} color={b.color} size={20} />
        <span className="project-name">{b.title || 'Untitled'}</span>
      </button>
    );

  const folderNode = (f: (typeof allFolders)[number]) => {
    const items = inFolder(f.id);
    const subfolders = childFolders(f.id);
    return (
      <div key={f.id} className="folder">
        <div
          className={`folder-row ${isDropping(f.id) ? 'drop-over' : ''} ${browsing === f.id ? 'current' : ''}`}
          draggable={renaming !== f.id}
          onDragStart={(e) => {
            e.stopPropagation();
            e.dataTransfer.setData(FOLDER_MIME, f.id);
            e.dataTransfer.effectAllowed = 'move';
          }}
          onDragEnd={() => setHtmlDrop(null)}
          onContextMenu={(e) => openContextMenu(e, folderMenu(f.id, 'sidebar'))}
          {...dropZone(f.id, { boards: true, folders: true })}
        >
          <button
            className="folder-toggle"
            aria-label={f.collapsed ? 'Expand folder' : 'Collapse folder'}
            onClick={() => mutate((d) => { d.folders[f.id].collapsed = !f.collapsed; }, 'none')}
          >
            {f.collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
          </button>
          <span className="sidebar-icon">{f.collapsed ? <Folder size={15} /> : <FolderOpen size={15} />}</span>
          {renaming === f.id ? (
            <RenameInput value={f.name} label="Folder name" onCommit={(v) => renameFolder(f.id, v)} />
          ) : (
            <span className="folder-name" onClick={() => browse(f.id)} onDoubleClick={() => setUI({ renaming: { id: f.id, where: 'sidebar' } })} title="Open folder · double-click to rename">
              {f.name}
            </span>
          )}
          <span className="folder-count">{totalIn(f.id)}</span>
          <span className="row-actions">
            <button aria-label={`New project in ${f.name}`} title="New project" onClick={() => newProject(f.id)}>
              <Plus size={13} />
            </button>
            <button aria-label={`New subfolder in ${f.name}`} title="New subfolder" onClick={() => createFolder(f.id)}>
              <FolderPlus size={13} />
            </button>
            <button
              aria-label={`Delete folder ${f.name}`}
              title="Delete folder (moves it to the Trash)"
              onClick={() => confirmTrashFolder(f.id)}
            >
              <Trash2 size={13} />
            </button>
          </span>
        </div>
        {!f.collapsed && (
          <div className="folder-items">
            {subfolders.map(folderNode)}
            {items.map(projectRow)}
            {items.length === 0 && subfolders.length === 0 && <p className="sidebar-empty">Drag projects here</p>}
          </div>
        )}
      </div>
    );
  };

  return (
    <nav className="sidebar" aria-label="Folders and projects">
      {/* The logo opens the list of places boards are kept in (each Google Drive, folders, this browser). */}
      <div className="sidebar-brand">
        <PlaceSwitcher onSettings={openStorageSettings} />
        <SaveBar />
      </div>
      {/* One list: folders first, then projects that aren't in a folder. Dropping a project
          or folder anywhere outside a folder moves it to the top level. */}
      <div
        className={`sidebar-section ${isDropping('') ? 'drop-over' : ''}`}
        onContextMenu={(e) => openContextMenu(e, placeMenu(undefined, 'sidebar'))}
        {...dropZone('', { boards: true, folders: true })}
      >
        <div className="sidebar-heading">
          {sectionToggle('folders', storageName ?? 'Projects', topFolders.length + unfiled.length)}
          <button aria-label="New project" title="New project" onClick={() => newProject()}>
            <Plus size={14} />
          </button>
          <button aria-label="New folder" title="New folder" onClick={() => createFolder()}>
            <FolderPlus size={14} />
          </button>
        </div>
        {!isCollapsed('folders') && (
          <>
            {topFolders.map(folderNode)}
            {unfiled.map(projectRow)}
            {topFolders.length === 0 && unfiled.length === 0 && (
              <p className="sidebar-empty">Create a project, or a folder to group them.</p>
            )}
          </>
        )}
      </div>
      <OtherPlaces />
      <div className="sidebar-bottom">
        <button className={`project-row trash-row ${browsing === TRASH ? 'current' : ''}`} onClick={() => browse(TRASH)}>
          <span className="sidebar-icon"><Trash2 size={15} /></span>
          <span className="project-name">Trash</span>
          {trashCount > 0 && <span className="folder-count">{trashCount}</span>}
        </button>
        <button className="sidebar-collapse" aria-label="Collapse sidebar" title={`Collapse sidebar (${MOD}\\)`} onClick={() => setUI({ sidebarOpen: false })}>
          <ChevronsLeft size={15} />
        </button>
      </div>
    </nav>
  );
}
