/**
 * What to do when a server action call throws instead of returning (issue 0116). A page left open
 * across a server restart (an iPad tab that slept overnight) can no longer reach the server's
 * actions; every call then throws. Reload such a page once, so the next try works; otherwise show
 * the server's own message rather than a generic one.
 */
const STALE = /server action|failed to fetch|load failed|networkerror|network error|unexpected response|not found|fetch/i;
const KEY = 'plcos:action-reload';

export function actionFailure(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : '';
  if (typeof window !== 'undefined' && STALE.test(message)) {
    let recent = false;
    try { recent = Date.now() - Number(sessionStorage.getItem(KEY) ?? 0) < 60_000; sessionStorage.setItem(KEY, String(Date.now())); } catch { /* storage off */ }
    if (!recent) { window.location.reload(); return 'This page was out of date; reloading it. Try again after it loads.'; }
  }
  return message && message.length < 200 ? `${fallback} (${message})` : fallback;
}
