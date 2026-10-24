import type { CommentEl } from '../../types';
import { mutate } from '../../store';
import { Editable } from '../Editable';

function timeAgo(t: number) {
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(t).toLocaleDateString();
}

export function CommentCard({ el, editing }: { el: CommentEl; editing: boolean }) {
  return (
    <div className="card-body comment">
      <div className="comment-head">
        <span className="avatar">Y</span>
        <span className="comment-author">You</span>
        <span className="comment-time">{timeAgo(el.createdAt)}</span>
      </div>
      <Editable
        value={el.text}
        editing={editing}
        placeholder="Add a comment…"
        onChange={(text) => mutate((d) => { (d.elements[el.id] as CommentEl).text = text; }, 'pending')}
      />
    </div>
  );
}
