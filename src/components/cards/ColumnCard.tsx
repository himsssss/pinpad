import { ChevronDown, ChevronRight } from 'lucide-react';
import { Fragment } from 'react';
import type { ColumnEl } from '../../types';
import { mutate, useStore } from '../../store';
import { Editable } from '../Editable';
import { CardFrame } from '../CardFrame';

export function ColumnCard({ el, editing }: { el: ColumnEl; editing: boolean }) {
  const drop = useStore((s) => (s.ui.dropTarget?.kind === 'column' && s.ui.dropTarget.id === el.id ? s.ui.dropTarget : null));
  const indicator = (i: number) => drop?.index === i && <div className="column-drop-indicator" />;
  return (
    <div className={`card-body column ${drop ? 'drop-over' : ''}`}>
      <div className="column-head" data-column-head>
        <button
          className="column-toggle"
          data-nodrag
          aria-label={el.collapsed ? 'Expand column' : 'Collapse column'}
          onClick={() => mutate((d) => { const c = d.elements[el.id] as ColumnEl; c.collapsed = !c.collapsed; })}
        >
          {el.collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
        </button>
        <Editable
          className="column-title"
          value={el.title}
          editing={editing}
          placeholder="Untitled column"
          onEnter={() => (document.activeElement as HTMLElement | null)?.blur()}
          onChange={(title) => mutate((d) => { (d.elements[el.id] as ColumnEl).title = title; }, 'pending')}
        />
        <span className="column-count">{el.children.length}</span>
      </div>
      {!el.collapsed && (
        <div className="column-list">
          {el.children.map((id, i) => (
            <Fragment key={id}>
              {indicator(i)}
              <div data-col-child>
                <CardFrame id={id} inColumn />
              </div>
            </Fragment>
          ))}
          {indicator(el.children.length)}
          {!el.children.length && !drop && <div className="column-empty">Drag cards here</div>}
        </div>
      )}
    </div>
  );
}
