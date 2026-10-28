/**
 * Links that open a board or sidebar folder directly ("#board=<id>", "#folder=<id>"), so the
 * other person needn't hunt for it. They open it for anyone whose Pinpad has those boards:
 * the same Google Drive or OneDrive, or the same (synced) folder.
 */

export type LinkTarget = { kind: 'board' | 'folder'; id: string };

/** The website's address, even from the desktop apps, whose own pages can't be linked to. */
const site = () => (window.pinpadNative ? import.meta.env.VITE_SITE_URL || 'https://pinpad-taupe.vercel.app/' : location.href.split(/[?#]/)[0]);

export const boardLink = (target: LinkTarget) => `${site()}#${target.kind}=${target.id}`;

export function linkInUrl(): LinkTarget | null {
  const m = /^#(board|folder)=([\w-]+)$/.exec(location.hash);
  return m ? { kind: m[1] as LinkTarget['kind'], id: m[2] } : null;
}

/** Takes the link off the address, so reloading opens the last board as usual. */
export function clearLinkFromUrl() {
  history.replaceState(null, '', location.pathname + location.search);
}

/** Copies the link; false when the browser wouldn't let it be copied. */
export async function copyLink(target: LinkTarget) {
  const text = boardLink(target);
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Older browsers and some embedded ones only copy what's selected on the page.
    const field = document.createElement('textarea');
    field.value = text;
    field.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(field);
    field.select();
    const copied = document.execCommand('copy');
    field.remove();
    return copied;
  }
}
