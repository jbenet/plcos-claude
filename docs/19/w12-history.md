# 19 — W12 protocol history

Archive of the design and history through N85. Current rules are in
`docs/workflows/*.md` and AGENTS.md; read only the protocol assigned to the job.

## Protocol — W12, what each event is about (version 1)

Juan, 24 Sep: "some meetings or notes from affinity are getting attributed to PLC Neurotech when they
may be for PLC Rails, or they may just be general catchups. Hmm maybe tag each event with which
vehicles (if any) it involves … Important that the info feeding strategy is appropriately tagged for
the vehicle. some of the info will apply regardless of vehicle, but some will be specific."

The rules (N59, N81; `lib/connectors/affinity/about.ts`) read words. They cannot tell neurotech the
field from PLC Neurotech I, a portfolio company from its SPV, or which fund "the fund" means, and until
N81 they read every meeting with a colleague on the invite as about the raise. W12 reads each record
whole, as a person would, and writes one tag per record. Translation lays the tags over the rules; a
person's tag on the LP's page stands over any of them. Only a record tagged with a vehicle, inside its
raise window, counts for that vehicle's pipeline and ladder; the rest are shown, labelled, and count
for none.

**Input.** `data/real/tags/batches/tNN.json`, cut by `scripts/event-tag-batch.ts` from a copy of the
database: `vehicles` (slug, name, kind, aliases, raise window) and `records`, each LP's together,
oldest first. A record: `ref`; `kind` (email, meeting, call, message, note); `on`; `dir`; `words` (an
email's subject or a meeting's title); `note` (the words of the note on it, or of the note itself);
`noteBy`; `team` (who from our side); `lps` (the LPs on it, each with the vehicles they are on and the
status there); `rule` (what the rules read, and why).

**Output.** `data/real/tags/out/tNN.json`:
`{ "batch": "tNN", "by": "claude (sub-agent)", "at": <now>, "tags": { "<ref>": { "about": "raise" | "other", "vehicles": [<slug>, …], "basis": "<why>" } } }`,
one line for every record in the batch and none for anything else.

**About a raise** means about raising money for one of *our* vehicles — the batch's `vehicles`: an
intro to invest, a pitch or a first meeting about investing with us, the deck, the data room, the
terms, a question about the fund, an indication, a commitment, subscription documents, a side letter,
a capital call, a close, or a follow-up on any of these. Everything else is **other**, which the page
shows as *General*: a catch-up, research or science, a portfolio company's business or its own raise,
someone else's fund (theirs, or one we are an LP in), an event and its logistics, recruiting, an
investor update a company sends us, an automatic reply. General is not noise: it applies to every
vehicle, and the strategy step reads it as who they are.

**Which vehicle**, only when the record's own words, or a record it plainly continues, point to it:

1. **It names the vehicle** as our fund or SPV: the name, or an alias used that way. A word that is
   also a field or a company is not enough — "neurotech" the field, a portfolio company by name
   ("their board meeting") is not its SPV — unless the talk is about investing in it through us, near
   the SPV's window.
2. **It speaks of what only one vehicle is**, when the talk is about investing with us:
   brain–computer interfaces, neuroscience, neurotech → PLC Neurotech I; crypto, stablecoins,
   payment rails, blockchain infrastructure → PLC Crypto/Rails.
3. **It continues a record that points to one**: the same thread ("Re:", the same subject), the note
   on the same meeting, the follow-up an earlier record asked for. The basis begins "Continues:".
4. **Inferred.** About raising with us, no word that picks a vehicle, and every LP on it is on the
   list of exactly one vehicle — the same one — whose raise window covers the date: that vehicle, with
   a basis that begins "Inferred:" and says why ("Inferred: 'the fund', and they are on PLC Neurotech
   I's list only"). Juan asked to have bulk decisions made for him, traceable by rule; this is that
   rule, and a search for the word finds every one of them.
5. **Otherwise unclear:** about a raise, `vehicles: []`. Say in the basis what it most likely is, if
   anything ("'the fund'; they are on both lists").

A record about two vehicles gets both. A list is never a reason on its own: a catch-up with someone on
Neurotech's list is other. The date alone is never a reason. The rules' reading is a hint: often right
about a named vehicle, often wrong about the rest; confirm or overturn it on the words.

**A record with nothing to read** — no words, no note — is other, "Nothing on record says what it
was", unless it plainly continues a neighbour (3).

**The basis** is 25 words or fewer and quotes at most 10 of the record's: no health detail (write
"[health detail]" if it matters), no amount, nothing personal, no name of anyone outside the team.

**The check.** `DATA_PROFILE=real npx tsx scripts/event-tag-merge.ts --check tNN` reads the output
against the batch — a line for every record, "raise" or "other", only the batch's vehicles, none with
"other", a basis within bounds and free of health words — the same check translation makes when it
loads the merged file. Fix what it reports.

**Amendments, W12 version 1.1** (after the first pass: the readers split on our own events):

- **Our own events are about the fund they court.** An investor event we host — a dinner, a breakfast,
  a salon, a roundtable, a speaker invitation — whose name or theme is one vehicle's (neurotech,
  brain–computer interfaces → PLC Neurotech I; crypto, stablecoins, payment rails → PLC Crypto/Rails)
  is about that vehicle's raise: it is how we raise. The basis begins "Our event:". One about the firm
  as a whole gets both funds only if its words take in both; otherwise the vehicle is unclear. A
  Protocol Labs or portfolio demo day, a conference, someone else's event and general networking stay
  General. Three readers had filed our events as General and one as the fund's; Claude decided this on
  Juan's standing instruction to decide in bulk (24 Sep), for him to overturn — a search for "Our
  event:" finds every one.
- **A second copy of a meeting takes the first's tag.** The calendar and a list entry can each hold the
  same meeting; the readers found the copies read differently. Tag them alike, and say "Continues:".
