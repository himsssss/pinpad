import { useEffect, useState } from 'react';
import { Download, File, FileArchive, FileAudio, FileCode, FileSpreadsheet, FileText, FileVideo, type LucideIcon } from 'lucide-react';
import type { FileEl } from '../../types';
import { getAttachment } from '../../attachments';

const TEXT_EXTENSIONS = /\.(txt|md|markdown|csv|tsv|json|js|jsx|ts|tsx|py|rb|go|rs|java|c|cpp|h|css|scss|html|xml|yaml|yml|toml|ini|log|sh|sql)$/i;

type Kind = 'pdf' | 'video' | 'audio' | 'text' | 'other';

function kindOf(el: FileEl): Kind {
  if (el.mime === 'application/pdf' || /\.pdf$/i.test(el.name)) return 'pdf';
  if (el.mime.startsWith('video/')) return 'video';
  if (el.mime.startsWith('audio/')) return 'audio';
  if (el.mime.startsWith('text/') || /json|xml|javascript|yaml/.test(el.mime) || TEXT_EXTENSIONS.test(el.name)) return 'text';
  return 'other';
}

function iconFor(el: FileEl, kind: Kind): LucideIcon {
  if (kind === 'video') return FileVideo;
  if (kind === 'audio') return FileAudio;
  if (kind === 'pdf' || /\.(docx?|pages|rtf|odt)$/i.test(el.name)) return FileText;
  if (/\.(xlsx?|numbers|ods|csv)$/i.test(el.name)) return FileSpreadsheet;
  if (/\.(zip|rar|7z|tar|gz)$/i.test(el.name)) return FileArchive;
  if (kind === 'text') return FileCode;
  return File;
}

/**
 * The type the file is shown as. Board files can come from anywhere, so only types that
 * can't run code are used: anything else is a plain download, never a page that opens here.
 */
function safeType(kind: Kind, mime: string) {
  if (kind === 'pdf') return 'application/pdf';
  if ((kind === 'video' || kind === 'audio') && /^(video|audio)\/[\w.+-]+$/.test(mime)) return mime;
  return 'application/octet-stream';
}

export function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

/**
 * An attached file with a preview: PDFs in a viewer, video and audio in a player, text and
 * code as its first lines, and anything else as an icon with its type. The file loads from
 * this device's copy, or from Google Drive or the storage folder the first time.
 */
export function FileCard({ el }: { el: FileEl }) {
  const kind = kindOf(el);
  const [url, setUrl] = useState<string | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let alive = true;
    let objectUrl: string | null = null;
    setMissing(false);
    getAttachment(el.ref, el.name, el.mime)
      .then(async (blob) => {
        if (!alive) return;
        if (!blob) return setMissing(true);
        objectUrl = URL.createObjectURL(new Blob([blob], { type: safeType(kind, el.mime) }));
        setUrl(objectUrl);
        if (kind === 'text') {
          const head = await blob.slice(0, 6000).text();
          if (alive) setText(head.split('\n').slice(0, 40).join('\n'));
        }
      })
      .catch(() => alive && setMissing(true));
    return () => {
      alive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [el.ref]);

  const Icon = iconFor(el, kind);
  const ext = /\.([a-z0-9]{1,6})$/i.exec(el.name)?.[1]?.toUpperCase() ?? 'FILE';

  let preview: React.ReactNode;
  if (missing) {
    preview = (
      <div className="file-preview file-missing">
        <Icon size={28} strokeWidth={1.5} />
        <span>This file isn't on this device yet. It will appear once it's been uploaded from where it was added.</span>
      </div>
    );
  } else if (!url) {
    preview = <div className="file-preview file-loading"><Icon size={28} strokeWidth={1.5} /></div>;
  } else if (kind === 'pdf') {
    preview = <iframe className="file-preview file-pdf" src={url} title={el.name} />;
  } else if (kind === 'video') {
    preview = <video className="file-preview file-video" src={url} controls preload="metadata" playsInline data-nodrag />;
  } else if (kind === 'audio') {
    preview = (
      <div className="file-preview file-audio" data-nodrag>
        <FileAudio size={28} strokeWidth={1.5} />
        <audio src={url} controls preload="metadata" />
      </div>
    );
  } else if (kind === 'text') {
    preview = <pre className="file-preview file-text">{text ?? ''}</pre>;
  } else {
    preview = (
      <div className="file-preview file-other">
        <Icon size={36} strokeWidth={1.4} />
        <span className="file-ext">{ext}</span>
      </div>
    );
  }

  return (
    <div className="card-body file">
      {preview}
      <div className="file-meta">
        <Icon size={16} className="file-meta-icon" />
        <span className="file-name" title={el.name}>{el.name}</span>
        <span className="file-size">{formatSize(el.size)}</span>
        {url && (
          <a className="file-download" href={url} download={el.name} data-nodrag aria-label={`Download ${el.name}`} title="Download">
            <Download size={14} />
          </a>
        )}
      </div>
    </div>
  );
}
