# A person's older research files under the organization they speak for · 7 Oct 2026

On 2 Oct some LPs moved from a person to that person's organization (the LP is the committing unit, docs/23). The
person's older research stayed under the person's keys, mostly research-pass slugs, which the export's alias map sent
to the person. The person no longer has a pursuit, so the map dropped those keys. 121 strategies on 108 organizations
pinned no finding at all. Their location (behind the counsel gate), AUM and Form ADV figures, and fact-check
corrections sat in 182 files nothing joined; the writers found them by grepping names.

The research export's `entity-keys.json` now files such an alias under the one LP the person speaks for (a contact on
its row), and the contact's own key too. A contact of two LPs, and anyone who is a candidate in their own right, never
moves. The checker, batches, W3 and the merge script all read this map, so they see the older research on the next
export. Pure property in `scripts/properties/alias-join.ts`; the triage-export, W3 alias and batch properties pass.
