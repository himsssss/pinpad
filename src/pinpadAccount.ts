/**
 * Pinpad accounts: signing in with an email and a password (Firebase Authentication). An
 * account doesn't hold boards; those stay wherever the user keeps them (Google Drive,
 * OneDrive, a folder, this browser), connected separately from the logo's menu. What it
 * holds is which Google Drive or OneDrive the boards are in, so signing in on another
 * computer finds them (Firestore, users/<uid>, readable only by its owner).
 *
 * Firebase's web endpoints are called directly, without its SDK. The project's web API key
 * and id come from .env (VITE_FIREBASE_API_KEY, VITE_FIREBASE_PROJECT_ID); they identify the
 * project and aren't secret. Without them, Sign in isn't shown.
 */

const API_KEY = import.meta.env.VITE_FIREBASE_API_KEY ?? '';
const PROJECT_ID = import.meta.env.VITE_FIREBASE_PROJECT_ID ?? '';
const AUTH = 'https://identitytoolkit.googleapis.com/v1/accounts';
const TOKEN = 'https://securetoken.googleapis.com/v1/token';
const STORE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
const KEY = 'pinpad:account';

export interface Account {
  uid: string;
  email: string;
  idToken: string;
  refreshToken: string;
  expiresAt: number;
}

/** The storage an account's boards are kept in, as far as it can be opened on another computer. */
export type RememberedStorage = { kind: 'drive' | 'onedrive'; account: string };

export const accountsConfigured = () => !!API_KEY && !!PROJECT_ID;

const listeners = new Set<() => void>();
let current: Account | null = read();

function read(): Account | null {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? 'null');
  } catch {
    return null;
  }
}

function keep(account: Account | null) {
  current = account;
  try {
    if (account) localStorage.setItem(KEY, JSON.stringify(account));
    else localStorage.removeItem(KEY);
  } catch {
    // Without storage the sign-in lasts until the page is closed.
  }
  listeners.forEach((l) => l());
}

export const pinpadAccount = () => current;
export function onAccountChange(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/** Firebase's error codes, as sentences. */
function explain(code: string) {
  const reason = code.split(' ')[0].split(':')[0];
  switch (reason) {
    case 'EMAIL_EXISTS': return 'There’s already a Pinpad account with this email. Sign in instead.';
    case 'INVALID_LOGIN_CREDENTIALS':
    case 'INVALID_PASSWORD':
    case 'EMAIL_NOT_FOUND': return 'That email and password don’t match a Pinpad account.';
    case 'INVALID_EMAIL':
    case 'MISSING_EMAIL': return 'Enter a valid email address.';
    case 'MISSING_PASSWORD': return 'Enter your password.';
    case 'WEAK_PASSWORD': return 'Choose a password of at least 6 characters.';
    case 'USER_DISABLED': return 'This account has been turned off.';
    case 'TOO_MANY_ATTEMPTS_TRY_LATER': return 'Too many tries. Wait a few minutes, or reset your password.';
    case 'OPERATION_NOT_ALLOWED': return 'Email sign-in isn’t turned on for Pinpad yet.';
    case 'TOKEN_EXPIRED':
    case 'INVALID_REFRESH_TOKEN':
    case 'USER_NOT_FOUND': return 'Your sign-in has expired. Sign in again.';
    default: return `Couldn’t sign in (${reason || 'no connection'}).`;
  }
}

async function post<T>(url: string, body: Record<string, unknown>, form = false): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': form ? 'application/x-www-form-urlencoded' : 'application/json' },
      body: form ? new URLSearchParams(body as Record<string, string>).toString() : JSON.stringify(body),
    });
  } catch {
    throw new Error('Couldn’t reach Pinpad’s sign-in. Check your connection.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(explain(data?.error?.message ?? ''));
  return data as T;
}

type AuthReply = { localId: string; email: string; idToken: string; refreshToken: string; expiresIn: string };

function signedIn(r: AuthReply) {
  const account: Account = {
    uid: r.localId,
    email: r.email,
    idToken: r.idToken,
    refreshToken: r.refreshToken,
    // Renewed a minute early, so a request never goes out with a token about to lapse.
    expiresAt: Date.now() + (Number(r.expiresIn) - 60) * 1000,
  };
  keep(account);
  return account;
}

export async function createAccount(email: string, password: string) {
  const account = signedIn(await post<AuthReply>(`${AUTH}:signUp?key=${API_KEY}`, { email: email.trim(), password, returnSecureToken: true }));
  // A welcome email that confirms the address; signing in doesn't wait for it.
  post(`${AUTH}:sendOobCode?key=${API_KEY}`, { requestType: 'VERIFY_EMAIL', idToken: account.idToken }).catch(() => {});
  return account;
}

export async function signInWithPassword(email: string, password: string) {
  return signedIn(await post<AuthReply>(`${AUTH}:signInWithPassword?key=${API_KEY}`, { email: email.trim(), password, returnSecureToken: true }));
}

/** Emails a link to choose a new password. */
export async function sendPasswordReset(email: string) {
  await post(`${AUTH}:sendOobCode?key=${API_KEY}`, { requestType: 'PASSWORD_RESET', email: email.trim() });
}

export function signOutOfPinpad() {
  keep(null);
}

/** A valid token for the account, renewed when it has run out; signs out if it can't be. */
async function idToken(): Promise<string | null> {
  const account = current;
  if (!account) return null;
  if (Date.now() < account.expiresAt) return account.idToken;
  try {
    const r = await post<{ id_token: string; refresh_token: string; expires_in: string }>(
      `${TOKEN}?key=${API_KEY}`,
      { grant_type: 'refresh_token', refresh_token: account.refreshToken },
      true,
    );
    if (current?.uid !== account.uid) return null;
    keep({ ...account, idToken: r.id_token, refreshToken: r.refresh_token, expiresAt: Date.now() + (Number(r.expires_in) - 60) * 1000 });
    return r.id_token;
  } catch (err) {
    // The account was deleted or its password changed elsewhere; offline keeps the sign-in.
    if (err instanceof Error && /expired/.test(err.message)) keep(null);
    return null;
  }
}

const userDoc = () => `${STORE}/users/${current!.uid}`;

/** Where this account's boards are kept, as remembered from the last computer that opened them. */
export async function rememberedStorage(): Promise<RememberedStorage | null> {
  const token = await idToken();
  if (!token) return null;
  const res = await fetch(userDoc(), { headers: { Authorization: `Bearer ${token}` } }).catch(() => null);
  if (!res?.ok) return null;
  const fields = (await res.json())?.fields?.storage?.mapValue?.fields;
  const kind = fields?.kind?.stringValue;
  const account = fields?.account?.stringValue;
  return (kind === 'drive' || kind === 'onedrive') && account ? { kind, account } : null;
}

/** Remembers where this account's boards are, for signing in elsewhere. */
export async function rememberStorage(storage: RememberedStorage) {
  const token = await idToken();
  if (!token) return;
  await fetch(`${userDoc()}?updateMask.fieldPaths=storage&updateMask.fieldPaths=updatedAt`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fields: {
        storage: { mapValue: { fields: { kind: { stringValue: storage.kind }, account: { stringValue: storage.account } } } },
        updatedAt: { timestampValue: new Date().toISOString() },
      },
    }),
  }).catch(() => {});
}
