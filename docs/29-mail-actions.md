# 29 — Mail actions: what PLC OS learns from the mail juanmail reads

**Status:** built on `claude/project-thread-isggv5`, 9 Oct 2026. The desk's playbook is
[docs/workflows/mail-actions.md](workflows/mail-actions.md); `outreach_playbook` returns it.

Juan, 9 Oct 2026: "I'd like you to develop some workflows or actions to run on top all the mail my new mail client reads
related to PLCOS": update pipeline status from the conversation or by explicit choice; update what we know about the LP
or connector ("role based, not identity based") — interest, soft commits, the questions they ask; evolve strategy from
the threads; get people's latest contact info and addresses. "Coordinate with JuanMail ... get these implemented +
working across both projects."

## 1. The split

juanmail reads the mail; PLC OS keeps what it learned and decides nothing on its own. So:

- **The desk reads.** Per new message in a PLC OS thread: metadata (`comms_ingest`, as since 5 Oct), contact details from
  the sender's signature by rules (no model), and signals by one small model call. The words never leave the desk: PLC
  OS gets a summary and at most a short quote.
- **PLC OS keeps, suggests, sums.** Deterministic, no model call here: the readings beside the LP, suggestions as ready
  `outreach_update` payloads, sums per vehicle for strategy, and the rungs a reply supports.
- **Juan clicks.** A status, an indicated amount or a next step changes only when he accepts the suggestion (the update
  box's rule since 4 Oct 2026, docs/27 §5). The rungs are the exception he made on 8 Oct: Reconciliation records the
  conversation rungs on a reply on file (§4).

## 2. Signals — `outreach_record_signals`, `outreach_signals`

`email.mail_signal` (email 022): one row per message, person or firm, kind and LP. Kinds: interest, soft_commit,
indication, question, objection, decline, timing, materials_request, meeting_request, referral, intro_offer, other.
Each has the person's **role in that thread** — `lp`, `connector`, `other` — so an LP who offers an intro is a connector
there and keeps being an LP elsewhere (Juan: "role based, not identity based"). A reusable `topic` lets the sums group
what LPs ask about. A person is named by pursuit, entity or address (matched to an email claim, as `comms_ingest` does;
licensed addresses never). An LP's signal without a pursuit is tied to its one open pursuit on the caller's vehicles, or
answers `pursuitCandidates`.

- **Readable** where the vehicle's words are (R2), amounts where amounts are (R1); a signal with no vehicle (a connector
  on none) needs all-vehicle access. Health details are redacted when read (docs/27 §8).
- **Idempotent.** The same message again replaces its readings; `dismiss` hides a wrong one and keeps it.
- **Audited** without words: kinds, counts, the pursuits, who read it (`readBy`: "rules" or the model's id).
- **Writes nothing else.** No status, update, indication, touchpoint, rung or ticket (a property).

Promoted to its own table at birth rather than `research.note`: the desk's tool keys it by message, and the sums filter
by kind and topic (AGENTS.md promotion rule: "a tool needs a precise input").

## 3. Suggestions

`suggest()` in `lib/outreach/signals.ts`, pure, from the signal and the pursuit's state now:

| Signal (from them) | Suggestion |
|---|---|
| an LP engaging (interest, question, objection, timing, materials, meeting, an amount) while New–Connecting, or Passed | status → Discussing |
| an LP declining (not Committed) | status → Passed, by them |
| an amount that differs from the indication on file | indicated amount (never soft money: rule 1) |
| a question, objection, request, timing | a next step, dated (two days; timing: their date, else two weeks) |
| a connector's intro offer or referral | a next step |

Never backward, never to Committed, never on our own words. No touchpoint either: the message is already in the trace
(Juan, 5 Oct: "let email be the state"). Each carries an idempotency key from the message, so a double click is one update.

## 4. A reply in Gmail is a reply on file

Reconciliation read only Affinity's and the calendar's records, so a reply juanmail saw and Affinity had not synced
moved nothing. Now `reconcile` reads each pursuit's merged trace (`tracePairs`), so a Gmail message counts once — the
same message Affinity has is one record — and a received one counts as a reply only when the LP sent it: the sender's
address is an email claim of the LP, of a contact on their pursuit, or of someone acting for the LP's firm now
(`sentByThem`). Copied on someone else's message is not a reply; auto-replies are not either. `comms_ingest` runs
Reconciliation for the LPs its new received messages are about, at once, and answers how many it looked at
(`reconciled`). It records only what Juan allowed on 8 Oct (connector, LP opted in, Meeting held), marked as
Reconciliation's and undoable on the timeline; above them it still asks.

## 5. Contact details — `outreach_propose_contact`, `outreach_contacts?details=1`

Besides an address: `phone`, `title`, `organization`, `postalAddress`, `linkedin`. `source: "gmail-signature"` is read from
the sender's own message and not confirmed: a `medium` claim dated by the message (`seenOn`), source document
`gmail-signature:<owner>` (weak strength). `source: "gmail"` is confirmed by the owner (`confirmedBy` now required), `high`.
A newer reading from the same source supersedes the older one (for an address, only the same address, since people have
several); another source's value is kept and said back. `outreach_contacts` with `details` adds, per person, the newest
reading of each field with its source, date and whether a person confirmed it.

## 6. Strategy — `outreach_insights`, W5

- `outreach_insights?vehicle=` sums a vehicle's signals: by kind, by topic within kind (case aside), by role, by month,
  with the latest examples, and the amounts named in mail (latest per LP; its own figure, never added to soft or hard).
  It is what the team reads to change the pitch, the FAQ and the materials.
- The W5 strategy pass reads each LP's readings (`mail` in `candidates.jsonl`, docs/workflows/w5-strategy.md), ranked
  with the notes' readings.

## 7. Cost

Nothing here calls a model. The desk's reading is one small call per new message with their words, none for our own
sends, auto-replies or notices, and no backfill until Juan asks (his Claude limit, 9 Oct; an API key bills apart).

## 8. Open

1. **Status from mail on its own** (asked 9 Oct): whether Reconciliation may also move status forward from the trace
   (our email → Connecting, their reply or a meeting → Discussing), undoable, as it records rungs. Until Juan says so, a
   status moves only on his click.
2. **The LP page** shows the readings only through `outreach_signals` and the W5 strategy for now; a "From mail" panel on
   the LP page is a later step if Juan wants it there too.
