# The LP page opens on the plan · 11 Oct 2026

Juan, 11 Oct 2026: "revamping LP pages + strategy". The review, the strategy and the open calls are in
`docs/strategy/lp-pages.md`.

- **The plan, first** (`components/strategy/LpBrief.tsx`): why they'd care, the next step (a person's leads; the
  strategy's shows as suggested, with "past its date"), the way in, the ask and the money, and who owes the last
  word. Restrictions in red at the top, always. One row of actions: draft an email, add an update, accept the
  suggested next step, and links to the full strategy, the account plan, the fit reading and every vehicle.
- **"Written before the latest"**: a strategy older than touches or team notes says how many, and the latest date.
- **Flags as chips**, each linked to its card: doesn't do SPVs on an SPV, a meeting while the status is early,
  needs evidence, the strategy's risks, a strategy on another vehicle, open questions.
- **Section anchors** under the name, sticky on a desktop.
- **Cards in the order of the work**: Before you send, Email, What changed, Timeline, then the strategies (this
  vehicle's first), research, Routes in, the ladder. Next moves and Open questions show only when not empty.
- The demo seed's blocked step no longer mentions a SEND ticket (people need none since 5 Oct).

Nothing a card computes, records or guards changed. Checks: tsc, boundaries, props, and demo renders at desktop
and phone widths and in dark mode.
