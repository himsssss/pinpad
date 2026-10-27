/**
 * Google sign-in for saving boards to Google Drive. The desktop apps sign in through the
 * system browser and keep a refresh token, so they stay connected (macos/main.swift,
 * desktop/main.cjs). The website uses Google Identity Services, whose access tokens last
 * about an hour; renewing one needs a click, because Google opens a popup for it.
 *
 * The OAuth client ids come from .env (see .env.example); without them the Google Drive
 * option says it isn't set up.
 */

import type { GoogleToken } from './native';

const WEB_CLIENT_ID = import.meta.env.VITE_GOOGLE_WEB_CLIENT_ID ?? '';
/** Addresses Google accepts sign-in from (the web client's authorized JavaScript origins). */
const WEB_ORIGINS: string[] = String(import.meta.env.VITE_GOOGLE_WEB_ORIGINS ?? '').split(',').map((o) => o.trim()).filter(Boolean);
const DESKTOP_CLIENT = {
  clientId: import.meta.env.VITE_GOOGLE_DESKTOP_CLIENT_ID ?? '',
  clientSecret: import.meta.env.VITE_GOOGLE_DESKTOP_CLIENT_SECRET ?? '',
};
const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const ACCOUNT_KEY = 'pinpad:google-account';

interface GisTokenResponse {
  access_token: string;
  expires_in: number | string;
  error?: string;
  error_description?: string;
}

declare global {
  interface Window {
    /** Google Identity Services, loaded on demand on the website. */
    google?: {
      accounts: {
        oauth2: {
          initTokenClient(config: {
            client_id: string;
            scope: string;
            callback: (response: GisTokenResponse) => void;
            error_callback?: (error: { type: string; message?: string }) => void;
          }): { requestAccessToken(overrides?: { prompt?: string; login_hint?: string }): void };
          revoke(token: string, done: () => void): void;
        };
      };
    };
  }
}

/** Thrown when Drive needs the user to sign in (again) before it can be used. */
export class SignInNeeded extends Error {
  constructor() {
    super('Sign in to Google Drive again to keep saving there.');
  }
}

const native = () => window.pinpadNative?.google;

export const googleConfigured = () => (native() ? !!DESKTOP_CLIENT.clientId : !!WEB_CLIENT_ID);

/**
 * Whether Google will let this copy of the website sign in: only from its registered
 * addresses. Anywhere else Google shows "Error 400: origin_mismatch".
 */
export const googleAllowedHere = () => !!native() || !WEB_ORIGINS.length || WEB_ORIGINS.includes(location.origin);

/** Where the website's Google sign-in works, for telling the user. */
export const googleWebOrigins = () => WEB_ORIGINS;

/**
 * Several Google accounts can be connected, one of them in use (ACCOUNT_KEY). Each has its
 * own access token; on the website a token is also kept for the tab's session, so reloading
 * within the hour doesn't ask for Google again. (The desktop apps renew it silently instead.)
 */
const ACCOUNTS_KEY = 'pinpad:google-accounts';
const TOKEN_KEY = 'pinpad:google-token';
const tokenKey = (account: string | null) => (account ? `${TOKEN_KEY}:${account}` : TOKEN_KEY);

type Token = { value: string; expiresAt: number };
const tokens = new Map<string, Token>();

function savedToken(account: string | null): Token | null {
  try {
    const saved = JSON.parse(sessionStorage.getItem(tokenKey(account)) ?? 'null');
    return saved && Date.now() < saved.expiresAt ? saved : null;
  } catch {
    return null;
  }
}

/** The token for an account, from memory or (website) this tab's session. */
function tokenFor(account: string | null): Token | null {
  const key = account ?? '';
  const known = tokens.get(key) ?? savedToken(account) ?? (account === googleAccount() ? savedToken(null) : null);
  if (known) tokens.set(key, known);
  return known && Date.now() < known.expiresAt ? known : null;
}

function keep(t: GoogleToken, account: string | null) {
  // Renew a minute early so a request never goes out with a token about to lapse.
  const token = { value: t.accessToken, expiresAt: Date.now() + (Number(t.expiresIn) - 60) * 1000 };
  tokens.set(account ?? '', token);
  if (!native()) {
    try {
      sessionStorage.setItem(tokenKey(account), JSON.stringify(token));
    } catch {
      // Without session storage a reload just asks to sign in again.
    }
  }
  return token.value;
}

function forgetToken(account: string | null) {
  tokens.delete(account ?? '');
  try {
    sessionStorage.removeItem(tokenKey(account));
    if (account === googleAccount()) sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    // Nothing saved to forget.
  }
}

/** Every Google account connected on this device, in the order they were added. */
export function googleAccounts(): string[] {
  try {
    const list = JSON.parse(localStorage.getItem(ACCOUNTS_KEY) ?? '[]');
    const current = googleAccount();
    return current && !list.includes(current) ? [...list, current] : list;
  } catch {
    return [];
  }
}

function setAccounts(list: string[]) {
  try {
    localStorage.setItem(ACCOUNTS_KEY, JSON.stringify([...new Set(list)]));
  } catch {
    // The list just isn't remembered.
  }
}

/** Makes a connected account the one Google Drive uses. */
export function useAccount(account: string) {
  try {
    localStorage.setItem(ACCOUNT_KEY, account);
  } catch {
    // Storage can be unavailable; this session still uses it.
  }
  setAccounts([...googleAccounts(), account]);
}

