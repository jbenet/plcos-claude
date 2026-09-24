/**
 * The page's height from the window itself (issue 0029, real). On Safari on an iPad, 100dvh came out
 * taller than the page as drawn — the feedback button and the user sat under the bottom edge, in
 * Safari and not in Chrome on the same iPad — while `innerHeight` is the height the page is drawn at
 * (the size the feedback box reports). This runs before first paint, inline in <head>, and again
 * when the window changes size; the stylesheet falls back to 100dvh without it. Not while zoomed
 * in: a pinch shrinks innerHeight, and the rail would shrink with it.
 */
export const VIEWPORT_BOOT = `(function(){var d=document.documentElement;function s(){var v=window.visualViewport;if(v&&v.scale>1.01)return;d.style.setProperty('--app-h',window.innerHeight+'px')}s();window.addEventListener('resize',s);window.addEventListener('orientationchange',s);window.addEventListener('pageshow',s)})();`;
