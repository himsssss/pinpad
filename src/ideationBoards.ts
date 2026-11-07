/**
 * Creative Tracker's ideation boards. "Open board" on a brief arrives with #project=&brief=&year=&month=
 * (kept by main.tsx until Pinpad has opened). Its board lives in a folder called "Ideation boards",
 * picked once and remembered, filed <Project>/<Year>/<Month>/<Project> <Brief ID> and made the first
 * time anyone opens it. Folders on disk are the website's Chrome/Edge feature (webFolderStorage.ts);
 * elsewhere the board is filed the same way wherever the boards are open.
 */
import { createElement, maxZ, projects, uid } from './doc';
import { getState, mutate, openBoard, usingWebFolder, whenOpened } from './store';
import { allowWebFolder, chooseWebFolder, currentWebFolder, webFolders, webFoldersSupported } from './webFolderStorage';
import { openPlace } from './places';
import { askConfirm } from './components/ConfirmDialog';

export type TrackerBrief = { project: string; brief: string; year: string; month: string };

export const IDEATION_FOLDER_NAME = 'Ideation boards';
/** The brief being opened, until Pinpad has opened (sessionStorage: survives the sign-in page). */
const PENDING_KEY = 'pinpad:tracker-brief';
/** Which picked folder is the Ideation boards one (localStorage: {id, name}). */
const FOLDER_KEY = 'pinpad:ideation-folder';

/** Keeps the brief from the tracker's link (main.tsx), so it outlives clearing the address. */
export function keepTrackerBrief(params: URLSearchParams) {
  const brief = { project: params.get('project'), brief: params.get('brief'), year: params.get('year'), month: params.get('month') };
  if (!Object.values(brief).every((v) => v?.trim())) return;
  try {
    sessionStorage.setItem(PENDING_KEY, JSON.stringify(brief));
  } catch {
    // Without storage the brief's board just isn't opened.
  }
}

function takeTrackerBrief(): TrackerBrief | null {
  try {
    const brief = JSON.parse(sessionStorage.getItem(PENDING_KEY) ?? 'null');
    sessionStorage.removeItem(PENDING_KEY);
    return brief;
  } catch {
    return null;
  }
}

/** The remembered Ideation boards folder, if it's still one this browser can use. */
async function ideationFolder(): Promise<{ id: string; name: string } | null> {
  try {
    const saved = JSON.parse(localStorage.getItem(FOLDER_KEY) ?? 'null') as { id: string; name: string } | null;
    return saved && (await webFolders()).some((f) => f.id === saved.id) ? saved : null;
  } catch {
    return null;
  }
}

function rememberIdeationFolder(folder: { id: string; name: string }) {
  try {
    localStorage.setItem(FOLDER_KEY, JSON.stringify(folder));
  } catch {
    // Asked again next time.
  }
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Finds or makes <Project>/<Year>/<Month> and the brief's board in it; returns the board's id. */
export function fileBriefBoard(b: TrackerBrief): string {
  const title = `${b.project} ${b.brief}`;
  let boardId = '';
  mutate((d) => {
    let parentId: string | undefined;
    for (const name of [b.project, b.year, b.month]) {
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
    if (existing) {
      boardId = existing.id;
      return;
    }
    const onHome = Object.values(d.elements).filter((e) => e.boardId === d.rootId && !e.columnId && e.type !== 'line');
    const x = onHome.length ? Math.max(...onHome.map((e) => e.x + e.w)) + 40 : 80;
    const { el, board } = createElement('board', d.rootId, x, 80, maxZ(d) + 1);
    if (!board) return;
    Object.assign(board, { title, folderId: parentId });
    d.elements[el.id] = el;
    d.boards[board.id] = board;
    boardId = board.id;
  });
  return boardId;
}

async function fileAndOpen(b: TrackerBrief) {
  await whenOpened();
  const id = fileBriefBoard(b);
  if (id && getState().doc.boards[id]) openBoard(id);
}

/** Opens the folder as the workspace; an empty one starts empty rather than copying the open boards. */
async function openIdeationFolder(folder: { id: string; name: string }) {
  await openPlace({ id: `webfolder:${folder.id}`, kind: 'webfolder', folderId: folder.id, name: folder.name }, async () => 'fresh');
}

/**
 * Opens the brief the tracker sent, if any: in the Ideation boards folder (asking to connect it the
 * first time, or to reopen it when the browser needs a click), then at its board.
 */
export async function openTrackerBrief() {
  const b = takeTrackerBrief();
  if (!b) return;
  if (!webFoldersSupported()) return fileAndOpen(b);

  const folder = await ideationFolder();
  if (folder && usingWebFolder() && currentWebFolder()?.id === folder.id && (await allowWebFolder(folder.id, false))) return fileAndOpen(b);

  if (folder) {
    // Choosing a folder or allowing it needs a click, hence the button.
    const go = await askConfirm({
      title: `Open the ${b.project} ${b.brief} board`,
      message: `It's kept in your “${folder.name}” folder, in ${b.project} › ${b.year} › ${b.month}.`,
      confirm: `Open “${folder.name}”`,
    });
    if (!go) return;
    await openIdeationFolder(folder);
    return fileAndOpen(b);
  }

  const connect = await askConfirm({
    title: `Connect your ${IDEATION_FOLDER_NAME} folder`,
    message: `Creative Tracker's boards are kept in a folder called “${IDEATION_FOLDER_NAME}” (make one if you don't have it). Choose it once and Pinpad remembers it. Each brief gets its own board inside, in Project › Year › Month folders — this one goes in ${b.project} › ${b.year} › ${b.month}.`,
    confirm: 'Choose folder',
  });
  if (!connect) return;
  const chosen = await chooseWebFolder();
  if (!chosen) return;
  if (!same(chosen.name, IDEATION_FOLDER_NAME)) {
    const anyway = await askConfirm({
      title: `That folder is called “${chosen.name}”`,
      message: `Use it for ideation boards anyway? Pinpad looks for it by this choice, not by its name.`,
      confirm: 'Use it',
    });
    if (!anyway) return;
  }
  rememberIdeationFolder(chosen);
  await openIdeationFolder(chosen);
  return fileAndOpen(b);
}
