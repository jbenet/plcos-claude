## W3 1.3 — Email evidence tiers

Unanswered one-to-one outbound email now yields C ("we wrote, no reply"); bulk mail alone yields D. Two-way personal email and direct meetings remain B. Inbound-only personal email is B with "waiting on us". A rules are unchanged. Path explanations name the evidence case.

The private research export joins cached email metadata to translated interaction refs, preserving bulk flags and recipient classification. No new connector request or migration. Re-export before the integrated live W3 run; old email metadata cannot establish B. Strict recipient and newsletter heuristics may understate personal mail.

Invented nine-LP fixture, measured against the previous implementation: A/B/C/D **0/9/0/0 → 0/3/1/5** (one path per LP). Properties cover direction, bulk flags/types/subjects, preview totals, CC, missing metadata, holder isolation, dates and firm projection. No real records read.

Validation: TypeScript, boundaries and all 1,308 properties pass (PGlite). Postgres validation belongs at merge.
