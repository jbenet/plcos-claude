# 19 — W5 protocol history

Archive of the design and history through N85. Current rules are in
`docs/workflows/*.md` and AGENTS.md; read only the protocol assigned to the job.

## Protocol — W5, strategy for an LP (version 1)

For one researched LP, read: its finding (`raw/<key>.json`), its line in `candidates.jsonl` (where it
stands with us: status, meetings, the last word from them, our notes' summaries), its paths in
`connections.jsonl`, and our side (`us/team.json`, `us/network.json`, with the Neurotech
portfolio). Write `strategy/<key>.json` (schema: `lib/enrich/strategy.ts`):

- **Fit, per vehicle that could apply.** PLC Neurotech I first; PLC Rails for crypto-native LPs;
  a single-company SPV (the one opening now) for a check below a fund's minimum. A verdict and
  why, and the gates: can their mandate take a specialist or emerging fund, a ten-year duration;
  a conflict (a competing fund, a competing direct position). A gate nobody can answer is `unknown`,
  and asking it becomes an open question.
- **The four scores, each with its basis** (docs/04 §4): capacity, as a band that is labelled an
  estimate; affinity, from their record (neuro, health or deep-tech deals, a stated interest, a
  technical background); propensity (deploying now, recent activity, their engagement with us);
  time to decision (a principal in weeks, a committee in a quarter or more).
- **The angle**: why they would care, in their own record's terms — a company they backed, a
  thing they said. Not a generic pitch.
- **The route**: the best path from W3, with its tier. An existing LP who shares a firm or a
  record with them is the first connector to consider (docs/06 §3.3); a C or D path is named as
  a clue to check, not a route to use.
- **The next action**: one concrete, bounded step, by a named person on our side (the pursuit's
  owner when there is one; the team's neuroscientist for a scientist or a neuro specialist; the
  angel-network lead for an angel; Juan for the largest). When, and with which material. Never a deck with a first intro (docs/06
  §5.2), and never anything that would be sent without a person.
- **The ask**: a fund commitment with a range drawn from capacity; an SPV; a re-up; an intro to
  others, for a connector; advice. **The list**: this year's close (fast deciders, warm, already
  engaged) or the 2027 pipeline (committees, cold) — two lists, never one (docs/04 §4.1).
- **Open questions and risks**: what to find out before the ask; what could go wrong (a stale
  status, a conflict, an identity only probable, silence since the last touch).

Never an inferred health reason, never pressure, never a claim the record doesn't carry.

**Amendments, W5 version 1.1** (from its first two batches):

- **One LP's decision is never disclosed to another** — not a commitment, not a pass, not an amount —
  even to the connector who introduced them.
- **"Committed" without evidence is a check, not a win.** A commitment with no signature recorded
  here, an amount that differs between records, or a note that contradicts the status: the next
  step is to verify it (ask shape `verify first`), not to write to the LP.
- **Read the whole firm.** Colleagues at one firm (W3 links them by name and by work domain) get one
  owner and one ask between them; the ask carried on one strategy is marked `firm-level ask` on the
  others, so it isn't counted twice.
- **An owner before an action.** Most pursuits have no owner on the team, and the meeting records
  don't say who from our side was there. The strategy proposes one and says why; the team's rule
  for who takes which kind of LP is a decision for the team, and the synthesis proposes one.
