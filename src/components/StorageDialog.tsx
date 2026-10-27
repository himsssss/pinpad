import { useEffect, useState } from 'react';
import { AlertTriangle, ExternalLink, FolderOpen, HardDrive, X } from 'lucide-react';
import { afterSignIn, cloudInUse, switchStorage, usingWebFolder, useStore, type StorageTarget } from '../store';
import { allowWebFolder, chooseWebFolder, currentWebFolder, webFolderHasWorkspace, webFoldersSupported } from '../webFolderStorage';
import { nativeStorage, type StorageLocation } from '../native';
import { driveStorage } from '../driveStorage';
import { oneDriveStorage } from '../oneDriveStorage';
import { DriveIcon } from './DriveIcon';
import { OneDriveIcon } from './OneDriveIcon';
import { microsoftAccount, microsoftAllowedHere, microsoftConfigured, microsoftSignIn, microsoftSignOut, microsoftWebOrigins } from '../microsoftAuth';
import { googleAccount, googleAllowedHere, googleConfigured, googleWebOrigins, preloadGoogle, signIn, signOut } from '../googleAuth';

const isMac = /Mac/.test(navigator.platform);
const fileManager = isMac ? 'Finder' : 'File Explorer';

/** "a", "a and b", "a, b and c". */
const listOf = (items: string[]) => (items.length > 1 ? `${items.slice(0, -1).join(', ')} and ${items.at(-1)}` : items[0] ?? '');

/**
 * Shows where boards are saved and moves them: a folder on this computer (desktop apps), this
 * browser (website), Google Drive or OneDrive. Switching never deletes the old copy; when the new place
 * already holds a workspace the user chooses whether to open it or replace it.
 */
