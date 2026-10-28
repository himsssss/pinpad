import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { LogOut } from 'lucide-react';
import { cloudInUse, useStore } from '../store';
import { googleAccount } from '../googleAuth';
import { microsoftAccount } from '../microsoftAuth';
import { openPlace, rememberOpenPlace } from '../places';
import {
  accountsConfigured, onAccountChange, pinpadAccount, rememberedStorage, signOutOfPinpad, type RememberedStorage,
} from '../pinpadAccount';
import { chooseForNewPlace } from './PlaceSwitcher';
import { DriveIcon } from './DriveIcon';
import { OneDriveIcon } from './OneDriveIcon';

const COLORS = ['#7c5cff', '#2f6fed', '#17a34a', '#e9438f', '#f06b1f', '#0e9488', '#c026d3'];
const colorFor = (email: string) => COLORS[[...email].reduce((n, c) => n + c.charCodeAt(0), 0) % COLORS.length];

function Avatar({ email, size = 30 }: { email: string; size?: number }) {
  return (
    <span className="avatar" style={{ width: size, height: size, background: colorFor(email), fontSize: size * 0.45 }}>
      {email[0]?.toUpperCase()}
    </span>
  );
}

const useAccount = () => useSyncExternalStore(onAccountChange, pinpadAccount);

/** Whether the remembered Drive or OneDrive is the one open now. */
function isOpen(storage: RememberedStorage) {
  return cloudInUse() === storage.kind && (storage.kind === 'drive' ? googleAccount() : microsoftAccount()) === storage.account;
}

const serviceName = (storage: RememberedStorage) => (storage.kind === 'drive' ? 'Google Drive' : 'OneDrive');

/**
 * The Pinpad account, at the top right (signing in is the page before the app). It doesn't move
 * the boards (where they're kept is chosen from the logo's menu); it remembers which Google
 * Drive or OneDrive they're in, and offers to open it on a computer that doesn't have it open.
 */
export function AccountButton() {
  const account = useAccount();
  const storageName = useStore((s) => s.storageName);
  const opening = useStore((s) => s.opening);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [remembered, setRemembered] = useState<RememberedStorage | null>(null);
  const [at, setAt] = useState({ right: 0, top: 0 });
  const ref = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

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

  // Opening the boards: the menu gives way to "Opening your Google Drive…".
  useEffect(() => {
    if (opening) setOpen(false);
  }, [opening]);

  // Signed in: where this account's boards are, to offer opening them here.
  useEffect(() => {
    if (!account) return setRemembered(null);
    let alive = true;
    rememberedStorage().then((storage) => {
      if (!alive) return;
      setRemembered(storage);
      // Nothing remembered yet: the Drive open here is where this account's boards are.
      if (!storage) rememberOpenPlace();
    });
    return () => void (alive = false);
  }, [account?.uid, open]);

  // Signed out, the sign-in page (SignInPage) stands in for the whole app.
  if (!accountsConfigured() || !account) return null;

  const toggle = () => {
    const r = ref.current!.getBoundingClientRect();
    setAt({ right: window.innerWidth - r.right, top: r.bottom + 8 });
    setError(null);
    setOpen((o) => !o);
  };

  const openRemembered = async (storage: RememberedStorage) => {
    setBusy(true);
    setError(null);
    try {
      await openPlace({ id: `${storage.kind}:${storage.account}`, kind: storage.kind, account: storage.account }, chooseForNewPlace);
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const where = cloudInUse() === 'drive' ? 'Google Drive' : cloudInUse() === 'onedrive' ? 'OneDrive' : storageName ? `the “${storageName}” folder` : 'this browser';

  return (
    <>
      <button ref={ref} className="account-btn" onClick={toggle} aria-haspopup="menu" aria-expanded={open} title={account.email}>
        <Avatar email={account.email} />
      </button>
      {open && createPortal(
        <div ref={menuRef} className="menu account-menu" role="menu" aria-label="Account" style={{ right: at.right, top: at.top }}>
          <div className="account-head">
            <Avatar email={account.email} size={40} />
            <div className="account-text">
              <div className="account-email">{account.email}</div>
              <div className="account-where">Boards saved in {where}</div>
            </div>
          </div>
          {remembered && !isOpen(remembered) && (
            <div className="account-suggest">
              <span>Your boards are in {serviceName(remembered)} ({remembered.account}).</span>
              <button className="signin-option signin-again" disabled={busy} onClick={() => openRemembered(remembered)}>
                {remembered.kind === 'drive' ? <DriveIcon size={18} /> : <OneDriveIcon size={19} />} {busy ? 'Opening…' : 'Open them here'}
              </button>
            </div>
          )}
          {error && <div className="place-menu-error" role="alert">{error}</div>}
          <div className="menu-sep" />
          <button role="menuitem" disabled={busy} onClick={() => (signOutOfPinpad(), setOpen(false))}>
            <LogOut size={14} /> Sign out of Pinpad
          </button>
        </div>,
        document.body,
      )}
    </>
  );
}
