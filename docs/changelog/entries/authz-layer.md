# Authorization layer — roles, vehicle scope and restricted reads

Server actions now enforce roster permissions before their bodies run. `platform.app_user`
gets an `access` enum, nullable vehicle UUID scope and explicit GP approval grants, while
its existing job-title `role` stays intact. The migration and new roster inserts make Juan
Admin and everyone else GP with all vehicles. Optional `access`, `vehicles` and `approves` roster fields are validated; omitted fields
preserve subsequently changed grants on reload. No LabOS sign-in or external integration was added.

The policy distinguishes ordinary edits, administration, ticket decisions, feedback and
local session changes. Persisted target IDs determine scope; forged vehicle fields cannot
narrow it. Bulk actions check every pursuit, collisions check both vehicles, and blanket SPV
stance changes check all SPVs. Money/close events, imports, scoring and grant invitations
are Admin-only. Ticket decisions enforce role, scope and self-approval rules inside the
service transaction as well as at the action boundary.

Read projections hide R1 amounts, R2 words and R4 reasons from Viewers while retaining note
metadata, restriction existence and cross-vehicle owner/vehicle disclosures. R3 Dakota fields
are Admin-only, including derived capacity, contact titles and route evidence. Display
redaction happens after shared caches; arithmetic and routing retain their raw inputs.
Scoped GPs retain allowed amounts, labelled context, restriction reasons and status edits.
Focused organization, strategy and full-graph route projections are also available.
The scoped workspace is a conservative projection, not a full replica of every unrestricted
screen: unscoped/Affinity note bodies stay hidden for scoped GPs, and non-admin visualizations
use the compact view until their aggregates retain enough provenance. Administrative controls are hidden or disabled where their policy denies access.

Rebuilt on `claude/main` at `bc536aa` on `codex/authz-layer-2`. Each action has one
`requireAction` call: the existing mutation guard checks origin/profile and resolves the
active user, then the authorization policy checks that same user and returns it for the
body to reuse. HTTP mutations use the same ordering through `withRoute`. The existing
append-only audit log, forged-header checks and transactional self-approval protections
remain intact. Linear's newer actions and roster fields are included.

The AST boundary covers **63 server actions and 13 HTTP handlers**. It rejects late guards,
comments masquerading as guards, re-exports and guards that do not receive the actual
arguments. Health is fixed public liveness. Session selection retains the local bootstrap
exception. Both feedback endpoints check origin/profile for POST and read only journal
state for GET; neither resolves a roster user or touches the database on the request path.
Reporter resolution stays at ingest. The origin/profile policy was extracted unchanged into
`lib/mutation-policy.ts`, with compatibility re-exports from `lib/mutation-guard.ts`.

The new platform migration is **012_authorization.sql**. All existing migrations are unchanged.
Invented fixtures only; no real data accessed. The local server applies the migration through
normal startup. Review roster grants before enabling additional readers. Juan's own
SEND/MONEY/allocation requests need a different authorized approver; the default roster does
not silently grant a second Admin. The local user switcher remains intentional until
authentication lands.

Validation: **1,107/1,107 PGlite properties pass**, including the unchanged database-free
feedback dependency property, a database-unavailable policy regression, restricted-read
fixtures and security guard composition. `npx tsc --noEmit` and `npm run boundaries` pass
(**63 actions / 13 handlers**).
The requested command `DATABASE_URL=postgres://plcos@127.0.0.1:5434/plcos_test_authz npm run props`
was attempted but the sandbox denied the connection with `EPERM` before any Postgres
properties ran; no Postgres pass is claimed.
