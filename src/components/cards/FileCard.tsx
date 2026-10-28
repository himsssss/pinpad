import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Download, Maximize2, Pause, Play, X } from 'lucide-react';
import type { FileEl } from '../../types';
import { getAttachment } from '../../attachments';
import { pdfPreview } from '../../pdfPreview';
import { fullPreview, richPreview, type Rich } from '../../filePreview';
import { extensionOf, formatSize, formatTime, isText, kindOf, lookOf, type Kind } from '../../fileTypes';

/**
 * The type a file is shown as. Board files can come from anywhere, so only types that can't
 * run code are used: anything else is a plain download, never a page that opens here.
 */
function safeType(kind: Kind, mime: string) {
  if (kind === 'pdf') return 'application/pdf';
  if ((kind === 'video' || kind === 'audio') && /^(video|audio)\/[\w.+-]+$/.test(mime)) return mime;
  return 'application/octet-stream';
}

/** The file's contents as a URL, loaded the first time something asks for it. */
function useFile(el: FileEl, kind: Kind, wanted: boolean) {
  const [url, setUrl] = useState<string | null>(null);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [missing, setMissing] = useState(false);
  const [tries, setTries] = useState(0);
  useEffect(() => {
    if (!wanted) return;
    let alive = true;
    let made: string | null = null;
    getAttachment(el.ref, el.name, el.mime)
      .then((b) => {
        if (!alive) return;
        if (!b) return setMissing(true);
        made = URL.createObjectURL(new Blob([b], { type: safeType(kind, el.mime) }));
        setMissing(false);
        setBlob(b);
        setUrl(made);
      })
      .catch(() => alive && setMissing(true));
    return () => {
      alive = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [el.ref, wanted, tries]);
  useFileArrival(missing, () => setTries((t) => t + 1));
  return { url, blob, missing };
}

/**
 * A file not here yet (still uploading from the computer it was added on) is looked for
 * again now and then, and when Pinpad comes back into view.
 */
function useFileArrival(missing: boolean, retry: () => void) {
  useEffect(() => {
    if (!missing) return;
    const again = () => document.visibilityState === 'visible' && retry();
    const timer = window.setInterval(again, 30_000);
    window.addEventListener('focus', again);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', again);
    };
  }, [missing]);
}

/** Saves the file with its own name. */
async function download(el: FileEl, url: string | null) {
  let href = url;
  if (!href) {
    const blob = await getAttachment(el.ref, el.name, el.mime);
    if (!blob) return;
    href = URL.createObjectURL(new Blob([blob], { type: 'application/octet-stream' }));
    setTimeout(() => URL.revokeObjectURL(href!), 60_000);
  }
  const a = document.createElement('a');
  a.href = href;
  a.download = el.name;
  a.click();
}

/**
 * An attached file, previewed the way its kind reads best: a PDF's first page, a video's
 * first frame, a player for audio, the start of a text, table or document, a slide, what's
 * in a zip, a font's letters, or a coloured tile for anything else. Double-click opens it large.
 */
export function FileCard({ el }: { el: FileEl }) {
  const kind = kindOf(el.name, el.mime);
  const look = lookOf(kind);
  const needsFile = kind === 'video' || kind === 'audio' || kind === 'font' || isText(kind);
  const { url, blob, missing } = useFile(el, kind, needsFile);
  const [viewing, setViewing] = useState(false);
  const [detail, setDetail] = useState<string | null>(null);

  let preview: ReactNode;
  if (missing) preview = <Tile kind={kind} name={el.name} note="Not on this device yet. It appears once it has finished uploading from where it was added." />;
  else if (kind === 'pdf') preview = <PdfPreview el={el} onDetail={setDetail} />;
  else if (kind === 'video') preview = url ? <VideoPreview url={url} name={el.name} onDetail={setDetail} /> : <Loading kind={kind} />;
  else if (kind === 'audio') preview = url ? <AudioPlayer url={url} seed={el.ref} color={look.color} onDetail={setDetail} /> : <Loading kind={kind} />;
  else if (kind === 'font') preview = url ? <FontSample url={url} id={el.ref} /> : <Loading kind={kind} />;
  else if (isText(kind)) preview = blob ? <TextPreview blob={blob} kind={kind} onDetail={setDetail} /> : <Loading kind={kind} />;
  else if (kind === 'document' || kind === 'sheet' || kind === 'slides' || kind === 'archive') preview = <RichPreview el={el} kind={kind} onDetail={setDetail} />;
  else preview = <Tile kind={kind} name={el.name} />;

  return (
    <div className="card-body file" style={{ '--file-color': look.color } as CSSProperties} onDoubleClick={(e) => (e.stopPropagation(), setViewing(true))}>
      <div className="file-preview">{preview}</div>
      <div className="file-meta">
        <span className="file-chip"><look.icon size={15} /></span>
        <span className="file-text-col">
          <span className="file-name" title={el.name}>{el.name}</span>
          <span className="file-sub">{[extensionOf(el.name).toUpperCase() || look.label, detail, formatSize(el.size)].filter(Boolean).join(' · ')}</span>
        </span>
        <span className="file-actions">
          <button className="file-action" data-nodrag onClick={() => setViewing(true)} aria-label={`Open ${el.name}`} title="Open">
            <Maximize2 size={14} />
          </button>
          <button className="file-action" data-nodrag onClick={() => download(el, url)} aria-label={`Download ${el.name}`} title="Download">
            <Download size={14} />
          </button>
        </span>
      </div>
      {viewing && <FileViewer el={el} kind={kind} onClose={() => setViewing(false)} />}
    </div>
  );
}

const Loading = ({ kind }: { kind: Kind }) => {
  const { icon: Icon } = lookOf(kind);
  return <div className="file-tile loading"><Icon size={26} strokeWidth={1.6} /></div>;
};

/** A coloured tile with the file's type, for kinds with nothing to preview. */
function Tile({ kind, name, note }: { kind: Kind; name: string; note?: string }) {
  const { icon: Icon, label } = lookOf(kind);
  return (
    <div className="file-tile">
      <span className="file-tile-icon"><Icon size={30} strokeWidth={1.6} /></span>
      <span className="file-tile-ext">{extensionOf(name).toUpperCase() || label}</span>
      {note && <span className="file-tile-note">{note}</span>}
    </div>
  );
}

function PdfPreview({ el, onDetail }: { el: FileEl; onDetail: (d: string | null) => void }) {
  const [state, setState] = useState<{ image: string; pages: number } | false | null>(null);
  useEffect(() => {
    let alive = true;
    let image: string | null = null;
    pdfPreview(el.ref, () => getAttachment(el.ref, el.name, el.mime)).then((preview) => {
      if (!alive) return;
      if (!preview) return setState(false);
      image = URL.createObjectURL(preview.image);
      setState({ image, pages: preview.pages });
      onDetail(preview.pages === 1 ? '1 page' : `${preview.pages} pages`);
    });
    return () => {
      alive = false;
      if (image) URL.revokeObjectURL(image);
    };
  }, [el.ref]);
  if (state === null) return <Loading kind="pdf" />;
  if (!state) return <Tile kind="pdf" name={el.name} />;
  return (
    <div className="file-page">
      <img src={state.image} alt={`First page of ${el.name}`} draggable={false} />
    </div>
  );
}

function VideoPreview({ url, name, onDetail }: { url: string; name: string; onDetail: (d: string | null) => void }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  if (failed) return <Tile kind="video" name={name} note="This browser can't play this video. Download it to watch." />;
  return (
    <div className={`file-video ${playing ? 'playing' : ''}`} data-nodrag={playing || undefined}>
      {/* #t= shows a frame from the start instead of a black box. */}
      <video
        ref={ref}
        src={`${url}#t=0.1`}
        preload="metadata"
        playsInline
        controls={playing}
        onLoadedMetadata={(e) => {
          setDuration(e.currentTarget.duration);
          onDetail(formatTime(e.currentTarget.duration) || null);
        }}
        onError={() => setFailed(true)}
      />
      {!playing && (
        <button
          className="file-play"
          data-nodrag
          aria-label={`Play ${name}`}
          onClick={() => {
            setPlaying(true);
            ref.current?.play().catch(() => {});
          }}
        >
          <Play size={22} fill="currentColor" />
        </button>
      )}
      {!playing && duration !== null && Number.isFinite(duration) && <span className="file-badge">{formatTime(duration)}</span>}
    </div>
  );
}

/** Bar heights for the audio player's waveform look, the same for a file every time. */
function bars(seed: string, count: number) {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return Array.from({ length: count }, (_, i) => {
    h = Math.imul(h ^ (h >>> 13), 1274126177) + i;
    const wave = Math.sin(i / 3.1) * 0.25 + 0.55;
    return Math.max(0.18, Math.min(1, wave + (((h >>> 0) % 1000) / 1000 - 0.5) * 0.7));
  });
}

function AudioPlayer({ url, seed, color, large = false, onDetail }: { url: string; seed: string; color: string; large?: boolean; onDetail?: (d: string | null) => void }) {
  const ref = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [failed, setFailed] = useState(false);
  const heights = useMemo(() => bars(seed, large ? 72 : 36), [seed, large]);
  const progress = duration ? time / duration : 0;
  if (failed) return <Tile kind="audio" name="" note="This browser can't play this audio file. Download it to listen." />;
  return (
    <div className={`file-audio ${large ? 'large' : ''}`} data-nodrag>
      <audio
        ref={ref}
        src={url}
        preload="metadata"
        onLoadedMetadata={(e) => {
          setDuration(e.currentTarget.duration);
          onDetail?.(formatTime(e.currentTarget.duration) || null);
        }}
        onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onError={() => setFailed(true)}
      />
      <button className="file-audio-play" style={{ background: color }} aria-label={playing ? 'Pause' : 'Play'} onClick={() => (playing ? ref.current?.pause() : ref.current?.play().catch(() => {}))}>
        {playing ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}
      </button>
      <div className="file-audio-body">
        <div
          className="file-wave"
          role="slider"
          aria-label="Position"
          aria-valuemin={0}
          aria-valuemax={Math.round(duration)}
          aria-valuenow={Math.round(time)}
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            if (ref.current && duration) ref.current.currentTime = ((e.clientX - r.left) / r.width) * duration;
          }}
        >
          {heights.map((h, i) => (
            <span key={i} style={{ height: `${h * 100}%`, background: i / heights.length < progress ? color : undefined }} />
          ))}
        </div>
        <span className="file-audio-time">{formatTime(time)} / {formatTime(duration) || '–:––'}</span>
      </div>
    </div>
  );
}

