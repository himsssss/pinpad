import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const PREVIEW_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15 PinpadLinkPreview';

/**
 * Dev-only `/__preview?url=` endpoint that fetches a page's HTML for link previews, since the
 * browser can't read other sites directly. The desktop apps do the same natively.
 */
function linkPreviewDevServer(): Plugin {
  return {
    name: 'pinpad-link-preview',
    configureServer(server) {
      server.middlewares.use('/__preview', async (req, res) => {
        const target = new URL(req.url ?? '', 'http://localhost').searchParams.get('url') ?? '';
        if (!/^https?:\/\//i.test(target)) {
          res.statusCode = 400;
          res.end();
          return;
        }
        try {
          const page = await fetch(target, { headers: { 'User-Agent': PREVIEW_UA, Accept: 'text/html' }, signal: AbortSignal.timeout(8000) });
          const html = (await page.text()).slice(0, 1_500_000);
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ url: page.url, html }));
        } catch {
          res.statusCode = 502;
          res.end();
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), linkPreviewDevServer()],
  // Relative asset paths so the build also loads inside the macOS app bundle.
  base: './',
  server: { port: 3000, strictPort: true },
});
