import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { initStore } from './store';
import { App } from './App';
import './styles.css';

initStore().then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
