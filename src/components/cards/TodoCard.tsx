import { Check } from 'lucide-react';
import { flushSync } from 'react-dom';
import type { TodoEl } from '../../types';
import { mutate } from '../../store';
import { uid } from '../../doc';
import { Editable, focusEnd } from '../Editable';

const focusItem = (itemId: string) => focusEnd(document.querySelector<HTMLElement>(`[data-item-id="${itemId}"]`));

export function TodoCard({ el, editing }: { el: TodoEl; editing: boolean }) {
  const edit = (fn: (t: TodoEl) => void) => mutate((d) => fn(d.elements[el.id] as TodoEl), 'pending');
  // Render structural changes immediately so focus can move before the next keystroke.
  const editNow = (fn: (t: TodoEl) => void) => flushSync(() => edit(fn));
  const done = el.items.filter((i) => i.done).length;

  const insertAfter = (index: number) => {
    const id = uid();
    editNow((t) => { t.items.splice(index + 1, 0, { id, text: '', done: false }); });
    focusItem(id);
  };

  return (
    <div className="card-body todo">
      {(el.title || editing) && (
        <Editable
          className="todo-title"
          value={el.title}
          editing={editing}
          placeholder="Title"
          onEnter={() => (el.items[0] ? focusItem(el.items[0].id) : insertAfter(-1))}
          onChange={(title) => edit((t) => { t.title = title; })}
        />
      )}
      {el.items.length > 0 && (
        <div className="todo-progress">
          <div className="todo-progress-bar" style={{ width: `${(done / el.items.length) * 100}%` }} />
        </div>
      )}
      <ul className="todo-items">
        {el.items.map((item, i) => (
          <li key={item.id} className={item.done ? 'done' : ''}>
            <button
              className="todo-check"
              data-nodrag
              aria-label={item.done ? 'Mark as not done' : 'Mark as done'}
              onClick={() => mutate((d) => {
                const it = (d.elements[el.id] as TodoEl).items[i];
                it.done = !it.done;
              })}
            >
              {item.done && <Check size={11} strokeWidth={3} />}
            </button>
            <Editable
              dataId={item.id}
              value={item.text}
              editing={editing}
              placeholder="To-do"
              onEnter={() => insertAfter(i)}
              onBackspaceEmpty={() => {
                if (el.items.length === 1) return;
                const prev = el.items[i - 1] ?? el.items[i + 1];
                editNow((t) => { t.items.splice(i, 1); });
                if (prev) focusItem(prev.id);
              }}
              onChange={(text) => edit((t) => { t.items[i].text = text; })}
            />
          </li>
        ))}
      </ul>
      {editing && (
        <button className="todo-add" data-nodrag onClick={() => insertAfter(el.items.length - 1)}>
          + Add item
        </button>
      )}
    </div>
  );
}
