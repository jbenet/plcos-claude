/**
 * Themes.
 *
 * A theme re-points the chrome — the accent, the ground, the rail. It never re-points a
 * colour that carries a meaning: clay still means refused, green still means passed,
 * amber still means needs a look. Otherwise a reader who learned the palette on one
 * theme would be wrong on the other, which is worse than having no themes at all.
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
 * The page is served in the default theme (`data-theme="green"` on <html>; clay is the stylesheet's
 * base, with no attribute). This runs before first paint, inline in <head>, and applies a stored
 * choice of clay: without it the page renders green and then swaps, a flash of the wrong colour on
 * every navigation.
 */
export const THEME_BOOT = `(function(){try{var t=localStorage.getItem(${JSON.stringify(THEME_KEY)});if(t==='clay')document.documentElement.removeAttribute('data-theme');else if(t==='green')document.documentElement.setAttribute('data-theme','green');}catch(e){}})();`;

/** The <html> attribute for a theme: clay is the stylesheet's base, so it has none. */
export const themeAttr = (id: ThemeId): string | undefined => (id === 'clay' ? undefined : id);
