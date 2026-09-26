import type { Check } from './harness';

export async function themeProperties(check: Check) {
  // The default theme is green (issue 0010, real): the page is served with data-theme="green", the
  // boot script takes it away only for a stored choice of clay, and the picker sets what it shows.
  {
    const { DEFAULT_THEME, THEME_BOOT, themeAttr } = await import('../../lib/theme');
    const boot = (stored: string | null, served: string | undefined) => {
      const attrs = new Map<string, string>(served ? [['data-theme', served]] : []);
      const document = { documentElement: { setAttribute: (k: string, v: string) => attrs.set(k, v), removeAttribute: (k: string) => attrs.delete(k) } };
      const localStorage = { getItem: () => stored };
      new Function('document', 'localStorage', THEME_BOOT)(document, localStorage);
      return attrs.get('data-theme') ?? 'clay';
    };
    const served = themeAttr(DEFAULT_THEME);
    const fresh = boot(null, served), clay = boot('clay', served), green = boot('green', served);
    check('Green is the default theme; a stored choice of clay is applied before first paint, and green stays green',
      DEFAULT_THEME === 'green' && served === 'green' && themeAttr('clay') === undefined && fresh === 'green' && clay === 'clay' && green === 'green',
      `served ${served}; a fresh browser sees ${fresh}; a stored clay sees ${clay}; a stored green sees ${green}`);
  }
}
