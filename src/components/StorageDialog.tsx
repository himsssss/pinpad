import { useEffect, useState } from 'react';
import { AlertTriangle, ExternalLink, FolderOpen, HardDrive, X } from 'lucide-react';
import { afterSignIn, switchStorage, usingDrive, useStore, type StorageTarget } from '../store';
import { nativeStorage, type StorageLocation } from '../native';
import { driveStorage } from '../driveStorage';
import { googleAccount, googleConfigured, preloadGoogle, signIn, signOut } from '../googleAuth';

const isMac = /Mac/.test(navigator.platform);
const fileManager = isMac ? 'Finder' : 'File Explorer';

/** Google Drive's mark, drawn small next to its tab. */
function DriveIcon() {
  return (
    <svg viewBox="0 0 87.3 78" width="16" height="16" aria-hidden="true">
      <path d="M6.6 66.85l3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3L27.5 53H0c0 1.55.4 3.1 1.2 4.5z" fill="#0066da" />
      <path d="M43.65 25L29.9 1.2c-1.35.8-2.5 1.9-3.3 3.3L1.2 48.5A9.06 9.06 0 000 53h27.5z" fill="#00ac47" />
      <path d="M73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5H59.8l5.85 11.5z" fill="#ea4335" />
      <path d="M43.65 25L57.4 1.2C56.05.4 54.5 0 52.9 0H34.4c-1.6 0-3.15.45-4.5 1.2z" fill="#00832d" />
      <path d="M59.8 53H27.5L13.75 76.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z" fill="#2684fc" />
      <path d="M73.4 26.5L60.7 4.5c-.8-1.4-1.95-2.5-3.3-3.3L43.65 25 59.8 53h27.45c0-1.55-.4-3.1-1.2-4.5z" fill="#ffba00" />
    </svg>
  );
}

/**
 * Shows where boards are saved and moves them: a folder on this computer (desktop apps), this
 * browser (website), or Google Drive. Switching never deletes the old copy; when the new place
 * already holds a workspace the user chooses whether to open it or replace it.
 */
