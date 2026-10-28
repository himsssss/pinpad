/**
 * The places this device keeps boards in, for the switcher under the logo: each connected
 * Google account's Drive and Microsoft account's OneDrive, each folder used on this computer (desktop apps), and this
 * browser (website). One is open at a time and each has its own folders and projects.
 */

import { browserHasBoards, cloudInUse, flushNow, setOpening, switchStorage, usingDrive, usingOneDrive, usingWebFolder, getState } from './store';
import { chooseWebFolder, currentWebFolder, forgetWebFolder, webFolderHasWorkspace, webFolders, webFoldersSupported } from './webFolderStorage';
import { nativeStorage } from './native';
import { driveStorage } from './driveStorage';
import { oneDriveStorage } from './oneDriveStorage';
import {
  ensureMicrosoftAccount, microsoftAccount, microsoftAccounts, microsoftAllowedHere, microsoftConfigured, microsoftSignIn,
  microsoftSignOut, useMicrosoftAccount,
} from './microsoftAuth';
import { ensureAccount, googleAccount, googleAccounts, googleAllowedHere, googleConfigured, signIn, signOut, useAccount } from './googleAuth';

export type Place =
  | { id: string; kind: 'drive'; account: string }
  | { id: string; kind: 'onedrive'; account: string }
  | { id: string; kind: 'folder'; folder: string; isDefault: boolean }
  /** A folder on this computer picked on the website (Chrome and Edge). */
  | { id: string; kind: 'webfolder'; folderId: string; name: string }
  | { id: string; kind: 'browser' };

const FOLDERS_KEY = 'pinpad:folders';

function savedFolders(): string[] {
  try {
    return JSON.parse(localStorage.getItem(FOLDERS_KEY) ?? '[]');
  } catch {
    return [];
  }
}

function saveFolders(list: string[]) {
  try {
    localStorage.setItem(FOLDERS_KEY, JSON.stringify([...new Set(list)]));
  } catch {
    // The list just isn't remembered.
  }
}

/** Every place, and which one is open. */
export async function listPlaces(): Promise<{ places: Place[]; current: string }> {
  const places: Place[] = [];
  const native = nativeStorage();
  let current = 'browser';
  if (native) {
    const loc = await native.location();
    // The open folder joins the list, so it's still there after switching away from it.
    if (loc.folder !== loc.defaultFolder && !savedFolders().includes(loc.folder)) saveFolders([...savedFolders(), loc.folder]);
    const folders = [loc.defaultFolder, ...savedFolders()].filter((f, i, all) => all.indexOf(f) === i);
    for (const folder of folders) places.push({ id: `folder:${folder}`, kind: 'folder', folder, isDefault: folder === loc.defaultFolder });
    if (!cloudInUse()) current = `folder:${loc.folder}`;
  } else {
    // Where folders can be chosen they replace "This browser", which only shows while it's
    // still in use (before a folder is chosen).
    if (!webFoldersSupported() || (!cloudInUse() && !usingWebFolder())) places.push({ id: 'browser', kind: 'browser' });
    if (webFoldersSupported()) {
      for (const f of await webFolders()) places.push({ id: `webfolder:${f.id}`, kind: 'webfolder', folderId: f.id, name: f.name });
      if (usingWebFolder()) current = `webfolder:${currentWebFolder()!.id}`;
    }
  }
  if (googleConfigured()) {
    for (const account of googleAccounts()) places.push({ id: `drive:${account}`, kind: 'drive', account });
    if (usingDrive() && googleAccount()) current = `drive:${googleAccount()}`;
  }
  if (microsoftConfigured()) {
    for (const account of microsoftAccounts()) places.push({ id: `onedrive:${account}`, kind: 'onedrive', account });
    if (usingOneDrive() && microsoftAccount()) current = `onedrive:${microsoftAccount()}`;
  }
  return { places, current };
}

/** What to do when a place has no Pinpad boards yet: start empty, or copy the open boards there. */
export type NewPlaceChoice = (placeName: string) => Promise<'fresh' | 'replace' | null>;

/** Opens a place. Called from a click (the website may need Google's popup). */
export async function openPlace(place: Place, choose: NewPlaceChoice) {
  const cloud = place.kind === 'drive' ? 'Google Drive' : place.kind === 'onedrive' ? 'OneDrive' : null;
  if (cloud) setOpening(`Opening your ${cloud}…`);
  try {
    await open(place, choose);
  } finally {
    if (cloud) setOpening(null);
  }
}

