# SPV stance: whether an LP does SPVs, and how many we know of

| | |
|---|---|
| ![Selection with an SPVs column, on SPV — Cortex](docs/changelog/shots/spv-stance/01-selection-spv-column.webp) | The SPVs column on Selection (does ≥N / doesn't / unknown, whose word it rests on, and "conflict" when evidence disagrees). |

Juan, 27 Sep 2026: "One important thing to check for LPs: whether they do SPVs (and how many, if we
can find out a min number) … Some explicitly do not do any SPVs and we'll need a way to flag that too.
By default starts at unknown (likely open to it)."

**The model.** Each LP unit (docs/23) has an SPV stance: *does* (with an optional least number of
known SPV or co-investment deals, "does ≥ 4"), *doesn't*, or *unknown*, the default, read as "likely
open". It is resolved in code (`modules/strategy/spv-rules.ts`) from three sources, never blended:

1. **A person's setting** on the LP page. It always wins, is audited (`spv.stance_set`,
   `spv.stance_withdrawn`), and is reversible: a new setting replaces the standing one, and
   withdrawing it returns the LP to the evidence. Every earlier setting is kept.
2. **Research facts.** Two new W1 fact fields, under the names the enrichment already writes:
   `spv_appetite` (`does` | `does-not` | `unknown`, with a quote) and `spv_deals` (a whole number, a JSON
   number or digits, with a quote naming the deals where possible). The finding check refuses any
   other value, and a stance or a count without its quote. Import the findings maps both onto the
   stance as research evidence, one row per claim, removed with its claim.
3. **Derived signals**, from "Derive SPV stance" (Developer → Enrich, and a step of Import the
   findings): our own SPVs (a hard commitment, or a pursuit set to Committed, on a vehicle of kind spv:
   does, with the number of our SPVs); Dakota's `co_investments__c` on the matched account (only a
   yes counts; shown as "Dakota: co-invests"); and research claims and profiles that name SPVs,
   co-investments or syndicates, or say "does not do SPVs" or "invests only through funds".

Research stands over derived signals; within a tier the stronger evidence wins (our records, then
Dakota, then text; then confidence; then the newer date), and the evidence on the other side is kept
and shown as the conflict. A count is a lower bound, so the largest agreeing count holds. A research
"unknown" is not a stance: unsupported is not a refusal. Every piece of evidence carries its source,
as of, confidence and who verified it (rule 9). Storage: `strategy.spv_setting` and
`strategy.spv_evidence` (migration `strategy/011`; the job kind in `platform/008`), in the
confidential schema because our own commitments are among the inputs.

**Dakota stays in the database.** The flag is tested inside the database, and only a yes, the
record's date and its importer leave `dakota.account`; the evidence row has a fixed label and never a
quote (a check constraint says so). Its text is not read into the app, the evidence, the page data or
any file. The demo seed carries no Dakota rows; the properties exercise the flag on invented rows.

**Where it shows.**
- **Selection:** an SPVs column (does ≥N / doesn't / unknown, with whose word under it, and
  "conflict" when evidence disagrees), sortable, and an SPVs filter (does or unknown, does, unknown,
  doesn't). On an SPV vehicle a doesn't LP is dimmed with its reason under the name, and the panel
  above Move to Selected says so before anyone moves it; the move stays a person's call. Met and last
  touch now fold into the detail below an 820 px list (was 700) to make room.
- **Fit list:** the same mark on every row, right-aligned before the status, and the stance with its
  reason in the side pane.
- **Strategy:** an SPVs column in the LP table, the stance in each row's basis, and, on an SPV, a
  flag in the row and the basis; the strategy detail on an SPV opens with "Approaching for an SPV".
- **LP page:** an SPVs card with the stance, each piece of evidence (quote, source, date,
  confidence, verifier; which stands and which disagrees), a control to set does / doesn't / unknown
  with an optional count and note, a withdrawal, and the history. On an SPV, a doesn't LP is also
  flagged in the status panel.

**Checked on the demo** (invented LPs on SPV — Cortex, `lib/seed-spv.ts`): research does ≥6, research
doesn't, a person's doesn't over research that says does (conflict shown), a person's does ≥4, research
text in a claim, a profile naming 3 co-investments, our own SPV over a profile saying no (conflict),
Committed on two of our SPVs (≥2), and nothing on file. At 1440×900 and 1180×820 with touch: selection
(column, dimming, filter, the warning), fit (mark and pane), strategy (column and basis), the strategy
detail's note, the LP page (setting saved, withdrawn), and the job on Developer → Enrich.

**Properties** (`scripts/properties/spv-stance.ts`, 16 new): a person's setting wins over every
source in 72 combinations and is reversible and audited; research beats derived, with the conflict
kept; within derived the stronger wins; counts are lower bounds; unknown by default; the text reader;
Dakota's flag; the two fact fields' names and validation; the import mapping them in (a JSON-number
count included); the derive pass (repeatable); Dakota's text never copied out; a setting refusing
what the page does not offer; and a doesn't LP flagged on an SPV's selection and only there.
