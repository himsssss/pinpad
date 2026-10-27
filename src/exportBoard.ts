/**
 * Saves the open board as a PNG image or a one-page PDF, for sharing with people who don't
 * use Pinpad. The board is drawn from the page itself, so it looks the way it does on
 * screen; the image and PDF libraries load only when an export is asked for.
 */

import { getState, setUI } from './store';
import { worldRect } from './interactions';

const PAD = 48;
/** Largest side of the image, in pixels; very large boards are drawn at a lower resolution. */
const MAX_SIDE = 8000;
/** Shown where an image from another site can't be drawn (it doesn't allow it). */
const BLANK = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
/** Editing controls left out of the picture. */
const HIDDEN = '.resize-handle, .resize-grip, .quick-line, .lines-layer.handles, .snap-guides, .link-play, .media-close';

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r(null)));

function fileName(ext: string) {
  const { doc, ui } = getState();
  const title = ui.boardId === doc.rootId ? 'Home' : doc.boards[ui.boardId]?.title || 'Board';
  return `${title.replace(/[/\\:*?"<>|]+/g, '-').trim() || 'Board'}.${ext}`;
}

function download(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

/**
 * Draws every card on the board (not just the visible part) into an image data URL: PNG
 * for the image export, JPEG inside PDFs (a PNG there would make the file many times larger).
 */
async function capture(type: 'png' | 'jpeg') {
  const world = document.querySelector<HTMLElement>('.world');
  const ids = [...document.querySelectorAll<HTMLElement>('.card.free')].map((n) => n.dataset.elId!);
  const boxes = ids.map(worldRect).filter((b): b is NonNullable<typeof b> => !!b);
  if (!world || !boxes.length) throw new Error('This board is empty');

  // Selection outlines and text carets don't belong in the picture.
  setUI({ selection: [], editingId: null, editPoint: null, playingId: null });
  await nextFrame();
  await nextFrame();

  const minX = Math.min(...boxes.map((b) => b.x)) - PAD;
  const minY = Math.min(...boxes.map((b) => b.y)) - PAD;
  const width = Math.ceil(Math.max(...boxes.map((b) => b.x + b.w)) - minX + PAD);
  const height = Math.ceil(Math.max(...boxes.map((b) => b.y + b.h)) - minY + PAD);
  const pixelRatio = Math.min(2, MAX_SIDE / Math.max(width, height));
  const background = getComputedStyle(document.body).getPropertyValue('--board').trim() || '#f3f3f7';

  const { toJpeg, toPng } = await import('html-to-image');
  const image = await (type === 'png' ? toPng : toJpeg)(world, {
    quality: 0.92,
    width,
    height,
    pixelRatio,
    backgroundColor: background,
    imagePlaceholder: BLANK,
    style: { transform: `translate(${-minX}px, ${-minY}px)` },
    filter: (node) => !(node instanceof Element && node.matches(HIDDEN)),
  });
  return { image, width, height };
}

export async function exportBoardImage() {
  const { image } = await capture('png');
  download(await (await fetch(image)).blob(), fileName('png'));
}

export async function exportBoardPdf() {
  const { image, width, height } = await capture('jpeg');
  const { jsPDF } = await import('jspdf');
  const pdf = new jsPDF({ orientation: width > height ? 'landscape' : 'portrait', unit: 'px', format: [width, height], hotfixes: ['px_scaling'] });
  pdf.addImage(image, 'JPEG', 0, 0, width, height);
  download(pdf.output('blob'), fileName('pdf'));
}
