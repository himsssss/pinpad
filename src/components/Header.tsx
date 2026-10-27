import { useEffect, useRef, useState } from 'react';
import { ChevronRight, Folder, PanelLeftOpen, Download, FileImage, FileText, FolderCog, HardDriveDownload, Keyboard, Redo2, Search, Settings, Undo2, Upload, RotateCcw } from 'lucide-react';
import { exportBoardImage, exportBoardPdf } from '../exportBoard';
import { TRASH } from './TrashPage';
import type { Doc } from '../types';
import { browse, getState, mutate, openBoard, redo, setUI, undo, useStore } from '../store';
import { PlaceSwitcher } from './PlaceSwitcher';
import { parseWorkspace } from '../workspaceFiles';
import { nativeStorage } from '../native';
import { googleConfigured } from '../googleAuth';
import { StorageDialog } from './StorageDialog';
import { boardPath, seedDoc } from '../doc';
import { BoardIcon } from './BoardIcon';
import { MOD, SHIFT } from '../shortcuts';

function downloadJSON(doc: Doc) {
  const blob = new Blob([JSON.stringify(doc)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `pinpad-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function replaceDoc(doc: Doc) {
  mutate((d) => {
    d.rootId = doc.rootId;
    d.boards = doc.boards;
    d.elements = doc.elements;
    d.folders = doc.folders ?? {};
  });
  openBoard(doc.rootId);
}

function importJSON() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/json';
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const doc = parseWorkspace(await file.text());
      if (confirm('Replace your workspace with this file? You can undo this.')) replaceDoc(doc);
    } catch (err) {
      alert(`Couldn't import: ${(err as Error).message}`);
    }
  };
  input.click();
}

let showStorage: (() => void) | null = null;

/** Opens the Storage location dialog (from the place switcher, for one). */
export function openStorageSettings() {
  showStorage?.();
}

