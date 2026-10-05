# Authorization

`can(user, action, { vehicle, fieldClass })` is the policy. `access` is an enum, separate
from the roster's existing `role` job title. `vehicles = null` explicitly grants all
vehicles; an empty list grants none. Unknown principals, actions and unresolved global
scopes fail closed. R3 is Admin-only. Viewers cannot perform domain mutations or read
R1–R4. Feedback and local session presentation are explicit exceptions to mutation denial.

Every server action starts with `requireAction` and forwards its original arguments.
The wrapper first runs `requireServerActionMutation`, then authorizes its resolved user;
actions reuse that user rather than invoking a second guard. The
closed manifest in `rules.ts` determines its permission and resolves persisted target IDs.
A submitted vehicle never overrides the vehicle of a pursuit, exposure, play, suggestion
or ticket. Bulk requests authorize every target before changing any; a collision requires
both vehicles. Global event/edge edits require all vehicles. A blanket SPV stance requires
all SPVs. Administrative imports, money/close recording, scoring, invitations and roster
operations require Admin. GP approval grants currently cover STAGE, INTRO_ASK and SEND;
MONEY/ALLOCATION_EXCEPTION stay Admin-only until named per-vehicle approvers are configured.

HTTP handlers use `withRoute` with a closed route manifest. Two policies take a bearer token instead of the
cookie: `mcp` (docs/26) and `outreach` (docs/27); each authorizes per tool or operation as the token's owner,
narrowed by the token, through `can()` and the same action rules as the pages. Health is fixed DB-free liveness. Feedback POSTs check origin/profile only;
feedback GETs read journal state only. Neither resolves a user or touches the database
on the request path. Reporter resolution happens at ingest. Local switching remains intentional until an
actual authentication provider is integrated. These checks do not turn the local handle
cookie into authenticated identity. No LabOS implementation is included.

Ticket decisions also authorize inside the governance transaction. Requesters cannot
approve their own tickets, except STAGE when they own the pursuit. Inactive automation
actors cannot decide. Existing bounded-ticket/expiry checks still gate the resulting action.

Display code imports the facades in `read/`; domain services keep raw inputs for arithmetic
and route planning. Facades redact after shared caches and do not modify cached objects.
Restricted readers use explicit scoped DTOs before unrestricted page loaders run. Names,
owner/vehicle overlaps and approach restrictions remain visible. The current scoped views
are intentionally smaller than the unrestricted workspace; see the changelog for coverage.

`npm run boundaries` parses actual export/function syntax, requires first-statement guards
and original arguments, and refuses unwrapped/re-exported/inline server actions and route
handlers. Adding a new action requires both a manifest rule and its wrapper. The property
suite checks forged IDs, mixed scopes, redaction, immutability and coverage using invented
fixtures. Role/scopes are also part of in-flight render identity, so a changed grant cannot
join an earlier render under the previous grant.
