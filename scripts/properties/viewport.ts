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
}
