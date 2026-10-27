import { useEffect, useState } from 'react';
import { ExternalLink, Music, Play, X } from 'lucide-react';
import type { LinkEl } from '../../types';
import { getState, mutate, setUI, useStore } from '../../store';
import { hostname, normalizeUrl } from '../../doc';
import { fetchPreview } from '../../linkPreview';
import { isSafeUrl } from '../../sanitize';
import { iframeSrc, mediaEmbed, type MediaEmbed } from '../../media';
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

/** The open player. Unless the card is the only one selected, a blocker covers it so the card can still be dragged. */
function Player({ media, title, interactive }: { media: MediaEmbed; title: string; interactive: boolean }) {
  const blocker = !interactive && <div className="media-blocker" title="Select the card to use the player" />;
  if (media.kind === 'video') {
    return (
      <div className="link-media video">
        <video src={media.src} controls autoPlay playsInline />
        {blocker}
      </div>
    );
  }
  if (media.kind === 'audio') {
    return (
      <div className="link-media audio">
        <audio src={media.src} controls autoPlay />
        {blocker}
      </div>
    );
  }
  const src = iframeSrc(media.src);
  return (
    <div className="link-media player" style={media.aspect ? { aspectRatio: String(media.aspect) } : { height: media.height }}>
      {src && (
        <iframe
          src={src}
          title={title || media.provider}
          allow="autoplay; encrypted-media; picture-in-picture; fullscreen; clipboard-write"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
        />
      )}
      {blocker}
    </div>
  );
}

export function LinkCard({ el, editing }: { el: LinkEl; editing: boolean }) {
  usePreview(el);
  const playing = useStore((s) => s.ui.playingId === el.id);
  const soleSelected = useStore((s) => s.ui.selection.length === 1 && s.ui.selection[0] === el.id);
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
  const media = mediaEmbed(el.url);
  const image = !imageFailed ? preview?.image : undefined;
  const favicon = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`;
  const audioOnly = media?.kind === 'audio' || (media?.kind === 'iframe' && !media.aspect);

  const play = () => {
    // A player that can't be embedded here (e.g. no wrapper) opens in the browser instead.
    if (media?.kind === 'iframe' && !iframeSrc(media.src)) {
      if (isSafeUrl(el.url)) window.open(el.url, '_blank', 'noopener');
    }
    else setUI({ playingId: el.id, selection: [el.id] });
  };

  let top: React.ReactNode;
  if (playing && media) {
    top = (
      <div className="link-player">
        <Player media={media} title={el.title} interactive={soleSelected} />
      </div>
    );
  } else if (image) {
    top = (
      <div className={`link-media ${media && !audioOnly ? 'video' : ''}`}>
        <img src={image} alt="" draggable={false} onError={() => setImageFailed(true)} />
        {media && <PlayButton audio={audioOnly} onPlay={play} />}
      </div>
    );
  } else if (media) {
    top = (
      <div className={`link-media placeholder ${audioOnly ? 'audio-placeholder' : 'video'}`}>
        <span className="media-provider">{media.provider}</span>
        <PlayButton audio={audioOnly} onPlay={play} />
      </div>
    );
  } else {
    top = (
      <div className="link-preview">
        <img src={favicon} alt="" draggable={false} />
      </div>
    );
  }

  return (
    <div className="card-body link">
      {top}
      <div className="link-meta">
        <div className="link-host">
          <img className="link-favicon" src={favicon} alt="" draggable={false} />
          <span className="link-url" title={el.url}>{el.url.replace(/^https?:\/\/(www\.)?/, '')}</span>
          {/* Outside the player, so an embedded video can never swallow the click. */}
          {playing && (
            <button className="media-close" data-nodrag aria-label="Close player" title="Back to preview (Esc)" onClick={() => setUI({ playingId: null })}>
              <X size={12} strokeWidth={2.5} /> Close
            </button>
          )}
          {isSafeUrl(el.url) && (
            <a href={el.url} target="_blank" rel="noreferrer noopener" data-nodrag aria-label="Open link">
              <ExternalLink size={13} />
            </a>
          )}
        </div>
        <Editable
          className="link-title"
          value={el.title}
          editing={editing}
          placeholder="Link title"
          onEnter={() => {}}
          onChange={(title) => mutate((d) => { (d.elements[el.id] as LinkEl).title = title; }, 'pending')}
        />
        {preview?.description && !playing && <p className="link-desc">{preview.description}</p>}
      </div>
    </div>
  );
}

function PlayButton({ audio, onPlay }: { audio: boolean; onPlay: () => void }) {
  return (
    <button className="link-play" data-nodrag aria-label={audio ? 'Play audio' : 'Play video'} onClick={onPlay}>
      {audio ? <Music size={20} /> : <Play size={22} fill="currentColor" strokeWidth={0} />}
    </button>
  );
}
