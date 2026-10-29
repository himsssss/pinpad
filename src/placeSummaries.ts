/**
 * What the sidebar shows of a place that isn't open (another folder on this computer): its
 * folders and projects as they were last saved on this device, so every folder's projects are
 * listed together and one click opens any of them.
 */

import type { Doc, Folder } from './types';
import { projects } from './doc';

export interface PlaceSummary {
  folders: Pick<Folder, 'id' | 'name' | 'parentId' | 'order'>[];
  projects: { id: string; title: string; icon: string; color: string; folderId?: string }[];
}

const key = (placeId: string) => `pinpad:place:${placeId}`;

export function summarize(doc: Doc): PlaceSummary {
  return {
    folders: Object.values(doc.folders).map(({ id, name, parentId, order }) => ({ id, name, parentId, order })),
    projects: projects(doc).map(({ id, title, icon, color, folderId }) => ({
      id, title, icon, color, folderId: folderId && doc.folders[folderId] ? folderId : undefined,
    })),
  };
}

/** Keeps the open place's summary; written only when its folders or projects changed. */
export function rememberSummary(placeId: string, doc: Doc) {
  try {
    const text = JSON.stringify(summarize(doc));
    if (localStorage.getItem(key(placeId)) !== text) localStorage.setItem(key(placeId), text);
  } catch {
    // Not remembered: the sidebar offers to open that folder instead.
  }
}

export function placeSummary(placeId: string): PlaceSummary | null {
  try {
    return JSON.parse(localStorage.getItem(key(placeId)) ?? 'null');
  } catch {
    return null;
  }
}

export function forgetSummary(placeId: string) {
  try {
    localStorage.removeItem(key(placeId));
  } catch {
    // Nothing to forget.
  }
}
