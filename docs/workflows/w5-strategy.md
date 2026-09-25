# W5 — Strategy for an LP: fit, scores, angle, route, next step and ask, as a proposal for a person
The rules in force, amendments 1.1–1.10 folded in; `docs/19-enrichment-workflows.md` keeps the design and the history.

## Inputs

For each key in the batch, `data/real/enrich/batches/<batch>.txt`:

- its finding, `raw/<key>.json`, and every finding at its firm;
- its line in `candidates.jsonl`: each pursuit's vehicle, status, rung, owner, stage and the contact
  that counts for that vehicle; `contact`, the relationship since their raises opened (`earlier` sums
  what came before; `lastTouchChannel`; `groupMeetings`; `meetingDates`; `recent`, the last eight
  touches; `outreachShared`), each touch and note with what it is `about` and who from our side was on
  it; `money`, the close track; `notes`, our notes' readings; `context`, the team's own words, newest
  first; `restrictions`;
- its paths in `connections.jsonl`, re-read just before writing each firm (it is regenerated as findings
  land); its line in `triage.jsonl`; its strategy and its colleagues', with their `made.revised`;
- our side: `us/team.json`, `us/network.json`, `presence/site.json`, the Neurotech portfolio;
- `lib/enrich/strategy.ts` (the shape), `lib/enrich/capacity.ts` and the `capacity` block of
  `config/deployment.ts` (the size table and the angel floor); AGENTS.md's "Real data" and "Domain
  rules".

## Output

`data/real/enrich/strategy/<key>.json`, a `Strategy`:

    key, name
    made    { at, by: "claude (sub-agent)", workflow: "W5", version: "1.10",
              inputs: { finding, money, bestPath, lead? }, revised?: [{ at, by, rule }] }
    fit     { <vehicle>: { verdict: strong | good | possible | weak | unknown, why,
                           gates: [{ gate, answer: yes | no | unknown, basis }] } }
    scores  { capacity: { band, basis }, affinity: { level, basis }, propensity: { level, basis },
              timeToDecision: { band: weeks | 1–2 months | a quarter or more | unknown, basis } }
    angle, route: { via, tier: A | B | C | D, why } | null
    next    { what, who, when, material?, lookAgain? }
    ask     { vehicle, shape, range?, unit? }
    openQuestions, risks, list: this year | 2027 | not now, confidence

`ask.shape` is fund commitment, SPV, re-up or upsize, intro to others, advice, verify first, firm-level
ask, co-invest, or none yet. `made.version` is a string: JSON reads the number 1.10 as 1.1.
`made.inputs` pins what it was written from: `finding`, the finding's `researched.at` (or null);
`money`, "<track> <state> <amount>" from `candidates.jsonl` (or null); `bestPath`, the best tier among
its paths (or null); and, on a firm-level strategy, `lead`, `{ key, at }` — the lead strategy's key and
its `made.at`. `made.revised` lists each change made by rule after writing, with the rule.

## Firm rules

- A strategy is a proposal for a person, never a decision: it becomes a suggestion someone accepts or
  dismisses, never a status, a rung, money or a send. Nothing is sent without a person. Soft is soft
  until signed (AGENTS.md, rule 1).
- Never an inferred health reason, never pressure, never a claim the record doesn't carry. Our notes'
  readings arrive with health detail redacted and the redaction marked in the text ("[health detail
  redacted]"); nothing puts it back.
- One LP's decision is never disclosed to another — not a commitment, not a pass, not an amount — even
  to the connector who introduced them. A note to several people never carries one person's amount or
  words.
- Web: docs/19 allows searches only to verify a key fact, on W1's query rules; the `strategy-writer`
  agent has no web tools and its definition says no web (which stands is open, for Juan). Any request
  made keeps to these, verbatim from AGENTS.md's "Real data" (CLAUDE.md imports it): A search may carry
  an LP's name with their organization, title, location and topic words, to read public pages. It never
  carries a status, an amount, a note, a list name, or the fact that they are in this pipeline. A
  request carries no identity of ours: no email, name or product name in any header — a User-Agent
  included (docs/19, W1 1.36). Where a service requires a contact address (SEC's fair-access policy asks
  for one in the User-Agent), use `blue.tunguska@agentmail.to` — Juan's privacy-preserving address, 24
  Sep 2026 — and nothing else; a service that wants more identity than that is asked about first.
  Government sites are read sparingly and by their own rules: SEC at most one request a second (its
  limit is ten), no bursts or loops over names, and a 403, 429 or 503 means stop and come back later (W1
  1.48). Juan's own address is never used in a request. No sign-ins, no paid services, no contact-data
  brokers, nothing posted.
