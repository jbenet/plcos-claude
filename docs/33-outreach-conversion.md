# 33 — Outreach conversion, one page per vehicle

**Status:** proposed 14 Oct 2026; charts 1–6 built the same day (`/<vehicle>/conversion`), 7–10 wait on DocSend. Juan: "need a tool to understand how outreach is converting per
vehicle. Include progression in pipeline, and views in the datarooms (need docsend api). Start by
scoping this out as a page per vehicle. Figure out what good graphs can show us what's working / not
working." First vehicles: PLC Neurotech I and the Netholabs SPV.

**Address:** `/<vehicle>/conversion`, beside LP stats. `/all/conversion` compares vehicles side by
side, never summed (rule 1).

---

## 1. The question each chart answers

The page answers four questions, in this order. Every chart names its base (n), its window and its
sources; a segment with fewer than 10 LPs shows its counts but no rate, and every rate carries an
interval, because "what's working" on 30 LPs is mostly noise and the page should say so.

| # | Chart | Question | Status |
|---|---|---|---|
| 1 | **Funnel with drop-off**: Reached → Replied → Met → Indicated → Committed, with the share that went on and the median days between steps | Where do LPs stop? | Builds now |
| 2 | **Weekly cohorts**: LPs first reached each week, and the share that replied, met, committed by now | Is outreach getting better or worse? Is a cohort still young? | Builds now |
| 3 | **What converts, by segment**: reply and meeting rate (with interval and n) by way in (warm intro, direct, they came to us), sender, LP type, check size, score band, fit | Which approach and which LPs work? | Builds now |
| 4 | **Waiting, by age**: LPs reached with no reply, and LPs met with no next step, in 0–7, 8–14, 15–30, 30+ day bins, each bin a list | What is stuck right now? | Builds now |
| 5 | **Weekly throughput**: mail we sent, replies, meetings held, LPs moved forward, per week | Is the effort there, and does it turn into anything? | Builds now |
| 6 | **Money over time**: hard to date against the target, soft beside it, never added | Is the raise on pace? | Builds now |
| 7 | **Dataroom funnel**: links sent → opened → read past half → came back, per LP | Does the material get read? | Needs DocSend |
| 8 | **Engagement vs outcome**: LPs by time in the dataroom, coloured by whether they met or committed | Does reading predict a yes? | Needs DocSend |
| 9 | **Where the deck loses people**: page-by-page share of viewers still reading | Which page to fix? | Needs DocSend |
| 10 | **Read it, nobody followed up**: views in the last 14 days with no touch from us since | Who to call today? | Needs DocSend |

Charts 7–10 are labelled partial wherever they render: a view is curiosity, not commitment (the
existing Content performance page says the same), and a link forwarded inside a firm shows as one
viewer or several.

## 2. Where each step comes from

Steps are dated by evidence, not by the status alone. A status is our plan and moves in any
direction (docs/17); statuses read from Affinity carry no date of change, so a funnel on status
history alone would start on the day each LP's status was last set here.

| Step | Dated by | Source |
|---|---|---|
| Reached | our first mail, call, intro ask or meeting with them about this raise | touchpoints (Affinity, logged here), juanmail's comms trace |
| Replied | their first message, or a meeting/call, after we reached them | the same |
| Met | the first meeting or call held | touchpoints |
| Indicated | a soft amount on file | pipeline exposures |
| Committed | status Committed, or a hard amount | the status audit log, exposures |
| Passed | status Passed, with who and why | the status audit log |

The audit log's status changes (`pursuit.status_set`, with from and to) fill in where evidence is
missing: an LP moved to Discussing by a person counts as Replied on that date if nothing earlier
says so. Segments come from the LP stats facts (lib/lp-stats), so the two pages agree on what an LP is.

## 3. How it is computed

Like the rest of the site: one `buildCache` read per vehicle (lib/build-cache), rebuilt behind the
page when the records change. No on-demand endpoint, no new workflow, no new tables for the parts
that build now.

## 4. DocSend

**What exists today.** Some DocSend "Deck Viewed" notifications already land in Affinity as notes
and show on LP timelines as "Viewed the deck". They say only that a deck was opened, and Affinity
notes are read on demand, not on a schedule, so they are not a usable source for charts 7–10.

**What the API needs.** DocSend's API is, by every account we found, on the Enterprise plan only;
we could not find official documentation in public. If PL has it, the key is pasted once in
Settings → Connections, kept encrypted, and only `lib/connectors/docsend/` calls DocSend, read-only:
links, visits (viewer email, time, duration, pages) and spaces (datarooms). A daily pull keeps the
call count low. Viewers are matched to LPs by email, the same way comms are.

**If there is no Enterprise plan**, two read-only routes need no key:
- juanmail already reads Juan's mail; DocSend's visit notification emails name the viewer, the
  document and the time. juanmail could report them through the outreach API. Forward-only.
- a CSV export from DocSend's dashboard, uploaded by hand, marked as a manual import.

This is a new connector: AGENTS.md's "No DocSend" line changes only with Juan's yes, recorded there.

## 5. Not in scope

Attribution of a commitment to a document, A/B tests of materials, forecasting. The page shows
what happened and where it stopped; it does not claim why.