async function emailFor(accessToken: string) {
  try {
    const res = await fetch('https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)', { headers: { Authorization: `Bearer ${accessToken}` } });
    return ((await res.json()).user?.emailAddress as string | undefined) ?? null;
  } catch {
    return null;
  }
}

let gisLoad: Promise<void> | null = null;

/**
 * Loads Google's sign-in script on the website ahead of time: the popup only opens if it's
 * requested straight from a click, with no network wait in between.
 */
export function preloadGoogle() {
  if (native() || !WEB_CLIENT_ID) return Promise.resolve();
  gisLoad ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      gisLoad = null;
      reject(new Error("Couldn't load Google sign-in. Check your connection."));
    };
    document.head.appendChild(script);
  });
  return gisLoad;
}

/** Asks Google Identity Services for a token; it has to run straight from a click (it opens a popup). */
function requestWebToken(overrides?: { prompt?: string; login_hint?: string }) {
  return new Promise<GisTokenResponse>((resolve, reject) => {
    const client = window.google!.accounts.oauth2.initTokenClient({
      client_id: WEB_CLIENT_ID,
      scope: SCOPE,
      callback: (r) => (r.error ? reject(new Error(r.error_description || r.error)) : resolve(r)),
      error_callback: (e) => reject(new Error(e.type === 'popup_closed' ? 'Sign-in was cancelled' : e.message || 'Sign-in failed')),
    });
    client.requestAccessToken(overrides);
  });
}

/**
 * Signs in, showing Google's account choice and consent, and makes that account the one in
 * use. `another` asks Google to let the user pick a different account. Returns its email.
 */
export async function signIn(another = false) {
  const shell = native();
  let access: GoogleToken;
  let account: string | null = null;
  if (shell) {
    const result = await shell.signIn(DESKTOP_CLIENT);
    access = result;
    account = result.account ?? null;
  } else {
    await preloadGoogle();
    const response = await requestWebToken(another ? { prompt: 'select_account' } : undefined);
    access = { accessToken: response.access_token, expiresIn: Number(response.expires_in) };
  }
  account ??= await emailFor(access.accessToken);
  keep(access, account);
  if (account) useAccount(account);
  return account;
}

/**
 * Makes sure an account can be used right now: its token is still valid, the desktop app
 * renews it, or (website) Google's popup confirms it, which needs a click.
 */
export async function ensureAccount(account: string) {
  if (tokenFor(account)) return;
  const shell = native();
  if (shell) {
    const fresh = await shell.token({ ...DESKTOP_CLIENT, account });
    if (!fresh) throw new SignInNeeded();
    keep(fresh, account);
    return;
  }
  await preloadGoogle();
  const response = await requestWebToken({ prompt: '', login_hint: account });
  const access = { accessToken: response.access_token, expiresIn: Number(response.expires_in) };
  const email = await emailFor(access.accessToken);
  if (email && email !== account) throw new Error(`Google signed in as ${email}, not ${account}`);
  keep(access, account);
}

let lastRenewal = 0;

/** Whether the website's Google token has run out or will within a few minutes. */
export function webTokenExpiring() {
  const account = googleAccount();
  if (native() || !WEB_CLIENT_ID || !googleAllowedHere() || !account) return false;
  const token = tokenFor(account) ?? tokens.get(account);
  return !token || token.expiresAt - Date.now() < 5 * 60_000;
}

/**
 * Renews the website's token for the account in use, without the consent screen: Google's
 * popup opens and closes by itself. Called from a click, at most once a minute; false when
 * Google needs the user (or the popup was blocked).
 */
export async function renewWebToken() {
  if (!window.google || Date.now() - lastRenewal < 60_000) return false;
  lastRenewal = Date.now();
  const account = googleAccount();
  try {
    const response = await requestWebToken({ prompt: '', login_hint: account ?? undefined });
    keep({ accessToken: response.access_token, expiresIn: Number(response.expires_in) }, account);
    return true;
  } catch {
    return false;
  }
}

/** A valid access token for the account in use, renewed silently in the desktop apps; throws SignInNeeded otherwise. */
export async function accessToken() {
  const account = googleAccount();
  const token = tokenFor(account);
  if (token) return token.value;
  const shell = native();
  if (shell) {
    const fresh = await shell.token({ ...DESKTOP_CLIENT, account: account ?? undefined });
    if (fresh) return keep(fresh, account);
  }
  throw new SignInNeeded();
}

/** Forgets the access token after Google rejected it, so the next call renews it. */
export function dropToken() {
  forgetToken(googleAccount());
}

/** Disconnects an account (the one in use by default) from this device. */
export async function signOut(account = googleAccount()) {
  const current = tokenFor(account);
  forgetToken(account);
  setAccounts(googleAccounts().filter((a) => a !== account));
  try {
    if (account === localStorage.getItem(ACCOUNT_KEY)) localStorage.removeItem(ACCOUNT_KEY);
  } catch {
    // Storage can be unavailable; nothing to forget then.
  }
  const shell = native();
  if (shell) await shell.signOut({ account: account ?? undefined });
  else if (current) window.google?.accounts.oauth2.revoke(current.value, () => {});
}

export function googleAccount() {
  try {
    return localStorage.getItem(ACCOUNT_KEY);
  } catch {
    return null;
  }
}
