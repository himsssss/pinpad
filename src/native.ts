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
}

export interface GoogleToken {
  accessToken: string;
  /** Seconds the access token stays valid. */
  expiresIn: number;
}

/** Google sign-in through the system browser; the refresh token stays in the native shell. */
export interface NativeGoogle {
  signIn(client: GoogleClient): Promise<GoogleToken>;
  /** A fresh access token from the saved sign-in, or null when the user has to sign in again. */
  token(client: GoogleClient): Promise<GoogleToken | null>;
  signOut(): Promise<boolean>;
}

declare global {
  interface Window {
    pinpadNative?: {
      fetchPage(url: string): Promise<PageResponse | null>;
      embedBase?: string;
      storage?: NativeStorage;
      google?: NativeGoogle;
    };
  }
}

export const nativeStorage = () => window.pinpadNative?.storage;
