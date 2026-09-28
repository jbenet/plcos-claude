# Security fixes — local mutations, routing, approvals and audit history

28 Sep 2026 · `codex/security-fixes` · invented fixtures only. No real records were opened and no deployment or remote git operation was performed.

Mutations now require an explicitly selected, known active `platform.app_user`; the local provider's first-user fallback is not authorization. Real-profile writes require the live checkout and refuse previews, including Postgres rehearsals. This is the requested local gate, not authentication or role-based access: a caller who supplies a known local handle can still impersonate that user. Admin/vehicle roles and LabOS identity remain the separate deployment work.

- `/api/identity/pursuit-merge` checks origin, actor and real/live profile before parsing or queueing consolidation/reversal. Its server actions independently check the same boundaries.
- All mutating routes reject absent, sibling, wrong-port and wrong-scheme origins, and conflicting Fetch Metadata. They compare the browser's Host with Origin, ignoring forwarded host headers. Actions require Origin/Host plus an active actor and live profile, in addition to Next's action-origin check. The local user-switch route has a narrow bootstrap exception: same-origin selection of a known active user, even without an existing selection. Vehicle-only changes still require an actor.
- The proxy sanitizes `x-routed`, `x-vehicle` and `x-asked-path` on every path, including APIs and paths with file extensions. Internally signed routing context is bound to method, target path/query, original path, vehicle and a 60-second expiry (GUESS). Only genuine rewrite reentry bypasses canonical redirects; session selection rejects unsigned/tampered vehicle headers. The runtime key is generated before Next forks, never added to Next's public `env` config. This preserves the existing rewrite-loop protection without trusting client markers.
- `decideTicket` refuses self-approval for SEND, INTRO_ASK, MONEY and ALLOCATION_EXCEPTION. STAGE self-approval requires ownership of the actual pursuit on the ticket's vehicle; ticket scope cannot assert ownership. Unknown/inactive decision actors are refused. The decision row is locked to preserve one decision/audit append across concurrent clicks. Rejecting one's own request remains allowed.
- New migration `platform/010_audit_append_only.sql` refuses UPDATE, DELETE and TRUNCATE using a database statement trigger on both backends, and revokes those grants from PUBLIC, the migration user and `plcos_app` when present. INSERT/SELECT remain available. Existing fixture cleanup now retains history until its scratch database is discarded. The current table owner can deliberately override triggers/grants with DDL; protection against that requires a separate migration owner.

## Entry-point audit

Scanned every `app/api/**/route.ts` and every `'use server'` file/export, plus both screenshot handlers. Nine API files contain five POST handlers and six GET handlers. Nineteen action files expose 61 actions: 60 mutations and one read-only action. No inline server actions were found. The regression inventory property checks guard coverage for future exports.

| API file | Finding and change |
| --- | --- |
| `app/api/identity/pursuit-merge/route.ts` | No route-level checks; now origin + explicit active actor + real/live guard before parsing. |
| `app/api/identity/entity-type/route.ts` | Had profile guard and fallback actor, no origin gate; shared guard added. |
| `app/api/feedback/route.ts` | Had live-filing gate, trusted raw reporter cookie, no origin gate; shared guard and resolved reporter added. GET no longer starts ingestion. |
| `app/api/connection-feedback/route.ts` | Optional origin/host-only check and raw reporter cookie; strict shared guard and resolved reporter added. GET no longer starts ingestion. |
| `app/api/session/route.ts` | Fallback actor and no origin/live gate; explicit bootstrap exception above, active roster validation and origin/live checks. |
| `app/api/dakota/status/route.ts` | GET resumed a write job; removed that side effect. Recovery stays in the server's job lifecycle. |
| `app/api/import-jobs/route.ts` | GET called a helper that started queued jobs and failed stale jobs. It now uses a read-only snapshot; recovery runs at database startup only on demo or the real live server. |
| `app/api/profile/route.ts` | GET profile read; unchanged. |
| `app/api/health/route.ts` | GET health read; unchanged. |

The screenshot GET handlers under `app/issues/shot/[...path]/route.ts` and `app/dev/shot/[...path]/route.ts` were also inspected: file reads, no mutations. Read access remains today's local model; this change does not claim a read authorization boundary.

All mutations below now call `requireServerActionMutation`. Most previously resolved a fallback user without an explicit selection; real/live checks were inconsistent. Four had no actor check at all: `reloadInit`, `writeInventoryReport`, `writeMappingAction`, `writeComparisonAction`.

