import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { LogOut } from 'lucide-react';
import { cloudInUse, useStore } from '../store';
import { googleAccount } from '../googleAuth';
import { microsoftAccount } from '../microsoftAuth';
import { openPlace, rememberOpenPlace } from '../places';
import {
  accountsConfigured, createAccount, onAccountChange, pinpadAccount, rememberedStorage, sendPasswordReset, signInWithPassword,
  signOutOfPinpad, type RememberedStorage,
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
 * Sign in, at the top right: a Pinpad account, with an email and a password. It doesn't move
 * the boards (where they're kept is chosen from the logo's menu); it remembers which Google
 * Drive or OneDrive they're in, and offers to open it on a computer that doesn't have it open.
 */
export function AccountButton() {
  const account = useAccount();
  const storageName = useStore((s) => s.storageName);
  const opening = useStore((s) => s.opening);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'signin' | 'create' | 'reset'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
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

  if (!accountsConfigured()) return null;

  const toggle = () => {
    const r = ref.current!.getBoundingClientRect();
    setAt({ right: window.innerWidth - r.right, top: r.bottom + 8 });
    setError(null);
    setNote(null);
    setOpen((o) => !o);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      if (mode === 'reset') {
        await sendPasswordReset(email);
        setNote(`If there's a Pinpad account for ${email.trim()}, an email with a link to choose a new password is on its way.`);
        setMode('signin');
      } else {
        await (mode === 'create' ? createAccount(email, password) : signInWithPassword(email, password));
        setPassword('');
        setMode('signin');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
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
      {account ? (
        <button ref={ref} className="account-btn" onClick={toggle} aria-haspopup="menu" aria-expanded={open} title={account.email}>
          <Avatar email={account.email} />
        </button>
      ) : (
        <button ref={ref} className="signin-btn" onClick={toggle} aria-haspopup="dialog" aria-expanded={open}>Sign in</button>
      )}
      {open && createPortal(
        <div ref={menuRef} className="menu account-menu" role={account ? 'menu' : 'dialog'} aria-label={account ? 'Account' : 'Sign in'} style={{ right: at.right, top: at.top }}>
          {account ? (
            <>
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
              <div className="menu-sep" />
              <button role="menuitem" disabled={busy} onClick={() => (signOutOfPinpad(), setOpen(false))}>
                <LogOut size={14} /> Sign out of Pinpad
              </button>
            </>
          ) : (
            <form className="signin-form" onSubmit={submit}>
              <div className="signin-title">{mode === 'create' ? 'Create your Pinpad account' : mode === 'reset' ? 'Reset your password' : 'Sign in to Pinpad'}</div>
              <p className="signin-note">
                {mode === 'reset'
                  ? 'We’ll email you a link to choose a new password.'
                  : 'Your account remembers where your boards are saved, so you can open them on any computer. Choose where they’re saved from the Pinpad logo.'}
              </p>
              <label className="signin-field">
                <span>Email</span>
                <input type="email" autoComplete="username" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
              </label>
              {mode !== 'reset' && (
                <label className="signin-field">
                  <span>Password</span>
                  <input
                    type="password"
                    autoComplete={mode === 'create' ? 'new-password' : 'current-password'}
                    required
                    minLength={mode === 'create' ? 6 : undefined}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </label>
              )}
              {error && <div className="place-menu-error" role="alert">{error}</div>}
              {note && <div className="signin-sent" role="status">{note}</div>}
              <button type="submit" className="btn-primary signin-submit" disabled={busy}>
                {busy ? 'Just a moment…' : mode === 'create' ? 'Create account' : mode === 'reset' ? 'Send reset link' : 'Sign in'}
              </button>
              <div className="signin-links">
                {mode === 'signin' ? (
                  <>
                    <button type="button" onClick={() => (setMode('create'), setError(null))}>Create an account</button>
                    <button type="button" onClick={() => (setMode('reset'), setError(null))}>Forgot password?</button>
                  </>
                ) : (
                  <button type="button" onClick={() => (setMode('signin'), setError(null))}>{mode === 'create' ? 'I already have an account' : 'Back to sign in'}</button>
                )}
              </div>
            </form>
          )}
        </div>,
        document.body,
      )}
    </>
  );
}
