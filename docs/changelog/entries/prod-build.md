# prod-build — Demo production build and tracing boundary

28 September 2026 · `codex/prod-build`

Added Next tracing exclusions and a post-build guard that rejects paths under `data/real` or `plcos-data`, including symlinks and standalone output. Malformed or absent trace inventories fail closed. Nineteen invented regression cases cover traversal, aliases, linked manifests and invalid inventories. Page design is unchanged.

[Deployment measurements](../../deploy/06-measurements.md) record a clean demo build at 9.974 seconds, 1.80 GiB peak child RSS and 304.7 MiB logical output. The build's 94 manifests passed the forbidden-path audit. A separate invented PGlite import profile peaked at 1.17 GiB; limiting V8 old space to 256 MiB still used 1.16 GiB RSS.

**B1 is partial.** The execution sandbox rejects Postgres TCP and HTTP/IPC listening. The requested five-minute, ten-concurrent page walk, Next idle/load RSS, page p50/p95, pool connections, pg import-child memory and capped runtime test could not run. The report keeps unavailable measurements explicit and provides Claude's demo-only completion steps. The PL runtime ask remains provisional.

Validation: PGlite **1,027 / 1,027 properties pass** (19 new tracing cases); TypeScript and boundaries pass. Postgres properties: 0 executed, connection blocked (`EPERM`), not a pass. Demo production build and tracing audit pass.

Claude: integrate after review, rerun the Postgres suite and complete the runtime measurements in a network-enabled local session before finalizing the PL resource ask. No live seed, migration, restart or secret change is needed. No real data was read or copied, and no fetch, pull or push was performed.
