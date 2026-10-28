/**
 * How the desktop apps lay the workspace out on disk: one JSON file per board, a folder per
 * project (holding the project board and every board inside it), sidebar folders as real
 * folders, and a small index that records the sidebar folders and where each board lives.
 *
 *   Pinpad Workspace.json      index
 *   Home.json
 *   Files/                     files attached to cards on Home
 *   Work/                      sidebar folder
 *     Project plan/            project
 *       Project plan.json
 *       Research.json          a board inside the project
 *
 * Each board file carries its own board record and ids, so a board is found again after its
 * file or folder is renamed, moved or deleted outside Pinpad (in Finder, File Explorer or
 * Google Drive), and Pinpad follows: the new name becomes the board's or folder's name.
 */

import type { Board, Doc, El, Folder } from './types';
import { deleteElements, projects, uid } from './doc';

/** Parses an exported or stored workspace, throwing if it isn't one. */
export function parseWorkspace(text: string): Doc {
  const doc = JSON.parse(text) as Doc;
  if (!doc?.boards?.[doc.rootId] || !doc.elements) throw new Error('Not a Pinpad workspace file');
  // Workspaces saved before folders existed.
  doc.folders ??= {};
  return doc;
}

export const INDEX_FILE = 'Pinpad Workspace.json';
/** Deleted folders and projects (see TrashEntry), kept in one file beside the index. */
export const TRASH_FILE = 'Pinpad Trash.json';
/** Boards saved as templates (see SavedTemplate), also beside the index. */
export const TEMPLATES_FILE = 'Pinpad Templates.json';
const FORMAT = 2;

interface Index {
  pinpad: number;
  rootId: string;
  folders: Record<string, Folder>;
  /** Board id to its file, relative to the storage folder, with / separators. */
  boards: Record<string, string>;
  /** Attached file (FileEl.ref) to where it's kept; absent before files were kept in project folders. */
  files?: Record<string, string>;
}

interface BoardFile {
  pinpad: number;
  board: Board;
  elements: El[];
}

/** A file or folder in the storage folder or Google Drive, as its storage lists it. */
export interface Listed {
  /** Relative path, with / separators. */
  path: string;
  /** Last change in ms since 1970 (0 for folders), to notice files changed outside Pinpad. */
  modified: number;
  dir?: boolean;
  /** In iCloud Drive but not downloaded to this Mac yet. */
  pending?: boolean;
}

export interface Layout {
  /** Relative path to file text; board files first, the index last. */
  files: Map<string, string>;
  /** Board id to its relative path. */
  paths: Map<string, string>;
  /** Attached file (FileEl.ref) to its relative path. */
  attachments: Map<string, string>;
  /** Sidebar folder or project id to its directory (from layoutWorkspace only). */
  dirs?: Map<string, string>;
}

/**
 * Attached files live in a "Files" folder in their project's folder (at the top level for
 * Home), under their own names. Files of deleted projects and of templates wait in
 * "Attachments". Neither name can be taken by a sidebar folder or project, and neither
 * folder is ever read as boards.
 */
export const FILES_DIR = 'Files';
export const HOLDING_DIR = 'Attachments';
/** Whether a path is inside an attached files folder (or is one). */
export const isAttachmentPath = (path: string) => path.split('/').some((part) => /^(files|attachments)$/i.test(part));
/** Where a file attached before files were kept in project folders sits. */
export const legacyAttachmentPath = (ref: string, name: string) => `${HOLDING_DIR}/${ref}${(/\.[a-z0-9]{1,8}$/i.exec(name)?.[0] ?? '').toLowerCase()}`;

