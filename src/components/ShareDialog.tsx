import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Copy, Download, Link2, Send, Share, X } from 'lucide-react';
import { cloudInUse, getState, usingWebFolder } from '../store';
import { boardLink, copyLink } from '../boardLinks';
import { canShareFiles, describeCopy, makeShareFile, sendFile } from '../shareFile';
import { formatSize } from '../fileTypes';

type Target = { kind: 'project' | 'board' | 'folder'; id: string };
let show: ((target: Target) => void) | null = null;

/** Opens Share for a project, board or sidebar folder. */
export const openShare = (target: Target) => show?.(target);

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Who a link opens for, where the boards are kept now. */
function linkReach() {
  const cloud = cloudInUse();
  if (cloud === 'drive') return 'anyone signed in to this Google Drive in Pinpad';
  if (cloud === 'onedrive') return 'anyone signed in to this OneDrive in Pinpad';
  if (usingWebFolder() || window.pinpadNative) return 'anyone using this folder in Pinpad (synced to their computer, say with Google Drive or Dropbox)';
  return null;
}

/**
 * Share: a link that opens the board (or folder) directly for people who use the same boards,
 * and Send a copy, a .pinpad file for anyone else, who imports it as their own.
 */
export function ShareDialog() {
  const [target, setTarget] = useState<Target | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    show = (t) => {
      setTarget(t);
      setCopied(false);
      setBusy(false);
      setNote(null);
    };
    return () => {
      show = null;
    };
  }, []);

  useEffect(() => {
    if (!target) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setTarget(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [target]);

  if (!target) return null;
  const { doc } = getState();
  const name = (target.kind === 'folder' ? doc.folders[target.id]?.name : doc.boards[target.id]?.title) || 'Untitled';
  const noun = target.kind;
  const link = { kind: target.kind === 'folder' ? 'folder' : 'board', id: target.id } as const;
  const reach = linkReach();
  const info = describeCopy(target);

  const copy = async () => {
    if (!(await copyLink(link))) {
      setNote("Your browser didn't allow copying: select the link and copy it yourself.");
      return;
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const send = async (share: boolean) => {
    setBusy(true);
    setNote(null);
    try {
      const { file, missing } = await makeShareFile(target);
      const how = await sendFile(file, share);
      if (how === 'cancelled') return;
      const left = missing ? ` ${plural(missing, 'attached file')} not on this device ${missing === 1 ? 'was' : 'were'} left out.` : '';
      setNote(`${how === 'shared' ? 'Sent' : `Saved “${file.name}” to your downloads`} (${formatSize(file.size)}).${left}`);
    } catch (err) {
      setNote(`Couldn't make the copy: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  const contents = [
    info.projects > 1 ? plural(info.projects, 'project') : null,
    plural(info.boards, 'board'),
    info.files ? `${plural(info.files, 'attached file')} (${formatSize(info.fileBytes)})` : null,
  ].filter(Boolean).join(', ');

  return createPortal(
    <div className="search-backdrop" onPointerDown={() => setTarget(null)}>
      <div className="dialog share-dialog" role="dialog" aria-labelledby="share-title" onPointerDown={(e) => e.stopPropagation()}>
        <div className="dialog-head">
          <h2 id="share-title">Share “{name}”</h2>
          <button className="icon-btn" onClick={() => setTarget(null)} aria-label="Close"><X size={18} /></button>
        </div>

        <div className="share-section">
          <div className="share-section-head"><Link2 size={16} /> Link that opens this {noun}</div>
          <p className="share-detail">
            {reach
              ? `Opens it straight away for ${reach}. Send it to them; one click and they're here.`
              : 'Your boards are kept in this browser only, so the link only works here. Sign in with Google (top right) to open it on other computers too.'}
          </p>
          <div className="share-link">
            <input readOnly value={boardLink(link)} onFocus={(e) => e.currentTarget.select()} aria-label="Link" />
            <button className="btn-primary" onClick={copy}>{copied ? <><Check size={14} /> Copied</> : <><Copy size={14} /> Copy link</>}</button>
          </div>
        </div>

        <div className="share-section">
          <div className="share-section-head"><Send size={16} /> Send a copy</div>
          <p className="share-detail">
            For someone who doesn't use these boards: a file with a copy of this {noun} ({contents}). They import it
            (⚙ menu → Import, or drop it onto a board) as their own; changes after that aren't shared.
          </p>
          <div className="share-actions">
            {canShareFiles() && (
              <button className="btn-secondary" disabled={busy} onClick={() => send(true)}><Share size={14} /> Share…</button>
            )}
            <button className="btn-secondary" disabled={busy} onClick={() => send(false)}>
              <Download size={14} /> {busy ? 'Preparing…' : 'Download file'}
            </button>
          </div>
          {note && <p className="share-note">{note}</p>}
        </div>
      </div>
    </div>,
    document.body,
  );
}
