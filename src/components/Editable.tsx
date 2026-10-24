import { useLayoutEffect, useRef } from 'react';

interface Props {
  value: string;
  onChange: (value: string) => void;
  editing: boolean;
  /** Rich text keeps HTML (bold, lists...); plain text keeps innerText. */
  rich?: boolean;
  placeholder?: string;
  className?: string;
  onEnter?: () => void;
  onBackspaceEmpty?: () => void;
  /** Runs before the built-in key handling; call preventDefault() to take over a key. */
  onKeyDown?: (e: React.KeyboardEvent<HTMLDivElement>) => void;
  onFocus?: () => void;
  dataId?: string;
}

/** A contentEditable that only becomes editable while its card is being edited. */
export function Editable({ value, onChange, editing, rich, placeholder, className, onEnter, onBackspaceEmpty, onKeyDown, onFocus, dataId }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node || document.activeElement === node) return;
    if (rich) {
      if (node.innerHTML !== value) node.innerHTML = value;
    } else if (node.innerText !== value) node.innerText = value;
  }, [value, rich]);

  return (
    <div
      ref={ref}
      className={`editable ${rich ? 'rich' : ''} ${className ?? ''}`}
      contentEditable={editing}
      suppressContentEditableWarning
      data-editor
      data-placeholder={placeholder}
      data-item-id={dataId}
      spellCheck={editing}
      onInput={(e) => {
        const node = e.currentTarget;
        // Drop the stray <br> browsers leave behind so :empty placeholders reappear.
        if (node.innerText.trim() === '' && !node.querySelector('img,li')) node.innerHTML = '';
        onChange(rich ? node.innerHTML : node.innerText);
      }}
      onPaste={(e) => {
        e.preventDefault();
        const text = e.clipboardData.getData('text/plain');
        document.execCommand('insertText', false, onEnter ? text.replace(/\s*\n\s*/g, ' ') : text);
      }}
      onFocus={onFocus}
      onKeyDown={(e) => {
        onKeyDown?.(e);
        if (e.defaultPrevented) return;
        if (e.key === 'Enter' && onEnter && !e.shiftKey) {
          e.preventDefault();
          onEnter();
        } else if (e.key === 'Backspace' && onBackspaceEmpty && e.currentTarget.innerText.trim() === '') {
          e.preventDefault();
          onBackspaceEmpty();
        }
      }}
    />
  );
}

/** Focuses the editable under a screen point (placing the caret there), else the first one. */
export function focusAtPoint(container: HTMLElement, point: { x: number; y: number } | null) {
  const editables = [...container.querySelectorAll<HTMLElement>('[contenteditable="true"], input')];
  if (!editables.length) return;
  if (point) {
    const range = document.caretRangeFromPoint?.(point.x, point.y);
    const host = range?.startContainer.parentElement?.closest<HTMLElement>('[contenteditable="true"]')
      ?? (range?.startContainer instanceof HTMLElement ? range.startContainer.closest<HTMLElement>('[contenteditable="true"]') : null);
    if (range && host && container.contains(host)) {
      host.focus();
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
      return;
    }
  }
  focusEnd(editables[0]);
}

export function focusEnd(node: HTMLElement | null | undefined) {
  if (!node) return;
  node.focus();
  if (node instanceof HTMLInputElement) return;
  const range = document.createRange();
  range.selectNodeContents(node);
  range.collapse(false);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}
