import { useEffect, useRef, useState } from 'react';
import { ChevronRight, Download, Redo2, Search, Settings, Undo2, Upload, RotateCcw } from 'lucide-react';
import type { Doc } from '../types';
import { getState, mutate, openBoard, redo, undo, useStore } from '../store';
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
      const doc = JSON.parse(await file.text()) as Doc;
      if (!doc.boards?.[doc.rootId] || !doc.elements) throw new Error('Not a workspace file');
      if (confirm('Replace your workspace with this file? You can undo this.')) replaceDoc(doc);
    } catch (err) {
      alert(`Couldn't import: ${(err as Error).message}`);
    }
  };
  input.click();
}

export function Header({ onSearch }: { onSearch: () => void }) {
  const boardId = useStore((s) => s.ui.boardId);
  const boards = useStore((s) => s.doc.boards);
  const rootId = useStore((s) => s.doc.rootId);
  const canUndo = useStore((s) => s.canUndo);
  const canRedo = useStore((s) => s.canRedo);
  const saved = useStore((s) => s.saved);
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const path = boardPath(getState().doc, boardId);
  const board = boards[boardId];
  const [title, setTitle] = useState(board?.title ?? '');

  useEffect(() => setTitle(board?.title ?? ''), [board?.title, boardId]);
  useEffect(() => {
    if (!menu) return;
    const close = (e: PointerEvent) => !menuRef.current?.contains(e.target as Node) && setMenu(false);
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [menu]);

  const commitTitle = () => {
    const t = title.trim() || 'Untitled';
    if (t !== board.title) mutate((d) => { d.boards[boardId].title = t; });
    setTitle(t);
  };

  const isRoot = boardId === rootId;
  const parents = path.slice(0, -1);

  // Miro-style floating panels over the canvas: board identity on the left, actions on the right.
  return (
    <>
      <header className="topbar topbar-left">
        <button className="logo" onClick={() => openBoard(rootId)} aria-label="Pinpad home" title="Home">
          <PinpadMark size={28} />
          <span className="wordmark">Pinpad</span>
        </button>
        <span className="topbar-sep" />
        <nav className="breadcrumbs" aria-label="Board path">
          {parents.map((b, i) => (
            <span key={b.id} className="crumb">
              <button onClick={() => openBoard(b.id)}>{i === 0 ? 'Home' : b.title || 'Untitled'}</button>
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
        <span className={`save-status ${saved ? 'saved' : 'saving'}`} title={saved ? 'All changes saved' : 'Saving…'} />
      </header>

      <div className="topbar topbar-right">
        <button className="icon-btn" onClick={undo} disabled={!canUndo} aria-label="Undo" title={`Undo (${MOD}Z)`}><Undo2 size={18} /></button>
        <button className="icon-btn" onClick={redo} disabled={!canRedo} aria-label="Redo" title={`Redo (${SHIFT}${MOD}Z)`}><Redo2 size={18} /></button>
        <span className="topbar-sep" />
        <button className="icon-btn" onClick={onSearch} aria-label="Search" title={`Search (${MOD}K)`}><Search size={18} /></button>
        <div className="menu-wrap" ref={menuRef}>
          <button className="icon-btn" onClick={() => setMenu((m) => !m)} aria-label="Settings" title="Settings"><Settings size={18} /></button>
          {menu && (
            <div className="menu">
              <button onClick={() => { downloadJSON(getState().doc); setMenu(false); }}><Download size={14} /> Export workspace</button>
              <button onClick={() => { importJSON(); setMenu(false); }}><Upload size={14} /> Import workspace</button>
              <button onClick={() => { if (confirm('Reset to the demo workspace? You can undo this.')) replaceDoc(seedDoc()); setMenu(false); }}>
                <RotateCcw size={14} /> Reset to demo
              </button>
            </div>
          )}
        </div>
        <button className="btn-primary" onClick={() => downloadJSON(getState().doc)} title="Export your workspace as a file">
          <Download size={15} /> Export
        </button>
      </div>
    </>
  );
}

/** The app mark: the forest pushpin on a lime square, matching the app icon. */
export function PinpadMark({ size }: { size: number }) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} aria-hidden="true">
      <rect width="32" height="32" rx="7" fill="#9fe870" />
      <g transform="rotate(35 16 16)" fill="#163300">
        <path d="M12 5h8a1.5 1.5 0 0 1 0 3h-8a1.5 1.5 0 0 1 0-3z" />
        <path d="M13.2 8h5.6l1 6.5h-7.6z" />
        <path d="M9.5 14.5h13a1.75 1.75 0 0 1 0 3.5h-13a1.75 1.75 0 0 1 0-3.5z" />
        <path d="M16 18v9.5" stroke="#163300" strokeWidth="1.8" strokeLinecap="round" />
      </g>
    </svg>
  );
}
