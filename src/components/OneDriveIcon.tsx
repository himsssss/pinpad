/** A blue cloud, shown next to where OneDrive is named. */
export function OneDriveIcon({ size = 16 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 16" width={size} height={(size * 2) / 3} aria-hidden="true">
      <path d="M9.6 4.1a5.4 5.4 0 0 1 9.4 1.6A4.2 4.2 0 0 1 23.6 10a4.2 4.2 0 0 1-4.2 4.2H8.2" fill="#0364b8" />
      <path d="M9.6 4.1A6 6 0 0 0 1 9.4a4.8 4.8 0 0 0 4.8 4.8h13.6a4.2 4.2 0 0 0 .4-8.4 5.4 5.4 0 0 0-10.2-1.7z" fill="#1490df" />
      <path d="M5.8 14.2h13.6a4.2 4.2 0 0 0 4.1-3.4l-9.1-3.6L5 12.9c.3.8.5 1.3.8 1.3z" fill="#28a8ea" />
    </svg>
  );
}