function FontSample({ url, id, large = false }: { url: string; id: string; large?: boolean }) {
  const family = `pinpad-font-${id}`;
  const [ready, setReady] = useState<boolean | null>(null);
  useEffect(() => {
    const face = new FontFace(family, `url(${url})`);
    face.load().then(() => {
      document.fonts.add(face);
      setReady(true);
    }).catch(() => setReady(false));
    return () => void document.fonts.delete(face);
  }, [url]);
  if (ready === false) return <Tile kind="font" name="" note="This font couldn't be read." />;
  return (
    <div className={`file-font ${large ? 'large' : ''}`} style={{ fontFamily: ready ? `'${family}'` : undefined, opacity: ready ? 1 : 0 }}>
      <span className="file-font-big">Aa</span>
      <span className="file-font-line">The quick brown fox jumps over the lazy dog</span>
      {large && (
        <>
          <span className="file-font-line">ABCDEFGHIJKLMNOPQRSTUVWXYZ</span>
          <span className="file-font-line">abcdefghijklmnopqrstuvwxyz 0123456789 &amp;?!</span>
        </>
      )}
    </div>
  );
}

/** Splits CSV or TSV text into rows, honouring quoted fields. */
function parseTable(text: string, tab: boolean, maxRows: number) {
  const sep = tab ? '\t' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length && rows.length < maxRows; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') (field += '"'), i++;
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"' && !field) quoted = true;
    else if (c === sep) row.push(field), (field = '');
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.some(Boolean)) rows.push(row);
      row = [];
    } else field += c;
  }
  if ((field || row.length) && rows.length < maxRows) rows.push([...row, field]);
  return rows;
}

