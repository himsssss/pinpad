import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Check, LogOut, Plus } from 'lucide-react';
import { afterSignIn, cloudInUse, useStore } from '../store';
import { googleAccount, googleAccounts, googleAllowedHere, googleConfigured } from '../googleAuth';
import { microsoftAccount, microsoftAccounts, microsoftAllowedHere, microsoftConfigured } from '../microsoftAuth';
import { addGoogleDrive, addOneDrive, listPlaces, openPlace, removePlace, signInAgain as signInAgainAs, type Place } from '../places';
import { askConfirm } from './ConfirmDialog';
import { chooseForNewPlace } from './PlaceSwitcher';
import { DriveIcon } from './DriveIcon';
import { OneDriveIcon } from './OneDriveIcon';

const COLORS = ['#7c5cff', '#2f6fed', '#17a34a', '#e9438f', '#f06b1f', '#0e9488', '#c026d3'];
const colorFor = (account: string) => COLORS[[...account].reduce((n, c) => n + c.charCodeAt(0), 0) % COLORS.length];

type Account = { service: 'Google' | 'Microsoft'; account: string };

function signedIn(): Account | null {
  const cloud = cloudInUse();
  if (cloud === 'drive' && googleAccount()) return { service: 'Google', account: googleAccount()! };
  if (cloud === 'onedrive' && microsoftAccount()) return { service: 'Microsoft', account: microsoftAccount()! };
  return null;
}

const placeOf = ({ service, account }: Account): Place =>
  service === 'Google' ? { id: `drive:${account}`, kind: 'drive', account } : { id: `onedrive:${account}`, kind: 'onedrive', account };

function Avatar({ account, size = 30, warn = false }: { account: Account; size?: number; warn?: boolean }) {
  return (
    <span className="avatar" style={{ width: size, height: size, background: colorFor(account.account), fontSize: size * 0.45 }}>
      {account.account[0]?.toUpperCase()}
      <span className={`avatar-badge ${warn ? 'warn' : ''}`}>
        {warn ? <AlertTriangle size={9} strokeWidth={3} /> : account.service === 'Google' ? <DriveIcon size={10} /> : <OneDriveIcon size={11} />}
      </span>
    </span>
  );
}

/**
 * Sign in, at the top right: signing in with Google or Microsoft saves the boards to that
 * account's Google Drive or OneDrive (Pinpad has no accounts of its own). Signed in, it shows
 * the account, the other connected accounts to switch to, and Sign out.
 */
