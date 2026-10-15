# Astra works from a fresh LP list each night · 15 Oct 2026

Juan, 14 Oct 2026: "I dont think astra did much tonight", then "seems like you didnt do anything yesterday". On the
night of 13–14 Oct every night-plan step, including the new search pass and strategy revision, ended at "Nobody is
left" within minutes. The Mac's research export dated from 8 Oct (1,982 LPs; the server's held 2,255), so the
prospects and calendar LPs added since never reached Astra, and no path brought the server's export to the Mac.

- **The runner fetches the server's export once a night.** In the window, a Mac copy older than 12 hours is replaced
  through the Astra endpoint (`op: "research"`), which rebuilds the server's export first when it is stale too. The
  five export files arrive with hashes and are swapped in between batch cuts.
- **No step ends the night on stale data.** While the fetch is pending the runner claims nothing, for up to 30
  minutes, then goes ahead on the old copy.
- Docs: [docs/30](../../30-astra-runner.md#the-night-plan). Property: `astra research export` (scripts/properties/astra.ts).