async function open(place: Place, choose: NewPlaceChoice) {
  // Unsaved changes go to the place they were made in, before anything switches.
  await flushNow();
  if (place.kind === 'drive') {
    await ensureAccount(place.account);
    useAccount(place.account);
    driveStorage.reset();
    if (await driveStorage.hasWorkspace()) return switchStorage({ kind: 'drive' }, 'open');
    setOpening(null);
    const keep = await choose('this Google Drive');
    if (keep) await switchStorage({ kind: 'drive' }, keep);
    return;
  }
  if (place.kind === 'onedrive') {
    await ensureMicrosoftAccount(place.account);
    useMicrosoftAccount(place.account);
    oneDriveStorage.reset();
    if (await oneDriveStorage.hasWorkspace()) return switchStorage({ kind: 'onedrive' }, 'open');
    setOpening(null);
    const keep = await choose('this OneDrive');
    if (keep) await switchStorage({ kind: 'onedrive' }, keep);
    return;
  }
  if (place.kind === 'folder') {
    const native = nativeStorage()!;
    const folder = place.isDefault ? null : place.folder;
    if ((await native.inspect(place.folder)).hasWorkspace) return switchStorage({ kind: 'folder', folder }, 'open');
    const keep = await choose('this folder');
    if (keep) await switchStorage({ kind: 'folder', folder }, keep);
    return;
  }
  if (place.kind === 'webfolder') {
    // Asks the browser for permission if needed, so this runs from a click.
    const target = { kind: 'webfolder' as const, id: place.folderId, name: place.name };
    if (await webFolderHasWorkspace(place.folderId)) return switchStorage(target, 'open');
    const keep = await choose(`the “${place.name}” folder`);
    if (keep) await switchStorage(target, keep);
    return;
  }
  if (await browserHasBoards()) return switchStorage({ kind: 'browser' }, 'open');
  const keep = await choose('this browser');
  if (keep) await switchStorage({ kind: 'browser' }, keep);
}

/** Connects another Google account (Google lets the user pick which) and opens its Drive. */
export async function addGoogleDrive(choose: NewPlaceChoice) {
  if (!googleAllowedHere()) throw new Error('Google sign-in only works on the Pinpad website and its registered addresses.');
  const account = await signIn(true);
  if (!account) throw new Error("Couldn't tell which Google account signed in");
  await openPlace({ id: `drive:${account}`, kind: 'drive', account }, choose);
}

/** Connects a Microsoft account (Microsoft lets the user pick which) and opens its OneDrive. */
export async function addOneDrive(choose: NewPlaceChoice) {
  if (!microsoftAllowedHere()) throw new Error('Microsoft sign-in only works on the Pinpad website and its registered addresses.');
  const account = await microsoftSignIn();
  await openPlace({ id: `onedrive:${account}`, kind: 'onedrive', account }, choose);
}

/** Picks a folder on this computer from the website (Chrome and Edge) and opens it. */
export async function addWebFolder(choose: NewPlaceChoice) {
  const folder = await chooseWebFolder();
  if (folder) await openPlace({ id: `webfolder:${folder.id}`, kind: 'webfolder', folderId: folder.id, name: folder.name }, choose);
}

/** Adds a folder on this computer (desktop apps) and opens it. */
export async function addFolder(choose: NewPlaceChoice) {
  const native = nativeStorage();
  const folder = await native?.choose();
  if (!native || !folder) return;
  saveFolders([...savedFolders(), folder]);
  const loc = await native.location();
  await openPlace({ id: `folder:${folder}`, kind: 'folder', folder, isDefault: folder === loc.defaultFolder }, choose);
}

/** Takes a place off the list: signs a Google account out, or forgets a folder (its files stay). */
export async function removePlace(place: Place) {
  if (place.kind === 'drive') await signOut(place.account);
  if (place.kind === 'onedrive') await microsoftSignOut(place.account);
  if (place.kind === 'webfolder') await forgetWebFolder(place.folderId);
  if (place.kind === 'folder') saveFolders(savedFolders().filter((f) => f !== place.folder));
}

/** A short name and a detail line for a place. */
export function describePlace(place: Place, current: boolean) {
  if (place.kind === 'drive') {
    return { name: (current && getState().storageName) || 'Google Drive', detail: place.account };
  }
  if (place.kind === 'onedrive') {
    return { name: 'OneDrive', detail: place.account };
  }
  if (place.kind === 'webfolder') {
    return { name: place.name, detail: 'Folder on this computer' };
  }
  if (place.kind === 'folder') {
    const name = place.folder.split(/[\\/]/).filter(Boolean).pop() ?? place.folder;
    return { name, detail: place.isDefault ? 'Default folder on this computer' : place.folder };
  }
  if (webFoldersSupported()) return { name: 'Not saved to a folder yet', detail: 'Kept in this browser until you choose a folder' };
  return { name: 'This browser', detail: 'Saved only on this device' };
}

/**
 * Signs in again as the account in use after its sign-in ran out, so its boards open where
 * they were. The desktop apps renew it silently; when Google or Microsoft no longer accept
 * that, they sign in from scratch.
 */
export async function signInAgain(service: 'google' | 'microsoft', account: string | null) {
  const again = service === 'google' ? () => signIn() : () => microsoftSignIn();
  if (!account) return void (await again());
  try {
    await (service === 'google' ? ensureAccount(account) : ensureMicrosoftAccount(account));
  } catch (err) {
    if (!window.pinpadNative) throw err;
    await again();
  }
}