export function AccountButton() {
  // Changes with every switch of place, so the button follows sign-ins made elsewhere too.
  useStore((s) => s.storageName);
  const opening = useStore((s) => s.opening);
  const signInNeeded = useStore((s) => s.signInNeeded);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [at, setAt] = useState({ right: 0, top: 0 });
  const ref = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const google = googleConfigured() && googleAllowedHere();
  const microsoft = microsoftConfigured() && microsoftAllowedHere();
  const current = signedIn();

  useEffect(() => {
    if (!open) return;
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

  // Signed in: the menu gives way to "Opening your Google Drive…".
  useEffect(() => {
    if (opening) setOpen(false);
  }, [opening]);

  if (!google && !microsoft) return null;

  const run = async (label: string, task: () => Promise<unknown>) => {
    setBusy(label);
    setError(null);
    try {
      await task();
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const signOut = async (account: Account) => {
    const ok = await askConfirm({
      title: `Sign out of ${account.account}?`,
      message: `Your boards stay in its ${account.service === 'Google' ? 'Google Drive' : 'OneDrive'}; sign in again any time to open them. Pinpad goes back to the boards kept on this computer.`,
      confirm: 'Sign out',
    });
    if (!ok) return;
    await run('signout', async () => {
      const { places } = await listPlaces();
      const local = places.find((p) => p.kind === 'browser' || p.kind === 'webfolder' || (p.kind === 'folder' && p.isDefault)) ?? { id: 'browser', kind: 'browser' };
      await openPlace(local, async () => 'fresh');
      await removePlace(placeOf(account));
    });
  };

  // The same account again (Google's popup confirms it), then saving carries on.
  const signInAgain = (account: Account) =>
    run('again', async () => {
      await signInAgainAs(account.service === 'Google' ? 'google' : 'microsoft', account.account);
      await afterSignIn();
    });

  const others: Account[] = [
    ...(google ? googleAccounts().map((account) => ({ service: 'Google' as const, account })) : []),
    ...(microsoft ? microsoftAccounts().map((account) => ({ service: 'Microsoft' as const, account })) : []),
  ].filter((a) => !current || a.account !== current.account || a.service !== current.service);

  const toggle = () => {
    const r = ref.current!.getBoundingClientRect();
    setAt({ right: window.innerWidth - r.right, top: r.bottom + 8 });
    setOpen((o) => !o);
  };

  return (
    <>
      {current ? (
        <button ref={ref} className="account-btn" onClick={toggle} aria-haspopup="menu" aria-expanded={open} title={signInNeeded ? `Sign in again to keep saving to ${current.service === 'Google' ? 'Google Drive' : 'OneDrive'}` : current.account}>
          <Avatar account={current} warn={signInNeeded} />
        </button>
      ) : (
        <button ref={ref} className="signin-btn" onClick={toggle} aria-haspopup="menu" aria-expanded={open}>Sign in</button>
      )}
      {open && createPortal(
        <div ref={menuRef} className="menu account-menu" role="menu" style={{ right: at.right, top: at.top }}>
          {current ? (
            <>
              <div className="account-head">
                <Avatar account={current} size={40} />
                <div className="account-text">
                  <div className="account-email">{current.account}</div>
                  <div className="account-where">
                    {signInNeeded ? 'Not saving: sign-in ran out' : `Saving to ${current.service === 'Google' ? 'Google Drive' : 'OneDrive'}`}
                  </div>
                </div>
              </div>
              {signInNeeded && (
                <button role="menuitem" className="signin-option signin-again" disabled={!!busy} onClick={() => signInAgain(current)}>
                  {current.service === 'Google' ? <DriveIcon size={18} /> : <OneDriveIcon size={19} />}
                  {busy === 'again' ? `Waiting for ${current.service}…` : 'Sign in again'}
                </button>
              )}
              {others.length > 0 && <div className="menu-sep" />}
              {others.map((a) => (
                <button key={a.service + a.account} role="menuitem" disabled={!!busy} onClick={() => run(a.account, () => openPlace(placeOf(a), chooseForNewPlace))}>
                  <Avatar account={a} size={24} /> <span className="account-other">{a.account}</span>
                </button>
              ))}
              <div className="menu-sep" />
              {google && (
                <button role="menuitem" disabled={!!busy} onClick={() => run('google', () => addGoogleDrive(chooseForNewPlace))}>
                  <Plus size={14} /> {busy === 'google' ? 'Waiting for Google…' : 'Add another Google account'}
                </button>
              )}
              <button role="menuitem" disabled={!!busy} onClick={() => signOut(current)}>
                <LogOut size={14} /> Sign out
              </button>
            </>
          ) : (
            <>
              <div className="signin-title">Sign in to save your boards</div>
              <p className="signin-note">Your boards are saved in your own {google && microsoft ? 'Google Drive or OneDrive' : google ? 'Google Drive' : 'OneDrive'}, so you can open them on any computer. Pinpad can only see the files it makes there.</p>
              {google && (
                <button role="menuitem" className="signin-option" disabled={!!busy} onClick={() => run('google', () => addGoogleDrive(chooseForNewPlace))}>
                  <DriveIcon size={18} /> {busy === 'google' ? 'Waiting for Google…' : 'Continue with Google'}
                </button>
              )}
              {microsoft && (
                <button role="menuitem" className="signin-option" disabled={!!busy} onClick={() => run('microsoft', () => addOneDrive(chooseForNewPlace))}>
                  <OneDriveIcon size={19} /> {busy === 'microsoft' ? 'Waiting for Microsoft…' : 'Continue with Microsoft'}
                </button>
              )}
              {others.length > 0 && (
                <>
                  <div className="menu-sep" />
                  <div className="signin-sub">Signed in before</div>
                  {others.map((a) => (
                    <button key={a.service + a.account} role="menuitem" disabled={!!busy} onClick={() => run(a.account, () => openPlace(placeOf(a), chooseForNewPlace))}>
                      <Avatar account={a} size={24} /> <span className="account-other">{a.account}</span> {busy === a.account && <Check size={14} />}
                    </button>
                  ))}
                </>
              )}
            </>
          )}
          {error && <div className="place-menu-error" role="alert">{error}</div>}
        </div>,
        document.body,
      )}
    </>
  );
}
