/**
 * Server start (Next calls this once per server process).
 * - The event-loop monitor (lib/responsiveness) records lag for Developer → Status.
 * - The local activity refresher runs independently of page views (lib/activity).
 * - The feedback journal files whatever it holds from before a restart and starts the ingester's
 *   timer (lib/feedback-ingest.ts).
 * - The page warm-up opens the main pages at start and again after the data changes, so the first
 *   click after a write does not rebuild the shared page caches (lib/page-warm.ts).
 * - The route warm-up runs again when the day changes, since cached routes are kept per day (lib/route-day-warm.ts).
 * All loaded lazily and never awaited, so a slow disk or a busy database cannot hold the start.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs' || process.env.NEXT_PHASE === 'phase-production-build') return;
  // A deployed server with no PLCOS_SECRET and no volume would make a new key on every deploy, and its stored
  // secrets would stop decrypting at the next one: it does not start, and the log says why.
  (await import('./lib/settings/key')).refuseKeylessBoot();
  void import('./lib/responsiveness').then((m) => m.startResponsivenessMonitor()).catch(() => undefined);
  void import('./lib/activity').then((m) => m.startActivity()).catch(() => undefined);
  void import('./lib/feedback-ingest').then((m) => m.startIngest()).catch(() => undefined);
  void import('./lib/page-warm').then((m) => m.startPageWarm()).catch(() => undefined);
  void import('./lib/route-day-warm').then((m) => m.startRouteDayWarm()).catch(() => undefined);
  // The mailguard token from the Keychain is checked for drafts-only once at start (docs/25 §12); the log says which, never the token.
  void import('./lib/connectors/mailguard').then((m) => m.checkAtStart()).catch(() => console.error('[mailguard] Could not check the token at start.'));
  // A deployed server that is not set up yet prints its one-time /setup code (docs/deploy/railway.md §3).
  void import('./lib/settings/setup').then((m) => m.announceAtBoot()).catch(() => console.error('[setup] Could not check whether setup is open.'));
  // Reconciliation's rules changed (issue 0137): read every LP again once, in the background.
  void import('./lib/reconcile').then((m) => m.reconcileIfRulesChanged()).catch(() => console.error('[reconcile] Could not run at start.'));
  if (process.env.SCHEDULE_DAILY_AT) void import('./lib/daily-timer').then((m) => m.startDailyTimer()).catch(() => console.error('[daily] Could not start timer.'));
}
