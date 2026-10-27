import type { Listed } from './workspaceFiles';

/**
 * What the desktop apps add to the page as `window.pinpadNative` (macos/main.swift and
 * desktop/preload.cjs). The plain web build has none of it and falls back to browser-only
 * behavior.
 */

export interface PageResponse {
  url: string;
  html: string;
}

export interface StorageLocation {
  /** Folder holding the workspace. */
  folder: string;
  /** Full path of the workspace index (Pinpad Workspace.json) inside it. */
  file: string;
  defaultFolder: string;
  isDefault: boolean;
  /** Whether the index has been written yet. */
  exists: boolean;
}

/** One save: files to write in order, files whose content now lives elsewhere, files to trash. */
export interface StorageBatch {
  write: [path: string, text: string][];
  /** Old paths of renamed or moved boards; their content was just written under the new path. */
  remove: string[];
  /** Files of deleted boards; they go to the Trash (Recycle Bin), not straight to deletion. */
  trash: string[];
}

/**
 * The workspace kept as files in a folder the user chooses (layout in workspaceFiles.ts).
 * Paths are relative to that folder, with / separators.
 */
export interface NativeStorage {
  location(): Promise<StorageLocation>;
  inspect(folder: string): Promise<{ hasWorkspace: boolean }>;
  /** Each file's text, or null for a file that doesn't exist. */
  read(paths: string[]): Promise<Record<string, string | null>>;
  write(batch: StorageBatch): Promise<boolean>;
  /** Every board file (.json) and folder in the storage folder, to notice changes made outside Pinpad. */
  list(): Promise<Listed[]>;
  /** Saves an attached file (base64) at Attachments/<name>. */
  writeFile(file: { path: string; data: string }): Promise<boolean>;
  /** An attached file as base64, or null when it isn't there. */
  readFile(path: string): Promise<string | null>;
  /** Moves an attached file (making folders as needed); false when there's nothing at `from`. */
  moveFile(move: { from: string; to: string }): Promise<boolean>;
  /** Sends an attached file to the system trash. */
  trashFile(path: string): Promise<boolean>;
  /** Shows the system folder picker; null when cancelled. */
  choose(): Promise<string | null>;
  /** Switches to a folder (null for the default) without moving any files. */
  use(folder: string | null): Promise<StorageLocation>;
  reveal(): Promise<boolean>;
}

/** OAuth client of the desktop apps (an "installed app" client, whose secret isn't confidential). */
export interface GoogleClient {
  clientId: string;
  clientSecret: string;
  /** Which connected account's saved sign-in to use. */
  account?: string;
}

export interface GoogleToken {
  accessToken: string;
  /** Seconds the access token stays valid. */
  expiresIn: number;
}

/** Google sign-in through the system browser; the refresh token stays in the native shell. */
export interface NativeGoogle {
  /** Also tells which account signed in (its sign-in is saved under that account). */
  signIn(client: GoogleClient): Promise<GoogleToken & { account?: string | null }>;
  /** A fresh access token from the saved sign-in, or null when the user has to sign in again. */
  token(client: GoogleClient): Promise<GoogleToken | null>;
  signOut(options?: { account?: string }): Promise<boolean>;
}

/** Microsoft sign-in through the system browser, like NativeGoogle (for OneDrive). */
export interface NativeMicrosoft {
  signIn(client: { clientId: string }): Promise<GoogleToken & { account?: string | null }>;
  token(client: { clientId: string; account?: string }): Promise<GoogleToken | null>;
  signOut(options?: { account?: string }): Promise<boolean>;
}

declare global {
  interface Window {
    pinpadNative?: {
      fetchPage(url: string): Promise<PageResponse | null>;
      embedBase?: string;
      storage?: NativeStorage;
      google?: NativeGoogle;
      microsoft?: NativeMicrosoft;
    };
  }
}

export const nativeStorage = () => window.pinpadNative?.storage;
