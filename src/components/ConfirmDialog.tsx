import { useEffect, useRef, useState } from 'react';
import { AlertTriangle } from 'lucide-react';

interface Ask {
  title: string;
  message: string;
  confirm: string;
  /** A second choice besides confirming, shown between Cancel and the confirm button. */
  alternative?: string;
  /** Red confirm button, for deleting. */
  danger?: boolean;
  resolve: (answer: boolean | 'alternative') => void;
}

let show: ((ask: Ask) => void) | null = null;

/** Shows a warning and resolves true if the user confirms. */
export function askConfirm(options: Omit<Ask, 'resolve' | 'alternative'>): Promise<boolean> {
  return new Promise((resolve) => (show ? show({ ...options, resolve: (a) => resolve(a === true) }) : resolve(confirm(`${options.title}\n\n${options.message}`))));
}

/** Like askConfirm, with a second choice: resolves 'confirm', 'alternative', or null when cancelled. */
export function askChoice(options: Omit<Ask, 'resolve'> & { alternative: string }): Promise<'confirm' | 'alternative' | null> {
  return new Promise((resolve) => {
    if (!show) return resolve(null);
    show({ ...options, resolve: (a) => resolve(a === true ? 'confirm' : a === 'alternative' ? 'alternative' : null) });
  });
}

export function ConfirmDialog() {
  const [ask, setAsk] = useState<Ask | null>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    show = setAsk;
    return () => { show = null; };
  }, []);

  const answer = (ok: boolean | 'alternative') => {
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
          {ask.alternative && <button className="btn-secondary" onClick={() => answer('alternative')}>{ask.alternative}</button>}
          <button ref={confirmRef} className={`btn-primary ${ask.danger ? 'danger' : ''}`} onClick={() => answer(true)}>{ask.confirm}</button>
        </div>
      </div>
    </div>
  );
}
