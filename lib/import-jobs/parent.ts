/** Losing the server must stop work and heartbeats, even during an open transaction. */
export function requireImportParent(): void {
  process.once('disconnect', () => process.exit(1));
  // Also cover a parent that disappeared before the listener was installed.
  if (!process.connected) process.exit(1);
  // The channel watches the parent without keeping a completed worker alive.
  process.channel?.unref();
}
