# LP pages and LP strategy: review and revamp

Written 11 Oct 2026 for Juan's ask "revamping LP pages + strategy", while he was away. It records what the
review found, the three designs built to compare, the strategy the pages should serve, and the calls left for him.
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

## 3. Three designs to compare

Juan, 11 Oct, on the live pages: "super verbose and not very useful ... way way way to much writing and info ...
humans get overloaded with noise", then "plan out some versions ... under different routes i can visit to
compare, and we can decide which ones we pick tomorrow". A first pass (a plan card added on top of the page)
was withdrawn because it added text instead of removing it. In its place, three trial pages read the same
records as the current one, and the current page stays as it is until one is picked:

| Route | Design | What leads | Where the rest goes |
| --- | --- | --- | --- |
| `/targets/<pursuit>/a` | **A · Brief and tabs** | Four lines: why, next, way in, ask; three buttons | Tabs: Activity, Strategy, Email, Research, Routes, People |
| `/targets/<pursuit>/b` | **B · Conversation first** | The thread with them, one line per touch, and the email box | A narrow side column: plan, who owes, three routes, five facts |
| `/targets/<pursuit>/c` | **C · Dossier** | The same twelve rows on every LP, one line each | Each row opens its detail in place |

The rules all three share (`app/targets/[id]/_lp/`):

- **One line per answer.** Long text is cut to a line with the full text on hover; explainer paragraphs become
  an "i" with the paragraph as its tooltip; a strategy shows Why, Next, Ask and one line of scores, with the
  full W5 card behind "Full strategy".
- **Nothing empty is shown.** No "None recorded" cards.
- **Chips, not sentences**, for status with its ladder, money (hard and soft never blended), who owes a reply,
  needs evidence, doesn't do SPVs, and the LP's other vehicles. Restrictions are always shown, in red.
- **A person's next step wins**; the strategy's is marked suggested, with an Accept button that writes the next
  step and nothing else.
- **The email trail is the record**: one line per touch, newest first, other vehicles' touches faded; health
  details lend no text (N56).

Nothing in what is computed, recorded or allowed changed. A small "Try a shorter page: A · B · C" line on the
current page links to them. When one is picked, it replaces the current page and the other two are deleted.

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

Each has a recommendation; only E is built, as the three trial pages.

| # | Question | Recommendation |
| --- | --- | --- |
| A | Fold the account plan (`/<vehicle>/strategy/<lp>`: needs, plays, propose and commit) into the LP page as part of its Strategy section, and retire the separate page? | **Yes.** It is the same LP and vehicle, and hardly anyone reaches it today. |
| B | Make the organisation page the cross-vehicle hub, with one plan card per vehicle? | **Yes, next.** It fits "either end" and reuses the plan card. |
| C | Refresh a strategy automatically when it is written before a reply from them, as a nightly Astra batch with a cap? | **Yes**, once the Astra runner is launching on its own; it costs no Claude usage. |
| D | Fold the long "What this covers" notes under each card into a one-line coverage note with the rest behind a disclosure? | **Yes.** Rule 7 needs the disclosure, not the paragraph. |
| E | Which design replaces the current page: A, B or C? | **A.** It is the shortest above the fold and gives each kind of detail its own address; B suits people working mostly from mail. |

## 6. How it was checked

Demo server (invented LPs), on Vetchling Wagtail Capital, Mirela Barrowcliff and Solveig Quaresma (a
restriction), with one invented W5 strategy added locally to Vetchling for the screenshots (not committed), at
desktop and phone widths and in dark mode; `tsc`, `boundaries` and `props`.
