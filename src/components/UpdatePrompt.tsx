import { useEffect, useState } from 'react';
import { Sparkles, X } from 'lucide-react';
import { onUpdateReady, updateNow, updateReady } from '../serviceWorker';

/** "A new version is ready", once the website's next version has downloaded in the background. */
export function UpdatePrompt() {
  const [ready, setReady] = useState(updateReady);
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => onUpdateReady(() => setReady(true)), []);
  if (!ready || dismissed) return null;
  return (
    <div className="update-prompt" role="status">
      <Sparkles size={16} className="update-prompt-icon" />
      <span>A new version of Pinpad is ready.</span>
      <button className="update-prompt-go" onClick={() => updateNow()}>Update</button>
      <button className="update-prompt-close" onClick={() => setDismissed(true)} aria-label="Later" title="Later (updates next time you open Pinpad)"><X size={14} /></button>
    </div>
  );
}
