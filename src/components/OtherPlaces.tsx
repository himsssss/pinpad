import { useEffect, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight, Folder, FolderOpen } from 'lucide-react';
import { browse, getState, openBoard, setUI, useStore } from '../store';
import { PLACES_CHANGED, describePlace, listPlaces, openPlace, type Place } from '../places';
import { placeSummary, type PlaceSummary } from '../placeSummaries';
import { chooseForNewPlace } from './PlaceSwitcher';
import { BoardIcon } from './BoardIcon';
import { tell } from './ConfirmDialog';

const isLocal = (p: Place) => p.kind === 'folder' || p.kind === 'webfolder';

/** The other folders on this computer that are connected, besides the open place. */
export function useOtherPlaces() {
  const storageName = useStore((s) => s.storageName);
  const rootId = useStore((s) => s.doc.rootId);
  const [others, setOthers] = useState<Place[]>([]);

  useEffect(() => {
    let alive = true;
    const refresh = () =>
      listPlaces()
        .then(({ places, current }) => alive && setOthers(places.filter((p) => isLocal(p) && p.id !== current)))
        .catch(() => {});
    refresh();
    window.addEventListener(PLACES_CHANGED, refresh);
    return () => {
      alive = false;
      window.removeEventListener(PLACES_CHANGED, refresh);
    };
  }, [storageName, rootId]);

  return others;
}

/**
 * A connected place as a top-level row in the sidebar's one list: the open place holds its
 * folders and projects, the others what they held when last saved here. Folding is remembered.
 */
export function PlaceNode({ id, name, title, icon, current, count, busy, onOpen, children }: {
  id: string; name: string; title: string; icon: ReactNode; current?: boolean; count: number; busy?: boolean;
  onOpen: () => void; children: ReactNode;
}) {
  const collapsed = useStore((s) => s.ui.collapsedSections.includes(`place:${id}`));
  const browsingAll = useStore((s) => s.ui.browsing === '');
  const toggle = () =>
    setUI((u) => ({
      collapsedSections: collapsed ? u.collapsedSections.filter((x) => x !== `place:${id}`) : [...u.collapsedSections, `place:${id}`],
    }));
  return (
    <div className="folder place-node">
      <div className={`folder-row place-row ${current ? 'open-place' : ''} ${current && browsingAll ? 'current' : ''}`}>
        <button className="folder-toggle" aria-label={collapsed ? `Expand ${name}` : `Collapse ${name}`} onClick={toggle}>
          {collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
        </button>
        <span className="sidebar-icon">{icon}</span>
        <span className="folder-name" onClick={busy ? undefined : onOpen} title={title}>
          {busy ? 'Opening…' : name}
        </span>
        {collapsed && count > 0 && <span className="folder-count">{count}</span>}
      </div>
      {!collapsed && <div className="folder-items">{children}</div>}
    </div>
  );
}

/** A connected folder that isn't open: clicking anything in it opens that folder, then what was clicked. */
export function OtherPlace({ place }: { place: Place }) {
  const [summary] = useState<PlaceSummary | null>(() => placeSummary(place.id));
  const [openFolders, setOpenFolders] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const { name, detail } = describePlace(place, false);

  const go = async (then: () => void) => {
    if (busy) return;
    setBusy(true);
    try {
      await openPlace(place, chooseForNewPlace);
      then();
    } catch (err) {
      tell(`Couldn't open “${name}”`, err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  const openProject = (id: string) => go(() => (getState().doc.boards[id] ? openBoard(id) : browse(null)));
  const openFolder = (id: string) => go(() => browse(getState().doc.folders[id] ? id : null));

  const folders = summary?.folders ?? [];
  const childFolders = (parentId?: string) =>
    folders
      .filter((f) => (f.parentId && folders.some((p) => p.id === f.parentId) ? f.parentId : undefined) === parentId)
      .sort((a, b) => a.order - b.order);
  const inFolder = (folderId?: string) =>
    (summary?.projects ?? []).filter((p) => p.folderId === folderId).sort((a, b) => a.title.localeCompare(b.title));
  const totalIn = (folderId: string): number => inFolder(folderId).length + childFolders(folderId).reduce((n, f) => n + totalIn(f.id), 0);

  const projectRow = (p: PlaceSummary['projects'][number]) => (
    <button key={p.id} className="project-row" disabled={busy} onClick={() => openProject(p.id)} title={`${p.title} · opens ${name}`}>
      <BoardIcon icon={p.icon} color={p.color} size={20} />
      <span className="project-name">{p.title || 'Untitled'}</span>
    </button>
  );

  const folderNode = (f: PlaceSummary['folders'][number]) => {
    const expanded = openFolders.has(f.id);
    return (
      <div key={f.id} className="folder">
        <div className="folder-row">
          <button
            className="folder-toggle"
            aria-label={expanded ? 'Collapse folder' : 'Expand folder'}
            onClick={() => setOpenFolders((s) => (s.delete(f.id) ? new Set(s) : new Set(s).add(f.id)))}
          >
            {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          </button>
          <span className="sidebar-icon">{expanded ? <FolderOpen size={15} /> : <Folder size={15} />}</span>
          <span className="folder-name" onClick={() => openFolder(f.id)} title={`Open folder · opens ${name}`}>{f.name}</span>
          <span className="folder-count">{totalIn(f.id)}</span>
        </div>
        {expanded && (
          <div className="folder-items">
            {childFolders(f.id).map(folderNode)}
            {inFolder(f.id).map(projectRow)}
          </div>
        )}
      </div>
    );
  };

  const top = childFolders(undefined);
  const unfiled = inFolder(undefined);

  return (
    <PlaceNode
      id={place.id}
      name={name}
      title={`Open ${name} (${detail})`}
      icon={<Folder size={15} />}
      count={top.length + unfiled.length}
      busy={busy}
      onOpen={() => go(() => browse(null))}
    >
      {!summary ? (
        <p className="sidebar-empty">Open it once to list its projects here.</p>
      ) : top.length + unfiled.length === 0 ? (
        <p className="sidebar-empty">No projects yet.</p>
      ) : (
        <>
          {top.map(folderNode)}
          {unfiled.map(projectRow)}
        </>
      )}
    </PlaceNode>
  );
}
