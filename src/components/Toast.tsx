import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';

let show: ((text: string) => void) | null = null;

/** A short note at the bottom of the screen that something worked ("Link copied"). */
export const notify = (text: string) => show?.(text);

export function Toast() {
  const [note, setNote] = useState<{ text: string; key: number } | null>(null);

  useEffect(() => {
    show = (text) => setNote({ text, key: Date.now() });
    return () => {
      show = null;
    };
  }, []);

  useEffect(() => {
    if (!note) return;
    const t = setTimeout(() => setNote(null), 2200);
    return () => clearTimeout(t);
  }, [note]);

  if (!note) return null;
  return (
    <div key={note.key} className="toast" role="status">
      <Check size={15} /> {note.text}
    </div>
  );
}
