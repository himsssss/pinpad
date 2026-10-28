import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Check, ChevronDown, Folder, FolderCog, FolderPlus, LogOut, Monitor, Plus, X } from 'lucide-react';
import { afterSignIn, browse, cloudInUse, useStore } from '../store';
import { nativeStorage } from '../native';
import { googleAccount, googleAllowedHere, googleConfigured } from '../googleAuth';
import { microsoftAccount, microsoftAllowedHere, microsoftConfigured } from '../microsoftAuth';
import { addFolder, addGoogleDrive, addOneDrive, addWebFolder, describePlace, listPlaces, openPlace, removePlace, signInAgain, type NewPlaceChoice, type Place } from '../places';
import { askChoice, askConfirm } from './ConfirmDialog';
import { DriveIcon } from './DriveIcon';
import { OneDriveIcon } from './OneDriveIcon';
import { webFoldersSupported } from '../webFolderStorage';
import { PinpadMark } from './PinpadMark';

/** A place with no Pinpad boards yet: start empty there, or copy the open boards over. */
export const chooseForNewPlace: NewPlaceChoice = async (where) => {
  const answer = await askChoice({
    title: `Pinpad hasn't been used in ${where} yet`,
    message: 'Start with an empty workspace there, or copy the boards you have open now? Nothing here is removed either way.',
    confirm: 'Copy my boards',
    alternative: 'Start empty',
  });
  return answer === 'confirm' ? 'replace' : answer === 'alternative' ? 'fresh' : null;
};

const PlaceIcon = ({ place }: { place: Place }) =>
  place.kind === 'drive' ? <DriveIcon size={16} /> : place.kind === 'onedrive' ? <OneDriveIcon size={17} /> : place.kind === 'folder' || place.kind === 'webfolder' ? <Folder size={16} /> : <Monitor size={16} />;

/**
 * The logo, which opens the list of places this device keeps boards in (each Google
 * account's Drive, folders on this computer, this browser), to switch between them or add
 * another. `compact` shows just the mark, for the collapsed sidebar.
 */
