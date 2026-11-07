import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import * as Sentry from '@sentry/react';
import { initStore } from './store';
import { App } from './App';
import { SignInGate } from './components/SignInPage';
import { accountsConfigured, signInWithTracker } from './pinpadAccount';
import { keepTrackerBrief } from './ideationBoards';
import { registerServiceWorker } from './serviceWorker';
import '@fontsource-variable/dm-sans/index.css';
import './styles.css';

// Crashes and errors go to Sentry (built apps only). Board contents stay out of the reports:
// no session replay, no personal details, no request queries, and no breadcrumbs of what was
// clicked, typed or logged.
const SENTRY_DSN = import.meta.env.VITE_SENTRY_DSN;
if (import.meta.env.PROD && SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: window.pinpadNative ? 'desktop' : 'web',
    dataCollection: { userInfo: false, cookies: false, httpHeaders: false, httpBodies: [], urlQueryParams: false },
    beforeBreadcrumb: (crumb) => {
      if (crumb.category?.startsWith('ui.') || crumb.category === 'console') return null;
      // Request addresses without their query (a Drive search names the board files it looks for)
      // or the account's id (Firestore's users/<id>).
      if (typeof crumb.data?.url === 'string') crumb.data.url = crumb.data.url.split(/[?#]/)[0].replace(/\/users\/[^/]+/, '/users/…');
      return crumb;
    },
  });
}

// The website works offline and can be installed; the desktop apps load it from their own
// app:// pages, where service workers don't apply.
if (import.meta.env.PROD && /^https?:$/.test(location.protocol) && !window.pinpadNative) registerServiceWorker();

// Opened from Creative Tracker's "Open board": #tracker=<token> signs in as the tracker's user
// (pinpadAccount.ts), and #project=&brief=&year=&month= say which brief's board to open
// (ideationBoards.ts). They leave the address bar at once; if the token can't be used, the
// sign-in page shows as usual.
const fromLink = new URLSearchParams(location.hash.slice(1));
const fromTracker = fromLink.get('tracker');
keepTrackerBrief(fromLink);
if (fromTracker || fromLink.has('brief')) history.replaceState(null, '', location.pathname + location.search);
const trackerSignIn = fromTracker && accountsConfigured()
  ? signInWithTracker(fromTracker).catch((err) => console.warn('Creative Tracker sign-in:', err instanceof Error ? err.message : err))
  : Promise.resolve();

trackerSignIn.then(initStore).then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <SignInGate>
        <App />
      </SignInGate>
    </StrictMode>,
  );
});