| Server-action file | Exports inspected |
| --- | --- |
| `app/approvals/actions.ts` | `decide`, `adjudicate`, `decideMany` |
| `app/dev/affinity/actions.ts` | `runConnectionTest`, `runDiscovery`, `runSliceAction`, `writeInventoryReport`, `writeMappingAction`, `writeComparisonAction`, `translateAction`, `countNotesAction`, `readNotesAction`, `readMeetingsAction`, `readHistoryAction` |
| `app/dev/data/actions.ts` | `reloadInit` |
| `app/dev/enrich/actions.ts` | `addProspectsAction`, `exportResearchSetAction`, `importFindingsAction`, `sourceBulkAction`, `importPortfolioAction`, `importDakotaAction`, `consolidatePursuitsAction`, `reversePursuitMergeAction`, `mergeImportDuplicatesAction`, `reverseImportDuplicateAction`, `reverseIdentitySeparationAction`, `repointPursuitsAction`, `reverseLpRepointAction`, `deriveSpvStanceAction` |
| `app/dev/linear/actions.ts` | `syncLinearAction` |
| `app/[vehicle]/strategy/actions.ts` | `saveMove`, `importMoveFile` |
| `app/grants/actions.ts` | `saveInvitation` |
| `app/materials/actions.ts` | `proposeSend` |
| `app/orgs/enrichment/select.ts` | `choose` |
| `app/plays/actions.ts` | `assign`, `propose` |
| `app/routes/actions.ts` | `proposeFromRoute`, `reviewEdgeAction`, `buildNetworkAction` |
| `app/selection/actions.ts` | `saveWeights`; `scoreDetailAction` is read-only and unchanged |
| `app/signals-actions.ts` | `disposeSignal` |
| `app/soft-hard/actions.ts` | `requestHarden`, `recordWire` |
| `app/standup/pin.ts` | `pinToday` |
| `app/targets/actions.ts` | `requestLadderAdvance`, `setPursuitStatus`, `addUpdateAction`, `addContextAction`, `decideSuggestionAction`, `logTouchpointAction`, `closeTrackAction`, `decideReadingAction`, `tagEventAction`, `moveMetToDiscussing` |
| `app/targets/bulk-actions.ts` | `bulkLpAction`, `undoBulkLpAction` |
| `app/targets/lp-unit-actions.ts` | `decideLpUnitAction` |
| `app/targets/spv-actions.ts` | `setSpvStanceAction`, `withdrawSpvStanceAction` |

Feedback now waits for the active roster lookup before journaling; its static imports still avoid database initialization. This deliberately replaces anonymous/raw-cookie journal acceptance. Background ingestion remains independent after acceptance and on server startup. Four GET handlers no longer initiate writes: feedback, connection feedback, Dakota status and import-job status.

## Validation and live handoff

- PGlite: `npm run props` — **1038/1038 properties pass**, including **30 new security properties**.
- `npx tsc --noEmit` — pass.
- `npm run boundaries` — pass (761 source files; 297 screenshot artifacts).
- Postgres: **0 properties executed**; blocked by sandbox loopback policy before test setup.
- Actual demo HTTP smoke: blocked by sandbox `listen EPERM`; direct route/proxy properties pass.

One intermediate full run passed 1033/1037: all 29 then-current security checks passed, but four existing history-checkpoint checks failed. The eight history checks and the complete Affinity property chain both passed in isolation with the same early route imports. No connector implementation or pass criteria were changed; the intermittent failure was not reproduced in those runs.

The property runner initializes Next's Node environment before importing route handlers, so Next captures real AsyncLocalStorage rather than its fallback. This is test setup, not an authorization mock.

Postgres command attempted: `DATABASE_URL=postgres://plcos@127.0.0.1:5434/plcos_test_security_fixes npm run props`. It stopped at scratch database setup with `connect EPERM`, before executing properties.

Claude must integrate and run the migration through the live server (renumber the new, unapplied migration if another branch took 010). Fully restart Next so all workers share the routing key, then smoke-test a vehicle link, Developer rewrite, session selection, feedback and mutation refusal with no cookie/cross-origin headers. A browser without a user cookie must explicitly select an active user before writing. Run the Postgres property command on the invented test database before live integration; this sandbox denies its loopback connection with `EPERM`. It also denies a demo HTTP listener, so HTTP smoke remains unverified here. No live database was touched.
