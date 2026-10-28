import { useState, useSyncExternalStore, type FormEvent, type ReactNode } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { accountsConfigured, createAccount, onAccountChange, pinpadAccount, sendPasswordReset, signInWithPassword } from '../pinpadAccount';
import { PinpadMark } from './PinpadMark';

/** Pinpad opens only once signed in: until then, this page is all there is. */
export function SignInGate({ children }: { children: ReactNode }) {
  const account = useSyncExternalStore(onAccountChange, pinpadAccount);
  return accountsConfigured() && !account ? <SignInPage /> : <>{children}</>;
}

function SignInPage() {
  const [mode, setMode] = useState<'signin' | 'create' | 'reset'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const switchTo = (next: typeof mode) => {
    setMode(next);
    setError(null);
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
        // Signing in swaps this page for the app.
        await (mode === 'create' ? createAccount(email, password) : signInWithPassword(email, password));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="signin-page">
      <form className="signin-form signin-card" onSubmit={submit}>
        <div className="signin-head">
          <PinpadMark size={40} />
          <h1 className="signin-title">{mode === 'create' ? 'Create your account' : mode === 'reset' ? 'Reset your password' : 'Sign in to Pinpad'}</h1>
          <p className="signin-note">
            {mode === 'reset' ? 'We’ll email you a link to choose a new one.' : 'Your boards, on any computer.'}
          </p>
        </div>
        <label className="signin-field">
          <span>Email</span>
          <input type="email" autoComplete="username" required autoFocus placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        {mode !== 'reset' && (
          <div className="signin-field">
            <span className="signin-label-row">
              <label htmlFor="signin-password">Password</label>
              {mode === 'signin' && (
                <button type="button" className="signin-link" onClick={() => switchTo('reset')}>Forgot?</button>
              )}
            </span>
            <span className="signin-password">
              <input
                id="signin-password"
                type={showPassword ? 'text' : 'password'}
                autoComplete={mode === 'create' ? 'new-password' : 'current-password'}
                required
                minLength={mode === 'create' ? 6 : undefined}
                placeholder={mode === 'create' ? 'At least 6 characters' : undefined}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button
                type="button"
                className="signin-eye"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                title={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </span>
          </div>
        )}
        {error && <div className="place-menu-error" role="alert">{error}</div>}
        {note && <div className="signin-sent" role="status">{note}</div>}
        <button type="submit" className="btn-primary signin-submit" disabled={busy}>
          {busy ? 'Just a moment…' : mode === 'create' ? 'Create account' : mode === 'reset' ? 'Send reset link' : 'Sign in'}
        </button>
        <div className="signin-foot">
          {mode === 'signin' ? (
            <>New to Pinpad? <button type="button" className="signin-link" onClick={() => switchTo('create')}>Create an account</button></>
          ) : mode === 'create' ? (
            <>Have an account? <button type="button" className="signin-link" onClick={() => switchTo('signin')}>Sign in</button></>
          ) : (
            <button type="button" className="signin-link" onClick={() => switchTo('signin')}>Back to sign in</button>
          )}
        </div>
      </form>
    </main>
  );
}
