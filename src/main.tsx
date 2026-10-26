import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { initStore } from './store';
import { App } from './App';
import '@fontsource-variable/dm-sans/index.css';
import './styles.css';

initStore().then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
