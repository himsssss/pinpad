import { useEffect, useRef, useState } from 'react';
import { AlertTriangle } from 'lucide-react';

interface Ask {
  title: string;
  message: string;
  confirm: string;
  /** Red confirm button, for deleting. */
  danger?: boolean;
  resolve: (ok: boolean) => void;
}

let show: ((ask: Ask) => void) | null = null;

/** Shows a warning and resolves true if the user confirms. */
export function askConfirm(options: Omit<Ask, 'resolve'>): Promise<boolean> {
  return new Promise((resolve) => (show ? show({ ...options, resolve }) : resolve(confirm(`${options.title}\n\n${options.message}`))));
}

export function ConfirmDialog() {
  const [ask, setAsk] = useState<Ask | null>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    show = setAsk;
    return () => { show = null; };
  }, []);

  const answer = (ok: boolean) => {
    ask?.resolve(ok);
    setAsk(null);
  };

  useEffect(() => {
    if (!ask) return;
    confirmRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        answer(false);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [ask]);

  if (!ask) return null;
  return (
    <div className="search-backdrop confirm-backdrop" onPointerDown={() => answer(false)}>
      <div className="dialog confirm-dialog" role="alertdialog" aria-labelledby="confirm-title" aria-describedby="confirm-text" onPointerDown={(e) => e.stopPropagation()}>
        <div className={`confirm-icon ${ask.danger ? 'danger' : ''}`}><AlertTriangle size={20} /></div>
        <h2 id="confirm-title">{ask.title}</h2>
        <p id="confirm-text" className="dialog-text">{ask.message}</p>
        <div className="dialog-actions">
          <button className="btn-secondary" onClick={() => answer(false)}>Cancel</button>
          <button ref={confirmRef} className={`btn-primary ${ask.danger ? 'danger' : ''}`} onClick={() => answer(true)}>{ask.confirm}</button>
        </div>
      </div>
    </div>
  );
}
