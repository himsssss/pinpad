import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { LayoutTemplate, Plus, X } from 'lucide-react';
import type { SavedTemplate } from '../types';
import { useStore } from '../store';
import { projects } from '../doc';
import { TEMPLATES, applyTemplate } from '../templates';
import { addTemplateToBoard, deleteTemplate, saveAsTemplate } from '../projectActions';
import { askConfirm } from './ConfirmDialog';
import { BoardIcon } from './BoardIcon';

const NO_TEMPLATES: SavedTemplate[] = [];
/** Built-in templates the user removed from the list (on this device). */
const HIDDEN_KEY = 'pinpad:hidden-templates';

function hiddenBuiltIns(): string[] {
  try {
    return JSON.parse(localStorage.getItem(HIDDEN_KEY) ?? '[]');
  } catch {
    return [];
  }
}

function setHiddenBuiltIns(ids: string[]) {
  try {
    localStorage.setItem(HIDDEN_KEY, JSON.stringify(ids));
  } catch {
    // Not remembered; the template shows again next time.
  }
}

/**
 * The template choices on an empty board: the built-in ones and the user's own, each
 * removable, plus "Create template" to save one of their projects as a template.
 */
export function TemplateChips() {
  const saved = useStore((s) => s.doc.templates ?? NO_TEMPLATES);
  const doc = useStore((s) => s.doc);
  const boardId = useStore((s) => s.ui.boardId);
  const [hidden, setHidden] = useState(hiddenBuiltIns);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!creating) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setCreating(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [creating]);

  const builtIns = TEMPLATES.filter((t) => !hidden.includes(t.id));

  const hideBuiltIn = async (id: string, name: string) => {
    const ok = await askConfirm({
      title: `Remove the “${name}” template?`,
      message: 'It leaves this list. You can bring the built-in templates back any time.',
      confirm: 'Remove',
    });
    if (!ok) return;
    const next = [...hidden, id];
    setHiddenBuiltIns(next);
    setHidden(next);
  };

  const removeSaved = async (t: SavedTemplate) => {
    const ok = await askConfirm({
      title: `Delete the “${t.name}” template?`,
      message: 'Projects already made from it stay as they are.',
      confirm: 'Delete',
      danger: true,
    });
    if (ok) deleteTemplate(t.id);
  };

  const restore = () => {
    setHiddenBuiltIns([]);
    setHidden([]);
  };

  // Any project can become a template, except the empty board this list is shown on.
  const sources = projects(doc).filter((p) => p.id !== boardId);

  return (
    <div className="templates" role="group" aria-label="Start from a template">
      <span className="templates-label">Or start from a template</span>
      {builtIns.map((t) => (
        <span key={t.id} className="template-chip-wrap">
          <button className="template-chip" onClick={() => applyTemplate(t)}>
            <t.icon size={16} aria-hidden="true" /> {t.name}
          </button>
          <button className="template-chip-remove" aria-label={`Remove the ${t.name} template`} title="Remove from this list" onClick={() => hideBuiltIn(t.id, t.name)}>
            <X size={11} strokeWidth={2.5} />
          </button>
        </span>
      ))}
      {/* The user's own templates, saved from their boards. */}
      {saved.map((t) => {
        const look = t.boards.find((b) => b.id === t.rootId);
        return (
          <span key={t.id} className="template-chip-wrap">
            <button className="template-chip saved" onClick={() => addTemplateToBoard(t.id)} title="Your template">
              <BoardIcon icon={look?.icon ?? 'layout'} color={look?.color ?? '#e6e6e6'} size={18} /> {t.name}
            </button>
            <button className="template-chip-remove" aria-label={`Delete the ${t.name} template`} title="Delete template" onClick={() => removeSaved(t)}>
              <X size={11} strokeWidth={2.5} />
            </button>
          </span>
        );
      })}
      <button className="template-chip create" onClick={() => setCreating(true)}>
        <Plus size={16} aria-hidden="true" /> Create template
      </button>
      {hidden.length > 0 && (
        <button className="templates-restore" onClick={restore}>Bring back built-in templates</button>
      )}

      {/* On the page itself: inside the board, scrolling the list would pan the board. */}
      {creating && createPortal(
        <div className="search-backdrop" onPointerDown={() => setCreating(false)}>
          <div className="dialog template-source" role="dialog" aria-labelledby="template-source-title" onPointerDown={(e) => e.stopPropagation()}>
            <div className="dialog-head">
              <h2 id="template-source-title">Create a template</h2>
              <button className="icon-btn" onClick={() => setCreating(false)} aria-label="Close"><X size={18} /></button>
            </div>
            <p className="dialog-text">Pick a project to save as a template. Its boards and cards are copied; the project itself doesn't change.</p>
            {sources.length ? (
              <div className="template-source-list">
                {sources.map((p) => (
                  <button
                    key={p.id}
                    className="project-row"
                    onClick={() => {
                      saveAsTemplate(p.id);
                      setCreating(false);
                    }}
                  >
                    <BoardIcon icon={p.icon} color={p.color} size={22} />
                    <span className="project-name">{p.title || 'Untitled'}</span>
                    <LayoutTemplate size={14} className="template-source-hint" />
                  </button>
                ))}
              </div>
            ) : (
              <p className="dialog-text">There are no other projects yet. Build a board you'd like to reuse, then save it as a template.</p>
            )}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
