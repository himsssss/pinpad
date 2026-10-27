/**
 * Microsoft sign-in for saving boards to OneDrive. Pinpad asks only for its own app folder
 * in OneDrive (Files.ReadWrite.AppFolder, "Apps/Pinpad"), never the rest of it.
 *
 * The desktop apps sign in through the system browser and keep the refresh token in the
 * Keychain or an encrypted file (macos/main.swift, desktop/main.cjs). The website signs in
 * in a popup (authorization code with PKCE, public/ms-auth.html receives the answer) and
 * keeps the refresh token in this browser; Microsoft lets a website's sign-in last a day,
 * after which "Sign in again" asks once more.
 *
 * The app's client id comes from .env (VITE_MICROSOFT_CLIENT_ID, see .env.example); without
 * it the OneDrive option isn't shown.
 */

import { SignInNeeded } from './googleAuth';
import type { GoogleToken } from './native';

const CLIENT_ID = import.meta.env.VITE_MICROSOFT_CLIENT_ID ?? '';
/** Addresses registered as the web app's redirect URIs (…/ms-auth.html at each). */
const WEB_ORIGINS: string[] = String(import.meta.env.VITE_MICROSOFT_WEB_ORIGINS ?? '').split(',').map((o) => o.trim()).filter(Boolean);
const AUTHORITY = 'https://login.microsoftonline.com/common/oauth2/v2.0';
export const MICROSOFT_SCOPE = 'offline_access User.Read Files.ReadWrite.AppFolder';

const ACCOUNT_KEY = 'pinpad:microsoft-account';
const ACCOUNTS_KEY = 'pinpad:microsoft-accounts';
const REFRESH_KEY = 'pinpad:microsoft-refresh';

export class MicrosoftSignInNeeded extends SignInNeeded {
  constructor() {
    super();
    this.message = 'Sign in to OneDrive again to keep saving there.';
  }
}

const native = () => window.pinpadNative?.microsoft;

export const microsoftConfigured = () => !!CLIENT_ID;
/** Microsoft only sends the website's sign-in back to its registered addresses. */
export const microsoftAllowedHere = () => !!native() || !WEB_ORIGINS.length || WEB_ORIGINS.includes(location.origin);
export const microsoftWebOrigins = () => WEB_ORIGINS;

type Token = { value: string; expiresAt: number };
const tokens = new Map<string, Token>();

function read<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null') ?? fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Not remembered; signing in again works.
  }
}

export function microsoftAccount(): string | null {
  return read<string | null>(ACCOUNT_KEY, null);
}

/** Every Microsoft account connected on this device, in the order they were added. */
export function microsoftAccounts(): string[] {
  const list = read<string[]>(ACCOUNTS_KEY, []);
  const current = microsoftAccount();
  return current && !list.includes(current) ? [...list, current] : list;
}

/** Makes a connected account the one OneDrive uses. */
export function useMicrosoftAccount(account: string) {
  write(ACCOUNT_KEY, account);
  write(ACCOUNTS_KEY, [...new Set([...microsoftAccounts(), account])]);
}

/** The website's refresh tokens, per account (the desktop apps keep theirs natively). */
const refreshTokens = () => read<Record<string, string>>(REFRESH_KEY, {});
function setRefreshToken(account: string, token: string | null) {
  const all = refreshTokens();
  if (token) all[account] = token;
  else delete all[account];
  write(REFRESH_KEY, all);
}

function keep(t: GoogleToken, account: string) {
  const token = { value: t.accessToken, expiresAt: Date.now() + (Number(t.expiresIn) - 60) * 1000 };
  tokens.set(account, token);
  return token.value;
}

