# LP pages and LP strategy: review and revamp

Written 11 Oct 2026 for Juan's ask "revamping LP pages + strategy", while he was away. It records what the
review found, what shipped with it, the strategy the pages should serve, and the larger calls left for him.
Everything here was checked on the demo data (invented LPs); no real record was read.

## 1. What an LP page is for

One person, one LP, one vehicle, about a minute: **what do we do next, who does it, how do we get in, what are we
asking for, and has anything changed since we planned it.** Everything else on the page (the timeline, the
research, the routes, the close track) is the evidence behind those answers, and should read as that.

## 2. What the review found

- **Three pages per LP, loosely joined.** The LP workspace (`/targets/<pursuit>`, reached from Pipeline and
  Selection), the account plan (`/<vehicle>/strategy/<lp>`: needs, plays, propose and commit, reached only from
  the fit page and Selection) and the organisation page (`/orgs/<lp>`, every vehicle). The workspace linked to
  the organisation page from the name only, and never to the account plan.
- **The strategy was below the fold.** The workspace opened on the status panel and the stepper, then about
  twenty cards in a 4,000 to 5,000 px column. W5's strategy (why they'd care, the next step, the way in, the ask)
  sat under the timeline, after the triage card. Juan said on 3 Oct that the email box "under a 4,000 px timeline
  and the strategies ... was never seen"; the strategy itself had the same problem.
- **The next step showed only when a person had set one**, as a line inside the status panel. A strategy's
  suggested next step was in its own card further down.
- **A strategy did not say it was out of date.** It flagged team notes newer than it, but not mail or meetings
  after it was written, which is now the main way an LP's situation changes (the mail actions, PR #89 and #90).
- **Empty cards took space.** "Next moves: No plan recorded" (no real pursuit has a plan; only the demo seed
  writes one) and "Open questions: None recorded".
- **Stale copy.** The demo's Next moves step read "Blocked: No SEND ticket has been opened", which a person has
  not needed since 5 Oct (domain rule 3).

## 3. What shipped with this note

On the LP workspace (`app/targets/[id]/page.tsx`, `components/strategy/LpBrief.tsx`):

- **The plan, first.** One card under the name: why they'd care, the next step (a person's leads; the strategy's
  is shown as suggested, with its date and "past its date" when it has passed), the way in (the route search's
  best recommended route, else the strategy's, else "no supported route ... not the same as none"), the ask and
  where the money stands, and who owes the last word, from the comms trace. Restrictions show in red at the top
  of it, always.
- **"Written before the latest."** When touches or team notes postdate the strategy, the plan says how many,
  how many came from them, and the latest date.
- **Flags as chips**: doesn't do SPVs on an SPV, a meeting on record while the status is still early, needs
  evidence, the strategy's first two risks, a strategy on another vehicle (fund first, either end), open
  questions. Each links to the card that has the detail.
- **Actions in one row**: draft an email, add an update, accept the suggested next step (the same action as the
  strategy card: it writes the next step and nothing else), and links to the full strategy, the account plan,
  the fit reading and every vehicle.
- **Section anchors** under the name (Plan, Status, Email, Timeline, Strategy, Research, Routes, What we know),
  sticky on a desktop.
- **The order follows the work**: triage and Before you send, Email, What changed, Timeline, then the strategies
  (this vehicle's first), the research, Routes in with connection feedback under it, and the ladder last.
  Next moves and Open questions show only when they have something in them.
- The demo seed's blocked step no longer mentions a SEND ticket.

Nothing changed in what any card computes, what is recorded, or what any guard allows.

## 4. The strategy the pages serve

1. **One plan per LP and vehicle, kept current by events, not by a calendar.** W5 writes it; mail, meetings and
   team notes after it make it "written before the latest", visibly. The next pass reads what is newer first.
2. **A person's next step wins; the strategy suggests.** Accepting copies the suggestion into the next step.
   Nothing else moves (status, ladder, money), and nothing is sent.
3. **Fund first, but either end** (Juan, 8 Oct). The LP page shows every vehicle's strategy for them, this
   vehicle's first, and flags the others in the plan, so one person sees the whole LP before writing.
4. **Relevant investments are flagged, never blocking** (Juan, 8 Oct): the card stays on the vehicle-LP page.
5. **Routing over owners** (Juan, 8 Oct): the plan names who sends from the strategy and the best route, not from
   the pursuit's owner.
6. **Evidence stays visible.** The plan is a summary of the cards under it, never a new claim: every line in it
   has its full card, with sources and coverage, a click away.

## 5. Calls for Juan

Each has a recommendation; none has been started.

| # | Question | Recommendation |
| --- | --- | --- |
| A | Fold the account plan (`/<vehicle>/strategy/<lp>`: needs, plays, propose and commit) into the LP page as part of its Strategy section, and retire the separate page? | **Yes.** It is the same LP and vehicle, and hardly anyone reaches it today. |
| B | Make the organisation page the cross-vehicle hub, with one plan card per vehicle? | **Yes, next.** It fits "either end" and reuses the plan card. |
| C | Refresh a strategy automatically when it is written before a reply from them, as a nightly Astra batch with a cap? | **Yes**, once the Astra runner is launching on its own; it costs no Claude usage. |
| D | Fold the long "What this covers" notes under each card into a one-line coverage note with the rest behind a disclosure? | **Yes.** Rule 7 needs the disclosure, not the paragraph. |
| E | Tabs instead of one long page? | **Not yet.** The anchors and the plan may be enough; tabs hide things. |

## 6. How it was checked

Demo server, the Vetchling Wagtail Capital and Mirela Barrowcliff LPs, with one invented W5 strategy added
locally to Vetchling for the screenshots (not committed), at desktop and phone widths and in dark mode;
`tsc`, `boundaries` and `props`.
