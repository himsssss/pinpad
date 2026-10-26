/**
 * Which links can play inside a card, and the player to embed for each. Covers the providers
 * Milanote's player supports (YouTube, Vimeo, Loom, Dailymotion, Wistia, Streamable, Twitch,
 * Facebook, Vidyard, SoundCloud, Spotify, Mixcloud) plus direct video and audio files.
 */

export type MediaEmbed =
  | { kind: 'iframe'; provider: string; src: string; aspect?: number; height?: number }
  | { kind: 'video'; provider: string; src: string }
  | { kind: 'audio'; provider: string; src: string };

/**
 * Hosts our embed wrapper may frame. The desktop apps keep their own copy of this list
 * (macos/main.swift, desktop/main.cjs) to validate wrapper requests.
 */
export const EMBED_HOSTS = [
  'www.youtube-nocookie.com', 'player.vimeo.com', 'www.loom.com', 'www.dailymotion.com', 'fast.wistia.net',
  'streamable.com', 'player.twitch.tv', 'clips.twitch.tv', 'www.facebook.com', 'play.vidyard.com',
  'w.soundcloud.com', 'open.spotify.com', 'player-widget.mixcloud.com',
];

/** Placeholder for Twitch's required `parent` (the embedding page's hostname). */
const PARENT = '__PARENT__';

const VIDEO_FILE = /\.(mp4|m4v|webm|ogv|mov)(\?|#|$)/i;
const AUDIO_FILE = /\.(mp3|m4a|aac|wav|oga|ogg|flac|opus)(\?|#|$)/i;

export function mediaEmbed(raw: string): MediaEmbed | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  const host = url.hostname.replace(/^(www|m|music|go)\./, '');
  const path = url.pathname;
  const seg = path.split('/').filter(Boolean);
  const enc = encodeURIComponent(raw);

  if (host === 'youtube.com' || host === 'youtu.be' || host === 'youtube-nocookie.com') {
    const shorts = seg[0] === 'shorts';
    const id = host === 'youtu.be' ? seg[0]
      : path === '/watch' ? url.searchParams.get('v')
      : ['shorts', 'embed', 'live'].includes(seg[0]) ? seg[1] : null;
    if (!id) return null;
    const start = url.searchParams.get('t')?.replace(/s$/, '');
    return {
      kind: 'iframe', provider: 'YouTube', aspect: shorts ? 9 / 16 : 16 / 9,
      src: `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0&playsinline=1${start && /^\d+$/.test(start) ? `&start=${start}` : ''}`,
    };
  }
  if (host === 'vimeo.com' || host === 'player.vimeo.com') {
    const id = seg.find((s) => /^\d+$/.test(s));
    return id ? { kind: 'iframe', provider: 'Vimeo', aspect: 16 / 9, src: `https://player.vimeo.com/video/${id}?autoplay=1` } : null;
  }
  if (host === 'loom.com' && (seg[0] === 'share' || seg[0] === 'embed') && seg[1]) {
    return { kind: 'iframe', provider: 'Loom', aspect: 16 / 9, src: `https://www.loom.com/embed/${seg[1]}?autoplay=1` };
  }
  if ((host === 'dailymotion.com' && seg[0] === 'video' && seg[1]) || (host === 'dai.ly' && seg[0])) {
    const id = host === 'dai.ly' ? seg[0] : seg[1];
    return { kind: 'iframe', provider: 'Dailymotion', aspect: 16 / 9, src: `https://www.dailymotion.com/embed/video/${id}?autoplay=1` };
  }
  if (/(^|\.)wistia\.(com|net)$/.test(host) || host === 'wi.st') {
    const i = seg.findIndex((s) => s === 'medias' || s === 'iframe');
    const id = i >= 0 ? seg[i + 1] : null;
    return id ? { kind: 'iframe', provider: 'Wistia', aspect: 16 / 9, src: `https://fast.wistia.net/embed/iframe/${id}?autoPlay=true` } : null;
  }
  if (host === 'streamable.com' && seg[0]) {
    const id = seg[0] === 'e' ? seg[1] : seg[0];
    return id ? { kind: 'iframe', provider: 'Streamable', aspect: 16 / 9, src: `https://streamable.com/e/${id}?autoplay=1` } : null;
  }
  if (host === 'clips.twitch.tv' || (host === 'twitch.tv' && seg[1] === 'clip')) {
    const id = host === 'clips.twitch.tv' ? seg[0] : seg[2];
    return id ? { kind: 'iframe', provider: 'Twitch', aspect: 16 / 9, src: `https://clips.twitch.tv/embed?clip=${id}&parent=${PARENT}&autoplay=true` } : null;
  }
  if (host === 'twitch.tv' && seg[0]) {
    const query = seg[0] === 'videos' && seg[1] ? `video=${seg[1]}` : `channel=${seg[0]}`;
    return { kind: 'iframe', provider: 'Twitch', aspect: 16 / 9, src: `https://player.twitch.tv/?${query}&parent=${PARENT}&autoplay=true` };
  }
  if ((host === 'facebook.com' && /\/(videos|watch|reel)\b/.test(path)) || host === 'fb.watch') {
    return { kind: 'iframe', provider: 'Facebook', aspect: 16 / 9, src: `https://www.facebook.com/plugins/video.php?href=${enc}&show_text=false&autoplay=true` };
  }
  if (host === 'share.vidyard.com' && seg[0] === 'watch' && seg[1]) {
    return { kind: 'iframe', provider: 'Vidyard', aspect: 16 / 9, src: `https://play.vidyard.com/${seg[1]}.html?autoplay=1` };
  }
  if (host === 'soundcloud.com' && seg.length >= 2) {
    return { kind: 'iframe', provider: 'SoundCloud', height: 166, src: `https://w.soundcloud.com/player/?url=${enc}&auto_play=true&show_artwork=true` };
  }
  if (host === 'open.spotify.com') {
    const s = seg[0]?.startsWith('intl-') ? seg.slice(1) : seg;
    const [type, id] = s;
    if (id && ['track', 'album', 'playlist', 'episode', 'show', 'artist'].includes(type)) {
      const compact = type === 'track' || type === 'episode';
      return { kind: 'iframe', provider: 'Spotify', height: compact ? 152 : 352, src: `https://open.spotify.com/embed/${type}/${id}` };
    }
  }
  if (host === 'mixcloud.com' && seg.length >= 2) {
    return { kind: 'iframe', provider: 'Mixcloud', height: 120, src: `https://player-widget.mixcloud.com/widget/iframe/?hide_cover=1&autoplay=1&feed=${encodeURIComponent(path)}` };
  }
  if (VIDEO_FILE.test(path)) return { kind: 'video', provider: 'Video', src: raw };
  if (AUDIO_FILE.test(path)) return { kind: 'audio', provider: 'Audio', src: raw };
  return null;
}

/**
 * The URL to put in the card's iframe. Normal web pages embed players directly. The desktop
 * apps serve pages from a private scheme that players reject (no referrer), so they route
 * through a tiny wrapper page on 127.0.0.1. Null means the player can't be embedded here.
 */
export function iframeSrc(src: string): string | null {
  if (location.protocol === 'http:' || location.protocol === 'https:') {
    return src.replace(PARENT, location.hostname);
  }
  const base = window.pinpadNative?.embedBase;
  if (!base) return null;
  return `${base}/embed?src=${encodeURIComponent(src.replace(PARENT, '127.0.0.1'))}`;
}
