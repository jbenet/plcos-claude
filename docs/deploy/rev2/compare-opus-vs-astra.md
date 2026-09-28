# Rev 2 planners compared: the Opus sections (A, B, C) and Astra's plan

28 Sep 2026. Both worked from the same brief, the kit and rev 1. The Opus planners each wrote one area;
Astra wrote one complete plan. I checked the claims against the code (`claude/main` at `f6fc062`), the
kit v1.13, `06-measurements.md` and current Anthropic list prices.

## Where they agree

- **The shape.** The service holds the one primary. One image runs as separate web, worker and agent
  processes. Agents hold no connector keys.
- **The job runner.** A Postgres queue (`SKIP LOCKED`), not Trigger.dev or Inngest, because those put
  LP data in a vendor cloud.
- **Security basics.** New read-scoped service credentials, never Juan's keys; hostname egress
  allowlists; per-role database grants.
- **Migration.** A one-time encrypted transfer with count and checksum verification, a short freeze,
  and no bidirectional sync.
- **Workflows.** Read-only syncs and derivations run unattended. Merges, pipeline, consent and money
  stay human.
- **Dakota** waits for its terms.
- **Feedback** is filed and triaged in the service.
- **Rev 1's two fixed trains a day** are dropped.

## Where they differ, and which is right

| Topic | Opus | Astra | Better |
|---|---|---|---|
| Identity | `/me` plus our HttpOnly session plus a passkey step-up on Admin actions (C) | Don't launch until PL provides a signed, app-scoped identity | **Neither alone.** Astra is right that step-up leaves reads open to a replayed token. Blocking launch on PL's roadmap is wrong. The merge requires the passkey at sign-in. |
| Sizing | 1 replica each; DB 2 vCPU / 8 GiB, 20 GB (A) | 2 replicas each (21 GiB); DB 4 vCPU / 16 GiB, 100 GiB; 300 GiB of backups | **Opus.** The DB is 640 MB and runtime memory is unmeasured. Astra's asks are unanchored. |
| Model cost | Taken from our ledger (97% cache reads) at current prices: about $1,000 for the heavy night on Sonnet 5, about $600 a month steady (B) | An invented workload at $3/$15 and $15/$75 per M: stale rates that overstate the strong tier about 4× | **Opus (B)**, clearly. |
| File storage | A: a shared volume, no code change. B: move every input into Postgres first. | An object store with a DB manifest; no volume | **A for launch, Astra for the long run.** B and A contradict each other, which is a flaw of the split. |
| Agent web access | A: an open egress proxy. B: the provider's server-side web tools. | Our own search broker plus SSRF defences | **B.** No open egress at all. |
| STAGE self-approval | Keep the owner exception (it is in the code today) | Remove it | A judgment call; it goes to Juan. |

## What each caught that the other missed

**Only the Opus sections:**
- **Measured sizes** (`du`: enrich 1.9 GB, log 652 MB, the 6.9 GB PGlite folder not to move).
- **The Dakota host is on Heroku**, so IP egress rules fail.
- **The code already on `claude/main`:** `d7ab0ad`'s guard covers 60 actions, and the audit trigger
  gap exists because the owner can drop it.
- **The fact-check baseline** (88.5% of facts supported), used to set gate thresholds.
- **Provider-side web tools** remove the need for open egress.
- **Fable is not offered under ZDR.** I checked this and it is correct.
- **C's design detail:** the undo and revert design, the hash-chained audit, `age`-encrypted dumps,
  CI driving the kit's connect flow, and a concrete rate-limit table.

**Only Astra:**
- **Lease fencing tokens**, so a stale worker cannot commit.
- **Readiness and liveness split**, and the **DB connection budget** (34 steady, 62 during a rollout).
- **Dakota lineage:** derived claims carry Dakota content, so dropping the schema is not enough.
- **"A file path in a prompt is not a privacy shield."**
- **Rev 1's last-writer-wins on notes** loses text.
- **The W5 protocol conflicts** need fixing before the first cloud run.
- **Analytics** send titles and error text as well as paths.
- **Migrated queued jobs** must never auto-dispatch.
- **Launch in waves.**
- **The Mac mirror is not a recovery service.**

## Quality

**Opus.**
- *Specific and grounded.* The sections cite files, counts and measured sizes, and build items name
  the functions to change.
- *Two small errors:* A says twelve import kinds (there are 13), and B and C disagree on the spend cap
  ($300 vs $50 a day).
- *Structure:* splitting into three sections duplicated the decisions (Dakota three times) and the
  wishlists, and left the volume-versus-rows conflict unresolved.
- *Overreach:* C's scrubbed-copy pipeline is premature.

**Astra.**
- *Rigorous on failure semantics and trust boundaries,* and honest about what the kit does not
  promise.
- *Weakly grounded:* it read no code and measured nothing; its prices are stale; its sizes are
  unanchored; its effort estimate (23.5–46 engineer-days) is not broken down.
- *Hard to act on:* the prose is dense, with long sentences and many "must"s. Its decisions are broad
  policy statements ("approve a concrete operating policy") rather than crisp questions, and its build
  items are coarse (four L-sized blocks).
- *Scope:* its "don't launch without PL's identity" stance would have made PL's roadmap our critical
  path.

## Verdict

**The Opus sections are the better plan designer for this work.** This project rewards plans that are
anchored in the repo's code, its measurements and its ledger, and that turn into tonight's build
items. The Opus sections do that; Astra's plan mostly does not.

**Astra is the better adversarial reviewer.** About a third of the merged plan's hardening came from
Astra: fencing, readiness, the connection budget, Dakota lineage, versioned notes, wave launch and the
identity pushback.

**Keep using both, in different roles.** Opus designs, one integrated author per plan rather than three
disjoint sections. Astra writes an independent plan or red-teams the draft. Merge with one line of
reasoning per disagreement, as done here. The cost is one extra plan; tonight it bought several real
defects we would otherwise have built.
