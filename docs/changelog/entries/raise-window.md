# An Admin moves a vehicle's raise window on the server · 8 Oct 2026

Juan, 8 Oct 2026, on an SPV whose close had passed: "yes still open, move date to Oct 9". The close came from the
init file, which nobody edits on the cloud server, and nothing else could change it.

- **`PATCH /api/sync/vehicles`** (`scripts/cloud-vehicle.sh --window <file>`) moves an existing vehicle's raise
  window, `{ slug, opens, closes, note }`, with an Admin's token. Only the window changes. A close before the open,
  an unknown slug or any other field is refused. One `vehicle.raise_window` audit row keeps the window before and
  after.
- **The app's window stays.** Once an Admin has moved a vehicle's window in the app, an init reload and the Affinity
  translation, which both rewrite windows from the file, leave that window alone and still update the rest
  (`RAISE_SET_IN_APP`, modules/platform/vehicles.ts).

Checks: tsc, boundaries, the authz properties and the sync-vehicles properties (raise window by token) on Postgres.
