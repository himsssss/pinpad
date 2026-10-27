import { useEffect, useState } from 'react';
import { AlertTriangle, FolderOpen, X } from 'lucide-react';
import { switchStorageFolder, useStore } from '../store';
import { nativeStorage, type StorageLocation } from '../native';

const isMac = /Mac/.test(navigator.platform);
const fileManager = isMac ? 'Finder' : 'File Explorer';

/**
 * Desktop apps only: shows where the workspace file lives and moves it to another folder.
 * Switching never deletes the old file; when the new folder already holds a workspace the
 * user chooses whether to open it or replace it with the current boards.
 */
export function StorageDialog({ onClose }: { onClose: () => void }) {
  const storage = nativeStorage();
  const storageError = useStore((s) => s.storageError);
  const [location, setLocation] = useState<StorageLocation | null>(null);
  // A folder that already has a workspace, waiting for the user to pick open or replace.
  const [conflict, setConflict] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = () => storage?.location().then(setLocation, (err) => setError(String(err)));
  useEffect(() => {
    refresh();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!storage) return null;

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

  const conflictFolder = conflict === '' ? null : conflict;

  const moveTo = async (folder: string | null) => {
    const target = folder ?? location?.defaultFolder;
    if (!target || target === location?.folder) return;
    if ((await storage.inspect(target)).hasWorkspace) setConflict(folder ?? '');
    else await switchStorageFolder(folder, 'replace');
  };

  const resolve = (keep: 'open' | 'replace') =>
    run(async () => {
      await switchStorageFolder(conflictFolder, keep);
      setConflict(null);
    });

  const change = () =>
    run(async () => {
      const folder = await storage.choose();
      if (folder) await moveTo(folder);
    });

  return (
    <div className="search-backdrop" onPointerDown={onClose}>
      <div className="dialog" role="dialog" aria-labelledby="storage-title" onPointerDown={(e) => e.stopPropagation()}>
        <div className="dialog-head">
          <h2 id="storage-title">Storage location</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <p className="dialog-text">
          Pinpad saves your boards as one file in this folder. Pick a folder that iCloud Drive, OneDrive or
          Dropbox syncs to keep a backup.
        </p>

        <div className="storage-path">
          <FolderOpen size={18} aria-hidden="true" />
          <div>
            <div className="storage-folder">{location?.folder ?? '…'}</div>
            <div className="storage-file">
              {location ? `${location.file.slice(location.folder.length + 1)}${location.isDefault ? ' · Default folder' : ''}` : ''}
            </div>
          </div>
        </div>

        {(error || storageError) && (
          <div className="dialog-error" role="alert">
            <AlertTriangle size={16} aria-hidden="true" />
            <span>{error ?? storageError}</span>
          </div>
        )}

        {conflict !== null ? (
          <div className="storage-conflict">
            <p><strong>That folder already has a Pinpad workspace.</strong> Open it, or replace it with the boards you have now?</p>
            <div className="dialog-actions">
              <button className="btn-secondary" disabled={busy} onClick={() => setConflict(null)}>Cancel</button>
              <button className="btn-secondary danger" disabled={busy} onClick={() => resolve('replace')}>
                Replace it
              </button>
              <button className="btn-primary" disabled={busy} onClick={() => resolve('open')}>
                Open it
              </button>
            </div>
          </div>
        ) : (
          <div className="dialog-actions">
            <button className="btn-secondary" disabled={busy} onClick={() => storage.reveal()}>Show in {fileManager}</button>
            {location && !location.isDefault && (
              <button className="btn-secondary" disabled={busy} onClick={() => run(() => moveTo(null))}>Use default folder</button>
            )}
            <button className="btn-primary" disabled={busy} onClick={change}>Change folder…</button>
          </div>
        )}
      </div>
    </div>
  );
}
