/**
 * Opening a shared link (#open=<Drive folder id>): a project or sidebar folder someone keeps
 * in Google Drive and shared with "anyone with the link". It's read with Pinpad's Google API
 * key, so the viewer needn't sign in, and shown read-only; it's read again now and then so
 * the owner's changes appear. "Save a copy" brings it into the viewer's own boards.
 *
 * The shared folder holds the projects' board files and their Files folders (layoutWorkspace),
 * but not the workspace index, so the projects are put back together from the board files.
 */

import type { Board, Doc, El, SavedTemplate } from './types';
import { createElement, uid } from './doc';
import { isAttachmentPath, layoutWorkspace } from './workspaceFiles';
import { save } from './persist';

const API = 'https://www.googleapis.com/drive/v3/files';
const API_KEY = import.meta.env.VITE_GOOGLE_API_KEY ?? '';
const FOLDER = 'application/vnd.google-apps.folder';
const PENDING_COPY = 'pending-copy';

export const sharingConfigured = () => !!API_KEY;

/** The shared link for a Drive folder: the website, even from the desktop apps. */
export function shareLink(folderId: string) {
  const site = window.pinpadNative ? import.meta.env.VITE_SITE_URL || 'https://pinpad-taupe.vercel.app/' : location.href.split(/[?#]/)[0];
  return `${site}#open=${folderId}`;
}

/** The Drive folder a link opens, if the page was opened from one. */
export const sharedFolderInUrl = () => /^#open=([\w-]{10,})$/.exec(location.hash)?.[1] ?? null;

interface DriveFile { id: string; name: string; mimeType: string; modifiedTime?: string }

async function get(url: string) {
  const res = await fetch(`${url}${url.includes('?') ? '&' : '?'}key=${API_KEY}`);
  if (res.status === 404 || res.status === 403) throw new Error("This link doesn't open anything: it may have been turned off, or the folder deleted.");
  if (!res.ok) throw new Error(`Google Drive: ${res.statusText || res.status}`);
  return res;
}

async function children(id: string): Promise<DriveFile[]> {
  const out: DriveFile[] = [];
  let page = '';
  do {
    const q = encodeURIComponent(`'${id}' in parents and trashed=false`);
    const body = await (await get(`${API}?q=${q}&pageSize=1000&fields=nextPageToken,files(id,name,mimeType,modifiedTime)${page ? `&pageToken=${page}` : ''}`)).json();
    out.push(...body.files);
    page = body.nextPageToken ?? '';
  } while (page);
  return out;
}

export interface Shared {
  name: string;
  doc: Doc;
  /** Attached file (ref) to its Drive file id. */
  files: Map<string, string>;
  /** Changes when anything in the folder changes. */
  version: string;
}

/** Reads a shared folder: its projects, ready to show, and where their attached files are. */
export async function loadShared(folderId: string): Promise<Shared> {
  const folder: DriveFile = await (await get(`${API}/${folderId}?fields=id,name,mimeType`)).json();
  if (folder.mimeType !== FOLDER) throw new Error('This link is not a shared Pinpad folder.');
  // Everything inside, by path.
  const all = new Map<string, DriveFile>();
  const walk = async (id: string, dir: string, depth: number) => {
    for (const f of await children(id)) {
      const path = dir ? `${dir}/${f.name}` : f.name;
      all.set(path.toLowerCase(), f);
      if (f.mimeType === FOLDER && depth < 8) await walk(f.id, path, depth + 1);
    }
  };
  await walk(folderId, '', 0);
  const boardFiles = [...all.entries()].filter(([path, f]) => f.mimeType !== FOLDER && path.endsWith('.json') && !isAttachmentPath(path.slice(0, path.lastIndexOf('/'))));
  const read = await Promise.all(
    boardFiles.map(async ([, f]) => {
      try {
        const data = JSON.parse(await (await get(`${API}/${f.id}?alt=media`)).text());
        return data?.board && Array.isArray(data.elements) ? (data as { board: Board; elements: El[] }) : null;
      } catch {
        return null;
      }
    }),
  );

  // A home board for the shared projects: those whose parent isn't in the folder.
  const rootId = `shared-${folderId}`;
  const doc: Doc = { rootId, boards: { [rootId]: { id: rootId, title: folder.name, parentId: null, color: '#e6e6e6', icon: 'layout' } }, elements: {}, folders: {} };
  for (const file of read) {
    if (!file) continue;
    doc.boards[file.board.id] = { ...file.board, folderId: undefined };
    for (const el of file.elements) doc.elements[el.id] = { ...el, boardId: file.board.id };
  }
  let x = 80;
  for (const b of Object.values(doc.boards)) {
    if (b.id === rootId || (b.parentId && doc.boards[b.parentId])) continue;
    b.parentId = rootId;
    const { el } = createElement('board', rootId, x, 80, 1);
    if (el.type === 'board') el.targetId = b.id;
    doc.elements[el.id] = el;
    x += 140;
  }

  // Attached files: where the owner's layout put them, relative to the shared folder. A shared
  // project is the folder itself; a shared sidebar folder holds a folder per project.
  const layout = layoutWorkspace(doc);
  const projectsAt = [...(layout.dirs ?? [])].filter(([id]) => doc.boards[id]).map(([, dir]) => dir);
  const oneProject = projectsAt.length === 1 && all.has(`${projectsAt[0].split('/').pop()!.toLowerCase()}.json`);
  const files = new Map<string, string>();
  for (const [ref, path] of layout.attachments) {
    const relative = oneProject ? path.slice(projectsAt[0].length + 1) : path;
    const hit = all.get(relative.toLowerCase());
    if (hit) files.set(ref, hit.id);
  }
  const version = [...all.values()].map((f) => `${f.id}:${f.modifiedTime ?? ''}`).sort().join('|');
  return { name: folder.name, doc, files, version };
}

/** An attached file in a shared folder. */
export async function sharedAttachment(id: string): Promise<Blob> {
  return (await get(`${API}/${id}?alt=media`)).blob();
}

/**
 * Keeps a copy of the shared projects (and their attached files, on this device) for the
 * viewer's own boards, which add it the next time they open (store.ts, importPendingCopy).
 */
export async function keepCopy(shared: Shared) {
  const projects = Object.values(shared.doc.boards).filter((b) => b.parentId === shared.doc.rootId);
  const treeOf = (rootId: string) => {
    const ids = new Set([rootId]);
    for (let grew = true; grew; ) {
      grew = false;
      for (const b of Object.values(shared.doc.boards)) if (b.parentId && ids.has(b.parentId) && !ids.has(b.id)) (ids.add(b.id), (grew = true));
    }
    return ids;
  };
  const copies: SavedTemplate[] = projects.map((p) => {
    const ids = treeOf(p.id);
    return {
      id: uid(),
      name: p.title || 'Untitled',
      createdAt: Date.now(),
      rootId: p.id,
      boards: [...ids].map((id) => shared.doc.boards[id]),
      elements: Object.values(shared.doc.elements).filter((e) => ids.has(e.boardId)),
    };
  });
  for (const [ref, id] of shared.files) {
    const blob = await sharedAttachment(id).catch(() => null);
    if (blob) await save(`file:${ref}`, blob);
  }
  await save(PENDING_COPY, { folder: projects.length > 1 ? shared.name : null, projects: copies });
}

export const PENDING_COPY_KEY = PENDING_COPY;
