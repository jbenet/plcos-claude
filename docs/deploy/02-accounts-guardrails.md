# 02: User accounts, access groups and user-proofing

This is a plan for Juan's review on 28 Sep 2026. Nothing in it is built yet. The kit is
`plcos-data/intake/ai-app-starter-kit-v1.13/` (called "the kit" below). The app files cited are in
the live checkout.

## 1. What the kit and LabOS provide, and what we have

**The kit and LabOS**

- **The sign-in gate.** Every path requires LabOS sign-in unless the app declares it public with
  `publicPaths`. LabOS does not authenticate public paths, so the app must protect them itself
  (deploy-to-labs, "Public endpoints").
- **Who can open the app.** There are two settings. `OPEN` lets in all PL Infra members, and it is
  the default. `PRIVATE` lets in the owner, the directory admins and the members added under ⋮ →
  **Manage access**. The setting changes without a redeploy, and the agent cannot pick members
  (AGENTS.md "Who can open the app"; deploy-to-labs step 2). **Directory admins can always open a
  private app.**
- **Who the user is.**
  - The LabOS cookie `authToken` is scoped to the shared apps domain, so every AI App receives it.
  - `GET /v1/ai-apps/me` with `Authorization: Bearer <token>` returns `uid, name, image, location,
    skills, teams[]`. It deliberately carries no email.
  - The server may forward the cookie's token to `/me` itself. It must never store or log the token.
  - The kit says the identity is for "personalization only, not authentication. Do not gate
    sensitive or destructive actions on it" (pln-member-context).
- **Not provided.** Roles or groups inside an app, approvals, audit, a signed identity header or
  JWKS, and per-app token audiences. The kit's only role concept is who can open the app.
- **Other constraints that touch this section:**
  - The app is framed from `https://os.pl.xyz`.
  - The baseline analytics send JS error messages (up to 300 characters) to PL's PostHog.
  - The route-sync script mirrors each page's path and `document.title` into the portal's URL and
    browser tab (app-analytics).
  - A PL-provisioned Postgres gives the app **one user that cannot create roles** (deploy-to-labs,
    "Apps that want a provisioned database").
  - The runtime limit is 384 MiB of memory (AGENTS.md "Resource limits").

**Our app today (live, `28a9777`)**

- **An auth seam already exists.**
  - `lib/auth/index.ts` defines an `AuthProvider` with a local cookie-and-dropdown provider.
  - `lib/auth/labos.ts` is a stub that refuses every call.
  - `config.auth.provider` picks one. `/api/session` already refuses user switching when the provider
    is not `switchable`.
- **The roster.** `platform.app_user` has `handle, name, initials, role (free text), email, active`,
  loaded from the `team` list in `data/real/init.jsonc` (`lib/real/init.ts`). Pursuits have
  `owner_id → app_user`. Affinity owners and note authors are matched to the team through
  `affinityEmail`.
- **No permission checks anywhere.**
  - Nothing checks `app_user.role`.
  - `decideTicket` (`modules/governance/service.ts`) lets anyone decide any ticket, including one
    they requested themselves.
  - Every `'use server'` export (19 files, about 70 functions) is callable by a POST whether or not
    its button is shown.
- **One unguarded route.** `/api/identity/pursuit-merge` consolidates or reverses pursuit merges
  with no profile, live-server or user check. The sibling route `entity-type` does have those checks.
  Today anyone on the LAN can call it, because the real server has no sign-in (real-data rules).
- **The audit log** is `platform.audit_log`, owned by `plcos_app`. The app can therefore update or
  delete its own audit rows.

## 2. How the app will know the user (the design is the same under every option)

1. **The LabOS gate** lets in only the members on the Manage access list, because the app is set to
   `PRIVATE`.
2. **A server-side identity check.** `labosAuth().currentUser()` does the following:
   - Reads `authToken` from the request cookies, URL-decodes it and strips the quotes.
   - Calls `/me` server-side.
   - Caches the answer in memory for 5 minutes, keyed by `sha256(token)`, with at most 100 entries.
     The token itself is never persisted or logged.
   - Maps `member.uid` to `platform.app_user.labos_uid`.
   - No cookie, or a 401 from `/me`, gets a page saying "Open Capital OS from LabOS → AI Apps".
   - A signed-in member who is not on the roster gets a 403 page showing their name and uid, so
     Juan can add them. This also shuts out directory admins who are not on the team.
