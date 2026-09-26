import type { SeedContext } from './harness';

export async function fitProperties({ check }: SeedContext) {
  // ---- funder–vehicle fit -------------------------------------------------

  {
    const { listAssessments } = await import('../../modules/fit');
    const fit = await listAssessments();

    check(
      'Every fit reading declares whether it is known, inferred or guessed',
      fit.every((a) =>
        a.dimensions.every((x) => x.certainty) && a.gates.every((g) => g.certainty)
        && a.perceptions.every((x) => x.certainty)),
      `${fit.reduce((n, a) => n + a.dimensions.length + a.gates.length, 0)} readings, all basis-tagged`,
    );

    check(
      'A failed hard gate always reports as blocked, however good the dimensions look',
      fit.every((a) => a.failedGates.length === 0
        || (a.band === 'blocked' && a.diagnosis.blocker === 'gated')),
      fit.filter((a) => a.failedGates.length > 0)
         .map((a) => `${a.entityName} ${a.weightedFit.toFixed(2)} → ${a.band}`).join('; ') || 'none failing',
    );

    check(
      'An unanswered gate is never counted as a pass',
      fit.every((a) => a.unknownGates.length === 0 || a.gateStatus !== 'clear'),
      `${fit.filter((a) => a.gateStatus === 'unknown').length} assessments carry an open gate`,
    );

    check(
      'The diagnosis is a precedence, so every assessment gets exactly one blocker',
      fit.every((a) => typeof a.diagnosis.blocker === 'string' && a.diagnosis.nextMove.length > 0),
      `${new Set(fit.map((a) => a.diagnosis.blocker)).size} distinct blockers across ${fit.length} assessments`,
    );

    check(
      'Awareness is measured against us, never against a thesis they hold independently',
      (() => {
        const t = fit.find((a) => a.entityName === 'Tessaro Family Office');
        if (!t) return false;
        const holdsThesis = t.perceptions.some(
          (x) => x.subjectKind === 'thesis' && x.familiarity === 'deep');
        return holdsThesis && t.diagnosis.blocker === 'awareness';
      })(),
      'Tessaro knows the thesis deeply and has never heard of us; the blocker is awareness',
    );

    check(
      'Certainty discounts the weighted fit rather than decorating it',
      fit.every((a) => a.evidenceCover > 0 && a.evidenceCover <= 1
        && (a.dimensions.every((x) => x.certainty === 'known') || a.evidenceCover < 1)),
      fit.map((a) => `${Math.round(a.evidenceCover * 100)}%`).join(' '),
    );

    check(
      'No fit figure is summed across vehicles',
      (() => {
        const bySlug = new Map<string, number>();
        for (const a of fit) bySlug.set(a.entityName, (bySlug.get(a.entityName) ?? 0) + 1);
        // Vantage is assessed on Rails only here; the property is that the repo returns one
        // row per firm × vehicle and never a merged one.
        return fit.length === new Set(fit.map((a) => `${a.entityId}:${a.vehicleId}`)).size;
      })(),
      `${fit.length} rows, one per firm × vehicle`,
    );

    check(
      'The compliance registry and the accreditation gate agree',
      (() => {
        const w = fit.find((a) => a.entityName === 'Whitcomb Capital');
        const gate = w?.gates.find((g) => g.code === 'accredited');
        return Boolean(w && gate && gate.passed === false && w.exemption === '506(c)');
      })(),
      'Whitcomb self-certified on a 506(c) vehicle: the gate fails and the registry says the same',
    );
  }
}
