import { beginConnect } from '../interactions';

/**
 * Quick-line tool on a card's top-right corner: a small dot that grows and shows an arrow on
 * hover. Dragging from it draws an arrow to another card.
 */
export function ConnectHandle({ id }: { id: string }) {
  return (
    <div
      className="quick-line"
      data-nodrag
      role="button"
      aria-label="Drag to connect to another card"
      title="Drag to connect"
      onPointerDown={(e) => beginConnect(e, id)}
    >
      <span className="quick-line-dot" />
      <svg className="quick-line-arrow" viewBox="0 0 10 10" width="10" height="10" aria-hidden="true">
        <path d="M2 8 7.6 2.4M3.2 2.2h4.6v4.6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}
