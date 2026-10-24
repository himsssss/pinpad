import type { NoteEl } from '../../types';
import { mutate } from '../../store';
import { Editable } from '../Editable';

export function NoteCard({ el, editing }: { el: NoteEl; editing: boolean }) {
  return (
    <div className="card-body note">
      <Editable
        rich
        value={el.html}
        editing={editing}
        placeholder="Write something…"
        onChange={(html) => mutate((d) => { (d.elements[el.id] as NoteEl).html = html; }, 'pending')}
      />
    </div>
  );
}
