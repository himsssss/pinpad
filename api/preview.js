/**
 * Link previews for the website (deployed with it on Vercel as /api/preview?url=…). Browsers
 * can't read other sites' pages, so this reads the page and returns the start of it (its
 * <head>, where the title, picture and description are), which src/linkPreview.ts reads like
 * the desktop apps' own page fetch. Nothing else is fetched or kept; answers are cached by
 * Vercel's CDN for a day, so a link is read once however many boards show it.
 */

export const config = { runtime: 'edge' };

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 PinpadLinkPreview';
const MAX_BYTES = 1_500_000;
const MAX_REDIRECTS = 5;

/** Public web addresses only: never this computer, a local network or a bare IP address. */
function allowed(url) {
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
  if (url.username || url.password) return false;
  const host = url.hostname.toLowerCase();
  if (!host.includes('.') || host.startsWith('[')) return false;
  if (/^\d+(\.\d+){3}$/.test(host)) return false;
  return !/(^|\.)(localhost|local|internal|home|lan|intranet|corp)$/.test(host);
}

const answer = (status, body, maxAge) =>
  new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': `public, max-age=0, s-maxage=${maxAge}, stale-while-revalidate=604800`,
      'X-Content-Type-Options': 'nosniff',
    },
  });

/** Reads at most MAX_BYTES, stopping early at </head> when the picture's tag came before it. */
async function head(response) {
  const reader = response.body?.getReader();
  if (!reader) return '';
  const decoder = new TextDecoder();
  let html = '';
  let bytes = 0;
  while (bytes < MAX_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.length;
    html += decoder.decode(value, { stream: true });
    // Some sites (Pinterest, say) put their preview tags after the head.
    const end = html.search(/<\/head\s*>/i);
    if (end !== -1 && /og:image|twitter:image/i.test(html.slice(0, end))) {
      html = html.slice(0, end);
      break;
    }
  }
  reader.cancel().catch(() => {});
  return html;
}

export default async function handler(request) {
  // Only for Pinpad's own pages; other sites couldn't read the answer anyway (no CORS).
  if (request.headers.get('sec-fetch-site') === 'cross-site') return answer(403, null, 0);
  let url;
  try {
    url = new URL(new URL(request.url).searchParams.get('url') ?? '');
  } catch {
    return answer(400, null, 0);
  }
  try {
    // Redirects are followed one at a time, so each address is checked.
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      if (!allowed(url)) return answer(400, null, 0);
      const response = await fetch(url, {
        headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml', 'Accept-Language': 'en' },
        redirect: 'manual',
        signal: AbortSignal.timeout(8000),
      });
      const next = response.status >= 300 && response.status < 400 && response.headers.get('location');
      if (next) {
        response.body?.cancel().catch(() => {});
        url = new URL(next, url);
        continue;
      }
      if (!response.ok || !/html/i.test(response.headers.get('content-type') ?? 'text/html')) return answer(404, null, 3600);
      return answer(200, { url: url.href, html: await head(response) }, 86400);
    }
  } catch {
    return answer(502, null, 300);
  }
  return answer(508, null, 300);
}
