import type { Check } from './harness';

export async function themeProperties(check: Check) {
  const { DEFAULT_MODE, DEFAULT_THEME, MODE_KEY, THEME_BOOT, THEME_KEY, themeAttr } = await import('../../lib/theme');
  /** Run the boot script against a stub <html>, a stub localStorage and a stub prefers-color-scheme. */
  const boot = (stored: { theme?: string | null; mode?: string | null }, served: string | undefined, systemDark = false) => {
    const attrs = new Map<string, string>(served ? [['data-theme', served]] : []);
    const document = { documentElement: { setAttribute: (k: string, v: string) => attrs.set(k, v), removeAttribute: (k: string) => attrs.delete(k) } };
    const localStorage = { getItem: (k: string) => (k === THEME_KEY ? stored.theme ?? null : k === MODE_KEY ? stored.mode ?? null : null) };
    const listeners: Array<() => void> = [];
    const query = { matches: systemDark, addEventListener: (_: string, f: () => void) => listeners.push(f) };
    const matchMedia = () => query;
    new Function('document', 'localStorage', 'matchMedia', THEME_BOOT)(document, localStorage, matchMedia);
    const flip = (dark: boolean) => { query.matches = dark; for (const f of listeners) f(); };
    return { theme: () => attrs.get('data-theme') ?? 'clay', mode: () => attrs.get('data-mode') ?? 'light', flip };
  };
  const served = themeAttr(DEFAULT_THEME);

  // The default theme is green (issue 0010, real): the page is served with data-theme="green", the
  // boot script takes it away only for a stored choice of clay, and the picker sets what it shows.
  {
    const fresh = boot({}, served).theme(), clay = boot({ theme: 'clay' }, served).theme(), green = boot({ theme: 'green' }, served).theme();
    check('Green is the default theme; a stored choice of clay is applied before first paint, and green stays green',
      DEFAULT_THEME === 'green' && served === 'green' && themeAttr('clay') === undefined && fresh === 'green' && clay === 'clay' && green === 'green',
      `served ${served}; a fresh browser sees ${fresh}; a stored clay sees ${clay}; a stored green sees ${green}`);
  }

  // Issue 0142: light, dark or follow the system, separate from the theme, before first paint.
  {
    const storedDark = boot({ mode: 'dark' }, served, false).mode();
    const storedLight = boot({ mode: 'light' }, served, true).mode();
    const systemDark = boot({ mode: 'system' }, served, true).mode();
    const systemLight = boot({ mode: 'system' }, served, false).mode();
    const freshDark = boot({}, served, true).mode();
    const junk = boot({ mode: 'green' }, served, true).mode();
    const clayDark = boot({ theme: 'clay', mode: 'dark' }, served);
    check('A stored dark, or system with a dark preference, paints dark before first paint; light stays light; the theme is untouched',
      DEFAULT_MODE === 'system' && storedDark === 'dark' && storedLight === 'light' && systemDark === 'dark' && systemLight === 'light'
        && freshDark === 'dark' && junk === 'dark' && clayDark.mode() === 'dark' && clayDark.theme() === 'clay',
      `stored dark ${storedDark}; stored light on a dark system ${storedLight}; system dark ${systemDark}; system light ${systemLight}; nothing stored on a dark system ${freshDark}; an unknown value on a dark system ${junk}; clay + dark ${clayDark.theme()} ${clayDark.mode()}`);

    const follows = boot({ mode: 'system' }, served, false);
    follows.flip(true); const toDark = follows.mode();
    follows.flip(false); const toLight = follows.mode();
    const fixed = boot({ mode: 'light' }, served, false);
    fixed.flip(true); const stays = fixed.mode();
    check('System keeps following the device while the page is open; a fixed choice does not move',
      toDark === 'dark' && toLight === 'light' && stays === 'light',
      `system, device turns dark: ${toDark}; turns light again: ${toLight}; light, device turns dark: ${stays}`);

    let threw = '';
    try { new Function('document', 'localStorage', 'matchMedia', THEME_BOOT)({ documentElement: { setAttribute() {}, removeAttribute() {} } }, { getItem: () => null }, undefined); }
    catch (error) { threw = String(error); }
    check('The boot script survives a browser without matchMedia', threw === '', threw || 'no throw');
  }
}
