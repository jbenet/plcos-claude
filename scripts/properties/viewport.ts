import type { Check } from './harness';

export async function viewportProperties(check: Check) {
  {
    // Issue 0029 (real): the rail is as tall as the window, measured, not as 100dvh says.
    const { VIEWPORT_BOOT } = await import('../../lib/viewport');
    const props = new Map<string, string>();
    const listeners: string[] = [];
    const window = { innerHeight: 892, visualViewport: { scale: 1 }, addEventListener: (e: string) => listeners.push(e) };
    const document = { documentElement: { style: { setProperty: (k: string, v: string) => props.set(k, v) } } };
    new Function('window', 'document', VIEWPORT_BOOT)(window, document);
    const zoomed = new Map<string, string>();
    new Function('window', 'document', VIEWPORT_BOOT)(
      { innerHeight: 400, visualViewport: { scale: 2 }, addEventListener: () => {} },
      { documentElement: { style: { setProperty: (k: string, v: string) => zoomed.set(k, v) } } },
    );
    check('The page height comes from the window before first paint, follows it when it changes, and ignores a pinch',
      props.get('--app-h') === '892px' && listeners.includes('resize') && listeners.includes('orientationchange') && !zoomed.has('--app-h'),
      `--app-h ${props.get('--app-h') ?? 'unset'}; listens for ${listeners.join(', ')}; zoomed in: ${zoomed.get('--app-h') ?? 'left alone'}`);
  }
  {
    // Issue 0090: the phone and narrow-tablet shell. The stylesheet's widths are the script's, and
    // outside its media queries it touches no shared class, so the desktop layout cannot move.
    const { readFileSync } = await import('node:fs');
    const { PHONE_MAX, PANE_MAX } = await import('../../lib/viewport');
    const css = readFileSync('components/shell/Shell.module.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const widths = [...css.matchAll(/@media[^{]*max-width:\s*(\d+)px/g)].map((m) => Number(m[1]));
    const allowed = new Set([PHONE_MAX, PANE_MAX]);
    let outside = '';
    for (let i = 0; i < css.length; i++) {
      if (css.startsWith('@media', i)) {
        let depth = 0;
        for (let j = css.indexOf('{', i); j < css.length; j++) {
          if (css[j] === '{') depth++;
          else if (css[j] === '}' && --depth === 0) { i = j; break; }
        }
        continue;
      }
      outside += css[i];
    }
    const shared = outside.match(/:global\([^)]*\)/g) ?? [];
    check('The shell folds by width at the numbers the script uses (issue 0090), and above them its stylesheet leaves every shared class alone',
      PHONE_MAX < PANE_MAX && widths.length > 0 && widths.every((w) => allowed.has(w)) && widths.includes(PHONE_MAX) && widths.includes(PANE_MAX) && shared.length === 0,
      `phone ≤${PHONE_MAX}px, pane ≤${PANE_MAX}px; media widths ${[...new Set(widths)].join(', ')}; shared classes outside a media query: ${shared.join(', ') || 'none'}`);
  }
  {
    // Issue 0090: Tab never leaves an open sheet, and comes in from outside at the right end.
    const { nextFocusIndex } = await import('../../lib/viewport');
    const bad: string[] = [];
    for (let n = 1; n <= 6; n++) {
      for (let i = -1; i < n; i++) {
        for (const back of [false, true]) {
          const next = nextFocusIndex(n, i, back);
          const want = i < 0 ? (back ? n - 1 : 0) : back ? (i === 0 ? n - 1 : i - 1) : (i === n - 1 ? 0 : i + 1);
          if (next !== want) bad.push(`${n}/${i}/${back ? 'back' : 'fwd'} → ${next}`);
        }
      }
    }
    if (nextFocusIndex(0, -1, false) !== null) bad.push('empty sheet');
    check('Tab and Shift+Tab wrap inside an open sheet, enter it from outside at the first or last control, and hold on the sheet when it has none (issue 0090)',
      bad.length === 0, bad.length ? bad.slice(0, 5).join('; ') : 'every count 1–6, every position, both directions');
  }
}
