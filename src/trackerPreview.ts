/**
 * Pictures of Creative Tracker briefs' boards for the tracker, which shows them when someone
 * hovers "Open" (its ideation table). A board filed for a brief (ideationBoards.ts) knows the
 * brief's key and the tracker's address; a few seconds after it's opened or changed, while it's
 * on screen and nobody is typing in it, a small picture of it goes to the tracker with the
 * Pinpad sign-in, which the tracker checks is one of its own users (tracker-<id>).
 */
import { getState, subscribeStore } from './store';
import { pinpadAccount, pinpadIdToken } from './pinpadAccount';
import { boardSnapshot } from './exportBoard';

const WAIT_MS = 4000;
/** Per board: the version last sent (its updatedAt), so an unchanged board isn't sent again. */
const sent = new Map<string, number>();
let timer: number | undefined;
let sending = false;

function trackedBoard() {
  const { doc, ui } = getState();
  if (ui.browsing !== null) return null;
  const board = doc.boards[ui.boardId];
  return board?.tracker && board.id !== doc.rootId ? board : null;
}

async function send() {
  timer = undefined;
  const board = trackedBoard();
  if (!board || sending) return;
  if (getState().ui.editingId || document.hidden) return void schedule();
  const version = board.updatedAt ?? 0;
  if (sent.get(board.id) === version) return;
  if (!pinpadAccount()?.uid.startsWith('tracker-')) return;
  sending = true;
  try {
    const [token, image] = await Promise.all([pinpadIdToken(), boardSnapshot().catch(() => null)]);
    // Moved to another board meanwhile: the picture may be of that one.
    if (!token || !image || trackedBoard()?.id !== board.id) return;
    const res = await fetch(`${board.tracker!.url}/api/pinpad/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ briefKey: board.tracker!.key, image }),
    });
    if (res.ok) sent.set(board.id, version);
  } catch {
    // The tracker can't be reached (offline, or a different network): tried after the next change.
  } finally {
    sending = false;
  }
}

function schedule() {
  clearTimeout(timer);
  timer = window.setTimeout(send, WAIT_MS);
}

let watching = false;
/** Starts watching for tracker boards being opened or changed (once, from App). */
export function watchTrackerBoards() {
  if (watching) return;
  watching = true;
  let last = '';
  subscribeStore(() => {
    const board = trackedBoard();
    const now = board ? `${board.id}:${board.updatedAt ?? 0}` : '';
    if (now === last) return;
    last = now;
    if (board && sent.get(board.id) !== (board.updatedAt ?? 0)) schedule();
  });
}
