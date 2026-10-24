import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Relative asset paths so the build also loads inside the macOS app bundle.
  base: './',
  server: { port: 3000, strictPort: true },
});
