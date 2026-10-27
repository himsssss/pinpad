import { useEffect } from 'react';
import { X } from 'lucide-react';
import { MOD, SHIFT } from '../shortcuts';

const GROUPS: [string, [string, string][]][] = [
  ['Add', [
    ['Double-click the board', 'New note'],
    [`${MOD}V`, 'Paste text, a link or an image as a card'],
    ['Drag a tool from the left', 'Add that card where you drop it'],
  ]],
  ['Edit', [
    ['Click a card', 'Edit it'],
    [`${MOD}D`, 'Duplicate'],
    [`${MOD}C / ${MOD}V`, 'Copy and paste cards'],
    ['Delete', 'Delete selected cards'],
    ['Arrow keys', `Nudge (${SHIFT} for 10px)`],
    ['Right-click a card', 'More actions'],
    [`${MOD}Z / ${SHIFT}${MOD}Z`, 'Undo and redo'],
  ]],
  ['Move around', [
    ['Space + drag, or scroll', 'Pan'],
    [`${MOD} + scroll, or pinch`, 'Zoom'],
    [`${MOD}A`, 'Select everything on the board'],
    ['Enter', 'Open the selected board'],
    [`${MOD}K`, 'Search every board'],
    [`${MOD}\\`, 'Show or hide the sidebar'],
    ['?', 'Show these shortcuts'],
  ]],
];

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return (
    <div className="search-backdrop" onPointerDown={onClose}>
      <div className="dialog shortcuts" role="dialog" aria-labelledby="shortcuts-title" onPointerDown={(e) => e.stopPropagation()}>
        <div className="dialog-head">
          <h2 id="shortcuts-title">Keyboard shortcuts</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        {GROUPS.map(([title, rows]) => (
          <section key={title}>
            <h3 className="shortcuts-group">{title}</h3>
            <dl className="shortcuts-list">
              {rows.map(([keys, what]) => (
                <div key={keys}>
                  <dt><kbd>{keys}</kbd></dt>
                  <dd>{what}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </div>
  );
}
