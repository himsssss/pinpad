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
  /** Folder holding the workspace file. */
  folder: string;
  /** Full path of the workspace file inside it. */
  file: string;
  defaultFolder: string;
  isDefault: boolean;
  /** Whether the workspace file has been written yet. */
  exists: boolean;
}

/** The workspace kept as a JSON file in a folder the user chooses. */
export interface NativeStorage {
  location(): Promise<StorageLocation>;
  inspect(folder: string): Promise<{ hasWorkspace: boolean }>;
  /** The workspace file's text, or null when there's no file yet. */
  read(): Promise<string | null>;
  write(text: string): Promise<boolean>;
  /** Shows the system folder picker; null when cancelled. */
  choose(): Promise<string | null>;
  /** Switches to a folder (null for the default) without moving any files. */
  use(folder: string | null): Promise<StorageLocation>;
  reveal(): Promise<boolean>;
}

declare global {
  interface Window {
    pinpadNative?: {
      fetchPage(url: string): Promise<PageResponse | null>;
      embedBase?: string;
      storage?: NativeStorage;
    };
  }
}

export const nativeStorage = () => window.pinpadNative?.storage;