export function StorageDialog({ onClose }: { onClose: () => void }) {
  const storage = nativeStorage();
  const storageError = useStore((s) => s.storageError);
  const [location, setLocation] = useState<StorageLocation | null>(null);
  const [cloud, setCloud] = useState(cloudInUse());
  const drive = cloud === 'drive';
  const onedrive = cloud === 'onedrive';
  const [tab, setTab] = useState<'local' | 'drive' | 'onedrive'>(cloud ?? 'local');
  const [account, setAccount] = useState(googleAccount());
  const [msAccount, setMsAccount] = useState(microsoftAccount());
  const [webFolder, setWebFolder] = useState(usingWebFolder() ? currentWebFolder() : null);
  const pickFolders = !storage && webFoldersSupported();
  // A place that already has a workspace, waiting for the user to pick open or replace.
  const [conflict, setConflict] = useState<StorageTarget | null>(null);
  const [signOutAfter, setSignOutAfter] = useState<'google' | 'microsoft' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    setCloud(cloudInUse());
    setAccount(googleAccount());
    setMsAccount(microsoftAccount());
    setWebFolder(usingWebFolder() ? currentWebFolder() : null);
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
      if (!dir || (!cloud && dir === location?.folder)) return false;
      if ((await storage.inspect(dir)).hasWorkspace) {
        setConflict(target);
        return false;
      }
    }
    if (target.kind === 'webfolder' && (await webFolderHasWorkspace(target.id))) {
      setConflict(target);
      return false;
    }
    if (target.kind === 'drive' || target.kind === 'onedrive') {
      const storage = target.kind === 'drive' ? driveStorage : oneDriveStorage;
      storage.reset();
      if (await storage.hasWorkspace()) {
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
      if (signOutAfter === 'google') await signOut();
      if (signOutAfter === 'microsoft') await microsoftSignOut();
      setSignOutAfter(null);
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

  const connectOneDrive = () =>
    run(async () => {
      await microsoftSignIn();
      await moveTo({ kind: 'onedrive' });
    });

  // Back to this computer or browser; the sign-in is dropped once the boards have moved.
  const disconnect = (service: 'google' | 'microsoft') =>
    run(async () => {
      setSignOutAfter(service);
      if (await moveTo(local)) {
        await (service === 'google' ? signOut() : microsoftSignOut());
        setSignOutAfter(null);
      }
    });

  const signInAgain = () =>
    run(async () => {
      await (onedrive ? microsoftSignIn() : signIn());
      await afterSignIn();
    });

  const chooseFolder = () =>
    run(async () => {
      const folder = await chooseWebFolder();
      if (folder && folder.id !== webFolder?.id) await moveTo({ kind: 'webfolder', ...folder });
    });

  const allowFolder = () =>
    run(async () => {
      if (webFolder && (await allowWebFolder(webFolder.id, true))) await afterSignIn();
    });

  const conflictPlace =
    conflict?.kind === 'drive' ? 'Your Google Drive' : conflict?.kind === 'onedrive' ? 'Your OneDrive' : conflict?.kind === 'webfolder' ? `The “${conflict.name}” folder` : 'That folder';
  const cloudName = drive ? 'Google Drive' : 'OneDrive';
  const oneDriveHere = microsoftConfigured() && microsoftAllowedHere();
  // Google only lets the website sign in from its registered addresses.
  const driveHere = googleConfigured() && googleAllowedHere();
  const driveSite = googleWebOrigins().find((o) => o.startsWith('https://'));

  return (
    <div className="search-backdrop" onPointerDown={onClose}>
      <div className="dialog" role="dialog" aria-labelledby="storage-title" onPointerDown={(e) => e.stopPropagation()}>
        <div className="dialog-head">
          <h2 id="storage-title">Storage location</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>

        <div className="segmented" role="tablist" aria-label="Where to save">
          <button role="tab" aria-selected={tab === 'local'} onClick={() => setTab('local')}>
            <HardDrive size={15} /> {storage || pickFolders ? 'This computer' : 'This browser'}
            {!cloud && <span className="segmented-badge">In use</span>}
          </button>
          <button role="tab" aria-selected={tab === 'drive'} onClick={() => setTab('drive')}>
            <DriveIcon /> Google Drive
            {drive && <span className="segmented-badge">In use</span>}
          </button>
          {microsoftConfigured() && (
            <button role="tab" aria-selected={tab === 'onedrive'} onClick={() => setTab('onedrive')}>
              <OneDriveIcon /> OneDrive
              {onedrive && <span className="segmented-badge">In use</span>}
            </button>
          )}
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
                  {cloud ? ` · not in use while saving to ${cloudName}` : ''}
                </div>
              </div>
            </div>
          </>
        )}

        {tab === 'local' && !storage && !webFolder && (
          <p className="dialog-text">
            {pickFolders
              ? 'Choose a folder on this computer and Pinpad saves each board there as a file: on your computer, never on the website. Until then your boards are kept in this browser, and clearing its site data deletes them.'
              : 'Boards are saved in this browser only, so clearing its site data deletes them. Save to Google Drive or OneDrive, or use Export now and then, to keep a copy.'}
          </p>
        )}

        {tab === 'local' && webFolder && (
          <>
            <p className="dialog-text">
              Pinpad saves each board as its own file in this folder on your computer, with a folder for each project
              and its attached files; nothing is stored on the website. Pick a folder that iCloud Drive, OneDrive or
              Dropbox syncs to keep a backup.
            </p>
            <div className="storage-path">
              <FolderOpen size={18} aria-hidden="true" />
              <div>
                <div className="storage-folder">{webFolder.name}</div>
                <div className="storage-file">
                  Folder on this computer{cloud ? ` · not in use while saving to ${cloudName}` : ''}
                </div>
              </div>
            </div>
          </>
        )}

        {tab === 'drive' && !googleConfigured() && (
          <p className="dialog-text">Google Drive isn't set up in this version of Pinpad yet.</p>
        )}

        {tab === 'drive' && googleConfigured() && !googleAllowedHere() && (
          <p className="dialog-text">
            Google only lets Pinpad sign in from {listOf(googleWebOrigins().map((o) => o.replace(/^https?:\/\//, '')))}, but
            this copy is open at {window.location.host}. {driveSite && <>Open <a href={`${driveSite}/`}>{driveSite.replace(/^https:\/\//, '')}</a> to use Google Drive.</>}
          </p>
        )}

        {tab === 'drive' && driveHere && (
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

        {tab === 'onedrive' && microsoftConfigured() && !microsoftAllowedHere() && (
          <p className="dialog-text">
            Microsoft only lets Pinpad sign in from {listOf(microsoftWebOrigins().map((o) => o.replace(/^https?:\/\//, '')))}, but this
            copy is open at {window.location.host}.
          </p>
        )}

        {tab === 'onedrive' && oneDriveHere && (
          <>
            <p className="dialog-text">
              Save each board as a file in your OneDrive, in Apps › Pinpad, and open them on any computer by signing in
              with your Microsoft account. Pinpad can only see its own folder there.
            </p>
            {onedrive && (
              <div className="storage-path">
                <OneDriveIcon />
                <div>
                  <div className="storage-folder">OneDrive › Apps › Pinpad</div>
                  <div className="storage-file">
                    {storageError ? `Last signed in as ${msAccount ?? 'your Microsoft account'}` : msAccount ? `Signed in as ${msAccount}` : 'Signed in'}
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
              <button className="btn-secondary" disabled={busy} onClick={() => { setConflict(null); setSignOutAfter(null); }}>Cancel</button>
              <button className="btn-secondary danger" disabled={busy} onClick={() => resolve('replace')}>Replace it</button>
              <button className="btn-primary" disabled={busy} onClick={() => resolve('open')}>Open it</button>
            </div>
          </div>
        ) : (
          <div className="dialog-actions">
            {tab === 'local' && storage && (
              <>
                <button className="btn-secondary" disabled={busy} onClick={() => storage.reveal()}>Show in {fileManager}</button>
                {location && !location.isDefault && !cloud && (
                  <button className="btn-secondary" disabled={busy} onClick={() => run(() => moveTo({ kind: 'folder', folder: null }))}>
                    Use default folder
                  </button>
                )}
                {cloud && (
                  <button className="btn-secondary" disabled={busy} onClick={() => run(() => moveTo(thisFolder))}>Save here instead</button>
                )}
                <button className="btn-primary" disabled={busy} onClick={changeFolder}>Change folder…</button>
              </>
            )}
            {tab === 'local' && webFolder && storageError && (
              <button className="btn-secondary" disabled={busy} onClick={allowFolder}>Allow access</button>
            )}
            {tab === 'local' && pickFolders && (
              <button className={webFolder || cloud ? 'btn-secondary' : 'btn-primary'} disabled={busy} onClick={chooseFolder}>
                {webFolder ? 'Change folder…' : 'Choose a folder…'}
              </button>
            )}
            {tab === 'local' && !storage && !pickFolders && cloud && (
              <button className="btn-primary" disabled={busy} onClick={() => run(() => switchStorage({ kind: 'browser' }, 'replace'))}>
                Keep boards in this browser instead
              </button>
            )}
            {tab === 'drive' && driveHere && drive && (
              <>
                <button className="btn-secondary" disabled={busy} onClick={() => disconnect('google')}>Disconnect</button>
                {driveStorage.folderUrl() && (
                  <button className="btn-secondary" disabled={busy} onClick={() => window.open(driveStorage.folderUrl()!, '_blank')}>
                    <ExternalLink size={14} /> Open in Google Drive
                  </button>
                )}
                {storageError && <button className="btn-primary" disabled={busy} onClick={signInAgain}>Sign in again</button>}
              </>
            )}
            {tab === 'drive' && driveHere && !drive && (
              <button className="btn-primary" disabled={busy} onClick={connect}>
                {busy ? 'Waiting for Google…' : 'Connect Google Drive'}
              </button>
            )}
            {tab === 'onedrive' && oneDriveHere && onedrive && (
              <>
                <button className="btn-secondary" disabled={busy} onClick={() => disconnect('microsoft')}>Disconnect</button>
                {oneDriveStorage.folderUrl() && (
                  <button className="btn-secondary" disabled={busy} onClick={() => window.open(oneDriveStorage.folderUrl()!, '_blank')}>
                    <ExternalLink size={14} /> Open in OneDrive
                  </button>
                )}
                {storageError && <button className="btn-primary" disabled={busy} onClick={signInAgain}>Sign in again</button>}
              </>
            )}
            {tab === 'onedrive' && oneDriveHere && !onedrive && (
              <button className="btn-primary" disabled={busy} onClick={connectOneDrive}>
                {busy ? 'Waiting for Microsoft…' : 'Connect OneDrive'}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