3. **Binding a person to the roster.** Juan puts each person's LabOS uid in the init file, with
   `labosUid` beside `handle` and `affinityEmail`, or binds it from an Admin → Access page listing
   the refused uids.
   - We never bind by name alone, because names collide and `/me` has no email.
   - Roster people who never sign in, such as Affinity-only pursuit owners, stay as `app_user` rows
     with no `labos_uid`. They own pursuits but are not users.
4. **Why this counts as authentication despite the kit's warning.** `/me` validates the token on
   PL's side, so its answer is authoritative for "who sent this cookie".
   - The residual risk is token replay. The same cookie reaches every AI App a member opens, and
     page JS can read it (the kit reads it from `document.cookie`). So any other PL app could lift a
     member's token and act as them here.
   - That risk is why the most dangerous actions are removed from the deployed build (§5) rather
     than only put behind roles. It is also the first piece of kit feedback (§8).

## 3. Options

| | What it is | Cost | Risk | Fit |
|---|---|---|---|---|
| **A. Gate only** | `PRIVATE` plus Manage access, and everyone inside is equal (today's model with a login in front) | S | Directory admins get in. Any team member, or anyone holding their token, can approve MONEY, record a wire, bulk-change 5,000 statuses or run merges. Dev pages are exposed. | Poor |
| **B. Gate + roster + three roles + vehicle scope, enforced on the server; Developer stripped from the build** | One policy module called by every action and route. A few restricted field classes. A `DEPLOY_TARGET=labos` build flag. | M: one to two nights | The policy table must cover every action, so a property test enforces that it does | **Good** |
| **C. B + per-record ACLs** (per LP, per note, Affinity-parity visibility) | Row-level lists, and mirroring Affinity's sharing settings | L | Complexity at 10 users. The promotion rule says to wait until a need recurs. | Premature |

## 4. Recommendation: Option B

**Why:** it is the smallest design that makes a mistaken click or a stolen token survivable. Only
low-harm, audited and reversible writes exist in the deployed build. The harmful ones either need
a named approver or do not exist there at all.

**Groups.** Each group is a roster field, not a new table. Add
`access (admin | gp | viewer)`, `vehicles uuid[]` (null means all) and `approves` (a list of
ticket kinds) to `platform.app_user`.

| Can… | Admin (Juan) | GP (team; scoped to their vehicles) | Viewer |
|---|---|---|---|
| Read pipeline, orgs, routes, strategy | all vehicles | their vehicles in full; other vehicles as "also pursued by ⟨vehicle⟩, owner ⟨X⟩" | their vehicles, without restricted fields |
| Restricted fields (below) | yes | their vehicles | no |
| Status, update, touchpoint, context, LP unit, SPV stance, reading, tag, play, strategy move | yes | their vehicles | no |
| Request tickets (propose send, ladder advance, harden) | yes | yes | no |
| Approve STAGE, INTRO_ASK, SEND | yes | if listed in `approves`, their vehicles, and not a ticket they requested | no |
| Approve MONEY, ALLOCATION_EXCEPTION; record a wire; close-track events | yes | only a named per-vehicle approver | no |
| Adjudicate a vehicle collision (rule 5) | yes | only if scoped to both vehicles | no |
| Scoring weights, enrichment method, grant invitation (rule 12), roster | yes | no | no |
| Feedback box, connection notes | yes | yes | yes |

**Two rules that apply to all groups:**

- **Self-approval.** A requester never approves their own SEND, INTRO_ASK, MONEY or
  ALLOCATION_EXCEPTION ticket. STAGE may be self-approved by the pursuit's owner, for speed. Agents
  request tickets but never decide them, which is already the rule in AGENTS.md.
- **Scoping never hides the fact of a collision** (rule 5) or a restriction (rule 8). A list that
  omits scoped-out records says so, as in "12 more pursuits on vehicles outside your access". That
  follows rule 7: unsupported is not nonexistent.
- Route planning always runs over the full graph. Only the display is redacted, so rule 6 ("never
  gate information on a person") still holds for routing.

**Restricted field classes.** The redaction happens in the data loaders (`lib/*-data.ts`), not in
the components.

- **R1 Money:** soft and hard amounts, wires, allocations and forecasts per LP.
- **R2 Words:** Affinity note bodies, email and meeting content, and team context notes.
  - Viewers see that a note exists, with its author and date.
  - Health-flagged notes stay redacted as they are now.
  - Juan's Affinity key sees Juan's view, which may be wider than what colleagues see in Affinity. So
    widening access to R2 is Juan's call (decision 5).
- **R3 Dakota-licensed:** AUM and asset figures, ticket and check sizes, allocations, contacts,
  consultant data and commentary. Names stay visible, as already agreed on 27 Sep.
- **R4 Restriction reasons:** why someone is do-not-approach. The restriction itself is visible to
  everyone and enforced on everyone's routes (rule 8). Only the reason text is restricted.

## 5. Danger inventory

**Classes:**

- **HIDE:** not in the deployed build at all. It runs on Juan's Mac, and the result propagates
  (section 04).
- **ADMIN:** Admin, or the named approver.
- **CONFIRM:** a GP may do it after a dialog that states the count or effect. It is audited and
  undoable.
- **SAFE:** a GP within their vehicles. It is audited and stamped with the author.

| Action (file) | What could go wrong | Class |
|---|---|---|
| All of Developer (`app/dev/*`, nav group `developer`) | the pages listed in the next rows, plus logs, workflow run notes and docs holding real data | HIDE |
| Affinity: test, discovery, slice, notes, meetings and history reads; translate; write mapping (`app/dev/affinity/actions.ts`) | spends the Affinity request quota; translate rewrites the pipeline from the landed copy; mapping overwrites `mapping.jsonc` | HIDE |
| Linear sync, Dakota import (`dev/linear`, `dev/enrich` importDakota) | connector keys would have to be in the cloud; Dakota data leaves "our system" | HIDE, and no connector code or keys in the image |
| Enrich imports: prospects, findings, portfolio, sourceBulk, exportResearchSet (`dev/enrich/actions.ts`) | bulk inserts; export writes real-data batch files meant for local agents | HIDE |
| Merges, re-point, import-duplicate merges, SPV-stance derivation and their reversals (same file, plus `/api/identity/pursuit-merge` and `/api/identity/entity-type`) | a single POST consolidates every pursuit; identity mistakes spread into routes and strategy | HIDE. **Fix the unguarded merge route tonight, deployed or not.** |
| Reload init (`dev/data/actions.ts` reloadInit) | overwrites the team and vehicles from the file, which could de-roster people or change an exemption | HIDE |
| Strategy-moves import (`[vehicle]/strategy/actions.ts` importMoveFile) and network rebuild (`routes/actions.ts` buildNetworkAction) | a heavy import job in a 384 MiB container; reads workflow files | HIDE, because they arrive through workflow propagation |
| `/api/dakota/status` GET | a GET that resumes a Dakota job | HIDE |
| User switcher (`/api/session` userHandle) | impersonation | HIDE (already refused when not switchable) |
| Record a wire (`soft-hard/actions.ts` recordWire); close-track events such as signature, closing or withdrawal (`targets/actions.ts` closeTrackAction) | moves the hard headline or cash receipt (rules 1 and 4) | ADMIN + confirm |
| Approve a MONEY or ALLOCATION_EXCEPTION ticket (`approvals/actions.ts` decide) | authorises money or an allocation exception | ADMIN, no self-approval |
| Adjudicate a conflict (`approvals` adjudicate) | picks the winning vehicle | ADMIN, or a GP scoped to both vehicles |
| Scoring weights (`selection/actions.ts` saveWeights); enrichment method (`orgs/enrichment/select.ts`) | re-ranks every LP for everyone | ADMIN (versioned already) |
| Grant invitation (`grants/actions.ts` saveInvitation) | opens the rule-12 outreach gate | ADMIN |
| Bulk status and its undo (`targets/bulk-actions.ts`) | up to 5,000 pursuits in one click | CONFIRM; cap at 200 per request when deployed; undo already exists |
| Batch STAGE approvals (`approvals` decideMany) | many rungs at once | CONFIRM with the count; approvers only |
| Pin today (`standup/pin.ts`) | one-way, so an early pin freezes the day's numbers | CONFIRM |
| Approve STAGE, INTRO_ASK or SEND tickets | a SEND or intro ask goes out on our name | approvers only, no self-approval (except STAGE by the owner) |
| Status, update, context, touchpoint, suggestion, reading, event tag, met→discussing, LP unit, SPV stance and withdrawal, plays, strategy-move state, signal disposal, edge review, propose send, ladder or harden requests | the wrong status or note on an LP; all reversible or proposal-only | SAFE |
| Feedback box and connection notes (`/api/feedback`, `/api/connection-feedback`) | spam; screenshots and text carry real data | SAFE for everyone; 20 per hour per user; issues stay in our store (section 05) |

## 6. Guardrails

1. **Server-side authorisation in one place.**
   - `lib/authz` holds `can(user, action, {vehicleId})` and `requireCan(...)`.
   - Every server action and route handler calls `requireCan` on its first line.
   - `decideTicket` checks approver authority and self-approval inside `modules/governance`, so
     every path goes through the check.
   - A property test walks every `'use server'` export and `route.ts` and fails if one skips
     `requireCan`, like the existing `npm run boundaries`.
   - `proxy.ts` blocks role-restricted prefixes as a second layer. Hidden buttons are cosmetic only.
2. **A deployed-build flag.** `DEPLOY_TARGET=labos` does the following:
   - Boot refuses the local auth provider and any connector key variable.
   - `proxy.ts` returns 404 for `/dev`, `/developer`, `/api/identity/*`, `/api/import-jobs` and
     `/api/dakota/*`, and the nav drops the Developer group.
   - The Dockerfile deletes `app/dev`, those API folders, `lib/connectors` and `scripts/` before
     `next build`.
   - A boundaries check fails the build if anything left over imports a connector.
3. **Audit.**
   - Every deployed write records the actor, never null, plus `via: labos` and the member uid.
   - A trigger refuses `UPDATE` and `DELETE` on `platform.audit_log`. This works even with the
     provisioned database's single user.
   - An Admin → Activity view shows the log per person.
4. **Reversible by default.** Follow the existing pattern: journalled, with a reversal (bulk undo,
   SPV-stance withdraw, merge and entity-type reversals). The only one-way actions in the deployed
   build are Pin today and ticket decisions, and both are append-only by design.
5. **A read-only path for viewers.** The provisioned database cannot create roles, so viewer
   requests use a separate small pool with `default_transaction_read_only = on`.
   - This guards against our own bugs, not attackers.
   - If we bring our own Postgres (section 01), a real `plcos_viewer` role gets `SELECT` on views
     that exclude R1–R4.
6. **Rate limits.** An in-memory token bucket per user (there is a single container):
   - 60 writes a minute.
   - One bulk action per 10 seconds.
   - 20 feedback items an hour.
   - `/me` is cached as in §2.
7. **A kill switch.** `READ_ONLY_MODE=1`, set in Deployment settings and applied with a redeploy,
   turns everyone into a viewer. Use it during an incident or while the workflows push data.
8. **The edges of the app:**
   - No public paths.
   - `Content-Security-Policy: frame-ancestors 'self' https://os.pl.xyz`, and no `X-Frame-Options`.
   - The analytics error event sends a fixed code, not the message.
   - Page titles and URLs carry ids, never LP names, because the portal mirrors both.
9. **Agents of team members** (later). An agent acts as its person with the same or narrower
   permissions (AGENTS.md: delegation cannot increase permission). There are no service accounts
   until they are needed.

## 7. Decisions for Juan

1. **Access at LabOS:** `PRIVATE`, with the team added under Manage access, and the app also
   refusing anyone not on our roster (including directory admins)? *Suggested: yes.*
2. **Should the deployed build be a team surface only?** Developer, connectors, imports, merges,
   re-points and syncs would all be removed from it. They would run on your Mac (live) and
   propagate to the deployed database. *Suggested: yes. A reversal needed in the cloud is done
   locally and propagated.*
3. **Approvals:** who approves MONEY and ALLOCATION_EXCEPTION per vehicle, and is self-approval
   banned for SEND, INTRO_ASK, MONEY and ALLOCATION_EXCEPTION? *Suggested: you, plus one named
   approver per vehicle. No self-approval, except STAGE by the pursuit owner.*
4. **Groups:** are Admin (you only), GP and Viewer enough? Do we need a backup admin? *Suggested:
   yes, and name a backup later.*
5. **Visibility inside the team:** should R1 amounts and R2 note bodies be visible to every GP on
   that vehicle, including notes other people wrote in Affinity? *Suggested: yes for GPs and no for
   viewers. Tell us if Affinity has lists or notes the team is not meant to see.*
6. **Dakota:** does our Dakota licence allow its private fields (R3) to be shown to the team on a
   PL-hosted app? *Suggested: until you confirm, R3 is Admin-only in the deployed build, and names
   stay visible.*
7. **Per-vehicle scope:** should it be on from day one? *Suggested: build it, but default every GP
   to all vehicles, and narrow someone only when you say so.*

## 8. Build list

**Tonight, with no decision needed:**

1. **S:** Guard `/api/identity/pursuit-merge` with the live-server, profile and user checks its
   sibling route has. This is a LAN exposure today.
2. **S:** `DEPLOY_TARGET` in `config/deployment.ts`. Boot refuses local auth and connector keys
   under it.
3. **S:** A new platform migration adding `labos_uid unique`, `access`, `vehicles` and `approves`
   to `app_user`, plus the init-file fields and validation. Existing users default to `gp` with all
   vehicles, except Juan, who is `admin`.
4. **M:** `lib/authz` with a policy table matching §4 and §5, `requireCan` in every action and
   route, and the property test that proves coverage.
5. **M:** The `labosAuth` provider: cookie → `/me` → roster, the LRU cache, the 401 and 403 pages,
   and tests against a fake `/me`.
6. **S:** Approver authority and the self-approval ban in `decideTicket`, with defaults matching
   decision 3.
7. **S:** The append-only trigger on the audit log. The actor is required on deployed writes.
8. **M:** Strip the deployed build (proxy 404s, nav filter, Dockerfile deletions, the boundaries
   check).
9. **S:** Rate limits, the bulk cap, the CSP header, the analytics error code, and titles without
   names.
10. **S:** `READ_ONLY_MODE` and the read-only viewer pool.

**After Juan's review:**

11. **M:** R1–R4 redaction in the data loaders, and a property test that a viewer's render of each
    page on the demo profile contains no restricted sample value. Needs decisions 5 and 6.
12. **M:** Per-vehicle scope, including the "also pursued by…" and "N hidden by your access"
    disclosures. Needs decision 7.
13. **S:** The Admin → Access page: the roster, roles, last seen, and refused uids to bind.
    Needs decision 1.

## 9. Feedback for the kit devs

1. **Give apps a verifiable identity.** For example, a gateway-injected signed header (a JWT with
   `aud = appId`, verifiable against a JWKS). Otherwise, confirm that a server-side `/me` result may
   be used for authorisation. "Personalization only" leaves every app that has users of different
   standing with nothing to build on.
2. **The shared `authToken` can be replayed across apps.** The token is readable by page JS (the kit
   reads it from `document.cookie`) and is sent to every AI App on the domain. So any app can replay
   a member's session against any other app. Please issue per-app, audience-scoped, HttpOnly tokens.
3. **`PRIVATE` always admits directory admins.** Please offer a stricter mode for confidential apps,
   or expose the app's access list (for example `appAccess` on `/me`) so an app can sync its roster
   instead of keeping a second list.
4. **The provisioned Postgres has one user that cannot create roles.** That rules out
   least-privilege roles (a read-only role for viewers, and grants separating the data planes).
   Please allow roles, or provide a second, read-only user.
5. **Analytics can leak confidential text.** Baseline error events forward message text to a shared
   PostHog, and route sync mirrors page titles into the portal URL. Please add an opt-out, or send
   codes and ids only, for confidential apps.