- Everything real lives under `data/real/`, which git ignores. None of it goes into a commit, the
  changelog, a screenshot, the published build log, `issues/`, a web search or a sub-agent prompt. The
  reply carries no names.

## What to look for

- **Gates, yes or no:** a check size against our minimum; a mandate that takes a first, emerging,
  specialist or single-sector fund, and a ten-year duration; a conflict — a competing fund, a competing
  direct position; whether they are deploying now.
- **Four scores, each with its evidence and a date, never one number:** capacity; affinity (neuro,
  health or deep-tech deals, a technical background, a stated interest); propensity (deploying now,
  recent commitments, hires, liquidity, their engagement with us); time to decision (a principal in
  weeks, a committee in a quarter or more).
- **Who decides:** who signs, influences, gatekeeps, informs. In a family office the analyst is the
  first contact and a gatekeeper.
- **Connections:** moderate ties convert best. Existing LPs are the most under-asked connectors ("who
  are the two or three people you think should see this?"); podcast guests and service providers make
  good pools. PL and crypto credibility does not carry to traditional family offices.

## Reading the records

- **The team's context comes first.** It outranks the research and the notes' readings; where it
  contradicts a finding, follow the team and say so. Then the triage line: its first step and reasons
  come before any plan.
- **Say only what the record says.** A stage is a claim, and so is a source's "signed". Owning a pursuit
  is neither having been in the meeting nor a channel: the way in needs its own record. Before calling
  something a reply or a one-to-one, read `contact.lastTouchChannel` and `contact.groupMeetings`: the
  last touch "from them" can be a meeting. An event is four or more parties on one calendar entry (a
  firm, or a person with none), so four people from one family office are a meeting — though
  `groupMeetings` and a date's `group` mark also count any date four or more LPs share. Two people at
  one firm with a meeting on the same day were most likely in one meeting: neither is a one-to-one on
  that alone. A meeting a note only scheduled is not held until a record says so. The date an LP was
  added to our list is not an event: "why are they on the list" is a question for the team, not a date
  to chase.
- **What a row is about.** A vehicle's own rows are evidence of where its pursuit stands; "general" rows
  are who they are, true for every vehicle; a row tagged with another vehicle is context — a line when
  the two asks need coordinating (rule 5), never progress on this one. A "vehicle unclear" row is
  evidence for none: if it decides the next step, the step is to ask its owner which vehicle it was.
- **Two contact blocks.** `contact` is the relationship, about anything: a reply owed is owed whatever
  it was about. Each pursuit's `contact` is what counts for its vehicle alone, and "met us" for a
  pursuit means a meeting tagged with its vehicle.
- **Rungs approved on records now tagged General** are for a person: say so where it matters, and never
  propose a stage from them (the list is on Approvals; withdrawing one is Juan's decision).
- **Our notes can settle an identity, and mislabel one.** A meeting note naming the exact role confirms
  a probable identity; a note calling a charitable trust a family office moves it to the committee lane
  and the 2027 list. A record far from investing — the work address and title of someone with no
  investing at all, beside a famous investor of the same name — is a question of identity: fix the
  contact first.

## Fit, scores and angle

- **Fit, per vehicle that could apply:** PLC Neurotech I first; PLC Crypto/Rails for crypto-native LPs;
  a single-company SPV (the one opening now) for a check below a fund's minimum. A verdict and why, with
  the gates. A gate nobody can answer is `unknown`, and asking it becomes an open question. A historical
  vehicle, or an SPV that never went through, is never a fit.
- **A firm's own words are gates.** A quoted exclusion of funds makes the fund gate no: the ask is a
  co-investment or an SPV at most, or none. A stated scope is not an exclusion, in the next step too
  ("focused on direct deals" never becomes "…, not funds"). A claim only an LP database's summary makes
  is a question, never a gate.
- **Capacity** is a band, labelled an estimate, that sizes the unit that commits with that unit's own
  money: assets or net worth, a check or commitment on record, a filing. That wins whenever it exists;
  the bands by rule are for when that is all there is, each held to its rule: the size table's band for
  the unit's size (basis "By size: …", off `config.capacity.bySize`), or the angel floor (basis "Floor:
  …", five or more of their own angel checks — fewer, or a fund's deals, set nothing). Otherwise
  `unknown`, and say why. No evidence: a firm's clients' money (though a wealth manager's size may set a
  band by size), a fund's target, a company's valuation or sale, a figure for a parent or a former
  employer, evidence more than six years old. A size that is only a lower bound — a 13F's listed
  holdings, a "billionaire" with no figure, a vehicle's running total — is read at its floor: the
  table's band for that figure, the basis saying it is a floor. The kind is the one named first in the
  basis ("a multi-family office" is a wealth manager). The table has no row for a GP's own funds, an
  insurer, a pension, a health system's investment office or a corporate venture arm: those stay
  `unknown` and say why (adding rows, and whether a self-described size counts, are Juan's decisions).
- **Affinity:** high — a personal interest in our field in the LP's own words (their writing, a
  scientific advisory seat); medium — their own deals in health or neuro, through a firm; low — a firm's
  holdings or an institution's field.
- **Propensity and raising.** A GP raising a fund of their own right now has lower propensity for an LP
  commitment — an ask of their partners reads as a trade — so the ask becomes introductions or
  co-investing. That is a fund that invests in companies: a fund of funds raising its next vintage is
  raising money for managers like us, a timing signal in our favour. "Raising now," for every strategy
  and the synthesis: a Form D or an amendment with money unsold, dated in the last twelve months, and no
  later word that it closed. Older with nothing newer is a question to ask, never a raise; a fund
  announced long ago with no Form D read is neither raising nor closed — hold the money ask, and leave
  the Form D as a question.
- **The angle:** why they would care, in their own record's terms — a company they backed, a thing they
  said. Not a generic pitch.

## Route, ask and list

- **The route:** the best path from W3, at the tier its file gives — a D is never called C, and never
  the way in; a C or D path is a clue to check, not a route to use. Cite W3 as it stands: a path, a W3
  row or a connector-plan pairing the current files carry; a tie W3 has dropped is gone, or at most a
  clue the files don't carry. An existing LP who shares a firm or a record with them is the first
  connector to consider. An old address at our own domain joins nobody.
- **A founder of one of our portfolio companies,** or of a company Protocol Labs backed (PL's directory
  marks it "Venture Investment"; Affinity's portfolio-founder lists; a protocol.ai logo among their
  investors), is a reference and a connector first: the first ask is their view and their introductions;
  money, if ever, comes after.
- **The ask:** a fund commitment with a range drawn from capacity; an SPV; a re-up; an intro to others,
  for a connector; advice; `verify first`; `co-invest`, for a specialist fund in our field that already
  backs our portfolio companies — a co-investor relationship, not an LP commitment. `ask.unit` names who
  would commit: the unit at the firm (a family office's fund-seeding arm, a foundation's investment
  office — our contact is who routes us there), or "personal" for a partner's own check.
- **Money on file comes first.** When the close track has an amount, the ask starts from it, soft and
  labelled; never "no amount visible" beside one. With no money on file, an ask carries no range while
  capacity is `unknown`. A range from a band says "an estimate from their size", never a range as if
  they had named it.
- **The list:** this year's close (fast deciders, warm, already engaged) or the 2027 pipeline
  (committees, cold) — two lists, never one — or not now. "This year" rests on the pursuit's own
  contact: a word from them in the last 90 days, or a one-to-one meeting, tagged with its vehicle; or a
  commitment on the close track. A catch-up keeps the relationship warm; it doesn't move the raise.
  Otherwise the 2027 list, until the check in the next step comes back.
- **Who gets one:** every Discussing or Committed LP, from our records when the research found nothing
  (a firm's lead can be one of them). Skip an unresolved identity unless our own records alone support a
  strategy. An LP with no finding (W9's "warm now" lane) gets one from our records — its triage line
  says why it is warm — at `low` confidence, with "research them" among the open questions.
- **Open questions and risks:** what to find out before the ask; what could go wrong — a stale status, a
  conflict, an identity only probable, silence since the last touch.

## The next step

- **One person, one action, a date:** concrete and bounded, under 300 characters with who and when (the
  import keeps what, who and when together in 400 and cuts the rest); the why goes in `angle` and
  `risks`. When, and with which material — never a deck with a first intro. Whatever its own risks say
  must come first, comes first.
- **An owner before an action.** The pursuit's owner when there is one; otherwise the strategy proposes
  one and says why — the team's neuroscientist for a scientist or a neuro specialist, the angel-network
  lead for an angel, Juan for the largest. (Who takes which kind of LP is the team's rule to set.) The
  close-contact mark is tier C, always, and never says whose contact the LP is: with no owner, the first
  step names who holds the relationship and gives them the pursuit, before any outreach.
- **When the last word is theirs, the next step answers it** — the question they asked, the dates they
  offered — or says plainly why not (a reply may have gone from an inbox Affinity doesn't see: check
  sent mail first; counsel first). A new question of ours before theirs is answered is not a reply, and
  "silence since" is ours, not theirs.
- **The records come first.** When the organization, title or profile on file is wrong, correct the
  contact before any note: an "unanswered" note may never have reached them. A stage that claims contact
  or a meeting with no touch on record: check sent mail or confirm the meeting first. A work domain that
  now redirects (a renamed firm, a move): a first personal note to a current address, not a follow-up.
  `scripts/enrich-fixes.ts` lists the record fixes for one sitting in Affinity; a person makes them.
- **A shared outreach date is a mailing:** when `contact.outreachShared` is ten or more, the next step
  is a first personal note, not a follow-up — they have never had one.
- **`verify first`** when a claim runs ahead of the evidence or records point opposite ways: a
  commitment with no signature recorded here, an amount that differs between records, a note or a reply
  on file that contradicts the stage, a ladder rung the stage contradicts. The step verifies; it doesn't
  write to the LP. A stage that merely lags the records is corrected as part of the next step, trusting
  the records.
- **Someone who has met us needs no introduction.**
- **Outside the US, counsel before any fund material.** For an LP placed outside the US — where they
  live, or where the investing entity is registered — what may be sent, and how they would be admitted,
  is a question for counsel: the first note carries no fund terms, and the gate is written into the
  strategy.
- **A park carries a date to look again** (`next.lookAgain`), and so does a park worded without the word
  ("waits for", "hold until"); only a date the park itself introduces ("to", "until", "look again")
  counts. A park whose event has come (the search pass) gets a plain dated look-again, or the step the
  event made possible. `scripts/enrich-look-again.ts` sets a missing date by rule — the 2027 list on 4
  Jan 2027, "not now" on 5 Apr 2027, guesses for a person to change — in `made.revised`, without moving
  `made.at`, so a colleague's pin stays valid.

## One firm, one ask

- Colleagues at one firm — by work domain, organization and W3's same-firm links; a colleague the
  research found has left is no longer at it — get one owner and one money ask, made to the unit that
  commits, wherever the lead conversation sits.
- The lead conversation's strategy is written first (the colleague with the most contact) and carries
  the firm: it reads every finding at the firm before setting the ask (a live raise can sit in a
  colleague's), lists every colleague with their owner and status, names the one owner and the one money
  ask, and carries the firm's mandate. The others say `firm-level ask` and pin the lead; where a
  colleague is already talking with us, the plan is usually "no separate note; ask inside that thread".
  A partner's personal check at a large firm is marked personal, so it isn't a second ask of the firm.
- The lead re-reads its colleagues' findings and their strategies' `made.revised` notes: a colleague
  revised first can be ahead of its lead, and a re-pin alone would leave the lead contradicting it.

## Pins and staleness

A strategy is stale, and is written again, when its finding is newer than `made.inputs.finding` or was
corrected after `made.at`; when the close track or the best tier among its paths differs from its pin;
when the team's context is newer than it; for a firm-level strategy, when its lead has been rewritten
since `made.inputs.lead.at`; and, for a lead, when a colleague's finding is newer than it (a filing on
one colleague's record can change the firm's ask). A re-pin still reads every claim against the current
files: "no change" means no change a person acts on, after that read — never a bare update of
`made.inputs`. Where a pursuit's counted contact changed, the strategy is re-read, not only re-pinned.

## The litmus test

Juan's question, which every iteration ends with and the critic (W5c) grades against: "step back and
look at the info available + current proposed strategies: does this look good enough to act on to
translate into results? or can we find much better info out there to improve the strategy? or can we
think of more creative ideas to improve our strategy?" What it turns up becomes the next amendment.

## Running W5 as a sub-agent

The `strategy-writer` agent. Its prompt names only its batches and what the pass is for. A local
sub-agent may read a research batch under `data/real/enrich/` and write its findings back there; its
prompt still carries no real data, and it never runs remotely.

1. Read, in full: this file; `lib/enrich/strategy.ts` and `lib/enrich/capacity.ts`; the `capacity` block
   of `config/deployment.ts`; AGENTS.md's "Real data" and "Domain rules"; the finished strategies in
   `data/real/enrich/strategy/`.
2. For each key in the batch, read its inputs and write `strategy/<key>.json`. Write only inside
   `data/real/enrich/strategy/`; no git.
3. Run the check and fix what it reports for your keys. Reply with counts (written, skipped; by list; by
   ask; routes A/B vs C/D vs none), the checker's strategy line, and three to six learnings. No names.

**Batches keep a firm together.** `DATA_PROFILE=real npx tsx scripts/enrich-batch.ts w5 <prefix> [size]`
cuts them: a firm whole — the lead, and its colleagues by work domain and organization — with the lead
first. `--revise` takes strategies written before 1.3, flagged by a gate, or with a next step over 300
characters, with their firms; `--keys <file>` takes the LPs listed, with theirs. A batch holds its keys
for three hours (a guess). Rewriting a lead unpins its colleagues in other batches, so one re-pin step
runs after all batches finish, and a firm's out-of-batch leads and colleagues get a revision of their
own, not only a re-pin. The checker's lists feed the next batch — `--lead-moved`, `--unpinned`,
`--gated`, `--stale-ties`, `--naming`, each followed by a file to write the keys to.

## The check

    DATA_PROFILE=real npx tsx scripts/enrich-check.ts

Fix what it reports for your keys. It refuses a strategy whose key doesn't match its file name; with no
fit; a score without a basis; no angle; a next step without what and who, or one that reads as an
automatic send; an ask without a vehicle; a list other than this year, 2027 or not now; a route tier
outside A–D. Its gates, counted by name and listed by `--gated`:

- "this year, without the evidence gate" — no word from them in the last 90 days and no meeting in the
  contact counted for any of their pursuits (the relationship's one-to-ones where the export has none),
  and no money on the close track. The rule above is stricter: the pursuit's own vehicle;
- "capacity ahead of the evidence" — a band with no money on file, no evidence of the unit's own money
  in the finding's band, its capacity or check-size facts (assets too, for a principal, a foundation or
  an angel) or our notes, and no band by rule that holds;
- "capacity off the size table", and "a floor without the angel checks behind it" — a band by rule that
  isn't what its rule gives (the floor test counts checks, not whose they are: that part is yours);
- "route better than the best path on file";
- "ask sized without capacity" — an amount in the range while capacity is unknown and no money is on
  file;
- "outside the US, no counsel gate" — the finding or our record places them, neither in the US, and
  "counsel" appears nowhere in the angle, the next step, the risks or the open questions (it can't see
  where an investing entity is registered: that part is yours);
- "a park with no date to look again".

Its strategy line also counts strategies stale against their pins; next steps over 300 characters, and
over the import's 400; firms asked for money twice (colleagues by work domain); firm-level strategies
whose lead was rewritten since (`--lead-moved`) or that pin no lead (`--unpinned`); leads older than a
colleague's finding; strategies that name an LP the files don't join to them (`--naming`), cite a W3 tie
the files no longer carry, or cite a tier W3's file doesn't give the pair (`--stale-ties`).
