/**
 * The website's service worker (public/sw.js): keeps each version's files on this device so
 * Pinpad opens instantly and offline. A new version installs in the background and waits;
 * the page offers to switch to it (UpdatePrompt), so the open boards never lose their files.
 */

import { flushNow } from './store';

let waiting: ServiceWorker | null = null;
const listeners = new Set<() => void>();

const offer = (worker: ServiceWorker) => {
  waiting = worker;
  listeners.forEach((l) => l());
};

export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  let switching = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (switching) location.reload();
  });
  window.addEventListener('pinpad:update-now', () => (switching = true));
  navigator.serviceWorker.register('./sw.js').then((reg) => {
    // Only an update to a page already running from the cache needs a switch; the first install doesn't.
    if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const worker = reg.installing;
      worker?.addEventListener('statechange', () => worker.state === 'installed' && navigator.serviceWorker.controller && offer(worker));
    });
    // A tab left open for days still hears about new versions.
    setInterval(() => reg.update().catch(() => {}), 60 * 60 * 1000);
  }).catch(() => {});
}

export const updateReady = () => waiting !== null;

export function onUpdateReady(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/** Saves, then switches to the new version (the page reloads once it's in charge). */
export async function updateNow() {
  if (!waiting) return;
  await flushNow().catch(() => {});
  window.dispatchEvent(new Event('pinpad:update-now'));
  waiting.postMessage('update');
}
