/**
 * Server start (Next calls this once per server process). Files whatever the feedback journal holds
 * from before a restart, and starts the ingester's timer (lib/feedback-ingest.ts). Loaded lazily and
 * never awaited, so a slow disk or a busy database cannot hold the server's start.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs' || process.env.NEXT_PHASE === 'phase-production-build') return;
  void import('./lib/feedback-ingest').then((m) => m.startIngest()).catch(() => undefined);
}
