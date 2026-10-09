/**
 * Themes.
 *
 * A theme re-points the chrome — the accent, the ground, the rail. It never re-points a
 * colour that carries a meaning: clay still means refused, green still means passed,
 * amber still means needs a look. Otherwise a reader who learned the palette on one
 * theme would be wrong on the other, which is worse than having no themes at all.
 *
 * Light or dark is a separate choice (the mode, below). Dark does move the meaning colours, to
 * lighter steps of the same hues, because the dark ground needs them; it never swaps one meaning
 * for another.
 */
export type ThemeId = 'clay' | 'green';

export const THEMES: Array<{
  id: ThemeId;
  name: string;
  blurb: string;
  /** Accent, ground, rail — the three the theme actually changes. */
  swatch: [string, string, string];
}> = [
  {
    id: 'clay',
    name: 'Clay',
    blurb: 'The design boards as drawn. Warm paper ground, near-black rail, terracotta accent.',
    swatch: ['#BF4A16', '#F5F3EE', '#1A1917'],
  },
  {
    id: 'green',
    name: 'Green',
    blurb: "Protocol Labs' own colour through the chrome. Cool paper ground, deep green rail.",
    swatch: ['#1E8F5E', '#F1F4F0', '#11251D'],
  },
];

export const THEME_KEY = 'capitalos.theme';
/** Green since 24 Sep 2026 (issue 0010, real: "so the changelog shows the green theme too"). */
export const DEFAULT_THEME: ThemeId = 'green';

/**
 * Light or dark (issue 0142). A mode, separate from the theme: clay and green each have a light and
 * a dark. "System" follows the operating system's setting and keeps following it while the page is
 * open. Kept in this browser like the theme; the default is to follow the system.
 */
export type ColourMode = 'light' | 'dark' | 'system';

export const MODES: Array<{
  id: ColourMode;
  name: string;
  blurb: string;
  /** Ground and ink, as a picture of the mode — the same in every mode, like the theme swatches. */
  swatch: string[];
}> = [
  { id: 'light', name: 'Light', blurb: 'Dark text on a paper ground, as the design boards are drawn.', swatch: ['#F5F3EE', '#1A1917'] },
  { id: 'dark', name: 'Dark', blurb: 'Light text on a dark ground. The same meanings, in brighter steps.', swatch: ['#161513', '#ECE8DF'] },
  { id: 'system', name: 'System', blurb: "Follows this device's setting, and changes when it does.", swatch: ['#F5F3EE', '#1A1917', '#161513', '#ECE8DF'] },
];

export const MODE_KEY = 'capitalos.mode';
export const DEFAULT_MODE: ColourMode = 'system';
export const DARK_QUERY = '(prefers-color-scheme: dark)';

export const isColourMode = (v: unknown): v is ColourMode => v === 'light' || v === 'dark' || v === 'system';

/** Whether a mode paints dark, given whether the system prefers dark. */
export const resolvesDark = (mode: ColourMode, systemDark: boolean): boolean =>
  mode === 'dark' || (mode === 'system' && systemDark);

/**
 * Put a mode on <html>: data-mode="dark" for dark, no attribute for light. The picker's side of
 * what THEME_BOOT does before first paint.
 */
export function applyMode(mode: ColourMode): void {
  let systemDark = false;
  try { systemDark = window.matchMedia(DARK_QUERY).matches; } catch { /* no matchMedia: light */ }
  if (resolvesDark(mode, systemDark)) document.documentElement.setAttribute('data-mode', 'dark');
  else document.documentElement.removeAttribute('data-mode');
}

/**
 * The page is served in the default theme (`data-theme="green"` on <html>; clay is the stylesheet's
 * base, with no attribute) and in light (no `data-mode`). This runs before first paint, inline in
 * <head>, and applies a stored choice of clay and a dark mode: without it the page renders green and
 * light and then swaps, a flash of the wrong colour on every navigation.
 *
 * For "system" (or nothing stored) it asks prefers-color-scheme, and listens: when the system turns
 * dark or light while the page is open, the page follows, unless a fixed mode has been stored since.
 * The listener lives as long as the document, which in this app is the whole session.
 */
export const THEME_BOOT = `(function(){try{var t=localStorage.getItem(${JSON.stringify(THEME_KEY)});if(t==='clay')document.documentElement.removeAttribute('data-theme');else if(t==='green')document.documentElement.setAttribute('data-theme','green');}catch(e){}try{var K=${JSON.stringify(MODE_KEY)};var m=function(){var s=null;try{s=localStorage.getItem(K);}catch(e){}return s==='light'||s==='dark'?s:'system';};var q=typeof matchMedia==='function'?matchMedia(${JSON.stringify(DARK_QUERY)}):null;var apply=function(){var s=m();if(s==='dark'||(s==='system'&&!!(q&&q.matches)))document.documentElement.setAttribute('data-mode','dark');else document.documentElement.removeAttribute('data-mode');};apply();if(q){var on=function(){if(m()==='system')apply();};if(q.addEventListener)q.addEventListener('change',on);else if(q.addListener)q.addListener(on);}}catch(e){}})();`;

/** The <html> attribute for a theme: clay is the stylesheet's base, so it has none. */
export const themeAttr = (id: ThemeId): string | undefined => (id === 'clay' ? undefined : id);
