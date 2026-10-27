/**
 * How the desktop apps lay the workspace out on disk: one JSON file per board, a folder per
 * project (holding the project board and every board inside it), sidebar folders as real
 * folders, and a small index that records the sidebar folders and where each board lives.
 *
 *   Pinpad Workspace.json      index
 *   Home.json
 *   Work/                      sidebar folder
 *     Project plan/            project
 *       Project plan.json
 *       Research.json          a board inside the project
 *
 * Each board file carries its own board record and ids, so loading never depends on file
 * names; names only follow titles to make the folder easy to browse.
 */

import type { Board, Doc, El, Folder } from './types';
import { projects } from './doc';

/** Parses an exported or stored workspace, throwing if it isn't one. */
export function parseWorkspace(text: string): Doc {
  const doc = JSON.parse(text) as Doc;
  if (!doc?.boards?.[doc.rootId] || !doc.elements) throw new Error('Not a Pinpad workspace file');
  // Workspaces saved before folders existed.
  doc.folders ??= {};
  return doc;
}

export const INDEX_FILE = 'Pinpad Workspace.json';
const FORMAT = 2;

interface Index {
  pinpad: number;
  rootId: string;
  folders: Record<string, Folder>;
  /** Board id to its file, relative to the storage folder, with / separators. */
  boards: Record<string, string>;
}

interface BoardFile {
  pinpad: number;
  board: Board;
  elements: El[];
}

export interface Layout {
  /** Relative path to file text; board files first, the index last. */
  files: Map<string, string>;
  /** Board id to its relative path. */
  paths: Map<string, string>;
}

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

export function layoutWorkspace(doc: Doc): Layout {
  // Names already used in each directory, compared case-insensitively like the file systems.
  const used = new Map<string, Set<string>>();
  const take = (dir: string, base: string, ext = '') => {
    const names = used.get(dir) ?? new Set<string>();
    used.set(dir, names);
    let name = base;
    for (let i = 2; names.has(`${name}${ext}`.toLowerCase()); i++) name = `${base} (${i})`;
    names.add(`${name}${ext}`.toLowerCase());
    return join(dir, `${name}${ext}`);
  };
  take('', 'Pinpad Workspace', '.json');

  const folderDirs = new Map<string, string>();
  const folderDir = (id: string): string => {
    const known = folderDirs.get(id);
    if (known !== undefined) return known;
    const folder = doc.folders[id];
    const parent = folder.parentId && doc.folders[folder.parentId] ? folderDir(folder.parentId) : '';
    const dir = take(parent, safeName(folder.name));
    folderDirs.set(id, dir);
    return dir;
  };
  const byName = (a: { title?: string; name?: string; id: string }, b: typeof a) =>
    (a.title ?? a.name ?? '').localeCompare(b.title ?? b.name ?? '') || a.id.localeCompare(b.id);
  Object.values(doc.folders).sort((a, b) => a.order - b.order || byName(a, b)).forEach((f) => folderDir(f.id));

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

  const files = new Map<string, string>();
  for (const [id, path] of paths) {
    const file: BoardFile = { pinpad: FORMAT, board: doc.boards[id], elements: elementsByBoard.get(id) ?? [] };
    files.set(path, JSON.stringify(file, null, 2));
  }
  const index: Index = { pinpad: FORMAT, rootId: doc.rootId, folders: doc.folders, boards: Object.fromEntries(paths) };
  files.set(INDEX_FILE, JSON.stringify(index, null, 2));
  return { files, paths };
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

/** Rebuilds the document from the index and the board files it lists. */
export function assembleWorkspace(index: Index, texts: Record<string, string | null>): Doc {
  const doc: Doc = { rootId: index.rootId, boards: {}, elements: {}, folders: index.folders ?? {} };
  for (const [id, path] of Object.entries(index.boards)) {
    const text = texts[path];
    if (text == null) throw new Error(`${path} is missing`);
    let file: BoardFile;
    try {
      file = JSON.parse(text);
    } catch (err) {
      throw new Error(`${path}: ${(err as Error).message}`);
    }
    if (!file?.board || !Array.isArray(file.elements)) throw new Error(`${path} isn't a Pinpad board file`);
    doc.boards[id] = { ...file.board, id };
    for (const el of file.elements) doc.elements[el.id] = { ...el, boardId: id };
  }
  return doc;
}
