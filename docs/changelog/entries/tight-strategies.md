# Strategies written tightly, and read as bullets · 8 Oct 2026

Juan, 8 Oct 2026 (feedback 0141, on a Netholabs SPV strategy read through an MCP client): "far too wordy... write
much more tightly, more signal"; "could be crisper, maybe bulleted".

- **W5 1.12, "Tight":** a one-sentence angle of 25 words at most, a 15-word route reason, a next step of 200
  characters, at most three risks and three open questions of 15 words each, and no field repeating another.
- **The checker counts strategies over those caps** and lists them with `--wordy <file>` for a tightening pass.
  It refuses nothing.
- **MCP pursuit reads open the strategy with `brief`:** short bullets for the ask, the route, why, the next step
  and the first risk, built from the fields. Older strategies get the bullets too.

Checks: tsc, boundaries and the enrichment-strategy properties (a wordy strategy is counted, not refused).
