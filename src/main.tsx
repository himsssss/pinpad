import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import * as Sentry from '@sentry/react';
import { initStore } from './store';
import { App } from './App';
import { SignInGate } from './components/SignInPage';
import { registerServiceWorker } from './serviceWorker';
import '@fontsource-variable/dm-sans/index.css';
import './styles.css';

// Crashes and errors go to Sentry (built apps only). Board contents stay out of the reports:
// no session replay, no personal details, and no breadcrumbs of what was clicked, typed or logged.
const SENTRY_DSN = import.meta.env.VITE_SENTRY_DSN;
if (import.meta.env.PROD && SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: window.pinpadNative ? 'desktop' : 'web',
    dataCollection: { userInfo: false, cookies: false, httpHeaders: false, httpBodies: [], urlQueryParams: false },
    beforeBreadcrumb: (crumb) => (crumb.category?.startsWith('ui.') || crumb.category === 'console' ? null : crumb),
  });
}

// The website works offline and can be installed; the desktop apps load it from their own
// app:// pages, where service workers don't apply.
if (import.meta.env.PROD && /^https?:$/.test(location.protocol) && !window.pinpadNative) registerServiceWorker();

initStore().then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <SignInGate>
        <App />
      </SignInGate>
    </StrictMode>,
  );
});
