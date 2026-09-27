/** Next invokes this once per server instance, before serving requests. */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startResponsivenessMonitor } = await import('./lib/responsiveness');
    startResponsivenessMonitor();
  }
}