async function emailFor(accessToken: string) {
  const res = await fetch('https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName', { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) return null;
  const me = await res.json();
  return ((me.mail || me.userPrincipalName) as string | undefined)?.toLowerCase() ?? null;
}

const base64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const random = (n: number) => base64url(crypto.getRandomValues(new Uint8Array(n)));
const redirectUri = () => new URL('ms-auth.html', location.href.split(/[?#]/)[0].replace(/[^/]*$/, '')).href;

async function tokenRequest(params: Record<string, string>) {
  const res = await fetch(`${AUTHORITY}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: CLIENT_ID, scope: MICROSOFT_SCOPE, ...params }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(json.error_description?.split('\r\n')[0] || json.error || `Microsoft sign-in failed (${res.status})`), { code: json.error });
  return json as { access_token: string; expires_in: number; refresh_token?: string };
}

/**
 * The website's sign-in popup. It's opened straight away (a popup only opens from a click)
 * and pointed at Microsoft once the PKCE challenge is ready.
 */
async function webSignIn(hint?: string) {
  const popup = window.open('', 'pinpad-microsoft', 'width=500,height=680');
  if (!popup) throw new Error('Allow pop-ups for Pinpad to sign in to Microsoft');
  const verifier = random(32);
  const challenge = base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  const state = random(16);
  const auth = new URL(`${AUTHORITY}/authorize`);
  Object.entries({
    client_id: CLIENT_ID, response_type: 'code', redirect_uri: redirectUri(), response_mode: 'query', scope: MICROSOFT_SCOPE,
    state, code_challenge: challenge, code_challenge_method: 'S256', prompt: hint ? 'login' : 'select_account',
    ...(hint ? { login_hint: hint } : {}),
  }).forEach(([k, v]) => auth.searchParams.set(k, v));
  popup.location.href = auth.href;
  const query = await new Promise<URLSearchParams>((resolve, reject) => {
    const done = (fn: () => void) => {
      window.removeEventListener('message', onMessage);
      clearInterval(watch);
      fn();
    };
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== location.origin || e.data?.type !== 'pinpad-microsoft-auth') return;
      done(() => resolve(new URLSearchParams(e.data.query)));
    };
    const watch = window.setInterval(() => popup.closed && done(() => reject(new Error('Sign-in was cancelled'))), 500);
    window.addEventListener('message', onMessage);
  });
  if (query.get('state') !== state) throw new Error('Sign-in failed');
  const code = query.get('code');
  if (!code) throw new Error(query.get('error') === 'access_denied' ? 'Sign-in was cancelled' : query.get('error_description') || 'Sign-in failed');
  const json = await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: redirectUri(), code_verifier: verifier });
  return { access: { accessToken: json.access_token, expiresIn: json.expires_in }, refresh: json.refresh_token ?? null };
}

/** Signs in, letting the user pick an account, and makes it the one in use. Returns its email. */
export async function microsoftSignIn() {
  const shell = native();
  let access: GoogleToken;
  let account: string | null;
  if (shell) {
    const result = await shell.signIn({ clientId: CLIENT_ID });
    access = result;
    account = result.account ?? (await emailFor(result.accessToken));
  } else {
    const result = await webSignIn();
    access = result.access;
    account = await emailFor(access.accessToken);
    if (account && result.refresh) setRefreshToken(account, result.refresh);
  }
  if (!account) throw new Error("Couldn't tell which Microsoft account signed in");
  keep(access, account);
  useMicrosoftAccount(account);
  return account;
}

/** A fresh access token from the saved sign-in, or null when the user must sign in again. */
async function renew(account: string): Promise<string | null> {
  const shell = native();
  if (shell) {
    const fresh = await shell.token({ clientId: CLIENT_ID, account });
    return fresh ? keep(fresh, account) : null;
  }
  const refresh = refreshTokens()[account];
  if (!refresh) return null;
  try {
    const json = await tokenRequest({ grant_type: 'refresh_token', refresh_token: refresh });
    // Microsoft hands out a new refresh token each time; the old one stops working.
    if (json.refresh_token) setRefreshToken(account, json.refresh_token);
    return keep({ accessToken: json.access_token, expiresIn: json.expires_in }, account);
  } catch (err) {
    if ((err as { code?: string }).code === 'invalid_grant') {
      setRefreshToken(account, null);
      return null;
    }
    throw err;
  }
}

/** Makes sure an account can be used now; on the website this may open the sign-in popup (needs a click). */
export async function ensureMicrosoftAccount(account: string) {
  const known = tokens.get(account);
  if (known && Date.now() < known.expiresAt) return;
  if (await renew(account)) return;
  if (native()) throw new MicrosoftSignInNeeded();
  const result = await webSignIn(account);
  const email = await emailFor(result.access.accessToken);
  if (email && email !== account) throw new Error(`Microsoft signed in as ${email}, not ${account}`);
  if (result.refresh) setRefreshToken(account, result.refresh);
  keep(result.access, account);
}

/** A valid access token for the account in use; throws MicrosoftSignInNeeded otherwise. */
export async function microsoftToken() {
  const account = microsoftAccount();
  if (!account) throw new MicrosoftSignInNeeded();
  const known = tokens.get(account);
  if (known && Date.now() < known.expiresAt) return known.value;
  const fresh = await renew(account);
  if (fresh) return fresh;
  throw new MicrosoftSignInNeeded();
}

/** Forgets the access token after OneDrive rejected it, so the next call renews it. */
export function dropMicrosoftToken() {
  const account = microsoftAccount();
  if (account) tokens.delete(account);
}

/** Disconnects an account (the one in use by default) from this device. */
export async function microsoftSignOut(account = microsoftAccount()) {
  if (!account) return;
  tokens.delete(account);
  setRefreshToken(account, null);
  write(ACCOUNTS_KEY, microsoftAccounts().filter((a) => a !== account));
  if (microsoftAccount() === account) write(ACCOUNT_KEY, null);
  await native()?.signOut({ account });
}