- **What the export now carries** (W0, from these learnings): the close track's amount and state
  (soft until signed; a source's "signed" is a claim), and meetings on dates four or more LPs share —
  an event, most likely, not a one-to-one.
- **Still missing, for a person:** who from our side was in each meeting; what the last message from
  them said; the first-close date (LPs have asked); the SPV's terms; which LPs are already in the
  Rails conversation (there is no Rails list).

**Amendments, W5 version 1.2** (from its third batch, iteration 3):

- **A shared outreach date is a mailing.** Dozens of LPs share each of the three most common "we
  wrote last" dates. When `contact.outreachShared` is ten or more, the next step is a first personal
  note, not a follow-up — they have never had one.
- **The close-contact mark is tier C, always.** It is relationship strength (CLAUDE.md: a tier-C
  edge) and never says whose contact the LP is. With no owner on the team, the first step is to
  name who holds the relationship and give them the pursuit — before any outreach.
- **A stage that claims contact the log doesn't show is a check.** "Contacted", "Lost – No Response"
  or "First Meeting Held" with no touch on record: the next step starts with checking sent mail or
  confirming the meeting, so we never cross a note we can't see.
- **Run W5 by firm, lead conversation first.** Where a colleague is already talking with us, the
  plan is usually "no separate note; ask inside that thread", taken from the lead's strategy — which
  also carries the firm's mandate. Batches are grouped by firm, and the colleague with the most
  contact is written first, so owners don't clash.
- **Pin the inputs.** `made.inputs.finding` is the finding's `researched.at` (or null when there was
  none). A strategy whose LP has since gained a finding is stale; the checker counts them, and
  they are written again.

**Amendments, W5 version 1.3** (from its fourth and fifth batches):

- **`verify first` is for any records that disagree,** not only commitments: a reply on file and a
  stage that says "Lost – No Response"; a ladder rung the stage contradicts.
- **Fix the contact before any note.** When the organization, title or profile on file is wrong —
  one contact looked like a different person, so an "unanswered" note may never have reached them —
  the first step is to correct it.
- **Our notes can settle an identity, and can mislabel one:** a meeting note naming the exact role
  confirms a probable identity; a note calling a charitable trust a family office moves it to the
  committee lane, and the 2027 list.
- **`co-invest`** is the ask for a specialist fund in our field that already backs our portfolio
  companies: a co-investor relationship, not an LP commitment.
- **Keep the next step short.** The import keeps what, who and when together in 400 characters and
  cuts the rest; the checker counts the ones it would cut. The why belongs in `angle` and `risks`.
- **Read the LP's triage line** (`triage.jsonl`): its first step and reasons come before any plan.

**Amendments, W5 version 1.4** (from its sixth batch):

- **`verify first` when a claim runs ahead of the evidence, or records point opposite ways** — not
  when a stage is merely out of date. A stage that lags the records ("To Research" with a meeting on
  file) is corrected as part of the next step, trusting the records.
- **A record far from investing is a question of identity.** A work address and title belonging to
  someone with no investing at all, with a famous investor of the same name, means the team may have
  meant the other person: fix the contact first.
- **"Last from them" can be a meeting, not a reply.** A meeting counts as from them; the export now
  says how the last touch happened (`contact.lastTouchChannel`).
- **One firm, one money ask.** The checker counts firms whose money is asked for twice (colleagues
  by work domain); the lead conversation's strategy carries it, the others say `firm-level ask`.
- **Someone who has met us needs no introduction:** W11 no longer proposes one.

**Amendments, W5 version 1.5** (from W5c, the critic's first sample: 25 strategies, 10 A, 12 B,
3 C — quality rising with each version; its five recurring problems, and three rule slips):

- **Say only what the record says.** Owning a pursuit is not having been in the meeting. Before
  calling something a reply or a one-to-one, read `contact.lastTouchChannel` and
  `contact.groupMeetings`. A stage is a claim.
- **Evidence gates.** Capacity is a band only with assets or net worth, a check or commitment on
  record, or a filing — otherwise `unknown`. "This year" needs a dated word from them in the last 90
  days, a commitment on the close track, or a meeting that wasn't a group date; otherwise the 2027
  list, until the check in the next step comes back. The checker counts both.
- **Money on file comes first.** When the close track has an amount, the ask starts from it, soft
  and labelled; a strategy never reads "no amount visible" beside one. A historical vehicle, or an
  SPV that never went through, is never a fit.
- **Read every finding at the firm before setting the lead's ask:** a firm's live raise can sit in a
  colleague's finding, not the lead's. A colleague the research found has left is no longer at
  the firm (W3 now groups them with their new one).
