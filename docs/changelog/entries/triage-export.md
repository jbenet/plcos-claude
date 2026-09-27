## Triage export — recorded contact for reply drafts

“Export the research set” also writes `enrich/triage.jsonl`. W9's existing rules run for each
LP × vehicle, so a second vehicle's status or owner is not hidden behind the first pursuit.
Rows retain the existing lane/reason fields and add vehicle slug/name, status, owner handle,
lanes, export time, the last five recorded touches, days since last inbound/outbound, and the
existing mass-mailing flag. Rows and tied touch dates have stable ordering; no lane rows means
an empty file.

Touches carry date, direction, channel, stored subject/title, team handles and a stored snippet
only when available (one line, up to 280 characters). Shared/unknown direction stays null.
Subjects come from our stored interaction records; the export makes no connector requests.
Email addresses and phone numbers are redacted from every free-text field. Missing content
stays null. The bulk timeline read is reused, and the added database queries are batched.

The file stays beside the other enrichment exports. Real-profile path overrides are refused;
triage replacement is atomic within that folder. The file-only W9 refresh preserves exported
touch details and asks for a fresh export if a newly eligible pair has no recorded snapshot.

[W9d](docs/workflows/w9d-reply-drafts.md) reads the assigned triage rows, W1 findings and W5
strategies. It writes a short internal brief, checks and an owner-editable DRAFT under
`enrich/drafts/<date>/<key>-<vehicle>.md`. Missing facts stay questions. Restrictions withhold
a draft; nothing sends.

Validation uses invented demo fixtures only. No real records were read or exported during
development. No UI change or screenshot.

`npx tsc --noEmit`, `npm run boundaries`, and `npm run props` pass: **748/748 properties**,
including eight new triage properties. The performance fixture has 500 LPs, 1,000 pursuits,
5,000 touches, 500 W1 findings and 500 connection records. The research baseline took 266 ms
and 17 queries; the full export took 316 ms and 19 queries. No existing export deadline is
configured; the regression ceilings are explicitly estimates (30 s total, 5 s added).
The three fixed W9d review cases pass: missing message text, newer outbound, and a restricted
approach.
