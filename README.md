# Pinpad

A visual board app for collecting and arranging ideas: notes, to-dos, links, images, tables,
drawings and nested boards on an infinite canvas, organized into folders. It runs in the
browser, as a native macOS app, and as a Windows app. Everything is stored locally on your
device.

![Pinpad home board](docs/screenshot.png)

## Try it

Open **[pinpad-taupe.vercel.app](https://pinpad-taupe.vercel.app/)** to use Pinpad in your browser. Boards
are saved in that browser, or in your Google Drive; the desktop apps save them as files you can back up.

## Download

Get the latest build from the [Releases](../../releases) page:

- **macOS** (Apple silicon and Intel, macOS 13.3+): `Pinpad-<version>-mac.zip`. Unzip and
  move `Pinpad.app` to Applications. The app isn't notarized, so the first time, right-click
  it and choose **Open**.
- **Windows** (10/11): `Pinpad-Setup-<version>-x64.exe` for most PCs,
  `Pinpad-Setup-<version>-arm64.exe` for Windows on ARM. The installer isn't code-signed, so
  SmartScreen will warn; choose **More info → Run anyway**.

## Features

- **Cards:** rich-text notes, to-do lists, links, images, comments, tables and freehand
  drawings; click to edit, drag to move, resize from the right edge
- **Boards inside boards:** double-click a board to open it; drop cards onto a board tile to
  move them in
- **Columns** to stack related cards, and **lines** that connect cards and follow them
- **Folders sidebar** with subfolders; drag projects between folders
- Pan, zoom, marquee select, undo/redo, copy/paste, and search across every board (Ctrl/⌘ K)
- Export and import your whole workspace as JSON, or export a board as a PNG image or PDF
- Templates for empty boards: moodboard, kanban, weekly plan, brainstorm, storyboard
- Snap guides while dragging, and align or spread out selected cards (right-click menu)
- Installable website: add it to your phone's home screen, open it offline, and share links
  into it from other apps
- **Storage folder (desktop apps):** each board is saved as its own JSON file, with a folder
  per project (inside its sidebar folder), in Documents/Pinpad or any folder you choose under
  ⚙ → Storage location. A synced folder works as a backup.
- **Google Drive:** the same files in "My Drive/Pinpad", on the website and the desktop apps.
- **Two-way sync:** rename, move or delete a folder or board file in Finder, File Explorer or
  Google Drive and Pinpad follows when it's back in focus (or within 30 seconds); boards
  edited on another computer update too.

## Development

Requires Node.js 22+.

```bash
npm install
npm run dev          # web app at http://localhost:3000
npm run build        # production web build in dist/
```

### Desktop apps

```bash
npm run build:mac    # build/Pinpad.app (needs Xcode command line tools, run on a Mac)
npm run install:mac  # copy it into /Applications
npm run build:win    # Windows installers in release/ (Electron; can be built on macOS)
npm run desktop      # run the Electron shell locally
```

The website is hosted on Vercel. To publish it, build it without the desktop client's secret
and deploy the folder:

```bash
VITE_GOOGLE_DESKTOP_CLIENT_SECRET= npx vite build --outDir web-deploy/pinpad
cd web-deploy/pinpad && npx vercel deploy --prod
```

The macOS app is a small Swift/AppKit wrapper around a WebKit view (`macos/`); the Windows
app uses Electron (`desktop/`). Both load the same web build from inside the app bundle.

## Google Drive

The Storage location dialog can save boards to Google Drive (in "My Drive/Pinpad"). It needs
OAuth clients from a Google Cloud project you own:

1. In the [Google Cloud console](https://console.cloud.google.com), create a project and enable
   the **Google Drive API**.
2. Under **Google Auth Platform**, set up the consent screen (External audience). Pinpad only
   asks for the `drive.file` scope (files it creates itself), which Google doesn't treat as
   sensitive.
3. Create a **Web application** client with these authorized JavaScript origins:
   `https://pinpad-taupe.vercel.app`, `http://localhost:5180` (dev) and `http://localhost:4173`
   (preview), and list them in `VITE_GOOGLE_WEB_ORIGINS`.
4. Create a **Desktop app** client for the Mac and Windows apps.
5. Copy `.env.example` to `.env.local` and fill in the ids (and the desktop client's secret).
   For the website build, also put `VITE_GOOGLE_WEB_CLIENT_ID=...` in a committed `.env`
   file; client ids aren't secret.

## Project layout

```
src/            React + TypeScript web app (Vite)
  components/   canvas, toolbar, sidebar, cards
  store.ts      state, undo history, persistence (IndexedDB, plus board files on desktop)
  workspaceFiles.ts  how the workspace is laid out as files on disk
  driveStorage.ts    the same files kept in Google Drive (googleAuth.ts signs in)
  native.ts     what the desktop apps expose to the page
macos/          native macOS shell, icon generator, build/install scripts
desktop/        Electron shell and Windows icons
```

## Credits

Pinpad is an independent project inspired by [Milanote](https://milanote.com). Its layout and
visual style follow a design system modeled on [Miro](https://miro.com)'s design language.
Pinpad isn't affiliated with or endorsed by either company.

## License

[MIT](LICENSE)