- **The lead strategy carries the firm.** Colleagues by work domain and by W3's same-firm links; the
  lead lists every colleague with their owner and status, names the one owner and the one money ask,
  and the others say `firm-level ask`. A partner's personal check at a large firm is marked
  personal, so it isn't a second ask of the firm.
- **A founder of one of our portfolio companies is a reference and a connector first:** the first
  ask is their view and their introductions, and money, if ever, comes after. The same holds for a
  founder of a company Protocol Labs backed (PL's directory marks it "Venture Investment"; Affinity's
  portfolio-founder lists; a protocol.ai logo among their investors).
- **"Raising now," one definition for every strategy and the synthesis:** a Form D, or an amendment,
  with money unsold and dated in the last twelve months, and no later word that it closed. Older
  with nothing newer is a question to ask, never a raise.
- **`ask.unit` names who would commit** — the unit at a firm, or "personal" for a partner's own
  check — so "one firm, one ask, made to the unit that commits" stays machine-readable.
- **An ask carries no range while capacity is unknown** (the critic's round two): a range with no
  evidence of the LP's own money behind it gets round the capacity gate. The checker counts them;
  thirty were unsized by rule, each noting the rule in `made.revised`, with sizing an open question.
- **A firm-level strategy pins its lead:** `made.inputs.lead` is `{ key, at }` — the lead strategy's
  key and its `made.at` — and the checker counts those whose lead has been rewritten since.
- **Re-read the paths just before writing each firm** — `connections.jsonl` is regenerated as
  findings land, and a pinned `bestPath` then marks the strategy stale.
- **An LP outside the US: counsel before any fund material.** What may be sent to, say, a UK
  recipient about a US 506(c) fund, and how a non-US investor is admitted, is a question for
  counsel. The first note carries no fund terms, and the gate is written into the strategy. It
  covers where the investing entity is registered as well as where the person lives (an insurer
  based in the US and registered in Bermuda).
- **A firm's stated scope is not an exclusion, in the next step too:** "focused on direct deals"
  never becomes "…, not funds" in a one-line step.
- **A date an LP was added to our list is not an event:** the list was loaded in bulk on a few days;
  "why are they on the list" is a question for the team, not a date to chase.
- **A work domain that now redirects** (a renamed firm, a move) may mean our emails never reached
  them: the next step is a first personal note to a current address, not a follow-up.
- **A firm that says it doesn't invest in funds** (a quoted exclusion in its finding): the fund
  gate is no. The ask is a co-investment or an SPV at most — or none.
- **A GP raising a fund of their own right now** (a recent Form D with money unsold): lower
  propensity for an LP commitment — an ask of their partners reads as a trade. The ask becomes
  introductions or co-investing. This covers a fund that invests in companies; **a fund of funds
  raising its next vintage is raising money for managers like us** — a timing signal in our favour.
- **"Raising now" needs a date:** a fund announced long ago with no Form D read is neither known to
  be raising nor known to be closed — hold the money ask, and leave the Form D as a question.
- **One firm, one ask — made to the unit that commits:** at a firm with a wealth unit and a fund-of-
  funds unit, the money ask names the unit that would commit, wherever the lead conversation sits.
- **Every Discussing or Committed LP gets a strategy,** from our records when the research found
  nothing: a firm's lead can be one of them.
- **The next step:** one person, one action, a date — under 300 characters with who and when.
  Whatever its own risks say must come first, comes first. **A note to several people never carries
  one person's amount or words.** A connector path keeps the tier the connection file gives it: a D
  is never called C, and never the way in.
- **Pin every input:** `made.inputs` carries the finding's `researched.at`, the close track's
  amount and state, and the best tier among the LP's paths on file (`bestPath`); a change in any of
  them makes the strategy stale.
- **An old address at our own domain joins nobody.** Two LPs who once had protocol.ai addresses
  don't share a firm now; each keeps their own money, and a partner's check at a large firm is
  marked personal.

**Amendments, W5 version 1.6** (from W5c's third round, which graded every "this year" strategy and
every one for an LP who wrote to us last — the ones a person acts on first — against the six
criteria and a seventh, the last word):

- **When the last word is theirs, the next step answers it.** Triage's "reply we owe" means they
  wrote last and nothing from us is on record since. The next step reads what they wrote and answers
  it — the question they asked, the dates they offered — or says plainly why not (a reply may have
  gone from an inbox Affinity doesn't see: check sent mail first; counsel first). A new question of
  ours before theirs is answered is not a reply, and "silence since" is ours, not theirs.
- **One meeting, one date.** Two people at one firm with a meeting on the same day were most likely
  in one meeting: neither is a one-to-one on that record alone. A meeting a note only scheduled is
  not held until a record says so.
- **Owning a pursuit is not a channel.** Who owns an LP's pursuit says who acts, not that they know
  the LP; the way in needs its own record.
- **Cite W3 as it stands.** A path, a W3 row or a connector-plan pairing named in a strategy is one
  the current files carry, at the tier they give it; a tie W3 has since dropped is gone, or at most
  a clue the files don't carry. The checker counts the citations that no longer match.
- **The lead re-reads its colleagues** — their findings and their strategies' `made.revised` notes.
  A firm-level lead is stale when a colleague's finding is newer than it: a filing on one colleague's
  record can change the firm's ask; and a colleague revised first can be ahead of its lead (one call
  read as one, a reply answered first), which a re-pin alone would leave contradicting it.
- **The team's context comes first** (issue 0016): `candidates.jsonl` carries `context`, what the team
  wrote on an LP's page to add to or correct what we know, newest first. It outranks the research
  and the notes' readings; where it contradicts a finding, the strategy follows the team and says so.
  A strategy written before the newest context is stale (`isStale`), so the next revision batch
  re-thinks it.
- **A park carries a date to look again** (the critic's fourth round, on the bulk): "park him until
  the search pass" is a park for good if the pass never runs. `next.lookAgain` holds the date; a gate
  counts a park without one, and `scripts/enrich-look-again.ts` sets it by rule where missing (the
  2027 list on 4 Jan 2027, "not now" on 5 Apr 2027 — guesses for a person to change), recorded in
  `made.revised` without moving `made.at`, so a colleague's pin stays valid.

**Amendments, W5 version 1.7** (from the rewrite after W1's search pass: 20 batches, 299 LPs — some 248
strategies revised or re-pinned, 51 written for identities the pass had just resolved):

- **A re-pin still reads every claim:** the search pass cut facts to their pages' words (W1 1.26), so an
  old strategy can repeat a claim no current fact supports. "No change after the search pass" means no
  change a person acts on, after that read — never a bare update of `made.inputs`.
- **A park "until the search pass" is now due:** each gets a plain dated look-again, or the step the
  pass made possible. The park gate reads parks worded without the word ("waits for", "hold until"), and
  only a date the park itself introduces ("to", "until", "look again") counts.
- **The ask names the unit that commits** (`ask.unit`): a family office's fund-seeding arm, a foundation's
  investment office — and our contact is who routes us there.
- **Affinity, written down** (it drifted between parallel batches): *high* — a personal interest in our
  field in the LP's own words (their writing, a scientific advisory seat); *medium* — their own deals in
  health or neuro, through a firm; *low* — a firm's holdings or an institution's field.
- **A band sizes the unit that commits, with that unit's own money:** the gate refuses a firm's clients'
  money, a fund's target, a company's valuation or sale, and evidence more than six years old. Where a
  finding carries such a band, the strategy stays at unknown and says why — the W1 band and the W5
  reading disagree on purpose until Juan settles which an office's totals may set (open).
- **The records come first:** in several batches half the next steps begin by fixing our own record — a
  merged record, a misspelled name, a dead domain, a renamed firm, a title the pages contradict.
  `scripts/enrich-fixes.ts` lists them for one sitting in Affinity (shown on the enrichment page).
- **Batches carry whole firms, and expire:** a lead rewritten outside its colleagues' batch unpins them;
  the cutter now lets a batch hold its keys for three hours only (a re-pin kept `made.at`, and 28 stale
  strategies went unbatched), and a firm's out-of-batch leads and colleagues get a revision of their own,
  not only a re-pin.
- **Gates fixed on the way:** "(May 2026)" read as the hedge "may"; a Form D's "date of first sale" read as
  a sale; "a parked page" and "Parker" read as parks; triage's "rule out our field" fired on the research's
  own sentences, not the firm's quoted words.

**Amendments, W5 version 1.8** (N81, after Juan found Rails meetings and catch-ups counted for Neurotech):

- **Every meeting date and every note says what it is about** (`about` in `candidates.jsonl`), and
  so do their last eight touches (`contact.recent`, added after the first re-read: an email-only LP's
  emails carried no tag), each with who from our side was on it: a vehicle's name, "vehicle unclear",
  or "general". A vehicle's own rows are evidence of where that
  pursuit stands; general rows are who they are, true for every vehicle; a row tagged with another
  vehicle is context — worth a line when the two asks need coordinating (rule 5), never progress on
  this one. A "vehicle unclear" row is evidence for none: if it decides the next step, the step is to
  ask its owner which vehicle it was.
- **Two contact blocks:** `contact` is the relationship since their raises opened, about anything —
  a reply owed is owed whatever it was about — with what came before summed in `contact.earlier`;
  each pursuit's `contact` is what counts for its vehicle alone. "Met us" for a pursuit means a
  meeting tagged with its vehicle.
- **A strategy written on the old reading is re-read**, not only re-pinned, where its pursuit's
  counted contact changed: the meetings it cited may now be another vehicle's, or a catch-up.

**Amendments, W5 version 1.9** (Juan's capacity answers of 24 Sep; W1 1.49 has the rules):

- **A band by size or a floor counts as evidence, held to its rule.** A strategy may carry the band the
  size table gives — basis "By size: …" — or the angel floor — basis "Floor: …". The gate accepts
  either and flags one that isn't what its rule gives ("capacity off the size table", "a floor without
  the angel checks behind it"). This settles the open question of 1.7: a wealth manager's clients'
  money still isn't the LP's own, but its size now sets an estimate for what such a firm places.
- **The ask follows the band, and says it is an estimate:** "an estimate from their size" beside a
  range, never a range as if they had named it.

**Amendments, W5 version 1.10** (from the re-read of 126 strategies on the tagged records, nine readers):

- **"This year" rests on the pursuit's own contact.** The evidence gate reads each pursuit's counted
  contact — a word from them in 90 days, or a one-to-one meeting, tagged with its vehicle — not the
  relationship's: a catch-up keeps the relationship warm, it doesn't move the raise. Seven strategies
  failed the stricter gate and were read again.
- **A size that is only a lower bound is read at its floor.** A 13F's listed holdings, a "billionaire"
  with no figure, a vehicle's running total: the table's band for that figure, and the basis says it is
  a floor. A figure for a parent, a former employer or a fund's target is no size of the unit that
  commits. The kind is the one named first in the basis ("a multi-family office" is a wealth manager).
- **What the export now carries:** each LP's last eight touches with their tags and who from our side
  was on them (`contact.recent`), so an email's vehicle is read from the file, not guessed. And an
  event is four or more *parties* on one calendar entry — a firm or a person with none — so four people
  from one family office are a meeting.
- **Rungs on records now tagged General are for a person.** 103 rungs on 37 LPs were approved on
  records the re-map reads as not about their vehicle. A strategy says so where it matters and never
  proposes a stage from them; the list is on Approvals, and withdrawing one is Juan's decision.
- **The version is a string from "1.10" on.** JSON reads the number 1.10 as 1.1, and the batch cutter
  took every such strategy for one older than 1.3 (a reader caught it); `versionBefore` compares
  major and minor, and a strategy writes `"version": "1.10"`.
- **The table has no row for** a GP's own funds, an insurer, a pension, a health system's investment
  office, or a corporate venture arm: those stay unknown and say why. Whether to add rows, and whether
  a self-described size counts, are Juan's.