export function PlaceSwitcher({ compact = false, onSettings }: { compact?: boolean; onSettings: () => void }) {
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<{ places: Place[]; current: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [waitingFor, setWaitingFor] = useState<'Google' | 'Microsoft' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const saved = useStore((s) => s.saved);
  const storageError = useStore((s) => s.storageError);
  const signInNeeded = useStore((s) => s.signInNeeded);
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  // Rendered on the page itself, placed against the window: inside the sidebar it would be
  // clipped by its scrolling and drawn under the tool rail.
  const [at, setAt] = useState({ left: 0, top: 0 });

  const refresh = () => listPlaces().then(setList).catch((err) => setError(String(err)));
  useEffect(() => {
    if (!open) return;
    setError(null);
    refresh();
    const close = (e: PointerEvent) =>
      !ref.current?.contains(e.target as Node) && !menuRef.current?.contains(e.target as Node) && !(e.target as Element).closest?.('.confirm-backdrop') && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const run = async (task: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await task();
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      refresh();
    } finally {
      setBusy(false);
      setWaitingFor(null);
    }
  };

  const remove = async (place: Place) => {
    const { name, detail } = describePlace(place, false);
    const current = place.id === list?.current;
    // Leaving the open place first: this browser on the website, the default folder in the apps.
    const fallback: Place | undefined = current
      ? list?.places.find((p) => p.kind === 'browser' || (p.kind === 'folder' && p.isDefault)) ?? { id: 'browser', kind: 'browser' }
      : undefined;
    const fallbackName = fallback?.kind === 'browser' ? 'this browser' : fallback ? describePlace(fallback, false).name : '';
    const cloud = place.kind === 'drive' || place.kind === 'onedrive';
    const service = place.kind === 'drive' ? 'Google' : 'Microsoft';
    const ok = await askConfirm({
      title: cloud ? `Disconnect ${detail}?` : `Remove “${name}” from the list?`,
      message:
        cloud
          ? `Pinpad signs out of this ${service} account on this device. Your boards stay in its ${place.kind === 'drive' ? 'Google Drive' : 'OneDrive'}.${
              current ? ` Pinpad switches to ${fallbackName}, copying your boards there if it's empty.` : ''
            }`
          : 'The folder and its files stay on your computer; it just leaves this list.',
      confirm: cloud ? 'Disconnect' : 'Remove',
      danger: cloud,
    });
    if (!ok) return refresh();
    await run(async () => {
      if (current && fallback) await openPlace(fallback, async () => 'replace');
      await removePlace(place);
    });
  };

  // The Drive or OneDrive in use stopped saving because its sign-in ran out: sign in as the same account again.
  const cloud = cloudInUse();
  const renew = () =>
    run(async () => {
      await signInAgain(cloud === 'onedrive' ? 'microsoft' : 'google', cloud === 'onedrive' ? microsoftAccount() : googleAccount());
      await afterSignIn();
    });

  return (
    <div className="place-switcher" ref={ref}>
      <button
        className={`logo ${compact ? 'compact' : ''}`}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setAt({ left: r.left, top: r.bottom + 6 });
          setOpen((o) => !o);
        }}
        aria-haspopup="menu"
        aria-expanded={open}
        title={signInNeeded ? 'Sign in again to keep saving' : 'Where your boards are saved'}
      >
        <PinpadMark size={26} />
        {!compact && <span className="wordmark">Pinpad</span>}
        <ChevronDown size={14} className="logo-chevron" />
      </button>
      <span
        className={`save-status ${storageError ? 'error' : saved ? 'saved' : 'saving'}`}
        title={storageError ?? (saved ? 'All changes saved' : 'Saving…')}
        onClick={storageError ? (signInNeeded ? () => ref.current?.querySelector<HTMLButtonElement>('.logo')?.click() : onSettings) : undefined}
      />
      {open && createPortal(
        <div ref={menuRef} className="menu place-menu" role="menu" style={at}>
          {signInNeeded && (
            <div className="place-warning" role="alert">
              <span><AlertTriangle size={14} /> Your {cloud === 'onedrive' ? 'OneDrive' : 'Google Drive'} sign-in ran out, so nothing is being saved there.</span>
              <button className="btn-primary" disabled={busy} onClick={renew}>{busy ? 'Waiting…' : 'Sign in again'}</button>
            </div>
          )}
          <div className="place-menu-title">Your places</div>
          {!list && <div className="place-menu-note">Loading…</div>}
          {list?.places.map((place) => {
            const current = place.id === list.current;
            const { name, detail } = describePlace(place, current);
            return (
              <div key={place.id} className={`place-row ${current ? 'current' : ''}`}>
                <button
                  role="menuitemradio"
                  aria-checked={current}
                  disabled={busy}
                  onClick={() => (current ? (browse(null), setOpen(false)) : run(() => openPlace(place, chooseForNewPlace)))}
                  title={current ? 'Show all its folders and projects' : `Switch to ${name}`}
                >
                  <span className="place-icon"><PlaceIcon place={place} /></span>
                  <span className="place-text">
                    <span className="place-name">{name}</span>
                    <span className="place-detail">{detail}</span>
                  </span>
                  {current && <Check size={16} className="place-check" />}
                </button>
                {(place.kind === 'drive' || place.kind === 'onedrive') && (
                  <button className="place-remove" disabled={busy} aria-label={`Disconnect ${detail}`} title={`Disconnect this ${place.kind === 'drive' ? 'Google' : 'Microsoft'} account`} onClick={() => remove(place)}>
                    <LogOut size={14} /> <span>Disconnect</span>
                  </button>
                )}
                {((place.kind === 'folder' && !place.isDefault) || place.kind === 'webfolder') && !current && (
                  <button className="place-remove" disabled={busy} aria-label={`Remove ${name}`} title="Remove from list (the folder stays)" onClick={() => remove(place)}>
                    <X size={14} />
                  </button>
                )}
              </div>
            );
          })}
          {error && <div className="place-menu-error" role="alert">{error}</div>}
          <div className="menu-sep" />
          {googleConfigured() && googleAllowedHere() && (
            <button role="menuitem" disabled={busy} onClick={() => (setWaitingFor('Google'), run(() => addGoogleDrive(chooseForNewPlace)))}>
              <Plus size={14} /> {waitingFor === 'Google' ? 'Waiting for Google…' : 'Connect a Google Drive'}
            </button>
          )}
          {microsoftConfigured() && microsoftAllowedHere() && (
            <button role="menuitem" disabled={busy} onClick={() => (setWaitingFor('Microsoft'), run(() => addOneDrive(chooseForNewPlace)))}>
              <Plus size={14} /> {waitingFor === 'Microsoft' ? 'Waiting for Microsoft…' : 'Connect a OneDrive'}
            </button>
          )}
          {nativeStorage() && (
            <button role="menuitem" disabled={busy} onClick={() => run(() => addFolder(chooseForNewPlace))}>
              <FolderPlus size={14} /> Add a folder on this computer
            </button>
          )}
          {webFoldersSupported() && (
            <button role="menuitem" disabled={busy} onClick={() => run(() => addWebFolder(chooseForNewPlace))}>
              <FolderPlus size={14} /> Choose a folder on this computer
            </button>
          )}
          <button role="menuitem" onClick={() => { setOpen(false); onSettings(); }}>
            <FolderCog size={14} /> Storage settings…
          </button>
        </div>,
        document.body,
      )}
    </div>
  );
}
