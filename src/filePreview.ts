/**
 * Previews of files the browser can't show by itself, read from inside them: the picture
 * Pages, Numbers, Keynote and OpenDocument files keep of their first page, the text of a
 * Word file, the first sheet of an Excel file, the first slide of a PowerPoint file, and
 * what's in a zip. Card previews are kept on this device so boards open quickly.
 */

import { load, save } from './persist';
import { openZip, type Zip } from './zip';
import { extensionOf } from './fileTypes';

export interface Block { text: string; level: 0 | 1 | 2; bullet?: boolean }

export type Rich =
  | { type: 'image'; image: Blob; pages?: number }
  | { type: 'doc'; blocks: Block[] }
  | { type: 'sheet'; rows: string[][]; sheets: number }
  | { type: 'slides'; slides: number; lines: string[] }
  | { type: 'files'; names: string[]; count: number };

const cacheKey = (ref: string) => `file-preview:v1:${ref}`;
const xml = (text: string) => new DOMParser().parseFromString(text, 'application/xml');
const all = (node: Document | Element, tag: string) => [...node.getElementsByTagNameNS('*', tag)];
const textOf = (node: Element, tag = 't') => all(node, tag).map((t) => t.textContent ?? '').join('');

/** A picture inside the file, typed by its name (only plain images, never anything that runs). */
async function picture(zip: Zip, names: string[]): Promise<Blob | null> {
  for (const name of names) {
    const bytes = await zip.read(name, 20 * 1024 * 1024);
    if (bytes?.length) return new Blob([bytes], { type: /\.png$/i.test(name) ? 'image/png' : 'image/jpeg' });
  }
  return null;
}

async function wordText(zip: Zip, max: number): Promise<Rich | null> {
  const text = await zip.text('word/document.xml', 40 * 1024 * 1024);
  if (!text) return null;
  const blocks: Block[] = [];
  for (const p of all(xml(text), 'p')) {
    const line = textOf(p).trim();
    if (!line) continue;
    const style = all(p, 'pStyle')[0]?.getAttribute('w:val') ?? '';
    const level = /^(Title|Heading1)$/i.test(style) ? 1 : /^Heading[2-9]$/i.test(style) ? 2 : 0;
    blocks.push({ text: line, level, bullet: all(p, 'numPr').length > 0 || undefined });
    if (blocks.length >= max) break;
  }
  return blocks.length ? { type: 'doc', blocks } : null;
}

const numbered = (zip: Zip, pattern: RegExp) =>
  zip.entries.map((e) => e.name).filter((n) => pattern.test(n)).sort((a, b) => Number(/(\d+)\.xml$/.exec(a)![1]) - Number(/(\d+)\.xml$/.exec(b)![1]));

async function excelSheet(zip: Zip, maxRows: number): Promise<Rich | null> {
  const sheets = numbered(zip, /^xl\/worksheets\/sheet\d+\.xml$/);
  const sheet = sheets[0] && (await zip.text(sheets[0], 40 * 1024 * 1024));
  if (!sheet) return null;
  const sharedText = await zip.text('xl/sharedStrings.xml', 40 * 1024 * 1024);
  const shared = sharedText ? all(xml(sharedText), 'si').map((si) => textOf(si)) : [];
  const column = (ref: string) => [...(/^[A-Z]+/.exec(ref)?.[0] ?? 'A')].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;
  const rows: string[][] = [];
  for (const row of all(xml(sheet), 'row')) {
    const cells: string[] = [];
    for (const c of all(row, 'c')) {
      const at = column(c.getAttribute('r') ?? '');
      if (at > 25) continue;
      const type = c.getAttribute('t');
      const value = all(c, 'v')[0]?.textContent ?? '';
      cells[at] = type === 's' ? (shared[Number(value)] ?? '') : type === 'inlineStr' ? textOf(c) : value;
    }
    if (cells.some(Boolean)) rows.push(Array.from(cells, (v) => v ?? ''));
    if (rows.length >= maxRows) break;
  }
  return rows.length ? { type: 'sheet', rows, sheets: sheets.length } : null;
}

async function powerPointSlide(zip: Zip): Promise<Rich | null> {
  const slides = numbered(zip, /^ppt\/slides\/slide\d+\.xml$/);
  const first = slides[0] && (await zip.text(slides[0]));
  if (!first) return null;
  const lines = all(xml(first), 'p').map((p) => textOf(p).trim()).filter(Boolean).slice(0, 12);
  return { type: 'slides', slides: slides.length, lines };
}

function archiveList(zip: Zip, max: number): Rich | null {
  const names = zip.entries.map((e) => e.name).filter((n) => !n.endsWith('/') && !n.startsWith('__MACOSX/') && !/(^|\/)\.DS_Store$/.test(n));
  return names.length ? { type: 'files', names: names.slice(0, max), count: names.length } : null;
}

async function extract(blob: Blob, name: string, full: boolean): Promise<Rich | null> {
  const ext = extensionOf(name);
  if (!['docx', 'xlsx', 'pptx', 'pages', 'numbers', 'key', 'odt', 'ods', 'odp', 'zip'].includes(ext)) return null;
  const zip = await openZip(blob);
  if (!zip) return null;
  if (ext === 'zip') return archiveList(zip, full ? 2000 : 8);
  // The first page as the app that made it drew it, when the file keeps one.
  const image = await picture(zip, ['preview.jpg', 'QuickLook/Thumbnail.jpg', 'preview-web.jpg', 'Thumbnails/thumbnail.png', 'docProps/thumbnail.jpeg']);
  if (ext === 'docx') return (await wordText(zip, full ? 5000 : 40)) ?? (image && { type: 'image', image });
  if (ext === 'xlsx') return (await excelSheet(zip, full ? 500 : 12)) ?? (image && { type: 'image', image });
  if (ext === 'pptx') return image ? { type: 'image', image, pages: numbered(zip, /^ppt\/slides\/slide\d+\.xml$/).length } : powerPointSlide(zip);
  return image && { type: 'image', image };
}

const pending = new Map<string, Promise<Rich | null>>();

/**
 * The card preview for a file, or null when there's none. `file` loads the file itself,
 * only when the preview isn't kept on this device yet.
 */
export function richPreview(ref: string, name: string, file: () => Promise<Blob | null>): Promise<Rich | null> {
  let job = pending.get(ref);
  if (!job) {
    job = (async () => {
      const kept = await load<{ rich: Rich | null }>(cacheKey(ref)).catch(() => undefined);
      if (kept) return kept.rich;
      const blob = await file();
      if (!blob) throw new Error('Not here yet');
      const rich = await extract(blob, name, false).catch(() => null);
      save(cacheKey(ref), { rich }).catch(() => {});
      return rich;
    })();
    pending.set(ref, job);
    // Not loaded yet (say, still on its way from Drive): try again next time it's shown.
    job.catch(() => pending.delete(ref));
  }
  return job.catch(() => null);
}

/** Everything that can be shown of a file, for the large viewer. */
export const fullPreview = (blob: Blob, name: string) => extract(blob, name, true).catch(() => null);