export function Header({ onSearch, onShortcuts }: { onSearch: () => void; onShortcuts: () => void }) {
  const boardId = useStore((s) => s.ui.boardId);
  const boards = useStore((s) => s.doc.boards);
  const rootId = useStore((s) => s.doc.rootId);
  const browsing = useStore((s) => s.ui.browsing);
  const folders = useStore((s) => s.doc.folders);
  const canUndo = useStore((s) => s.canUndo);
  const canRedo = useStore((s) => s.canRedo);
  const sidebarOpen = useStore((s) => s.ui.sidebarOpen);
  const [menu, setMenu] = useState(false);
  const [exportMenu, setExportMenu] = useState(false);
  const [exporting, setExporting] = useState(false);
  const exportRef = useRef<HTMLDivElement>(null);
  const [storageOpen, setStorageOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const path = boardPath(getState().doc, boardId);
  const board = boards[boardId];
  const [title, setTitle] = useState(board?.title ?? '');

  useEffect(() => setTitle(board?.title ?? ''), [board?.title, boardId]);
  useEffect(() => {
    showStorage = () => setStorageOpen(true);
    return () => { showStorage = null; };
  }, []);
  useEffect(() => {
    if (!menu) return;
    const close = (e: PointerEvent) => !menuRef.current?.contains(e.target as Node) && setMenu(false);
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [menu]);
  useEffect(() => {
    if (!exportMenu) return;
    const close = (e: PointerEvent) => !exportRef.current?.contains(e.target as Node) && setExportMenu(false);
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [exportMenu]);

  const exportAs = (run: () => Promise<void>) => async () => {
    setExportMenu(false);
    setExporting(true);
    try {
      await run();
    } catch (err) {
      alert(`Couldn't export: ${(err as Error).message}`);
    } finally {
      setExporting(false);
    }
  };

  const commitTitle = () => {
    const t = title.trim() || 'Untitled';
    if (t !== board.title) mutate((d) => { d.boards[boardId].title = t; });
    setTitle(t);
  };

  const isRoot = boardId === rootId;
  const parents = path.slice(0, -1);
  // A board's path starts at its project's folder (Home stays out of it, as on the Projects page).
  const projectFolders = [];
  for (let f = path[1]?.folderId ? folders[path[1].folderId] : undefined; f; f = f.parentId ? folders[f.parentId] : undefined) projectFolders.unshift(f);
  const folderTrail = [];
  for (let f = browsing ? folders[browsing] : undefined; f; f = f.parentId ? folders[f.parentId] : undefined) folderTrail.unshift(f);

  // Floating panels over the canvas. The logo and place switcher live at the top of the
  // sidebar; with the sidebar collapsed they come out here, with a button to bring it back.
  // The left panel otherwise just shows where you are.
  const hasPath = browsing === null || browsing === TRASH || folderTrail.length > 0;
  return (
    <>
      <header className={`topbar topbar-left ${hasPath || !sidebarOpen ? '' : 'empty'}`}>
        {!sidebarOpen && (
          <>
            <PlaceSwitcher compact onSettings={() => setStorageOpen(true)} />
            {/* On phones the tools bar takes the bottom edge, so the button stays up here. */}
            <button className="icon-btn phone-only" onClick={() => setUI({ sidebarOpen: true })} aria-label="Show sidebar" title={`Show sidebar (${MOD}\\)`}>
              <PanelLeftOpen size={18} />
            </button>
            {hasPath && <span className="topbar-sep" />}
          </>
        )}
        {browsing !== null ? (
          <nav className="breadcrumbs" aria-label="Folder path">
            {folderTrail.slice(0, -1).map((f) => (
              <span key={f.id} className="crumb">
                <button onClick={() => browse(f.id)}>{f.name}</button>
                <ChevronRight size={14} className="crumb-sep" aria-hidden="true" />
              </span>
            ))}
            {folderTrail.length > 0 && <Folder size={18} className="crumb-folder" aria-hidden="true" />}
            {(browsing === TRASH || folderTrail.length > 0) && (
              <span className="board-heading static">{browsing === TRASH ? 'Trash' : folderTrail.at(-1)!.name}</span>
            )}
          </nav>
        ) : (
          <nav className="breadcrumbs" aria-label="Board path">
            {projectFolders.map((f) => (
              <span key={f.id} className="crumb">
                <button className="crumb-folder-link" onClick={() => browse(f.id)}>
                  <Folder size={14} aria-hidden="true" /> {f.name}
                </button>
                <ChevronRight size={14} className="crumb-sep" aria-hidden="true" />
              </span>
            ))}
            {parents.slice(1).map((b) => (
              <span key={b.id} className="crumb">
                <button onClick={() => openBoard(b.id)}>{b.title || 'Untitled'}</button>
                <ChevronRight size={14} className="crumb-sep" aria-hidden="true" />
              </span>
            ))}
            {isRoot ? (
              <span className="board-heading static">Home</span>
            ) : (
              <>
                {board && <BoardIcon icon={board.icon} color={board.color} size={20} />}
                <input
                  className="board-heading"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  onBlur={commitTitle}
                  onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                  aria-label="Board title"
                />
              </>
            )}
          </nav>
        )}
      </header>

      {/* Where the sidebar's bottom row (Trash and collapse) was, so it comes back from the same spot. */}
      {!sidebarOpen && (
        <button className="sidebar-expand" onClick={() => setUI({ sidebarOpen: true })} title={`Show sidebar (${MOD}\\)`}>
          <PanelLeftOpen size={16} /> Folders
        </button>
      )}

      <div className="topbar topbar-right">
        <button className="icon-btn" onClick={undo} disabled={!canUndo} aria-label="Undo" title={`Undo (${MOD}Z)`}><Undo2 size={18} /></button>
        <button className="icon-btn" onClick={redo} disabled={!canRedo} aria-label="Redo" title={`Redo (${SHIFT}${MOD}Z)`}><Redo2 size={18} /></button>
        <span className="topbar-sep" />
        <button className="icon-btn" onClick={onSearch} aria-label="Search" title={`Search (${MOD}K)`}><Search size={18} /></button>
        <div className="menu-wrap" ref={menuRef}>
          <button className="icon-btn" onClick={() => setMenu((m) => !m)} aria-label="Settings" title="Settings"><Settings size={18} /></button>
          {menu && (
            <div className="menu">
              {(nativeStorage() || googleConfigured()) && (
                <button onClick={() => { setStorageOpen(true); setMenu(false); }}><FolderCog size={14} /> Storage location…</button>
              )}
              <button onClick={() => { downloadJSON(getState().doc); setMenu(false); }}><Download size={14} /> Export workspace</button>
              <button onClick={() => { importJSON(); setMenu(false); }}><Upload size={14} /> Import workspace</button>
              <button onClick={() => { onShortcuts(); setMenu(false); }}><Keyboard size={14} /> Keyboard shortcuts <kbd className="menu-kbd">?</kbd></button>
              <button onClick={() => { if (confirm('Reset to the demo workspace? You can undo this.')) replaceDoc(seedDoc()); setMenu(false); }}>
                <RotateCcw size={14} /> Reset to demo
              </button>
            </div>
          )}
        </div>
        <div className="menu-wrap" ref={exportRef}>
          <button className="icon-btn" onClick={() => setExportMenu((m) => !m)} disabled={exporting} aria-haspopup="menu" aria-label="Export" title={exporting ? 'Exporting…' : 'Export'}>
            <Download size={18} />
          </button>
          {exportMenu && (
            <div className="menu" role="menu">
              <button role="menuitem" disabled={browsing !== null} onClick={exportAs(exportBoardImage)}>
                <FileImage size={14} /> This board as an image (PNG)
              </button>
              <button role="menuitem" disabled={browsing !== null} onClick={exportAs(exportBoardPdf)}>
                <FileText size={14} /> This board as a PDF
              </button>
              <div className="menu-sep" />
              <button role="menuitem" onClick={() => { downloadJSON(getState().doc); setExportMenu(false); }}>
                <HardDriveDownload size={14} /> Whole workspace (backup file)
              </button>
            </div>
          )}
        </div>
      </div>
      {storageOpen && <StorageDialog onClose={() => setStorageOpen(false)} />}
    </>
  );
}
