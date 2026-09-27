# Identity review — deterministic fixture labels and row comparisons

The export property used an eight-character random hexadecimal tag in both names and
public URLs. Reproduced a failure with `78287679`: contact redaction correctly scrubbed
the affiliation name and dropped the phone-shaped URL, while the assertion expected
both unchanged. Fixture tags now map digits to letters without losing entropy. Explicit
numeric-URL coverage keeps the redaction behavior tested; production code is unchanged.

The property-suite audit also fixed unordered snapshots in prospect, prospect-key,
Dakota and institution-alias checks. Enrichment checks select the replacement suggestion
by lifecycle state, and close-track comparisons use exposure IDs rather than tied amounts.

`scripts/identity-review-repeat.ts` repeats the whole identity-review group, fails on the
first failed assertion, and adds 128 invented namesake pairs alongside the demo seed.
Run these sequentially because the harness shares its disposable scratch directory:

```sh
env -u DATABASE_URL node --import tsx scripts/identity-review-repeat.ts 50
DATABASE_URL=postgres://plcos@127.0.0.1:5434/plcos_test_flaky_identity_review node --import tsx scripts/identity-review-repeat.ts 50
```

Validation: PGlite **50/50 iterations, 1,550 checks, zero failures** with the scaled
fixtures; full `npm run props` **960/960**; standalone routes properties **17/17**;
TypeScript and boundaries passed.
The Postgres repetition and full-suite commands were attempted, but the sandbox refused
the loopback connection with `connect EPERM 127.0.0.1:5434` before fixture setup. Postgres
validation remains outstanding. No real data was read and no remote git operations ran.
