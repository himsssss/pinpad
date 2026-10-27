/** The app mark: the forest pushpin on a lime square, matching the app icon. */
export function PinpadMark({ size }: { size: number }) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} aria-hidden="true">
      <rect width="32" height="32" rx="7" fill="#9fe870" />
      <g transform="rotate(35 16 16)" fill="#163300">
        <path d="M12 5h8a1.5 1.5 0 0 1 0 3h-8a1.5 1.5 0 0 1 0-3z" />
        <path d="M13.2 8h5.6l1 6.5h-7.6z" />
        <path d="M9.5 14.5h13a1.75 1.75 0 0 1 0 3.5h-13a1.75 1.75 0 0 1 0-3.5z" />
        <path d="M16 18v9.5" stroke="#163300" strokeWidth="1.8" strokeLinecap="round" />
      </g>
    </svg>
  );
}
