/** What kind of file an attachment is, and how its card looks: label, colour and icon. */

import {
  Box, File, FileArchive, FileCode, FileJson, FileSpreadsheet, FileText, Music, FileVideo, PenTool, Presentation, Type,
  type LucideIcon,
} from 'lucide-react';

export type Kind =
  | 'pdf' | 'video' | 'audio' | 'csv' | 'markdown' | 'json' | 'code' | 'text'
  | 'document' | 'sheet' | 'slides' | 'archive' | 'font' | 'design' | 'model' | 'other';

const BY_EXTENSION: Record<string, Kind> = {
  pdf: 'pdf',
  mp4: 'video', m4v: 'video', mov: 'video', webm: 'video', ogv: 'video', mkv: 'video', avi: 'video',
  mp3: 'audio', m4a: 'audio', wav: 'audio', ogg: 'audio', oga: 'audio', flac: 'audio', aac: 'audio', opus: 'audio', aiff: 'audio', aif: 'audio',
  csv: 'csv', tsv: 'csv',
  md: 'markdown', markdown: 'markdown',
  json: 'json', geojson: 'json',
  js: 'code', jsx: 'code', ts: 'code', tsx: 'code', py: 'code', rb: 'code', go: 'code', rs: 'code', java: 'code', kt: 'code', swift: 'code',
  c: 'code', h: 'code', cpp: 'code', cs: 'code', php: 'code', css: 'code', scss: 'code', html: 'code', xml: 'code', yaml: 'code', yml: 'code',
  toml: 'code', ini: 'code', sh: 'code', sql: 'code', vue: 'code', svelte: 'code',
  txt: 'text', log: 'text', rtf: 'document',
  doc: 'document', docx: 'document', pages: 'document', odt: 'document',
  xls: 'sheet', xlsx: 'sheet', numbers: 'sheet', ods: 'sheet',
  ppt: 'slides', pptx: 'slides', key: 'slides', odp: 'slides',
  zip: 'archive', rar: 'archive', '7z': 'archive', tar: 'archive', gz: 'archive', tgz: 'archive', bz2: 'archive', dmg: 'archive',
  ttf: 'font', otf: 'font', woff: 'font', woff2: 'font',
  psd: 'design', ai: 'design', fig: 'design', sketch: 'design', xd: 'design', indd: 'design', eps: 'design',
  stl: 'model', obj: 'model', glb: 'model', gltf: 'model', fbx: 'model', blend: 'model', usdz: 'model',
};

export const extensionOf = (name: string) => /\.([a-z0-9]{1,8})$/i.exec(name)?.[1]?.toLowerCase() ?? '';

export function kindOf(name: string, mime: string): Kind {
  const byName = BY_EXTENSION[extensionOf(name)];
  if (byName) return byName;
  if (mime === 'application/pdf') return 'pdf';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('font/')) return 'font';
  if (/json/.test(mime)) return 'json';
  if (/javascript|xml|yaml/.test(mime)) return 'code';
  if (mime.startsWith('text/')) return 'text';
  return 'other';
}

/** Files read as text for their preview. */
export const isText = (kind: Kind) => kind === 'csv' || kind === 'markdown' || kind === 'json' || kind === 'code' || kind === 'text';

interface Look { label: string; color: string; icon: LucideIcon }

const LOOKS: Record<Kind, Look> = {
  pdf: { label: 'PDF', color: '#e5484d', icon: FileText },
  video: { label: 'Video', color: '#7c5cff', icon: FileVideo },
  audio: { label: 'Audio', color: '#e9438f', icon: Music },
  csv: { label: 'Table', color: '#17a34a', icon: FileSpreadsheet },
  markdown: { label: 'Markdown', color: '#5b6478', icon: FileText },
  json: { label: 'JSON', color: '#b7791f', icon: FileJson },
  code: { label: 'Code', color: '#5b6478', icon: FileCode },
  text: { label: 'Text', color: '#5b6478', icon: FileText },
  document: { label: 'Document', color: '#2f6fed', icon: FileText },
  sheet: { label: 'Spreadsheet', color: '#17a34a', icon: FileSpreadsheet },
  slides: { label: 'Presentation', color: '#f06b1f', icon: Presentation },
  archive: { label: 'Archive', color: '#c88a12', icon: FileArchive },
  font: { label: 'Font', color: '#0e9488', icon: Type },
  design: { label: 'Design', color: '#c026d3', icon: PenTool },
  model: { label: '3D model', color: '#0891b2', icon: Box },
  other: { label: 'File', color: '#8c89a6', icon: File },
};

export const lookOf = (kind: Kind) => LOOKS[kind];

export function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

export function formatTime(seconds: number) {
  if (!Number.isFinite(seconds)) return '';
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const pad = (n: number) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
}
