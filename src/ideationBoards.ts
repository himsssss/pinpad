/**
 * Creative Tracker's ideation boards. "Open board" on a brief arrives with #project=&brief=&year=&month=
 * (kept by main.tsx until Pinpad has opened). Its board is filed in the boards already open, under
 * Ideation boards/<Project>/<Year>/<Month>, named "<Project> <Brief ID>", made the first time anyone
 * opens it and reopened after that. In a folder on disk (desktop app, or a picked folder on the
 * website) those sidebar folders are real folders.
 */
import { createElement, maxZ, projects, uid } from './doc';
import { browserHasBoards, getState, mutate, openBoard, setUI, switchStorage, usingWebFolder, whenOpened } from './store';
import { currentWebFolder } from './webFolderStorage';

/** `key` and `url`: the tracker's key for the brief and its address, for board pictures (trackerPreview.ts). */
export type TrackerBrief = { project: string; brief: string; year: string; month: string; key?: string; url?: string };

export const IDEATION_FOLDER_NAME = 'Ideation boards';
/** The brief being opened, until Pinpad has opened (sessionStorage: survives the sign-in page). */
const PENDING_KEY = 'pinpad:tracker-brief';
/** The last brief opened in this tab, kept so a version switch right after (serviceWorker.ts) still links its board. */
const LAST_KEY = 'pinpad:tracker-brief-last';
/**
 * Set by the first version, which opened a picked "Ideation boards" folder in place of the boards
 * already open (hiding "This browser" in Chrome and Edge). Seeing it sends Pinpad back, once.
 */
const OLD_FOLDER_KEY = 'pinpad:ideation-folder';

/** Keeps the brief from the tracker's link (main.tsx), so it outlives clearing the address. */
export function keepTrackerBrief(params: URLSearchParams) {
  const brief = { project: params.get('project'), brief: params.get('brief'), year: params.get('year'), month: params.get('month') };
  if (!Object.values(brief).every((v) => v?.trim())) return;
  const key = params.get('key');
  const url = params.get('api');
  const tracker = key && url && /^https?:\/\//.test(url) ? { key, url: url.replace(/\/+$/, '') } : {};
  try {
    sessionStorage.setItem(PENDING_KEY, JSON.stringify({ ...brief, ...tracker }));
    sessionStorage.setItem(LAST_KEY, JSON.stringify({ ...brief, ...tracker }));
  } catch {
    // Without storage the brief's board just isn't opened.
  }
}

/** The brief waiting to be opened; it stays until its board is open, so a reload part-way (a version switch) still opens it. */
function pendingTrackerBrief(): TrackerBrief | null {
  try {
    return JSON.parse(sessionStorage.getItem(PENDING_KEY) ?? 'null');
  } catch {
    return null;
  }
}

function donePending() {
  try {
    sessionStorage.removeItem(PENDING_KEY);
  } catch {
    // Nothing kept, nothing to clear.
  }
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Finds or makes Ideation boards/<Project>/<Year>/<Month> and the brief's board in it; returns the board's id. */
export function fileBriefBoard(b: TrackerBrief): string {
  const title = `${b.project} ${b.brief}`;
  let boardId = '';
  mutate((d) => {
    let parentId: string | undefined;
    // Boards kept in a folder that is itself called "Ideation boards" don't need another one inside.
    const inIdeationFolder = usingWebFolder() && same(currentWebFolder()?.name ?? '', IDEATION_FOLDER_NAME);
    for (const name of [...(inIdeationFolder ? [] : [IDEATION_FOLDER_NAME]), b.project, b.year, b.month]) {
      const siblings = Object.values(d.folders).filter((f) => f.parentId === parentId);
      const found = siblings.find((f) => same(f.name, name));
      if (found) {
        parentId = found.id;
        continue;
      }
      const id = uid();
      d.folders[id] = { id, name, order: Math.max(0, ...siblings.map((f) => f.order)) + 1, ...(parentId ? { parentId } : {}) };
      parentId = id;
    }
    // Opened before: the one in its month folder, else one moved elsewhere (never a second copy).
    const all = projects(d);
    const existing = all.find((p) => p.folderId === parentId && same(p.title, title)) ?? all.find((p) => same(p.title, title));
    const tracker = b.key && b.url ? { key: b.key, url: b.url } : undefined;
    if (existing) {
      boardId = existing.id;
      const board = d.boards[existing.id];
      if (tracker && (board.tracker?.key !== tracker.key || board.tracker?.url !== tracker.url)) board.tracker = tracker;
      return;
    }
    const onHome = Object.values(d.elements).filter((e) => e.boardId === d.rootId && !e.columnId && e.type !== 'line');
    const x = onHome.length ? Math.max(...onHome.map((e) => e.x + e.w)) + 40 : 80;
    const { el, board } = createElement('board', d.rootId, x, 80, maxZ(d) + 1);
    if (!board) return;
    Object.assign(board, { title, folderId: parentId, ...(tracker ? { tracker } : {}) });
    d.elements[el.id] = el;
    d.boards[board.id] = board;
    boardId = board.id;
  });
  return boardId;
}

/** Undoes the first version's switch: back to this browser's boards, which Chrome and Edge then list again. */
async function leaveOldIdeationFolder() {
  let old: { id: string } | null = null;
  try {
    old = JSON.parse(localStorage.getItem(OLD_FOLDER_KEY) ?? 'null');
    localStorage.removeItem(OLD_FOLDER_KEY);
  } catch {
    return;
  }
  if (!old) return;
  await whenOpened();
  // Only where this browser has boards to go back to; otherwise the folder stays open (it's
  // still a normal place in the logo menu, and a Drive can be opened from there).
  if (usingWebFolder() && currentWebFolder()?.id === old.id && (await browserHasBoards())) {
    await switchStorage({ kind: 'browser' }, 'open');
  }
}

/** After a reload (a version switch): the brief opened before it keeps its link to the tracker, without reopening it. */
async function relinkLastBrief() {
  let last: TrackerBrief | null = null;
  try {
    last = JSON.parse(sessionStorage.getItem(LAST_KEY) ?? 'null');
  } catch {
    return;
  }
  if (!last?.key || !last.url) return;
  await whenOpened();
  const linked = Object.values(getState().doc.boards).some((bd) => bd.tracker?.key === last!.key && bd.tracker?.url === last!.url);
  if (!linked && projects(getState().doc).some((p) => same(p.title, `${last!.project} ${last!.brief}`))) fileBriefBoard(last);
}

/** Opens the brief the tracker sent, if any, at its board in the boards already open. */
export async function openTrackerBrief() {
  await leaveOldIdeationFolder();
  const b = pendingTrackerBrief();
  if (!b) return relinkLastBrief();
  // Opened at once from this device's copy of the boards while the folder or Drive is still being
  // read (a network drive takes a few seconds). The read usually finds the same boards and keeps
  // this one; if it found changes made elsewhere it replaces the copy, so the board is filed (or
  // found) again in what it read.
  const first = fileBriefBoard(b);
  if (first && getState().doc.boards[first]) openBoard(first);
  // Opened from Creative Tracker: the board gets the room, with the folders tucked away (the
  // button by the logo, or the shortcut, brings them back).
  setUI({ sidebarOpen: false });
  await whenOpened();
  const { doc, ui } = getState();
  if (!doc.boards[first] || ui.boardId !== first) {
    const id = fileBriefBoard(b);
    // Still on this brief (not moved on to something else meanwhile).
    if (id && getState().doc.boards[id] && (ui.boardId === first || ui.boardId === doc.rootId)) openBoard(id);
  }
  donePending();
}
