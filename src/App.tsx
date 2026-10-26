import { useEffect, useState } from 'react';
import { getState, openBoard, redo, select, setUI, startEditing, undo, useStore } from './store';
import { copySelection, deleteSelection, duplicateSelection, nudgeSelection, paste, selectAll } from './actions';
import { Header } from './components/Header';
import { Toolbar } from './components/Toolbar';
import { Sidebar } from './components/Sidebar';
import { Canvas } from './components/Canvas';
import { SearchDialog } from './components/SearchDialog';

const isTypingTarget = (t: EventTarget | null) =>
  t instanceof HTMLElement && !!t.closest('input, textarea, [contenteditable="true"]');

export function App() {
  const [searching, setSearching] = useState(false);
  const boardTitle = useStore((s) => (s.ui.boardId === s.doc.rootId ? '' : s.doc.boards[s.ui.boardId]?.title));
  const sidebarOpen = useStore((s) => s.ui.sidebarOpen);

  // The macOS app shows this as its window title.
  useEffect(() => {
    document.title = boardTitle ? `${boardTitle} – Pinpad` : 'Pinpad';
  }, [boardTitle]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      const { ui, doc } = getState();
      const typing = isTypingTarget(e.target);

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

    const onCopy = (e: ClipboardEvent) => !isTypingTarget(e.target) && copySelection(e);
    const onPaste = (e: ClipboardEvent) => !isTypingTarget(e.target) && paste(e);
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
    <div className={`app ${sidebarOpen ? 'with-sidebar' : ''}`}>
      <Canvas />
      <Header onSearch={() => setSearching(true)} />
      <Sidebar />
      <Toolbar />
      {searching && <SearchDialog onClose={() => setSearching(false)} />}
    </div>
  );
}
