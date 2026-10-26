/**
 * Rich link previews (title, image, description, video). YouTube and Vimeo come from their
 * oEmbed APIs, which allow cross-origin requests. Other pages need their HTML, which browsers
 * block across origins, so it comes from the desktop app (window.pinpadNative) or the dev
 * server; the static web build falls back to the plain link card.
 */

import type { LinkPreview } from './types';

interface PageResponse {
  url: string;
  html: string;
}

declare global {
  interface Window {
    pinpadNative?: { fetchPage(url: string): Promise<PageResponse | null> };
  }
}

export function youtubeId(url: string) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^(www|m|music)\./, '');
    if (host === 'youtu.be') return u.pathname.slice(1).split('/')[0] || null;
    if (host !== 'youtube.com' && host !== 'youtube-nocookie.com') return null;
    if (u.pathname === '/watch') return u.searchParams.get('v');
    const m = u.pathname.match(/^\/(shorts|embed|live)\/([\w-]{6,})/);
    return m ? m[2] : null;
  } catch {
    return null;
  }
}

function vimeoId(url: string) {
  const m = url.match(/^https?:\/\/(?:www\.|player\.)?vimeo\.com\/(?:video\/)?(\d+)/);
  return m ? m[1] : null;
}

async function json<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

async function fetchPage(url: string): Promise<PageResponse | null> {
  try {
    if (window.pinpadNative) return await window.pinpadNative.fetchPage(url);
    if (import.meta.env.DEV) {
      const res = await fetch(`/__preview?url=${encodeURIComponent(url)}`);
      return res.ok ? ((await res.json()) as PageResponse) : null;
    }
  } catch {
    // Fall through to "no preview".
  }
  return null;
}

/** Reads Open Graph / Twitter card / standard meta tags from a page's HTML. */
function parseMeta({ url, html }: PageResponse): LinkPreview {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const meta = (...keys: string[]) => {
    for (const key of keys) {
      const value = doc.querySelector(`meta[property="${key}"], meta[name="${key}"]`)?.getAttribute('content')?.trim();
      if (value) return value;
    }
    return undefined;
  };
  const absolute = (src?: string) => {
    if (!src) return undefined;
    try {
      const resolved = new URL(src, url);
      return resolved.protocol === 'https:' || resolved.protocol === 'http:' ? resolved.href : undefined;
    } catch {
      return undefined;
    }
  };
  return {
    title: meta('og:title', 'twitter:title') ?? (doc.title.trim() || undefined),
    description: meta('og:description', 'twitter:description', 'description'),
    image: absolute(meta('og:image:secure_url', 'og:image', 'twitter:image', 'twitter:image:src')),
    siteName: meta('og:site_name', 'application-name'),
  };
}

export async function fetchPreview(url: string): Promise<LinkPreview | null> {
  const yt = youtubeId(url);
  if (yt) {
    const o = await json<{ title?: string; author_name?: string }>(
      `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${yt}`)}`,
    );
    return {
      title: o?.title,
      siteName: o?.author_name ? `YouTube · ${o.author_name}` : 'YouTube',
      image: `https://i.ytimg.com/vi/${yt}/hqdefault.jpg`,
      video: { provider: 'youtube', id: yt },
    };
  }
  const vm = vimeoId(url);
  if (vm) {
    const o = await json<{ title?: string; author_name?: string; thumbnail_url?: string }>(
      `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(url)}`,
    );
    if (o) return { title: o.title, siteName: 'Vimeo', image: o.thumbnail_url, video: { provider: 'vimeo', id: vm } };
  }
  const page = await fetchPage(url);
  return page ? parseMeta(page) : null;
}

/** Embeddable player URL for a video preview. */
export function embedUrl(video: NonNullable<LinkPreview['video']>) {
  return video.provider === 'youtube'
    ? `https://www.youtube-nocookie.com/embed/${video.id}?autoplay=1&rel=0`
    : `https://player.vimeo.com/video/${video.id}?autoplay=1`;
}
