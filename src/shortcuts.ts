/** Modifier labels for shortcut hints: ⌘ on Apple platforms, Ctrl elsewhere (Windows). */
const isMac = /Mac|iPhone|iPad/.test(navigator.platform);

export const MOD = isMac ? '⌘' : 'Ctrl+';
export const SHIFT = isMac ? '⇧' : 'Shift+';
