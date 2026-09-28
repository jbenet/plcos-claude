# W3 — Connect LP units

Version **1.3** (28 September 2026).

Deterministic local file join: `scripts/enrich-connect.ts`, using `lib/enrich/connect.ts`.
Read `docs/agent-rules/real-data.md`, `docs/23-lp-units.md` and this protocol.

Inputs are a frozen research export (`candidates.jsonl`), public findings in `raw/`,
`us/network.json`, `us/team.json`, `us/pl-directory.jsonl`, the optional profile-level
`portfolio/portfolio.json`, and the optional complete,
hash-checked `warehouse/` graph. No web requests or database access occur in W3.

An organisation LP exports `contacts`: pursuit contacts and people whose current primary
work affiliation says they speak for the firm. Board, adviser and investor affiliations
alone do not qualify. Each nested contact keeps its entity key and `contactRole`; the
private candidates file also carries its own records and restrictions. The public
`research-set.jsonl` includes only the corresponding research identities.

W3 joins each contact once, even when that person also has an individual LP row. It keeps
the original person paths for the graph and projects them onto the organisation with
`viaContact: {key, name, role}` and a “via <role> (<name>)” basis. Projection never changes
the tier, warmth or warehouse hops. Contact-only endpoints do not enter the LP denominator;
a firm and a person investing personally are two distinct LP units, each counted once.
The graph importer ignores projected rows when building edges: membership is not a new
relationship. Runtime routes resolve current contacts, retaining both firm and contact
restrictions.

## Route evidence rules

- Export the full held meeting/call/email/message history as `contact.records`, including
  dates before the current raise and rows beyond the eight-touch strategy preview. Resolve
  team participants by recorded person identity or email. Match LP people through their
  canonical records and project their paths onto current LP-unit contacts. An assigned owner
  alone is not evidence of participation. Legacy exports fall back to `contact.recent`.
- Grade email per LP and named team participant, across the complete history. Two-way
  one-to-one email is B. Inbound-only one-to-one email is B, labelled **waiting on us**.
  Outbound-only one-to-one email is C, labelled **we wrote, no reply**. Bulk/mass mail alone
  is D, never evidence of a direct conversation. A rules are unchanged.
- The private export joins translated touchpoint source refs to cached Affinity email metadata
  (account-wide email plus list-entry fallback). It preserves `massMailing`, `loggingType`,
  recipient count, and a derived one-to-one/bulk classification without exporting addresses.
  `ours`/`sent` and `theirs`/`received` are the two directions. One-to-one requires exactly
  one sender and one recipient, the LP and an internal participant. More than one recipient
  (including CC and preview totals), mass-mail flags, bulk/newsletter logging types, and
  newsletter subjects are conservatively treated as bulk. Investor updates to a list qualify through recipient counts or bulk flags. The strict
  recipient cutoff and newsletter subject heuristic are guesses. Missing metadata or unknown direction stays C, never inferred as a reply.
  Bulk emails never supply either side of a two-way exchange or refresh direct-contact warmth;
  independent personal email or meeting evidence can still establish B.
- A held direct meeting/call with both present remains B; group attendance stays C and labelled.
  A sourced personal podcast conversation or explicit one-to-one finding receives the same
  rule. Each path's `basis` (the displayed why) states the applicable case. Age or an unknown
  date may lower warmth, but cannot erase the evidence of a direct
  conversation. Mere mentions, panels, shared attendance and firm-level ties do not qualify.
- Read the sourced portfolio snapshot, including SPVs. Founders join LP identities only with
  corroborating company evidence; ambiguous names remain separate. Non-LP founders can be
  connector nodes when a sourced onward relationship exists. Excluded rows and warehouse-only
  or research-scope classifications cannot establish portfolio membership.
- Join the team profile's structured `roles`, `prior`, `affiliations`, `boards`, `employers`,
  `cofounded` and `investments` to named LP firms and resolved findings' structured organisation
  fields, using W3's entity-name normalization. Ambiguous/not-found findings and low-confidence
  facts cannot supply the join. Each entry uses `org`, optional `role`, `since`, `until`, `source`;
  preserve the team and LP sources and dates in the path explanation. A documented past working
  relationship with a principal is B: sourced work roles on both sides with dated overlap meeting
  the configured colleague-overlap threshold. Unknown dates, disjoint dates, shared organisations,
  boards, co-investments or firm-level funding of a team member's co-founded organisation remain C;
  they do not prove personal interaction, willingness or consent. Principal paths project onto LP
  units under the existing contact rule. Target and connector restrictions still apply.
- Optional team `bio` text joins only literal, bounded organisation names from those same inputs;
  no fuzzy name or person-name matching. Denials and organisation-name extensions are excluded.
  These paths are always C and marked **from bio**. `sources` holds profile source URLs.

  Layout: `config.data.root` is `data/<profile>`; the enriched team file is
  `enrich/us/team.json` with `{team: [...]}`, separate from the minimal exported `enrich/team.json`
  roster. The invented `fixtures/enrich/demo.json` team is copied there by `scripts/enrich-demo.ts`.

- PL directory membership stays C. Its explanation names an independently evidenced team
  relationship holder when known, otherwise states that no particular holder is recorded.
  Membership never invents a personal meeting, its date, willingness or consent.

## Live rerun (Claude, after integration)

1. On the live app, Developer → Enrich → **Export the research set**. An old export lacks
   full contact history or email metadata, so running only W3 will not recover missing meetings. Re-translate
   cached Affinity records first when team participants were stored only as person IDs.
2. Freeze that export and the named inputs. Record the authorized W3 run in the workflow
   ledger using `docs/COLLAB.md` (protocol hash includes this file and the implementation).
3. From `plcos-claude-live`, run:

   ```sh
   DATA_PROFILE=real npx tsx scripts/enrich-connect.ts
   ```

4. Inspect the printed LP coverage counts and diagnostics. If updating saved W9 triage,
   rerun `DATA_PROFILE=real npx tsx scripts/enrich-triage.ts` against the same frozen inputs.
5. Use the live app's **Import the findings**, then record completion in the ledger.
   Only the live server imports into the real database. Check routes, Selection, triage
   and the LP stats path panel. No prior coverage total is promised: eligibility and
   current evidence determine it.
