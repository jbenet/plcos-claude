/**
 * What to do when a server action call throws instead of returning (issue 0116). A page left open
 * across a server restart (an iPad tab that slept overnight) can no longer reach the server's
 * actions; every call then throws. Reload such a page once, so the next try works; otherwise show
 * the server's own message rather than a generic one.
 */
const STALE = /server action|failed to fetch|load failed|networkerror|network error|unexpected response|not found|fetch|no answer from the server/i;
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

/**
 * A page left open across a dev-server restart can also hang rather than throw (found by npm run e2e,
 * 28 Sep 2026): the action runs and the server answers, but the old page then waits for code the new
 * server names and it cannot load, so "Moving…" never ends. A call with no answer by the deadline
 * is treated as failed, which reloads the page once through actionFailure; the reload shows what was saved.
 */
export const ACTION_DEADLINE_MS = 12_000; // GUESS: a move answers in about half a second on the demo.

export function withDeadline<T>(call: Promise<T>, ms = ACTION_DEADLINE_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('No answer from the server in time; this page may be out of date.')), ms);
  });
  return Promise.race([call, late]).finally(() => clearTimeout(timer));
}
