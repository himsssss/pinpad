/**
 * Sending a copy of a project or folder as a file ("Name.pinpad"): its boards, cards and
 * attached files in one file, sent however the user likes (email, WhatsApp, AirDrop). The
 * other person imports it (Import, or dropping it on Pinpad) as projects of their own; later
 * changes on either side aren't shared.
 */

import type { FileEl, SavedTemplate } from './types';
import { importCopies, projectCopies } from './projectActions';
import { getAttachment } from './attachments';
import { save } from './persist';
import { browse, getState, openBoard } from './store';

const FORMAT = 'pinpad-share';

interface ShareFile {
  format: typeof FORMAT;
  version: 1;
  name: string;
  /** The folder's name when a whole folder was sent; its projects arrive in a folder like it. */
  folder: string | null;
  projects: SavedTemplate[];
  /** Attached files (by their cards' ref), as base64. */
  files: Record<string, { name: string; mime: string; data: string }>;
}

const toBase64 = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

/** What a copy would hold, for the Send a copy dialog. */
export function describeCopy(target: { kind: 'project' | 'board' | 'folder'; id: string }) {
  const projects = projectCopies(target);
  const files = projects.flatMap((p) => p.elements).filter((e): e is FileEl => e.type === 'file' && !!e.ref);
  return {
    projects: projects.length,
    boards: projects.reduce((n, p) => n + p.boards.length, 0),
    files: new Set(files.map((f) => f.ref)).size,
    fileBytes: [...new Map(files.map((f) => [f.ref, f.size])).values()].reduce((a, b) => a + b, 0),
  };
}

/** Makes the file for a project or sidebar folder. Files not on this device are left out (counted in `missing`). */
export async function makeShareFile(target: { kind: 'project' | 'board' | 'folder'; id: string }) {
  const { doc } = getState();
  const name = (target.kind === 'folder' ? doc.folders[target.id]?.name : doc.boards[target.id]?.title) || 'Untitled';
  const projects = projectCopies(target);
  const files: ShareFile['files'] = {};
  let missing = 0;
  for (const el of projects.flatMap((p) => p.elements)) {
    if (el.type !== 'file' || !el.ref || files[el.ref]) continue;
    const blob = await getAttachment(el.ref, el.name, el.mime).catch(() => null);
    if (blob) files[el.ref] = { name: el.name, mime: el.mime, data: await toBase64(blob) };
    else missing++;
  }
  const body: ShareFile = { format: FORMAT, version: 1, name, folder: target.kind === 'folder' ? name : null, projects, files };
  const safe = name.replace(/[/\\:*?"<>|\x00-\x1f]/g, '-').trim() || 'Pinpad';
  const file = new File([JSON.stringify(body)], `${safe}.pinpad`, { type: 'application/json' });
  return { file, missing };
}

/** Hands the file to the system share sheet where there is one (phones, Safari), else downloads it. */
export async function sendFile(file: File, share: boolean) {
  if (share && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: file.name });
      return 'shared';
    } catch (err) {
      if ((err as DOMException).name === 'AbortError') return 'cancelled';
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
  return 'downloaded';
}

export const canShareFiles = () => typeof navigator.canShare === 'function' && navigator.canShare({ files: [new File([''], 'a.pinpad', { type: 'application/json' })] });

/** Whether some text is a sent copy rather than a whole workspace backup. */
export const isShareFile = (text: string) => text.trimStart().startsWith('{') && text.includes(`"format":"${FORMAT}"`);

/** Adds a sent copy as new projects (and its attached files to this device), and opens them. */
export async function importShareFile(text: string) {
  const data = JSON.parse(text) as ShareFile;
  if (data.format !== FORMAT || !Array.isArray(data.projects)) throw new Error("This isn't a Pinpad copy");
  for (const [ref, f] of Object.entries(data.files ?? {})) {
    const blob = await (await fetch(`data:${f.mime || 'application/octet-stream'};base64,${f.data}`)).blob();
    await save(`file:${ref}`, blob);
  }
  const { first, count } = importCopies(data.projects, data.folder);
  if (data.folder) browse(Object.values(getState().doc.folders).filter((f) => f.name === data.folder).pop()?.id ?? null);
  else if (first) openBoard(first);
  return count;
}

/** Opens the file picker for a sent copy or a workspace backup. */
export function pickImportFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.pinpad,.json,application/json';
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.click();
  });
}
