/**
 * Keeps note HTML to plain formatting before it reaches the page. Notes can come from
 * imported workspace files, Google Drive or another computer, so any script, event handler
 * or javascript: link in them must never run: in the desktop apps a script could reach the
 * board files and the Google sign-in.
 */

const TAGS = new Set([
  'A', 'B', 'BLOCKQUOTE', 'BR', 'CODE', 'DIV', 'EM', 'H1', 'H2', 'H3', 'I', 'IMG', 'LI', 'OL', 'P', 'PRE',
  'S', 'SPAN', 'STRIKE', 'STRONG', 'SUB', 'SUP', 'U', 'UL',
]);
/** Elements dropped with everything inside them, rather than unwrapped. */
const DROP = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'TEMPLATE', 'NOSCRIPT', 'SVG', 'MATH', 'TITLE', 'META', 'LINK', 'HEAD']);

/** Whether a link may be opened: web and mail addresses only. */
export const isSafeUrl = (url: string) => /^(https?:|mailto:)/i.test(url.trim());
const isSafeImage = (src: string) => /^(https?:|data:image\/(png|jpe?g|gif|webp);)/i.test(src.trim());

function clean(node: Element) {
  for (const child of [...node.children]) {
    if (DROP.has(child.tagName)) {
      child.remove();
      continue;
    }
    clean(child);
    if (!TAGS.has(child.tagName)) {
      child.replaceWith(...child.childNodes);
      continue;
    }
    for (const attr of [...child.attributes]) {
      const keep =
        (child.tagName === 'A' && attr.name === 'href' && isSafeUrl(attr.value)) ||
        (child.tagName === 'IMG' && attr.name === 'src' && isSafeImage(attr.value)) ||
        (child.tagName === 'IMG' && attr.name === 'alt');
      if (!keep) child.removeAttribute(attr.name);
    }
    if (child.tagName === 'A') {
      child.setAttribute('target', '_blank');
      child.setAttribute('rel', 'noopener noreferrer');
    }
    if (child.tagName === 'IMG' && !child.getAttribute('src')) child.remove();
  }
}

export function sanitizeHtml(html: string) {
  if (!/[<&]/.test(html)) return html;
  // A parsed document is inert: nothing in it loads or runs while it's cleaned.
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  clean(doc.body);
  return doc.body.innerHTML;
}
