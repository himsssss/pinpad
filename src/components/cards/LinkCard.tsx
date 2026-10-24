import { ExternalLink } from 'lucide-react';
import type { LinkEl } from '../../types';
import { mutate } from '../../store';
import { hostname, normalizeUrl } from '../../doc';
import { Editable } from '../Editable';

export function LinkCard({ el, editing }: { el: LinkEl; editing: boolean }) {
  if (!el.url) {
    return (
      <div className="card-body link-empty">
        <input
          className="link-input"
          data-editor
          placeholder="Paste a link and press Enter"
          readOnly={!editing}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return;
            const url = normalizeUrl(e.currentTarget.value);
            if (!url) return;
            mutate((d) => {
              const l = d.elements[el.id] as LinkEl;
              l.url = url;
              l.title = hostname(url);
            }, 'pending');
          }}
        />
      </div>
    );
  }
  const host = hostname(el.url);
  return (
    <div className="card-body link">
      <div className="link-preview">
        <img src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`} alt="" draggable={false} />
      </div>
      <div className="link-meta">
        <Editable
          className="link-title"
          value={el.title}
          editing={editing}
          placeholder="Link title"
          onEnter={() => {}}
          onChange={(title) => mutate((d) => { (d.elements[el.id] as LinkEl).title = title; }, 'pending')}
        />
        <div className="link-host">
          <span>{host}</span>
          <a href={el.url} target="_blank" rel="noreferrer noopener" data-nodrag aria-label="Open link">
            <ExternalLink size={13} />
          </a>
        </div>
      </div>
    </div>
  );
}
