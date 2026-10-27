import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';

/**
 * A thin bar under the logo showing saving: it moves while a save is on its way, fills as
 * Google Drive takes each file, completes and fades once everything is saved, and turns red
 * when saving fails.
 */
export function SaveBar() {
  const saved = useStore((s) => s.saved);
  const progress = useStore((s) => s.saveProgress);
  const failed = useStore((s) => !!s.storageError && !s.storageError.startsWith("Couldn't read changes"));
  const [finishing, setFinishing] = useState(false);
  const wasSaving = useRef(false);

  useEffect(() => {
    if (!saved || progress !== null) {
      wasSaving.current = true;
      return;
    }
    if (!wasSaving.current) return;
    // Just finished: show it full for a moment, then fade.
    wasSaving.current = false;
    setFinishing(true);
    const t = setTimeout(() => setFinishing(false), 900);
    return () => clearTimeout(t);
  }, [saved, progress]);

  const state = failed ? 'failed' : progress !== null ? 'progress' : !saved ? 'busy' : finishing ? 'done' : 'idle';
  const label = failed ? 'Not saved' : state === 'idle' || state === 'done' ? 'All changes saved' : 'Saving…';
  return (
    <div className={`save-bar ${state}`} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress !== null ? Math.round(progress * 100) : undefined}>
      <span style={state === 'progress' ? { width: `${Math.max(6, progress! * 100)}%` } : undefined} />
    </div>
  );
}
