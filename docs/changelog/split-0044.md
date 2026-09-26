# Smaller files for agents — split verification

Counts compare this branch with its starting master commit `22578e4`. A zero means a new file.
This report lists every changed source/document file; it excludes itself. No content from real records is included.

## Verification

- The 103 changelog fragments, joined by one blank line, reconstruct byte for byte to the original 5,396-line Markdown.
- Both rendered HTML outputs (Developer → Changelog content and inspector, and the standalone build log)
  match the baseline after normalizing only the displayed source-location label from `CHANGELOG.md`
  to `docs/changelog/entries/`. All 101 entries, screenshot URLs and version anchors are preserved.
- Every existing L/N issue-to-changelog link resolves to its original title and anchor.
- The seven docs/19 fragments, without their new archive labels and joined by one blank line, reconstruct the original byte for byte.
  Its index preserves all 23 old heading anchors, and all links resolve in the Docs catalog.
- Every original AGENTS rule is retained; the screenshot rule points to the new entry location.
  The commit message inventories each moved paragraph by its original line range and destination.
- Typecheck and boundaries pass: 470 source files, 297 screenshots.
- Properties: 223/223 before and after, with the same check names and execution order.
  Docs assertions additionally cover the new catalog directories, links and symlink refusals.
- All six agent definitions and four active protocols name their scoped read sets.
  Agent tool/model permissions and protected evaluation criteria are unchanged.
- No workflow was launched. Runtime token savings and live model prompt quality are not measured here;
  the local no-op agent runtime cannot execute live prompt evaluations. Compare the next approved
  stage with its prior run in the shared workflow ledger; do not infer token savings from line counts.

## Before and after, every changed file

