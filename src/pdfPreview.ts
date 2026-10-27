/**
 * A picture of a PDF's first page and its page count, for the file card. Drawn with pdf.js
 * (loaded only when a PDF card first appears) and kept on this device, so a board opens
 * with its PDF pictures at once instead of drawing them again.
 */

import { load, save } from './persist';

export type PdfPreview = { image: Blob; pages: number };

const cacheKey = (ref: string) => `pdf-preview:${ref}`;
const WIDTH = 640;
const drawing = new Map<string, Promise<PdfPreview | null>>();

async function draw(blob: Blob): Promise<PdfPreview> {
  const pdfjs = await import('pdfjs-dist');
  const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()), isEvalSupported: false }).promise;
  try {
    const page = await doc.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: WIDTH / base.width });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(viewport.width);
    // A very tall first page is cut off: the card shows its top.
    canvas.height = Math.round(Math.min(viewport.height, viewport.width * 1.5));
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: context, viewport }).promise;
    const image = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('No picture'))), 'image/jpeg', 0.85),
    );
    return { image, pages: doc.numPages };
  } finally {
    doc.destroy();
  }
}

/** The first page's picture and page count, or null when the file can't be read as a PDF. */
export function pdfPreview(ref: string, file: () => Promise<Blob | null>): Promise<PdfPreview | null> {
  let job = drawing.get(ref);
  if (!job) {
    job = (async () => {
      const kept = await load<PdfPreview>(cacheKey(ref)).catch(() => undefined);
      if (kept) return kept;
      const blob = await file();
      if (!blob) return null;
      const preview = await draw(blob);
      save(cacheKey(ref), preview).catch(() => {});
      return preview;
    })().catch(() => null);
    drawing.set(ref, job);
    // Not readable yet (say, still on its way from Drive): try again next time it's shown.
    job.then((preview) => preview || drawing.delete(ref));
  }
  return job;
}
