import type { Check } from './harness';

/** Developer pages (issues 0098–0101): changelog batches, the git reader's parsing, the workflows view. */
export async function developerProperties(check: Check) {
  {
    const { changelogItems, changelogBatches, changelogBody, splitLabel, BATCH_SIZE } = await import('../../lib/changelog');
    const items = await changelogItems();
    const batches = changelogBatches(items);
    const sizes = batches.map((b) => b.items.length);
    const closedFull = sizes.slice(0, -1).every((n) => n === BATCH_SIZE);
    const last = sizes.at(-1)!;
    const bodies = await Promise.all(items.map(changelogBody));
    const empty = bodies.filter((b) => !b.divider && b.blocks.length === 0).map((b) => b.item.slug);
    const split = [splitLabel('N30 — The rest'), splitLabel('Dakota translation, enrichment and sourcing — review candidate'), splitLabel('busy-stuck — Cancellation')];
    check(
      'The changelog reads in batches of ten cut from the index, oldest first: every closed batch holds ten, the latest holds one to ten, every entry has its own body (an entry headed with # is no longer dropped), and a long title is not split into a false key (issue 0098)',
      closedFull && last >= 1 && last <= BATCH_SIZE && sizes.reduce((a, b) => a + b, 0) === items.length && empty.length === 0 &&
        split[0]!.key === 'N30' && split[1]!.key === '' && split[2]!.key === 'busy-stuck',
      `${items.length} entries in ${batches.length} batches (latest ${last}); empty bodies: ${empty.join(', ') || 'none'}`,
    );
  }
  {
    const { issuesIn, parseLog } = await import('../../lib/dev/git');
    const FS = '\x1f', RS = '\x1e';
    const text = [
      ['a'.repeat(40), 'p1 p2', 'Jo', '2026-09-27T05:00:00Z', "Merge codex/orgs-0094", ''],
      ['b'.repeat(40), 'p1 p3', 'Jo', '2026-09-27T04:00:00Z', 'Merge strategy designer: 0097 recommendations', ''],
      ['c'.repeat(40), 'p1', 'Jo', '2026-09-27T03:00:00Z', 'Selection table (issues 0091–0093)', 'Body 22578e4 and 0.0123\nCo-Authored-By: X <x@y>'],
    ].map((f) => f.join(FS)).join(RS) + RS;
    const [m1, m2, c] = parseLog(text);
    const ok = m1?.merge && m1.branch === 'codex/orgs-0094' && m1.issues.join() === '0094' &&
      m2?.merge && m2.branch === null && m2.issues.join() === '0097' &&
      c && !c.merge && c.issues.join() === '0091,0092,0093' && !c.body.includes('Co-Authored') &&
      issuesIn('hash 0a0066b, time 12:0045, v0.0123').length === 0;
    check(
      'The repository reader finds which issues a commit or merge closed — ranges expanded, a merged branch named only when the subject says so unambiguously — and ignores hashes, decimals and trailers (issue 0101)',
      Boolean(ok),
      `branches ${m1?.branch} / ${m2?.branch}; issues ${m1?.issues} / ${m2?.issues} / ${c?.issues}`,
    );
  }
  {
    const { foldRuns } = await import('../../lib/workflows/ledger');
    const { demoLedger } = await import('../../lib/workflows/demo');
    const { viewRun, workflowStats, noteSummary } = await import('../../lib/workflows/view');
    const folded = foldRuns(demoLedger());
    const runs = folded.runs.map(viewRun).filter((r) => r !== null);
    const stats = workflowStats(runs);
    const open = runs.filter((r) => !r.finished);
    const note = noteSummary('# 03 — W5\n\nRun: `00000000-0000-4000-8000-000000000007`.\n\nHypothesis: naming the route first makes the action concrete. More after.\n');
    check(
      'The demo ledger folds cleanly through the real reader; a start with no finish stays open and counts as no outcome, never success; per-workflow totals add up to the runs; a note yields its title, run and hypothesis (issue 0100)',
      folded.issues.length === 0 && open.length === 1 && open.every((r) => r.outcome === 'unknown') &&
        stats.reduce((n, x) => n + x.runs, 0) === runs.length && stats.some((x) => x.workflow === 'W5c') &&
        note.title === '03 — W5' && note.runId === '00000000-0000-4000-8000-000000000007' && note.lede === 'naming the route first makes the action concrete.',
      `${runs.length} runs, ${stats.length} workflows, ${open.length} open; note lede: ${note.lede}`,
    );
  }
}
