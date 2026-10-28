import { useState } from 'react';
import { Copy, Eye, Home } from 'lucide-react';
import { saveSharedCopy, useStore } from '../store';

/** Across the top while a shared link is open: what it is, that it's read-only, and Save a copy. */
export function ViewBanner() {
  const viewing = useStore((s) => s.viewing);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!viewing) return null;
  const own = location.href.split('#')[0];
  return (
    <div className="view-banner" role="status">
      <Eye size={16} className="view-banner-icon" />
      <span className="view-banner-text">
        {viewing.error ? viewing.error : <>Viewing <strong>{viewing.name}</strong>, shared with you · read-only</>}
        {error && <span className="view-banner-error"> {error}</span>}
      </span>
      {!viewing.error && (
        <button
          className="view-banner-copy"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              await saveSharedCopy();
            } catch (err) {
              setError(err instanceof Error ? err.message : String(err));
              setBusy(false);
            }
          }}
        >
          <Copy size={14} /> {busy ? 'Copying…' : 'Save a copy'}
        </button>
      )}
      <a className="view-banner-own" href={own}><Home size={14} /> My boards</a>
    </div>
  );
}