function Table({ rows, header = true }: { rows: string[][]; header?: boolean }) {
  const width = Math.min(26, Math.max(...rows.map((r) => r.length)));
  const [head, ...body] = header ? rows : [[], ...rows];
  const cells = (r: string[]) => Array.from({ length: width }, (_, i) => r[i] ?? '');
  return (
    <table className="file-table">
      {header && <thead><tr>{cells(head).map((c, i) => <th key={i}>{c}</th>)}</tr></thead>}
      <tbody>{body.map((r, i) => <tr key={i}>{cells(r).map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody>
    </table>
  );
}

/** Markdown shown as headings, bullets and paragraphs (as text: nothing in it is run or loaded). */
function Markdown({ text }: { text: string }) {
  const out: ReactNode[] = [];
  let code: string[] | null = null;
  text.split('\n').forEach((line, i) => {
    if (line.startsWith('```')) {
      if (code) out.push(<pre key={i}>{code.join('\n')}</pre>);
      code = code ? null : [];
      return;
    }
    if (code) return void code.push(line);
    const clean = line.replace(/\*\*|__|`/g, '');
    const heading = /^(#{1,6})\s+(.*)/.exec(clean);
    const bullet = /^\s*([-*+]|\d+\.)\s+(.*)/.exec(clean);
    if (heading) out.push(<div key={i} className={`md-h md-h${Math.min(3, heading[1].length)}`}>{heading[2]}</div>);
    else if (bullet) out.push(<div key={i} className="md-li">{bullet[2]}</div>);
    else if (clean.trim()) out.push(<p key={i}>{clean}</p>);
  });
  return <div className="file-md">{out}</div>;
}

function TextView({ text, kind, name }: { text: string; kind: Kind; name: string }) {
  if (kind === 'csv') {
    const rows = parseTable(text, /\.tsv$/i.test(name), 1000);
    return rows.length ? <Table rows={rows} /> : <pre className="file-code">{text}</pre>;
  }
  if (kind === 'markdown') return <Markdown text={text} />;
  if (kind === 'json') {
    try {
      return <pre className="file-code">{JSON.stringify(JSON.parse(text), null, 2)}</pre>;
    } catch {
      // Cut short or not valid: shown as it is.
    }
  }
  return <pre className="file-code">{text}</pre>;
}

function TextPreview({ blob, kind, onDetail }: { blob: Blob; kind: Kind; onDetail: (d: string | null) => void }) {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    // A whole small JSON file pretty-prints; otherwise the start is enough for the card.
    const size = kind === 'json' && blob.size < 200_000 ? blob.size : 4000;
    blob.slice(0, size).text().then((t) => {
      if (!alive) return;
      setText(t);
      if (kind === 'csv') {
        const rows = blob.size <= 4000 ? t.split('\n').filter((l) => l.trim()).length : null;
        onDetail(rows ? `${rows} rows` : null);
      }
    });
    return () => void (alive = false);
  }, [blob]);
  if (text === null) return <Loading kind={kind} />;
  const short = kind === 'csv' ? text.split('\n').slice(0, 9).join('\n') : kind === 'json' ? text : text.split('\n').slice(0, 30).join('\n');
  return <div className={`file-textview kind-${kind}`}><TextView text={short} kind={kind} name="" /></div>;
}

function RichView({ rich, large = false }: { rich: Rich; large?: boolean }) {
  const [image, setImage] = useState<string | null>(null);
  useEffect(() => {
    if (rich.type !== 'image') return;
    const u = URL.createObjectURL(rich.image);
    setImage(u);
    return () => URL.revokeObjectURL(u);
  }, [rich]);
  switch (rich.type) {
    case 'image':
      return <div className="file-page">{image && <img src={image} alt="" draggable={false} />}</div>;
    case 'doc':
      return (
        <div className="file-page">
          <div className="file-doc">
            {rich.blocks.map((b, i) => (
              <div key={i} className={b.level ? `md-h md-h${b.level}` : b.bullet ? 'md-li' : 'file-doc-p'}>{b.text}</div>
            ))}
          </div>
        </div>
      );
    case 'sheet':
      return <div className="file-textview kind-csv"><Table rows={rich.rows} header={false} /></div>;
    case 'slides':
      return (
        <div className="file-slide-wrap">
          <div className="file-slide">
            {rich.lines[0] && <div className="file-slide-title">{rich.lines[0]}</div>}
            {rich.lines.slice(1, large ? 40 : 5).map((l, i) => <div key={i} className="file-slide-line">{l}</div>)}
          </div>
        </div>
      );
    case 'files':
      return (
        <ul className="file-list">
          {rich.names.map((n) => <li key={n} title={n}>{n}</li>)}
          {rich.count > rich.names.length && <li className="file-list-more">+ {rich.count - rich.names.length} more</li>}
        </ul>
      );
  }
}

const richDetail = (rich: Rich) =>
  rich.type === 'image' && rich.pages ? `${rich.pages} slides`
  : rich.type === 'slides' ? `${rich.slides} slides`
  : rich.type === 'sheet' && rich.sheets > 1 ? `${rich.sheets} sheets`
  : rich.type === 'files' ? `${rich.count} files`
  : null;

function RichPreview({ el, kind, onDetail }: { el: FileEl; kind: Kind; onDetail: (d: string | null) => void }) {
  const [rich, setRich] = useState<Rich | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    richPreview(el.ref, el.name, () => getAttachment(el.ref, el.name, el.mime)).then((r) => {
      if (!alive) return;
      setRich(r);
      if (r) onDetail(richDetail(r));
    });
    return () => void (alive = false);
  }, [el.ref]);
  if (rich === undefined) return <Loading kind={kind} />;
  if (!rich) return <Tile kind={kind} name={el.name} />;
  return <RichView rich={rich} />;
}

/** The file, large: PDFs in the browser's viewer, media in a player, everything else as fully as Pinpad can show it. */
function FileViewer({ el, kind, onClose }: { el: FileEl; kind: Kind; onClose: () => void }) {
  const look = lookOf(kind);
  const { url, blob, missing } = useFile(el, kind, true);
  const [text, setText] = useState<string | null>(null);
  const [rich, setRich] = useState<Rich | null | undefined>(undefined);

  useEffect(() => {
    // While it's open, keys and copy/paste belong to the viewer, not the board behind it
    // (Delete mustn't delete the card, and copying text copies the text).
    const onKey = (e: KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === 'Escape') onClose();
    };
    const keep = (e: Event) => e.stopPropagation();
    window.addEventListener('keydown', onKey, true);
    for (const type of ['copy', 'cut', 'paste']) window.addEventListener(type, keep, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      for (const type of ['copy', 'cut', 'paste']) window.removeEventListener(type, keep, true);
    };
  }, [onClose]);

  useEffect(() => {
    if (!blob) return;
    if (isText(kind)) blob.slice(0, 2_000_000).text().then(setText);
    else if (kind === 'document' || kind === 'sheet' || kind === 'slides' || kind === 'archive') fullPreview(blob, el.name).then(setRich);
  }, [blob]);

  let body: ReactNode;
  if (missing) body = <Tile kind={kind} name={el.name} note="This file isn't on this device yet." />;
  else if (!url || !blob) body = <Loading kind={kind} />;
  else if (kind === 'pdf') body = <iframe src={url} title={el.name} />;
  else if (kind === 'video') body = <video className="file-viewer-video" src={url} controls autoPlay playsInline />;
  else if (kind === 'audio') body = <div className="file-viewer-center"><AudioPlayer url={url} seed={el.ref} color={look.color} large /></div>;
  else if (kind === 'font') body = <div className="file-viewer-center"><FontSample url={url} id={`${el.ref}-large`} large /></div>;
  else if (isText(kind)) body = text === null ? <Loading kind={kind} /> : <div className={`file-viewer-scroll kind-${kind}`}><TextView text={text} kind={kind} name={el.name} /></div>;
  else if (rich === undefined && (kind === 'document' || kind === 'sheet' || kind === 'slides' || kind === 'archive')) body = <Loading kind={kind} />;
  else if (rich) body = <div className={`file-viewer-scroll rich-${rich.type}`}><RichView rich={rich} large /></div>;
  else body = <div className="file-viewer-center"><Tile kind={kind} name={el.name} note="Pinpad can't show this kind of file. Download it to open it in the app it belongs to." /></div>;

  return createPortal(
    // Rendered on the page, but React still passes its events up to the card: stop them here.
    <div
      className="search-backdrop file-viewer-backdrop"
      onPointerDown={(e) => (e.stopPropagation(), onClose())}
      onDoubleClick={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.stopPropagation()}
    >
      <div className="file-viewer" role="dialog" aria-label={el.name} style={{ '--file-color': look.color } as CSSProperties} onPointerDown={(e) => e.stopPropagation()}>
        <div className="file-viewer-head">
          <span className="file-chip"><look.icon size={15} /></span>
          <span className="file-text-col">
            <span className="file-name">{el.name}</span>
            <span className="file-sub">{[look.label, formatSize(el.size)].join(' · ')}</span>
          </span>
          <button className="icon-btn" onClick={() => download(el, url)} aria-label="Download" title="Download"><Download size={17} /></button>
          <button className="icon-btn" onClick={onClose} aria-label="Close" title="Close (Esc)"><X size={18} /></button>
        </div>
        <div className="file-viewer-body">{body}</div>
      </div>
    </div>,
    document.body,
  );
}
