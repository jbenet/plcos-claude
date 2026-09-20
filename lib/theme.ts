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
export const DEFAULT_THEME: ThemeId = 'clay';

/**
 * Runs before first paint, inline in <head>. Without it the page renders in the default
 * theme and then swaps, which is a flash of the wrong colour on every navigation.
 */
export const THEME_BOOT = `(function(){try{var t=localStorage.getItem(${JSON.stringify(THEME_KEY)});if(t==='green')document.documentElement.setAttribute('data-theme',t);}catch(e){}})();`;
