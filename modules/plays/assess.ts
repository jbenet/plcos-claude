import { listAssessments } from '@/modules/fit';
import { listCycles } from '@/modules/close';
import { listAsks, connectorLoad } from '@/modules/coordination';
import { listAssets, listSends } from '@/modules/content';
import { coverageGaps, listAnswers } from '@/modules/library';
import { listPursuits, rungIndex, RUNGS } from '@/modules/strategy';
import { vehicleTotals } from '@/modules/pipeline';
import { listEdges } from '@/modules/network';
import type { Assessment, Lever, Reading, Verdict } from './types';

/**
 * Where this raise actually stands, read from the modules that own each fact.
 *
 * Every reading carries a verdict and the levers that would move it, which is what turns
 * a dashboard into a strategy: the board below ranks plays, and a play whose lever answers
 * a weak reading is marked. Nothing here is a forecast and nothing is blended — the money
 * readings are per vehicle, and the counts are counts.
 */

const pct = (n: number, d: number) => (d === 0 ? 0 : n / d);

function verdictFrom(value: number, ok: number, strong: number): Verdict {
  if (value >= strong) return 'strong';
  if (value >= ok) return 'ok';
  return 'weak';
}

export async function assessVehicle(
  vehicleId: string, now = new Date(),
): Promise<Assessment | null> {
  const [totals, fit, cycles, pursuits, asks, assets, sends, answers, gaps, edges, load] =
    await Promise.all([
      vehicleTotals(), listAssessments(vehicleId), listCycles(), listPursuits(vehicleId),
      listAsks(vehicleId), listAssets(), listSends(), listAnswers(), coverageGaps(),
      listEdges(), connectorLoad(),
    ]);

  const t = totals.find((x) => x.vehicleId === vehicleId);
  if (!t) return null;
  const cycle = cycles.find((c) => c.vehicleId === vehicleId) ?? null;
  const daysToClose = cycle
    ? Math.round((cycle.targetDate.getTime() - now.getTime()) / 86_400_000)
    : null;

  const readings: Reading[] = [];
  const add = (r: Reading) => readings.push(r);

  // ---------------------------------------------------------------- pipeline
  const coverage = t.coverage;
  add({
    key: 'coverage', group: 'Pipeline', label: 'Pipeline depth',
    value: coverage === null ? '—' : `${coverage.toFixed(1)}×`,
    verdict: coverage === null ? 'unknown' : verdictFrom(coverage, 1.5, 2.5),
    detail:
      'Soft plus hard against the gap. It is depth, not money: a 3× pipeline of prospects '
      + 'nobody can reach converts the same as no pipeline at all.',
    levers: ['source', 'segment', 'route'],
  });
  add({
    key: 'gap', group: 'Pipeline', label: 'Gap to target',
    value: t.gapToTarget === null ? 'no target' : `$${(t.gapToTarget / 1e6).toFixed(1)}M`,
    verdict: t.gapToTarget === null ? 'unknown' : t.gapToTarget <= 0 ? 'strong' : 'ok',
    detail: 'Hard only. Soft is a separate track and is never counted toward this.',
    levers: ['ask', 'source'],
  });
  if (daysToClose !== null) {
    add({
      key: 'clock', group: 'Pipeline', label: 'Days to close target',
      value: `${daysToClose}`,
      verdict: daysToClose > 90 ? 'strong' : daysToClose > 45 ? 'ok' : 'weak',
      detail:
        daysToClose < 45
          ? 'Inside six weeks. Anything that pays off after the close is not strategy, it is a hobby.'
          : 'Calendar days, not working days — the sprint calendar has the holiday overlay.',
      levers: ['ask', 'process'],
    });
  }

  // ---------------------------------------------------------------- the universe
  const assessed = fit.length;
  const clear = fit.filter((a) => a.gateStatus === 'clear').length;
  const workable = fit.filter((a) => a.band === 'strong' || a.band === 'workable').length;
  add({
    key: 'universe', group: 'Targets', label: 'Funders assessed',
    value: `${assessed}`,
    verdict: verdictFrom(assessed, 8, 15),
    detail:
      'Firms with a fit reading against this vehicle. Firms nobody has assessed are not in '
      + 'the pipeline — that is a gap in our work rather than a fact about the universe.',
    levers: ['source', 'segment'],
  });
  add({
    key: 'qualified', group: 'Targets', label: 'Qualified and workable',
    value: `${workable} of ${assessed}`,
    verdict: assessed === 0 ? 'unknown' : verdictFrom(pct(workable, assessed), 0.4, 0.65),
    detail: 'Band strong or workable, hard gates not failing. The pool a week can be spent inside.',
    levers: ['segment', 'enrich'],
  });
  const cover = assessed === 0 ? 0 : fit.reduce((s, a) => s + a.evidenceCover, 0) / assessed;
  add({
    key: 'evidence', group: 'Targets', label: 'Readings that rest on things we know',
    value: assessed === 0 ? '—' : `${Math.round(cover * 100)}%`,
    verdict: assessed === 0 ? 'unknown' : verdictFrom(cover, 0.7, 0.85),
    detail:
      'The rest is inferred or guessed. A board ranked on guesses ranks the guesses, so this '
      + 'is the reading that decides whether the rest of this page can be trusted.',
    levers: ['enrich'],
  });
  add({
    key: 'gates', group: 'Targets', label: 'Every gate answered',
    value: `${clear} of ${assessed}`,
    verdict: assessed === 0 ? 'unknown' : verdictFrom(pct(clear, assessed), 0.5, 0.8),
    detail: 'An unanswered gate is not a pass. Each one is a phone call nobody has made.',
    levers: ['enrich', 'process'],
  });

  // ---------------------------------------------------------------- conversion
  const atRung = (i: number) => pursuits.filter((p) => p.rung && rungIndex(p.rung) >= i).length;
  const opened = pursuits.length;
  const met = atRung(2);
  add({
    key: 'ladder', group: 'Conversion', label: 'Reached a meeting',
    value: `${met} of ${opened}`,
    verdict: opened === 0 ? 'unknown' : verdictFrom(pct(met, opened), 0.35, 0.6),
    detail:
      `Rung ${3} of ${RUNGS.length} or better, derived from evidence rather than stored. `
      + 'A connector saying yes is rung one and nothing more.',
    levers: ['route', 'ask', 'convene'],
  });
  const blockers = new Map<string, number>();
  for (const a of fit) blockers.set(a.diagnosis.blocker, (blockers.get(a.diagnosis.blocker) ?? 0) + 1);
  const awareness = blockers.get('awareness') ?? 0;
  const conviction = blockers.get('conviction') ?? 0;
  const access = blockers.get('access') ?? 0;
  const unqualified = blockers.get('evidence') ?? 0;
  add({
    key: 'awareness', group: 'Perception', label: 'Blocked on awareness',
    value: `${awareness}`,
    verdict: assessed === 0 ? 'unknown' : awareness === 0 ? 'strong' : awareness <= 2 ? 'ok' : 'weak',
    detail:
      'They have heard of us at most. More reach and better priming fixes this; a warmer '
      + 'introduction to somebody who does not know what we do does not.',
    levers: ['reach', 'materials', 'convene'],
  });
  add({
    key: 'conviction', group: 'Perception', label: 'Blocked on conviction',
    value: `${conviction}`,
    verdict: assessed === 0 ? 'unknown' : conviction === 0 ? 'strong' : conviction <= 2 ? 'ok' : 'weak',
    detail:
      'They know us and are not convinced. Each one has named an objection, and each one '
      + 'needs that specific objection answered with evidence.',
    levers: ['convince', 'validate', 'materials'],
  });
  add({
    key: 'access', group: 'Access', label: 'No route in',
    value: `${access}`,
    verdict: assessed === 0 ? 'unknown' : access === 0 ? 'strong' : access <= 1 ? 'ok' : 'weak',
    detail: 'No tie on file and no prior relationship. Nothing else can start for these.',
    levers: ['route', 'convene', 'reach'],
  });
  add({
    key: 'unqualified', group: 'Targets', label: 'Cannot be qualified yet',
    value: `${unqualified}`,
    verdict: assessed === 0 ? 'unknown' : unqualified === 0 ? 'strong' : unqualified <= 2 ? 'ok' : 'weak',
    detail: 'A gate nobody has answered. These are usually cheap and always somebody’s job.',
    levers: ['enrich'],
  });

  // ---------------------------------------------------------------- reach and routes
  const routable = fit.filter((a) =>
    a.links.some((l) => l.opinionWeight === 'strong' || l.opinionWeight === 'good')
    || a.profile?.priorRelationship).length;
  add({
    key: 'routes', group: 'Access', label: 'Targets with a usable route',
    value: `${routable} of ${assessed}`,
    verdict: assessed === 0 ? 'unknown' : verdictFrom(pct(routable, assessed), 0.55, 0.8),
    detail:
      'A tie with real opinion-setting weight, or a prior relationship. Co-attendance and a '
      + 'shared board are discovery clues, and they are not counted here.',
    levers: ['route', 'convene'],
  });
  const tierAB = edges.filter((e) => e.tier === 'A' || e.tier === 'B').length;
  add({
    key: 'graph', group: 'Access', label: 'Edges that can carry a route',
    value: `${tierAB} of ${edges.length}`,
    verdict: edges.length === 0 ? 'unknown' : verdictFrom(pct(tierAB, edges.length), 0.4, 0.6),
    detail: 'Tiers A and B. C and D need a human before either can carry anything.',
    levers: ['enrich', 'route'],
  });
  const spent = load.filter((c) => c.used >= 2).length;
  add({
    key: 'goodwill', group: 'Access', label: 'Connectors near their cap',
    value: `${spent} of ${load.length}`,
    verdict: load.length === 0 ? 'unknown' : spent === 0 ? 'strong' : spent <= 1 ? 'ok' : 'weak',
    detail:
      'Goodwill is finite and spent per person across every vehicle. A connector at the cap '
      + 'is not a route, whatever the graph says.',
    levers: ['route', 'convene', 'reach'],
  });

  // ---------------------------------------------------------------- what we send
  const approved = assets.filter((a) => a.status === 'approved').length;
  const stale = assets.filter((a) => a.flags.length > 0).length;
  add({
    key: 'materials', group: 'Materials', label: 'Approved and current',
    value: `${approved - stale} of ${assets.length}`,
    verdict: assets.length === 0 ? 'unknown' : verdictFrom(pct(approved - stale, assets.length), 0.5, 0.8),
    detail:
      'Approved, and not flagged because a claim underneath changed. A deck goes wrong '
      + 'because a fact moved, not because ninety days passed.',
    levers: ['materials'],
  });
  const refused = sends.filter((s) => s.status === 'refused').length;
  add({
    key: 'wrap', group: 'Materials', label: 'Sends refused by the wrap gate',
    value: `${refused}`,
    verdict: refused === 0 ? 'strong' : 'ok',
    detail:
      'Refusals are kept, which is what makes "wrong-wrap sends = 0" checkable. A refusal is '
      + 'the gate working, not a failure.',
    levers: ['materials', 'process'],
  });
  const expiring = answers.filter((a) => a.stale).length;
  add({
    key: 'answers', group: 'Materials', label: 'Answers gone stale',
    value: `${expiring} of ${answers.length}`,
    verdict: answers.length === 0 ? 'unknown' : expiring === 0 ? 'strong' : expiring <= 2 ? 'ok' : 'weak',
    detail: 'Expired on a date, or superseded because a claim underneath them changed.',
    levers: ['materials', 'convince'],
  });
  add({
    key: 'gaps', group: 'Materials', label: 'Questions with no approved answer',
    value: `${gaps.length}`,
    verdict: gaps.length === 0 ? 'strong' : gaps.length <= 5 ? 'ok' : 'weak',
    detail:
      'Objections and diligence questions people have actually asked, with nothing approved '
      + 'behind them. This is the content backlog, derived rather than planned.',
    levers: ['materials', 'convince'],
  });

  // ---------------------------------------------------------------- asking
  const madeAsks = asks.filter((a) => a.madeAt).length;
  add({
    key: 'asks', group: 'Conversion', label: 'Asks actually made',
    value: `${madeAsks} of ${asks.length}`,
    verdict: asks.length === 0 ? 'unknown' : verdictFrom(pct(madeAsks, asks.length), 0.5, 0.8),
    detail:
      'The rest are recorded and unsent. An ask that never leaves the building converts at '
      + 'exactly the rate of no ask.',
    levers: ['ask'],
  });

  // ---------------------------------------------------------------- the summary
  const weak = readings.filter((r) => r.verdict === 'weak');
  const weakLevers = [...new Set(weak.flatMap((r) => r.levers))] as Lever[];

  const diagnosis: string[] = [];
  if (weak.length === 0) {
    diagnosis.push(
      'Nothing here reads weak. That is either a raise in good shape or a set of thresholds '
      + 'that have never been calibrated against an outcome — and with this little history, '
      + 'the second is worth considering.',
    );
  } else {
    const named = weak.slice(0, 3).map((r) => `${r.label.toLowerCase()} (${r.value})`);
    diagnosis.push(
      `${weak.length} reading${weak.length === 1 ? '' : 's'} came back weak: ${named.join(', ')}`
      + `${weak.length > 3 ? ', and others below' : ''}.`,
    );
  }
  if (daysToClose !== null && daysToClose < 45) {
    diagnosis.push(
      `The close target is ${daysToClose} days out. Compounding work is listed below and `
      + 'should be read as next-vehicle planning rather than as this quarter’s plan.',
    );
  }
  if (awareness > conviction && awareness > 0) {
    diagnosis.push(
      `More funders are blocked on awareness (${awareness}) than on conviction (${conviction}). `
      + 'Those need opposite work, and the cheaper one is reach.',
    );
  } else if (conviction > 0) {
    diagnosis.push(
      `${conviction} funder${conviction === 1 ? ' is' : 's are'} blocked on conviction rather than `
      + 'awareness — they know us and have named something. More reach makes that worse, not better.',
    );
  }

  return {
    vehicleId, vehicleName: t.vehicleName, exemption: t.exemption,
    daysToClose, readings, weakLevers, diagnosis,
  };
}