/** A title made safe as a file or folder name on macOS and Windows. */
function safeName(title: string) {
  let name = title
    .replace(/[/\\:*?"<>|\x00-\x1f]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .slice(0, 80)
    .replace(/[. ]+$/, '');
  if (!name) name = 'Untitled';
  if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(name)) name += '_';
  return name;
}

const join = (dir: string, name: string) => (dir ? `${dir}/${name}` : name);
const dirname = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');
const basename = (path: string) => path.slice(path.lastIndexOf('/') + 1);
const stem = (path: string) => basename(path).replace(/\.json$/i, '');
const segments = (path: string) => (path ? path.split('/') : []);

type Take = (dir: string, base: string, ext?: string) => string;

/** Hands out unique names in each directory, compared case-insensitively like the file systems. */
function namer(): Take {
  const used = new Map<string, Set<string>>();
  const take: Take = (dir, base, ext = '') => {
    // Every folder keeps the attached files folders' names free (see FILES_DIR).
    const names = used.get(dir) ?? new Set<string>(['files', 'attachments']);
    used.set(dir, names);
    let name = base;
    for (let i = 2; names.has(`${name}${ext}`.toLowerCase()); i++) name = `${base} (${i})`;
    names.add(`${name}${ext}`.toLowerCase());
    return join(dir, `${name}${ext}`);
  };
  take('', 'Pinpad Workspace', '.json');
  take('', 'Pinpad Trash', '.json');
  take('', 'Pinpad Templates', '.json');
  return take;
}

const byName = (a: { title?: string; name?: string; id: string }, b: typeof a) =>
  (a.title ?? a.name ?? '').localeCompare(b.title ?? b.name ?? '') || a.id.localeCompare(b.id);

/** Each sidebar folder's directory. Folders are placed first, so their names don't depend on boards. */
function placeFolders(folders: Record<string, Folder>, take: Take) {
  const dirs = new Map<string, string>();
  const place = (id: string): string => {
    const known = dirs.get(id);
    if (known !== undefined) return known;
    const folder = folders[id];
    const parent = folder.parentId && folders[folder.parentId] ? place(folder.parentId) : '';
    const dir = take(parent, safeName(folder.name));
    dirs.set(id, dir);
    return dir;
  };
  Object.values(folders).sort((a, b) => a.order - b.order || byName(a, b)).forEach((f) => place(f.id));
  return dirs;
}

export function layoutWorkspace(doc: Doc): Layout {
  const take = namer();
  const folderDirs = placeFolders(doc.folders, take);
  const folderDir = (id: string) => folderDirs.get(id)!;

  const paths = new Map<string, string>();
  paths.set(doc.rootId, take('', 'Home', '.json'));

  // Each project gets a folder, inside its sidebar folder if it's filed in one.
  const projectDirs = new Map<string, string>();
  for (const p of [...projects(doc)].sort(byName)) {
    const parent = p.folderId && doc.folders[p.folderId] ? folderDir(p.folderId) : '';
    const dir = take(parent, safeName(p.title));
    projectDirs.set(p.id, dir);
    paths.set(p.id, take(dir, safeName(p.title), '.json'));
  }

  // Every other board goes in the folder of the project it sits under, or at the top level.
  const projectOf = (b: Board) => {
    for (let cur: Board | undefined = b; cur; cur = cur.parentId ? doc.boards[cur.parentId] : undefined) {
      if (projectDirs.has(cur.id)) return cur.id;
    }
    return undefined;
  };
  for (const b of Object.values(doc.boards).sort(byName)) {
    if (paths.has(b.id)) continue;
    const project = projectOf(b);
    paths.set(b.id, take(project ? projectDirs.get(project)! : '', safeName(b.title), '.json'));
  }

  const elementsByBoard = new Map<string, El[]>();
  for (const el of Object.values(doc.elements)) {
    const list = elementsByBoard.get(el.boardId);
    if (list) list.push(el);
    else elementsByBoard.set(el.boardId, [el]);
  }

  // Attached files, in a stable order so a name that's taken twice keeps its "(2)".
  const attachments = new Map<string, string>();
  const place = (el: El, dir: string) => {
    if (el.type !== 'file' || !el.ref || attachments.has(el.ref)) return;
    const ext = /\.[a-z0-9]{1,8}$/i.exec(el.name)?.[0] ?? '';
    attachments.set(el.ref, take(dir, safeName(ext ? el.name.slice(0, -ext.length) : el.name), ext.toLowerCase()));
  };
  const byRef = (a: El, b: El) => (a.type === 'file' && b.type === 'file' ? a.ref.localeCompare(b.ref) : 0);
  for (const el of Object.values(doc.elements).sort(byRef)) {
    const board = doc.boards[el.boardId];
    const project = board && projectOf(board);
    place(el, join(project ? projectDirs.get(project)! : '', FILES_DIR));
  }
  const waiting = [...(doc.trash ?? []).flatMap((t) => t.elements), ...(doc.templates ?? []).flatMap((t) => t.elements)];
  for (const el of waiting.sort(byRef)) place(el, HOLDING_DIR);

  const files = new Map<string, string>();
  for (const [id, path] of paths) {
    const file: BoardFile = { pinpad: FORMAT, board: doc.boards[id], elements: elementsByBoard.get(id) ?? [] };
    files.set(path, JSON.stringify(file, null, 2));
  }
  // Once the Trash has been used the file stays, so emptying it is saved too.
  if (doc.trash) files.set(TRASH_FILE, JSON.stringify(doc.trash));
  if (doc.templates) files.set(TEMPLATES_FILE, JSON.stringify(doc.templates));
  const index: Index = { pinpad: FORMAT, rootId: doc.rootId, folders: doc.folders, boards: Object.fromEntries(paths) };
  if (attachments.size) index.files = Object.fromEntries(attachments);
  files.set(INDEX_FILE, JSON.stringify(index, null, 2));
  return { files, paths, attachments, dirs: new Map([...folderDirs, ...projectDirs]) };
}

/**
 * Reads the index: either a whole workspace saved in the earlier single-file format, or the
 * list of board files still to read.
 */
export function parseIndex(text: string): { doc: Doc } | { index: Index } {
  const data = JSON.parse(text);
  if (data?.elements) return { doc: parseWorkspace(text) };
  if (data?.pinpad !== FORMAT || !data.boards?.[data.rootId]) throw new Error(`${INDEX_FILE} isn't a Pinpad workspace index`);
  return { index: data as Index };
}

type Read = (paths: string[]) => Promise<Record<string, string | null>>;

/**
 * Rebuilds the document from the index and its board files. With a listing of what's there
 * now, it also follows changes made outside Pinpad: a board whose file was renamed or moved
 * is found by the id inside it, and boards whose files were deleted are deleted.
 */
export async function readWorkspace(
  index: Index,
  listing: Listed[] | null,
  read: Read,
): Promise<{ doc: Doc; files: Map<string, string>; paths: Map<string, string>; attachments: Map<string, string> }> {
  const found = new Map<string, { path: string; text: string; file: BoardFile }>();
  /** Files the index names must be board files; others are only looked through. */
  const consider = (path: string, text: string, expected?: string) => {
    let file: BoardFile;
    try {
      file = JSON.parse(text);
    } catch (err) {
      if (expected) throw new Error(`${path}: ${(err as Error).message}`);
      return;
    }
    if (!file?.board || !Array.isArray(file.elements)) {
      if (expected) throw new Error(`${path} isn't a Pinpad board file`);
      return;
    }
    const id = file.board.id ?? expected;
    if (id && index.boards[id] && !found.has(id)) found.set(id, { path, text, file });
  };

  const indexed = Object.entries(index.boards);
  const texts = await read([...indexed.map(([, path]) => path), TRASH_FILE, TEMPLATES_FILE]);
  for (const [id, path] of indexed) {
    const text = texts[path];
    if (text != null) consider(path, text, id);
  }
  let missing = indexed.filter(([id]) => !found.has(id));
  if (missing.length && listing) {
    const tried = new Set(indexed.filter(([, path]) => texts[path] != null).map(([, path]) => path));
    const others = listing.filter((f) => !f.dir && !f.pending && f.path !== INDEX_FILE && f.path !== TRASH_FILE && f.path !== TEMPLATES_FILE && !tried.has(f.path)).map((f) => f.path);
    const more = others.length ? await read(others) : {};
    for (const path of others) {
      const text = more[path];
      if (text != null) consider(path, text);
    }
    missing = indexed.filter(([id]) => !found.has(id));
  }
  if (missing.length) {
    const home = missing.find(([id]) => id === index.rootId);
    if (home || !listing) throw new Error(`${(home ?? missing[0])[1]} is missing`);
    if (listing.some((f) => f.pending)) throw new Error('some boards are still downloading from iCloud Drive; try again in a moment');
  }

  const doc: Doc = { rootId: index.rootId, boards: {}, elements: {}, folders: index.folders ?? {} };
  try {
    const trash = JSON.parse(texts[TRASH_FILE] ?? '[]');
    if (Array.isArray(trash) && texts[TRASH_FILE] != null) doc.trash = trash;
  } catch {
    // An unreadable Trash file only loses what was in the Trash.
  }
  try {
    const templates = JSON.parse(texts[TEMPLATES_FILE] ?? '[]');
    if (Array.isArray(templates) && texts[TEMPLATES_FILE] != null) doc.templates = templates;
  } catch {
    // An unreadable templates file only loses the saved templates.
  }
  for (const [id, { file }] of found) {
    doc.boards[id] = { ...file.board, id };
    for (const el of file.elements) doc.elements[el.id] = { ...el, boardId: id };
  }
  if (missing.length) deleteBoards(doc, new Set(missing.map(([id]) => id)));

  const paths = new Map([...found].map(([id, f]) => [id, f.path]));
  const files = new Map([...found].map(([, f]) => [f.path, f.text]));
  if (texts[TRASH_FILE] != null) files.set(TRASH_FILE, texts[TRASH_FILE]!);
  if (texts[TEMPLATES_FILE] != null) files.set(TEMPLATES_FILE, texts[TEMPLATES_FILE]!);
  if (listing) followRenames(doc, index, paths, listing);
  return { doc, files, paths, attachments: attachmentsOnDisk(doc, index) };
}

/** Where each attached file is now: as the index records, or where files were kept before. */
function attachmentsOnDisk(doc: Doc, index: Index) {
  const out = new Map<string, string>(Object.entries(index.files ?? {}));
  const all = [...Object.values(doc.elements), ...(doc.trash ?? []).flatMap((t) => t.elements), ...(doc.templates ?? []).flatMap((t) => t.elements)];
  for (const el of all) if (el.type === 'file' && el.ref && !out.has(el.ref)) out.set(el.ref, legacyAttachmentPath(el.ref, el.name));
  return out;
}

/** Deletes boards whose files are gone, the cards that open them, and boards only reachable through them. */
function deleteBoards(doc: Doc, gone: Set<string>) {
  for (let grew = true; grew; ) {
    grew = false;
    for (const b of Object.values(doc.boards)) {
      if (b.parentId && gone.has(b.parentId) && !gone.has(b.id)) {
        gone.add(b.id);
        grew = true;
      }
    }
  }
  for (const el of Object.values(doc.elements)) if (gone.has(el.boardId)) delete doc.elements[el.id];
  for (const id of gone) delete doc.boards[id];
  const cards = Object.values(doc.elements).filter((el) => el.type === 'board' && gone.has(el.targetId));
  deleteElements(doc, cards.map((el) => el.id));
}

/**
 * Renames and refiles boards and sidebar folders to match files and folders that were
 * renamed or moved outside Pinpad, so the next save keeps the user's names instead of
 * putting the old ones back.
 */
function followRenames(doc: Doc, index: Index, paths: Map<string, string>, listing: Listed[]) {
  const moved = [...paths].filter(([id, path]) => path !== index.boards[id] && doc.boards[id] && id !== doc.rootId);
  if (!moved.length) return;
  const dirs = new Set(listing.filter((f) => f.dir).map((f) => f.path.toLowerCase()));
  const exists = (dir: string) => !dir || dirs.has(dir.toLowerCase());

  // A folder was renamed when what was in it is now under another name and it's gone.
  const renamed = new Map<string, string>();
  for (const [id, path] of moved) {
    const from = segments(dirname(index.boards[id]));
    const to = segments(dirname(path));
    if (from.length !== to.length) continue;
    from.forEach((name, i) => {
      const old = from.slice(0, i + 1).join('/');
      if (name !== to[i] && !exists(old)) renamed.set(old, to[i]);
    });
  }
  const now = (dir: string) => {
    const parts = segments(dir);
    return parts.map((name, i) => renamed.get(parts.slice(0, i + 1).join('/')) ?? name).join('/');
  };

  const oldFolderDirs = placeFolders(index.folders ?? {}, namer());
  const folderAt = new Map<string, string>();
  for (const [id, dir] of oldFolderDirs) {
    const folder = doc.folders[id];
    if (!folder) continue;
    const name = renamed.get(dir);
    if (name) folder.name = name;
    folderAt.set(now(dir).toLowerCase(), id);
  }
  const hadFiles = (dir: string) => Object.values(index.boards).some((p) => p.startsWith(`${dir}/`));
  const claimed = new Set<string>();
  /** The sidebar folder for a directory: a known one, one moved there, or a new one. */
  const folderFor = (dir: string): string | undefined => {
    if (!dir) return undefined;
    const known = folderAt.get(dir.toLowerCase());
    if (known) return known;
    const parentId = folderFor(dirname(dir));
    const name = basename(dir);
    let folder = Object.values(doc.folders).find((f) => {
      const old = oldFolderDirs.get(f.id);
      return !claimed.has(f.id) && f.name.toLowerCase() === name.toLowerCase() && old !== undefined && hadFiles(old) && !exists(now(old));
    });
    if (!folder) {
      const order = Math.max(0, ...Object.values(doc.folders).map((f) => f.order)) + 1;
      folder = { id: uid(), name, order };
      doc.folders[folder.id] = folder;
    }
    if (parentId) folder.parentId = parentId;
    else delete folder.parentId;
    claimed.add(folder.id);
    folderAt.set(dir.toLowerCase(), folder.id);
    return folder.id;
  };

  const projectIds = new Set(projects(doc).map((p) => p.id));
  for (const [id, path] of moved) {
    const board = doc.boards[id];
    const before = index.boards[id];
    if (projectIds.has(id)) {
      // A project lives in a folder of its own, unless its file was put straight into a
      // sidebar folder or the top level.
      const dir = dirname(path);
      const own = dir && !folderAt.has(dir.toLowerCase()) ? dir : '';
      if (own && basename(own) !== basename(dirname(before))) board.title = basename(own);
      const folderId = folderFor(own ? dirname(own) : dir);
      if (folderId) board.folderId = folderId;
      else delete board.folderId;
    }
    if (stem(path) !== stem(before)) board.title = stem(path);
  }
}
