import { useEffect, useState } from 'react';
import { ExternalLink, Play } from 'lucide-react';
import type { LinkEl } from '../../types';
import { getState, mutate } from '../../store';
import { hostname, normalizeUrl } from '../../doc';
import { embedUrl, fetchPreview } from '../../linkPreview';
import { Editable } from '../Editable';

/** Links whose preview is being fetched, so remounts don't fetch twice. */
const inFlight = new Set<string>();

function usePreview(el: LinkEl) {
  useEffect(() => {
    if (!el.url || el.previewFor === el.url || inFlight.has(el.id)) return;
    inFlight.add(el.id);
    const url = el.url;
    fetchPreview(url).then((preview) => {
      inFlight.delete(el.id);
      const current = getState().doc.elements[el.id];
      if (current?.type !== 'link' || current.url !== url) return;
      // Not an undo step: the preview is derived from the URL, not an edit.
      mutate((d) => {
        const l = d.elements[el.id] as LinkEl;
        l.preview = preview ?? undefined;
        l.previewFor = url;
        if (preview?.title && (!l.title || l.title === hostname(url))) l.title = preview.title;
      }, 'none');
    });
  }, [el.id, el.url, el.previewFor]);
}

/** Inline playback needs a normal web origin; the desktop apps open videos in the browser. */
const canEmbed = location.protocol === 'http:' || location.protocol === 'https:';

export function LinkCard({ el, editing }: { el: LinkEl; editing: boolean }) {
  usePreview(el);
  const [playing, setPlaying] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);

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
  const preview = el.previewFor === el.url ? el.preview : undefined;
  const video = preview?.video;
  const image = !imageFailed ? preview?.image : undefined;
  const favicon = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`;

  return (
    <div className="card-body link">
      {playing && video ? (
        <div className="link-media video">
          <iframe
            src={embedUrl(video)}
            title={el.title || 'Video'}
            allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
          />
        </div>
      ) : image ? (
        <div className={`link-media ${video ? 'video' : ''}`}>
          <img src={image} alt="" draggable={false} onError={() => setImageFailed(true)} />
          {video && (
            <button
              className="link-play"
              data-nodrag
              aria-label="Play video"
              onClick={() => (canEmbed ? setPlaying(true) : window.open(el.url, '_blank', 'noopener'))}
            >
              <Play size={22} fill="currentColor" strokeWidth={0} />
            </button>
          )}
        </div>
      ) : (
        <div className="link-preview">
          <img src={favicon} alt="" draggable={false} />
        </div>
      )}
      <div className="link-meta">
        <div className="link-host">
          <img className="link-favicon" src={favicon} alt="" draggable={false} />
          <span className="link-url" title={el.url}>{el.url.replace(/^https?:\/\/(www\.)?/, '')}</span>
          <a href={el.url} target="_blank" rel="noreferrer noopener" data-nodrag aria-label="Open link">
            <ExternalLink size={13} />
          </a>
        </div>
        <Editable
          className="link-title"
          value={el.title}
          editing={editing}
          placeholder="Link title"
          onEnter={() => {}}
          onChange={(title) => mutate((d) => { (d.elements[el.id] as LinkEl).title = title; }, 'pending')}
        />
        {preview?.description && <p className="link-desc">{preview.description}</p>}
      </div>
    </div>
  );
}
