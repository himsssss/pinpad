/**
 * Rich link previews (title, image, description, video). YouTube and Vimeo come from their
 * oEmbed APIs, which allow cross-origin requests. Other pages need their HTML, which browsers
 * block across origins, so it comes from the desktop app (window.pinpadNative) or the dev
 * server; the static web build falls back to the plain link card.
 */

import type { LinkPreview } from './types';
import type { PageResponse } from './native';

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
    };
  }
  const vm = vimeoId(url);
  if (vm) {
    const o = await json<{ title?: string; author_name?: string; thumbnail_url?: string }>(
      `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(url)}`,
    );
    if (o) return { title: o.title, siteName: 'Vimeo', image: o.thumbnail_url };
  }
  // Audio services whose oEmbed APIs allow cross-origin requests (their pages hide metadata from bots).
  const audioOembed = /^https?:\/\/open\.spotify\.com\//.test(url) ? ['Spotify', 'https://open.spotify.com/oembed?url=']
    : /^https?:\/\/(www\.|m\.)?soundcloud\.com\//.test(url) ? ['SoundCloud', 'https://soundcloud.com/oembed?format=json&url=']
    : null;
  if (audioOembed) {
    const o = await json<{ title?: string; thumbnail_url?: string; author_name?: string }>(audioOembed[1] + encodeURIComponent(url));
    if (o) return { title: o.title, image: o.thumbnail_url, siteName: o.author_name ? `${audioOembed[0]} · ${o.author_name}` : audioOembed[0] };
  }
  // Direct media files have no page to read; their file name is the best title.
  const file = url.match(/\/([^/?#]+\.(?:mp4|m4v|webm|ogv|mov|mp3|m4a|aac|wav|oga|ogg|flac|opus))(?:[?#]|$)/i);
  if (file) return { title: decodeURIComponent(file[1]) };
  const page = await fetchPage(url);
  return page ? parseMeta(page) : null;
}
