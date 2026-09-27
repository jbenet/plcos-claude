# LP-unit research decisions

Unresolved person-versus-firm pursuits can now be researched outside the database. **Export
the research set** writes `enrich/lp-unit-review.jsonl`: one row per review item, with pursuit
and vehicle IDs, the person, current firm candidates and roles, the rule's evidence and reason,
and amount presence only. The export omits amounts and contact details, scrubs embedded contact
strings and numeric figures, and is not limited by the UI's report cap. Failed exports remove
stale review files and show a persistent retry notice.

**Re-point pursuits to their LP** and **Import the findings** both consume
`enrich/lp-unit-decisions.jsonl`. Valid personal/firm decisions use the LP page's existing
compare-and-restore journal. Each line applies atomically, with pinned evidence, researcher
attribution and an idempotent receipt. Refused lines are listed with reasons. A person's LP-page
answer always wins; neither file retries nor the rule can reapply a reversed answer.

The shared move path now enforces the money guard for every caller, including the LP page:
exposures in either track, money under canonical aliases, capital pools and high ladder rungs
prevent a move to a firm's pursuit. No money is transferred between names.

W14 (`docs/workflows/w14-lp-unit-review.md`) specifies public research, W1 query boundaries,
evidence requirements, unresolved cases, local decision files and human-triggered application.
Migration `strategy/011_lp_unit_decisions.sql` extends the journal with file attribution and
decision receipts; existing migrations are unchanged. Migration numbering is provisional until
integration, as required by `docs/COLLAB.md`.

Validation uses invented fixtures only: export privacy/completeness, personal and firm answers,
malformed/invalid/conflicting lines, money protection, person precedence, rollback after a partial
write, retry idempotence, reversal, and export failure/retry reporting. No real data was read.

Checks passed: `npx tsc --noEmit`, `npm run boundaries`, and `npm run props` (916/916).
The checkout's existing dependency symlink lacked `pg`; validation temporarily used the installed
live-checkout dependencies without changing them, then restored the original symlink. One earlier
run hit an existing identity-review fixture flake: a random hex tag containing seven consecutive
digits was scrubbed as a phone number. The unchanged fixture passed on the final full run.

The requested Postgres command was attempted but stopped before any test ran: the sandbox denied
the TCP connection to `127.0.0.1:5434` with `EPERM`. It must be rerun by the integrator with local
database access:

```sh
DATABASE_URL=postgres://plcos@127.0.0.1:5434/plcos_test_lpr npm run props
```
