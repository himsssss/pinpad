import { useEffect, useState } from 'react';
import { getState, openBoard, redo, select, setUI, startEditing, undo, useStore } from './store';
import { copySelection, deleteSelection, duplicateSelection, nudgeSelection, paste, selectAll } from './actions';
import { Header } from './components/Header';
import { Toolbar } from './components/Toolbar';
import { Sidebar } from './components/Sidebar';
import { Canvas } from './components/Canvas';
import { SearchDialog } from './components/SearchDialog';
import { ProjectsPage } from './components/ProjectsPage';
import { TRASH, TrashPage } from './components/TrashPage';
import { UpdatePrompt } from './components/UpdatePrompt';
import { ConfirmDialog } from './components/ConfirmDialog';
import { ShareDialog } from './components/ShareDialog';
import { ViewBanner } from './components/ViewBanner';
import { ShortcutsDialog } from './components/ShortcutsDialog';
import { CardMenu } from './components/CardMenu';
import { ContextMenu } from './components/ContextMenu';
import { addElementAtCenter } from './actions';

const isTypingTarget = (t: EventTarget | null) =>
  t instanceof HTMLElement && !!t.closest('input, textarea, [contenteditable="true"]');

export function App() {
  const [searching, setSearching] = useState(false);
  const [shortcuts, setShortcuts] = useState(false);
  const browsing = useStore((s) => s.ui.browsing);
  const boardTitle = useStore((s) =>
    s.ui.browsing === TRASH ? 'Trash' : s.ui.browsing !== null ? s.doc.folders[s.ui.browsing]?.name ?? s.storageName ?? 'Projects' : s.ui.boardId === s.doc.rootId ? '' : s.doc.boards[s.ui.boardId]?.title,
  );
  const sidebarOpen = useStore((s) => s.ui.sidebarOpen);
  const viewing = useStore((s) => !!s.viewing);

  // The macOS app shows this as its window title.
  useEffect(() => {
    document.title = boardTitle && boardTitle !== 'Pinpad' ? `${boardTitle} – Pinpad` : 'Pinpad';
  }, [boardTitle]);

  // Something shared to the installed app from another app (a link or text) becomes a card.
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const text = params.get('text') ?? '';
    const shared = params.get('url') || text.match(/https?:\/\/\S+/)?.[0] || text || params.get('title');
    if (!shared) return;
    history.replaceState(null, '', location.pathname);
    addElementAtCenter(/^https?:\/\/\S+$/.test(shared.trim()) ? 'link' : 'note', shared.trim());
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      const { ui, doc } = getState();
      const typing = isTypingTarget(e.target);
      // Board shortcuts don't apply on the Projects page.
      if (e.key === '?' && !typing && !mod) {
        e.preventDefault();
        setShortcuts(true);
        return;
      }
      if (ui.browsing !== null && !(mod && ['\\', 'k', 'z', 'y'].includes(e.key.toLowerCase()))) return;

      if (mod && e.key === '\\') {
        e.preventDefault();
        setUI((u) => ({ sidebarOpen: !u.sidebarOpen }));
        return;
      }
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearching(true);
        return;
      }
      if (e.key === 'Escape') {
        if (ui.playingId && ui.selection.includes(ui.playingId)) {
          setUI({ playingId: null });
        } else if (ui.draw) {
          const drawn = ui.draw.drawingId && doc.elements[ui.draw.drawingId];
          setUI({ draw: null });
          select(drawn ? [drawn.id] : []);
        } else if (ui.editingId) {
          (document.activeElement as HTMLElement | null)?.blur();
          setUI({ editingId: null, editPoint: null });
        } else select([]);
        return;
      }
      if (mod && e.key.toLowerCase() === 'z') {
        // Text fields keep their own undo while typing outside a card (e.g. the board title).
        if (typing && !ui.editingId) return;
        e.preventDefault();
        if (ui.editingId) setUI({ editingId: null, editPoint: null });
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
        return;
      }
      if (typing) return;

      if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault();
        deleteSelection();
      } else if (mod && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        duplicateSelection();
      } else if (mod && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        selectAll();
      } else if (e.key === 'Enter' && ui.selection.length === 1) {
        e.preventDefault();
        const el = doc.elements[ui.selection[0]];
        if (el?.type === 'board') openBoard(el.targetId);
        else if (el && el.type !== 'line') startEditing(el.id);
      } else if (e.key.startsWith('Arrow') && ui.selection.length) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        nudgeSelection(dx, dy);
      }
    };
    // The macOS app's Edit › Undo/Redo menu items call these. Plain text fields (like the
    // board title) keep their native text undo.
    const history = (direction: 'undo' | 'redo') => () => {
      if (isTypingTarget(document.activeElement) && !getState().ui.editingId) {
        document.execCommand(direction);
        return;
      }
      if (getState().ui.editingId) setUI({ editingId: null, editPoint: null });
      if (direction === 'undo') undo();
      else redo();
    };
    Object.assign(window, { __undo: history('undo'), __redo: history('redo') });

    // Cards are only copied and pasted on a board, never into one hidden behind the Projects page.
    const onBoard = (e: ClipboardEvent) => !isTypingTarget(e.target) && getState().ui.browsing === null;
    const onCopy = (e: ClipboardEvent) => onBoard(e) && copySelection(e);
    const onPaste = (e: ClipboardEvent) => onBoard(e) && paste(e);
    window.addEventListener('keydown', onKey);
    window.addEventListener('copy', onCopy);
    window.addEventListener('paste', onPaste);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('copy', onCopy);
      window.removeEventListener('paste', onPaste);
    };
  }, []);

  return (
    // The canvas fills the window; header, folders and tools float over it in rounded panels.
    <div className={`app ${sidebarOpen ? 'with-sidebar' : ''} ${viewing ? 'view-only' : ''}`}>
      {browsing === null ? <Canvas /> : browsing === TRASH ? <TrashPage /> : <ProjectsPage folderId={browsing || null} />}
      <Header onSearch={() => setSearching(true)} onShortcuts={() => setShortcuts(true)} />
      {sidebarOpen && <div className="sidebar-backdrop" onPointerDown={() => setUI({ sidebarOpen: false })} />}
      <Sidebar />
      {browsing === null && !viewing && <Toolbar />}
      <ViewBanner />
      {searching && <SearchDialog onClose={() => setSearching(false)} />}
      <CardMenu />
      <ContextMenu />
      <ConfirmDialog />
      <ShareDialog />
      <UpdatePrompt />
      {shortcuts && <ShortcutsDialog onClose={() => setShortcuts(false)} />}
    </div>
  );
}
