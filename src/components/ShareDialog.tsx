import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Copy, Link2, X } from 'lucide-react';
import { flushNow, getState, usingDrive } from '../store';
import { driveStorage } from '../driveStorage';
import { layoutWorkspace } from '../workspaceFiles';
import { shareLink, sharingConfigured } from '../sharedView';
import { DriveIcon } from './DriveIcon';

type Target = { kind: 'project' | 'folder'; id: string };
let show: ((target: Target) => void) | null = null;

/** Opens the Share dialog for a project or sidebar folder (from its right-click menu). */
export const openShare = (target: Target) => show?.(target);

/**
 * Share a project or folder like in Google Drive: "Anyone with the link can open" lets anyone
 * with Pinpad open it, read-only, and see changes as they're made. It shares the project's
 * (or folder's) folder in the owner's Google Drive, so it needs boards saved there.
 */
export function ShareDialog() {
  const [target, setTarget] = useState<Target | null>(null);
  const [folderId, setFolderId] = useState<string | null>(null);
  const [on, setOn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    show = (t) => {
      setTarget(t);
      setFolderId(null);
      setOn(null);
      setCopied(false);
      setError(null);
    };
    return () => {
      show = null;
    };
  }, []);

  const drive = usingDrive();
  useEffect(() => {
    if (!target || !drive) return;
    let alive = true;
    (async () => {
      // Saved first, so a new project's folder exists in Drive.
      await flushNow();
      const dir = layoutWorkspace(getState().doc).dirs?.get(target.id);
      const id = dir ? await driveStorage.folderId(dir) : null;
      if (!alive) return;
      if (!id) return setError(target.kind === 'folder' ? 'This folder has no projects in Google Drive yet: add one, then share it.' : "This project isn't in Google Drive yet: try again once it has saved.");
      setFolderId(id);
      setOn(await driveStorage.linkShared(id));
    })().catch((err) => alive && setError(err instanceof Error ? err.message : String(err)));
    return () => {
      alive = false;
    };
  }, [target]);

  useEffect(() => {
    if (!target) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setTarget(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [target]);

  if (!target) return null;
  const { doc } = getState();
  const name = target.kind === 'folder' ? doc.folders[target.id]?.name : doc.boards[target.id]?.title;
  const link = folderId ? shareLink(folderId) : '';

  const toggle = async () => {
    if (!folderId || on === null) return;
    setBusy(true);
    setError(null);
    try {
      await driveStorage.setLinkShared(folderId, !on);
      setOn(!on);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    await navigator.clipboard.writeText(link).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return createPortal(
    <div className="search-backdrop" onPointerDown={() => setTarget(null)}>
      <div className="dialog share-dialog" role="dialog" aria-labelledby="share-title" onPointerDown={(e) => e.stopPropagation()}>
        <div className="dialog-head">
          <h2 id="share-title">Share “{name || 'Untitled'}”</h2>
          <button className="icon-btn" onClick={() => setTarget(null)} aria-label="Close"><X size={18} /></button>
        </div>
        {!drive ? (
          <p className="dialog-text">
            Sharing works for boards saved in Google Drive. Sign in with Google (top right) to save your boards there,
            then share any project or folder.
          </p>
        ) : !sharingConfigured() ? (
          <p className="dialog-text">Sharing links aren't set up in this version of Pinpad yet.</p>
        ) : (
          <>
            <div className="share-row">
              <span className="share-icon"><Link2 size={18} /></span>
              <div className="share-text">
                <div className="share-title">Anyone with the link can open</div>
                <div className="share-detail">
                  {on ? 'They see it in Pinpad, read-only, with your changes as you make them, and can save a copy.' : 'Only you can open it.'}
                </div>
              </div>
              <button
                className={`switch ${on ? 'on' : ''}`}
                role="switch"
                aria-checked={!!on}
                aria-label="Anyone with the link can open"
                disabled={busy || on === null}
                onClick={toggle}
              >
                <span />
              </button>
            </div>
            {on && (
              <div className="share-link">
                <input readOnly value={link} onFocus={(e) => e.currentTarget.select()} aria-label="Link" />
                <button className="btn-primary" onClick={copy}>{copied ? <><Check size={14} /> Copied</> : <><Copy size={14} /> Copy link</>}</button>
              </div>
            )}
            <p className="share-note"><DriveIcon size={12} /> Shares this {target.kind}'s folder in your Google Drive. Turn the link off any time.</p>
          </>
        )}
        {error && <div className="dialog-error" role="alert"><span>{error}</span></div>}
      </div>
    </div>,
    document.body,
  );
}