export function StorageDialog({ onClose }: { onClose: () => void }) {
  const storage = nativeStorage();
  const storageError = useStore((s) => s.storageError);
  const [location, setLocation] = useState<StorageLocation | null>(null);
  const [drive, setDrive] = useState(usingDrive());
  const [tab, setTab] = useState<'local' | 'drive'>(usingDrive() ? 'drive' : 'local');
  const [account, setAccount] = useState(googleAccount());
  // A place that already has a workspace, waiting for the user to pick open or replace.
  const [conflict, setConflict] = useState<StorageTarget | null>(null);
  const [signOutAfter, setSignOutAfter] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    setDrive(usingDrive());
    setAccount(googleAccount());
    if (storage) setLocation(await storage.location());
  };
  useEffect(() => {
    refresh().catch((err) => setError(String(err)));
    preloadGoogle().catch(() => {});
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const run = async (task: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await task();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  /** Switches to a place (true once switched), or asks first when it already has a workspace. */
  const moveTo = async (target: StorageTarget) => {
    if (target.kind === 'folder' && storage) {
      const dir = target.folder ?? location?.defaultFolder;
      if (!dir || (!drive && dir === location?.folder)) return false;
      if ((await storage.inspect(dir)).hasWorkspace) {
        setConflict(target);
        return false;
      }
    }
    if (target.kind === 'drive') {
      driveStorage.reset();
      if (await driveStorage.hasWorkspace()) {
        setConflict(target);
        return false;
      }
    }
    await switchStorage(target, 'replace');
    return true;
  };

  const resolve = (keep: 'open' | 'replace') =>
    run(async () => {
      await switchStorage(conflict!, keep);
      setConflict(null);
      if (signOutAfter) await signOut();
      setSignOutAfter(false);
    });

  const changeFolder = () =>
    run(async () => {
      const folder = await storage!.choose();
      if (folder) await moveTo({ kind: 'folder', folder });
    });

  const thisFolder: StorageTarget = { kind: 'folder', folder: location && !location.isDefault ? location.folder : null };
  const local: StorageTarget = storage ? thisFolder : { kind: 'browser' };

  const connect = () =>
    run(async () => {
      await signIn();
      await moveTo({ kind: 'drive' });
    });

  // Back to this computer or browser; the Google sign-in is dropped once the boards have moved.
  const disconnect = () =>
    run(async () => {
      setSignOutAfter(true);
      if (await moveTo(local)) {
        await signOut();
        setSignOutAfter(false);
      }
    });

  const signInAgain = () =>
    run(async () => {
      await signIn();
      await afterSignIn();
    });

  const conflictPlace = conflict?.kind === 'drive' ? 'Your Google Drive' : 'That folder';

  return (
    <div className="search-backdrop" onPointerDown={onClose}>
      <div className="dialog" role="dialog" aria-labelledby="storage-title" onPointerDown={(e) => e.stopPropagation()}>
        <div className="dialog-head">
          <h2 id="storage-title">Storage location</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>

        <div className="segmented" role="tablist" aria-label="Where to save">
          <button role="tab" aria-selected={tab === 'local'} onClick={() => setTab('local')}>
            <HardDrive size={15} /> {storage ? 'This computer' : 'This browser'}
            {!drive && <span className="segmented-badge">In use</span>}
          </button>
          <button role="tab" aria-selected={tab === 'drive'} onClick={() => setTab('drive')}>
            <DriveIcon /> Google Drive
            {drive && <span className="segmented-badge">In use</span>}
          </button>
        </div>

        {tab === 'local' && storage && (
          <>
            <p className="dialog-text">
              Pinpad saves each board as its own file here, with a folder for each project. Pick a folder that
              iCloud Drive, OneDrive or Dropbox syncs to keep a backup.
            </p>
            <div className="storage-path">
              <FolderOpen size={18} aria-hidden="true" />
              <div>
                <div className="storage-folder">{location?.folder ?? '…'}</div>
                <div className="storage-file">
                  {location?.isDefault ? 'Default folder' : 'Chosen folder'}
                  {drive ? ' · not in use while saving to Google Drive' : ''}
                </div>
              </div>
            </div>
          </>
        )}

        {tab === 'local' && !storage && (
          <p className="dialog-text">
            Boards are saved in this browser only, so clearing its site data deletes them. Save to Google Drive, or
            use Export now and then, to keep a copy.
          </p>
        )}

        {tab === 'drive' && !googleConfigured() && (
          <p className="dialog-text">Google Drive isn't set up in this version of Pinpad yet.</p>
        )}

        {tab === 'drive' && googleConfigured() && (
          <>
            <p className="dialog-text">
              Save each board as a file in your Google Drive, in a Pinpad folder, and open them on any computer by
              signing in. Pinpad can only see the files it creates there.
            </p>
            {drive && (
              <div className="storage-path">
                <DriveIcon />
                <div>
                  <div className="storage-folder">My Drive › Pinpad</div>
                  <div className="storage-file">
                    {storageError ? `Last signed in as ${account ?? 'your Google account'}` : account ? `Signed in as ${account}` : 'Signed in'}
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {(error || storageError) && (
          <div className="dialog-error" role="alert">
            <AlertTriangle size={16} aria-hidden="true" />
            <span>{error ?? storageError}</span>
          </div>
        )}

        {conflict ? (
          <div className="storage-conflict">
            <p><strong>{conflictPlace} already has a Pinpad workspace.</strong> Open it, or replace it with the boards you have now?</p>
            <div className="dialog-actions">
              <button className="btn-secondary" disabled={busy} onClick={() => { setConflict(null); setSignOutAfter(false); }}>Cancel</button>
              <button className="btn-secondary danger" disabled={busy} onClick={() => resolve('replace')}>Replace it</button>
              <button className="btn-primary" disabled={busy} onClick={() => resolve('open')}>Open it</button>
            </div>
          </div>
        ) : (
          <div className="dialog-actions">
            {tab === 'local' && storage && (
              <>
                <button className="btn-secondary" disabled={busy} onClick={() => storage.reveal()}>Show in {fileManager}</button>
                {location && !location.isDefault && !drive && (
                  <button className="btn-secondary" disabled={busy} onClick={() => run(() => moveTo({ kind: 'folder', folder: null }))}>
                    Use default folder
                  </button>
                )}
                {drive && (
                  <button className="btn-secondary" disabled={busy} onClick={() => run(() => moveTo(thisFolder))}>Save here instead</button>
                )}
                <button className="btn-primary" disabled={busy} onClick={changeFolder}>Change folder…</button>
              </>
            )}
            {tab === 'local' && !storage && drive && (
              <button className="btn-primary" disabled={busy} onClick={() => run(() => switchStorage({ kind: 'browser' }, 'replace'))}>
                Keep boards in this browser instead
              </button>
            )}
            {tab === 'drive' && googleConfigured() && drive && (
              <>
                <button className="btn-secondary" disabled={busy} onClick={disconnect}>Disconnect</button>
                {driveStorage.folderUrl() && (
                  <button className="btn-secondary" disabled={busy} onClick={() => window.open(driveStorage.folderUrl()!, '_blank')}>
                    <ExternalLink size={14} /> Open in Google Drive
                  </button>
                )}
                {storageError && <button className="btn-primary" disabled={busy} onClick={signInAgain}>Sign in again</button>}
              </>
            )}
            {tab === 'drive' && googleConfigured() && !drive && (
              <button className="btn-primary" disabled={busy} onClick={connect}>
                {busy ? 'Waiting for Google…' : 'Connect Google Drive'}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
