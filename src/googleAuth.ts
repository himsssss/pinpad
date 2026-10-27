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
          }): { requestAccessToken(overrides?: { prompt?: string }): void };
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
 * On the website the access token is also kept for the tab's session, so reloading the page
 * within the hour doesn't ask for Google again. (The desktop apps renew it silently instead.)
 */
const TOKEN_KEY = 'pinpad:google-token';

function savedToken(): { value: string; expiresAt: number } | null {
  try {
    const saved = JSON.parse(sessionStorage.getItem(TOKEN_KEY) ?? 'null');
    return saved && Date.now() < saved.expiresAt ? saved : null;
  } catch {
    return null;
  }
}

let token = savedToken();

function keep(t: GoogleToken) {
  // Renew a minute early so a request never goes out with a token about to lapse.
  token = { value: t.accessToken, expiresAt: Date.now() + (Number(t.expiresIn) - 60) * 1000 };
  if (!native()) {
    try {
      sessionStorage.setItem(TOKEN_KEY, JSON.stringify(token));
    } catch {
      // Without session storage a reload just asks to sign in again.
    }
  }
  return token.value;
}

function forgetToken() {
  token = null;
  try {
    sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    // Nothing saved to forget.
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

/** Signs in (showing Google's consent screen) and remembers the account's email. */
export async function signIn() {
  const shell = native();
  if (shell) {
    keep(await shell.signIn(DESKTOP_CLIENT));
  } else {
    await preloadGoogle();
    const response = await new Promise<GisTokenResponse>((resolve, reject) => {
      const client = window.google!.accounts.oauth2.initTokenClient({
        client_id: WEB_CLIENT_ID,
        scope: SCOPE,
        callback: (r) => (r.error ? reject(new Error(r.error_description || r.error)) : resolve(r)),
        error_callback: (e) => reject(new Error(e.type === 'popup_closed' ? 'Sign-in was cancelled' : e.message || 'Sign-in failed')),
      });
      client.requestAccessToken();
    });
    keep({ accessToken: response.access_token, expiresIn: Number(response.expires_in) });
  }
  await rememberAccount();
}

/** A valid access token, renewed silently in the desktop apps; throws SignInNeeded otherwise. */
export async function accessToken() {
  if (token && Date.now() < token.expiresAt) return token.value;
  const shell = native();
  if (shell) {
    const fresh = await shell.token(DESKTOP_CLIENT);
    if (fresh) return keep(fresh);
  }
  throw new SignInNeeded();
}

/** Forgets the access token after Google rejected it, so the next call renews it. */
export function dropToken() {
  forgetToken();
}

export async function signOut() {
  const current = token;
  forgetToken();
  try {
    localStorage.removeItem(ACCOUNT_KEY);
  } catch {
    // Storage can be unavailable; nothing to forget then.
  }
  const shell = native();
  if (shell) await shell.signOut();
  else if (current) window.google?.accounts.oauth2.revoke(current.value, () => {});
}

export function googleAccount() {
  try {
    return localStorage.getItem(ACCOUNT_KEY);
  } catch {
    return null;
  }
}

async function rememberAccount() {
  try {
    const res = await fetch('https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)', {
      headers: { Authorization: `Bearer ${await accessToken()}` },
    });
    const email = (await res.json()).user?.emailAddress;
    if (email) localStorage.setItem(ACCOUNT_KEY, email);
  } catch {
    // The email is only shown in the Storage dialog; Drive works without it.
  }
}
