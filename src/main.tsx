import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { initStore } from './store';
import { App } from './App';
import { SignInGate } from './components/SignInPage';
import { registerServiceWorker } from './serviceWorker';
import '@fontsource-variable/dm-sans/index.css';
import './styles.css';

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
