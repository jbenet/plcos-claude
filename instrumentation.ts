/**
 * Server start (Next calls this once per server process).
 * - The event-loop monitor (lib/responsiveness) records lag for Developer → Status.
 * - The local activity refresher runs independently of page views (lib/activity).
 * - The feedback journal files whatever it holds from before a restart and starts the ingester's
 *   timer (lib/feedback-ingest.ts).
 * All loaded lazily and never awaited, so a slow disk or a busy database cannot hold the start.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs' || process.env.NEXT_PHASE === 'phase-production-build') return;
  void import('./lib/responsiveness').then((m) => m.startResponsivenessMonitor()).catch(() => undefined);
  void import('./lib/activity').then((m) => m.startActivity()).catch(() => undefined);
  void import('./lib/feedback-ingest').then((m) => m.startIngest()).catch(() => undefined);
}