| File | Before | After |
| --- | ---: | ---: |
| `.claude/agents/event-tagger.md` | 29 | 36 |
| `.claude/agents/fact-checker.md` | 29 | 37 |
| `.claude/agents/feedback-fixer.md` | 25 | 35 |
| `.claude/agents/lp-researcher.md` | 37 | 47 |
| `.claude/agents/shot-taker.md` | 23 | 35 |
| `.claude/agents/strategy-writer.md` | 31 | 42 |
| `AGENTS.md` | 424 | 144 |
| `CHANGELOG.md` | 5,396 | 7 |
| `README.md` | 120 | 120 |
| `app/dev/changelog/page.tsx` | 216 | 215 |
| `docs/19-enrichment-workflows.md` | 1,744 | 109 |
| `docs/19/log-2026-09-24.md` | 0 | 257 |
| `docs/19/research-notes.md` | 0 | 30 |
| `docs/19/running-history.md` | 0 | 89 |
| `docs/19/set.md` | 0 | 85 |
| `docs/19/w1-history.md` | 0 | 937 |
| `docs/19/w12-history.md` | 0 | 87 |
| `docs/19/w5-history.md` | 0 | 288 |
| `docs/agent-rules/development.md` | 0 | 73 |
| `docs/agent-rules/domain.md` | 0 | 99 |
| `docs/agent-rules/frontend.md` | 0 | 35 |
| `docs/agent-rules/operations.md` | 0 | 76 |
| `docs/agent-rules/real-data.md` | 0 | 68 |
| `docs/changelog/entries/beyond-l13.md` | 0 | 7 |
| `docs/changelog/entries/l1.md` | 0 | 108 |
| `docs/changelog/entries/l10.md` | 0 | 75 |
| `docs/changelog/entries/l11.md` | 0 | 64 |
| `docs/changelog/entries/l12.md` | 0 | 70 |
| `docs/changelog/entries/l13.md` | 0 | 90 |
| `docs/changelog/entries/l2.md` | 0 | 64 |
| `docs/changelog/entries/l3.md` | 0 | 87 |
| `docs/changelog/entries/l4.md` | 0 | 84 |
| `docs/changelog/entries/l5.md` | 0 | 81 |
| `docs/changelog/entries/l6.md` | 0 | 71 |
| `docs/changelog/entries/l7.md` | 0 | 48 |
| `docs/changelog/entries/l8.md` | 0 | 68 |
| `docs/changelog/entries/l9.md` | 0 | 62 |
| `docs/changelog/entries/module-24.md` | 0 | 60 |
| `docs/changelog/entries/modules-17-and-13.md` | 0 | 49 |
| `docs/changelog/entries/n1.md` | 0 | 81 |
| `docs/changelog/entries/n10.md` | 0 | 34 |
| `docs/changelog/entries/n11.md` | 0 | 52 |
| `docs/changelog/entries/n12.md` | 0 | 52 |
| `docs/changelog/entries/n13.md` | 0 | 51 |
| `docs/changelog/entries/n14.md` | 0 | 91 |
| `docs/changelog/entries/n15.md` | 0 | 62 |
| `docs/changelog/entries/n16.md` | 0 | 65 |
| `docs/changelog/entries/n17.md` | 0 | 63 |
| `docs/changelog/entries/n18.md` | 0 | 61 |
| `docs/changelog/entries/n19.md` | 0 | 70 |
| `docs/changelog/entries/n2.md` | 0 | 22 |
| `docs/changelog/entries/n20.md` | 0 | 23 |
| `docs/changelog/entries/n21.md` | 0 | 77 |
| `docs/changelog/entries/n22.md` | 0 | 58 |
| `docs/changelog/entries/n23.md` | 0 | 38 |
| `docs/changelog/entries/n24.md` | 0 | 35 |
| `docs/changelog/entries/n25.md` | 0 | 38 |
| `docs/changelog/entries/n26.md` | 0 | 35 |
| `docs/changelog/entries/n27.md` | 0 | 28 |
| `docs/changelog/entries/n28.md` | 0 | 84 |
| `docs/changelog/entries/n29.md` | 0 | 76 |
| `docs/changelog/entries/n3.md` | 0 | 124 |
| `docs/changelog/entries/n30.md` | 0 | 76 |
| `docs/changelog/entries/n31.md` | 0 | 55 |
| `docs/changelog/entries/n32.md` | 0 | 44 |
| `docs/changelog/entries/n33.md` | 0 | 51 |
| `docs/changelog/entries/n34.md` | 0 | 85 |
| `docs/changelog/entries/n35.md` | 0 | 66 |
| `docs/changelog/entries/n36.md` | 0 | 40 |
| `docs/changelog/entries/n37.md` | 0 | 44 |
| `docs/changelog/entries/n38.md` | 0 | 86 |
| `docs/changelog/entries/n39.md` | 0 | 70 |
| `docs/changelog/entries/n4.md` | 0 | 62 |
| `docs/changelog/entries/n40.md` | 0 | 48 |
| `docs/changelog/entries/n41.md` | 0 | 45 |
| `docs/changelog/entries/n42.md` | 0 | 65 |
| `docs/changelog/entries/n43.md` | 0 | 50 |
| `docs/changelog/entries/n44.md` | 0 | 35 |
| `docs/changelog/entries/n45.md` | 0 | 54 |
| `docs/changelog/entries/n46.md` | 0 | 53 |
| `docs/changelog/entries/n47.md` | 0 | 55 |
| `docs/changelog/entries/n48.md` | 0 | 22 |
| `docs/changelog/entries/n49.md` | 0 | 39 |
| `docs/changelog/entries/n5.md` | 0 | 92 |
| `docs/changelog/entries/n50.md` | 0 | 30 |
| `docs/changelog/entries/n51.md` | 0 | 29 |
| `docs/changelog/entries/n52.md` | 0 | 27 |
| `docs/changelog/entries/n53.md` | 0 | 23 |
| `docs/changelog/entries/n54.md` | 0 | 21 |
| `docs/changelog/entries/n55.md` | 0 | 34 |
| `docs/changelog/entries/n56.md` | 0 | 28 |
| `docs/changelog/entries/n57.md` | 0 | 31 |
| `docs/changelog/entries/n58.md` | 0 | 31 |
| `docs/changelog/entries/n59.md` | 0 | 39 |
| `docs/changelog/entries/n6.md` | 0 | 66 |
| `docs/changelog/entries/n60.md` | 0 | 22 |
| `docs/changelog/entries/n61.md` | 0 | 25 |
| `docs/changelog/entries/n62.md` | 0 | 28 |
| `docs/changelog/entries/n63.md` | 0 | 27 |
| `docs/changelog/entries/n64.md` | 0 | 39 |
| `docs/changelog/entries/n65.md` | 0 | 35 |
| `docs/changelog/entries/n66.md` | 0 | 72 |
| `docs/changelog/entries/n67.md` | 0 | 62 |
| `docs/changelog/entries/n68.md` | 0 | 50 |
| `docs/changelog/entries/n69.md` | 0 | 48 |
| `docs/changelog/entries/n7.md` | 0 | 68 |
| `docs/changelog/entries/n70.md` | 0 | 97 |
| `docs/changelog/entries/n71.md` | 0 | 42 |
| `docs/changelog/entries/n72.md` | 0 | 17 |
| `docs/changelog/entries/n73.md` | 0 | 9 |
| `docs/changelog/entries/n74.md` | 0 | 17 |
| `docs/changelog/entries/n75.md` | 0 | 11 |
| `docs/changelog/entries/n76.md` | 0 | 15 |
| `docs/changelog/entries/n77.md` | 0 | 31 |
| `docs/changelog/entries/n78.md` | 0 | 18 |
| `docs/changelog/entries/n79.md` | 0 | 44 |
| `docs/changelog/entries/n8.md` | 0 | 62 |
| `docs/changelog/entries/n80.md` | 0 | 56 |
| `docs/changelog/entries/n81.md` | 0 | 77 |
| `docs/changelog/entries/n82.md` | 0 | 38 |
| `docs/changelog/entries/n83.md` | 0 | 50 |
| `docs/changelog/entries/n84.md` | 0 | 53 |
| `docs/changelog/entries/n85.md` | 0 | 35 |
| `docs/changelog/entries/n9.md` | 0 | 76 |
| `docs/changelog/entries/preamble.md` | 0 | 7 |
| `docs/changelog/entries/where-this-got-to.md` | 0 | 59 |
| `docs/changelog/index.md` | 0 | 110 |
| `docs/workflows/w1-profile.md` | 526 | 539 |
| `docs/workflows/w12-events.md` | 106 | 114 |
| `docs/workflows/w1c-fact-check.md` | 123 | 135 |
| `docs/workflows/w5-strategy.md` | 309 | 325 |
| `lib/changelog.ts` | 32 | 50 |
| `lib/docs.ts` | 83 | 92 |
| `scripts/boundaries.ts` | 106 | 111 |
| `scripts/changelog-html.ts` | 338 | 339 |
| `scripts/properties.ts` | 2,761 | 27 |
| `scripts/properties/affinity-discovery.ts` | 0 | 56 |
| `scripts/properties/affinity-fixtures.ts` | 0 | 37 |
| `scripts/properties/affinity-mapping.ts` | 0 | 75 |
| `scripts/properties/affinity-notes.ts` | 0 | 83 |
| `scripts/properties/affinity-slice.ts` | 0 | 122 |
| `scripts/properties/affinity-translation.ts` | 0 | 204 |
| `scripts/properties/affinity.ts` | 0 | 115 |
| `scripts/properties/agents.ts` | 0 | 75 |
| `scripts/properties/close.ts` | 0 | 17 |
| `scripts/properties/compliance.ts` | 0 | 66 |
| `scripts/properties/content.ts` | 0 | 92 |
| `scripts/properties/coordination.ts` | 0 | 70 |
| `scripts/properties/deployment.ts` | 0 | 167 |
| `scripts/properties/docs.ts` | 0 | 74 |
| `scripts/properties/enrichment-strategy.ts` | 0 | 167 |
| `scripts/properties/enrichment.ts` | 0 | 193 |
| `scripts/properties/fit.ts` | 0 | 79 |
| `scripts/properties/harness.ts` | 0 | 16 |
| `scripts/properties/identity.ts` | 0 | 20 |
| `scripts/properties/issues.ts` | 0 | 26 |
| `scripts/properties/markdown.ts` | 0 | 19 |
| `scripts/properties/meetings.ts` | 0 | 27 |
| `scripts/properties/navigation.ts` | 0 | 67 |
| `scripts/properties/network.ts` | 0 | 393 |
| `scripts/properties/pipeline.ts` | 0 | 117 |
| `scripts/properties/readings.ts` | 0 | 47 |
| `scripts/properties/reconciliation.ts` | 0 | 235 |
| `scripts/properties/research.ts` | 0 | 17 |
| `scripts/properties/scoring.ts` | 0 | 65 |
| `scripts/properties/strategy.ts` | 0 | 31 |
| `scripts/properties/suite.ts` | 0 | 64 |
| `scripts/properties/theme.ts` | 0 | 21 |
| `scripts/properties/updates.ts` | 0 | 93 |
| `scripts/properties/viewport.ts` | 0 | 21 |
| `scripts/shots-compress.ts` | 58 | 62 |
| `scripts/shots.ts` | 2,496 | 2,496 |
