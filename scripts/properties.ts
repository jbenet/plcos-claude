/**
 * The properties-to-check and useful-variations harness.
 *
 * v4's target-pursuit fixture set carried two sections that no package turned into code:
 * a list of properties that must hold over the corpus, and a list of perturbations with
 * the outcome each should produce. This runs both, against a scratch database, so the
 * discipline is testable rather than aspirational.
 *
 *   npm run props
 */
import { spawnSync } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';

// Always the demo profile, whatever the shell says: the harness deletes and rebuilds its
// database on every run, and the fixtures it checks against are the fictional ones.
process.env.DATA_PROFILE = 'demo';
const SCRATCH = join('data', 'demo', 'props');
process.env.PGLITE_DIR = `./${SCRATCH}`;
delete process.env.DATABASE_URL;

type Check = { name: string; ok: boolean; detail: string };

const results: Check[] = [];
const check = (name: string, ok: boolean, detail: string) => {
  results.push({ name, ok, detail });
};

async function freshDb() {
  await rm(join(process.cwd(), SCRATCH), { recursive: true, force: true });
  const g = globalThis as typeof globalThis & { __capitalOsDb?: unknown };
  delete g.__capitalOsDb;
  const { openFresh } = await import('../lib/db');
  return openFresh();
}

async function main() {
  const db = await freshDb();
  const { listEntities } = await import('../modules/identity');
  const { planRoutes } = await import('../modules/network');
  const { RUNGS } = await import('../modules/strategy');

  const entities = await listEntities();
  const id = (name: string) => entities.find((e) => e.displayName === name)!.entityId;

  // ---------------------------------------------------------------- properties

  const orphanClaims = await db.query<{ n: string }>(
    `select count(*)::text as n from research.claim c
      left join research.source_doc d on d.doc_id = c.source
      where d.doc_id is null or c.as_of is null or c.confidence is null`,
  );
  check(
    'Every claim carries a complete provenance tuple',
    Number(orphanClaims[0]!.n) === 0,
    `${orphanClaims[0]!.n} claims missing a source, an as-of or a confidence`,
  );

  const roos = await planRoutes('juan', id('Delia Roos'));
  const badUnreviewed = roos!.routes.filter(
    (r) =>
      r.hops.some((h) => (h.edge.tier === 'C' || h.edge.tier === 'D') && !h.edge.reviewedByName) &&
      (r.verdict === 'recommend' || r.verdict === 'hold'),
  );
  check(
    'No route with an unreviewed C or D hop is recommended or held',
    badUnreviewed.length === 0,
    `${badUnreviewed.length} such routes`,
  );

  const restrictedPaths = roos!.routes.filter((r) => r.connectorNames.includes('Jonah Hale'));
  check(
    'Every path through a restricted party is excluded',
    restrictedPaths.length > 0 && restrictedPaths.every((r) => r.verdict === 'excluded'),
    `${restrictedPaths.filter((r) => r.verdict === 'excluded').length} of ${restrictedPaths.length} excluded`,
  );

  const pursuits = await db.query<{ pursuit_id: string; rungs: string[] }>(
    `select p.pursuit_id, array_agg(l.rung::text order by l.occurred_at) as rungs
       from strategy.pursuit p join strategy.ladder_event l on l.pursuit_id = p.pursuit_id
      group by p.pursuit_id`,
  );
  const gapped = pursuits.filter((p) => {
    const idxs = p.rungs.map((r) => RUNGS.indexOf(r as (typeof RUNGS)[number])).sort((a, b) => a - b);
    return idxs.some((v, i) => v !== i);
  });
  check(
    'The consent ladder has no gaps: recorded rungs are always a prefix',
    gapped.length === 0,
    `${gapped.length} pursuits with a skipped rung`,
  );

  const softHard = await db.query<{ n: string }>(
    `select count(*)::text as n from strategy.ladder_event
      where rung = 'cash_received' and pursuit_id not in (
        select pursuit_id from strategy.ladder_event where rung = 'commitment_accepted')`,
  );
  check(
    'No cash is recorded without an accepted commitment beneath it',
    Number(softHard[0]!.n) === 0,
    `${softHard[0]!.n} violations`,
  );

  const halfAdjudicated = await db.query<{ n: string }>(
    `select count(*)::text as n from coordination.conflict_case
      where status = 'adjudicated'
        and (winner_ask_id is null or loser_ask_id is null
             or reason_code is null or loser_followup_at is null)`,
  );
  check(
    'Every adjudicated conflict has a winner, a loser, a reason and a dated follow-up',
    Number(halfAdjudicated[0]!.n) === 0,
    `${halfAdjudicated[0]!.n} incomplete adjudications`,
  );

  const ungatedAsks = await db.query<{ n: string }>(
    `select count(*)::text as n from coordination.ask
      where status in ('proposed','blocked') and ticket_id is null`,
  );
  check(
    'Every live ask carries an approval ticket',
    Number(ungatedAsks[0]!.n) === 0,
    `${ungatedAsks[0]!.n} live asks with no ticket`,
  );

  const softCash = await db.query<{ n: string }>(
    "select count(*)::text as n from pipeline.exposure where track = 'soft' and cash_received_at is not null",
  );
  check(
    'No cash is recorded against a soft commitment',
    Number(softCash[0]!.n) === 0,
    `${softCash[0]!.n} soft rows with cash`,
  );

  const hardNoEvidence = await db.query<{ n: string }>(
    "select count(*)::text as n from pipeline.exposure where track = 'hard' and (evidence_ref is null or hardened_at is null)",
  );
  check(
    'Every hard commitment names the document that makes it hard',
    Number(hardNoEvidence[0]!.n) === 0,
    `${hardNoEvidence[0]!.n} hard rows without evidence or a date`,
  );

  const { vehicleTotals } = await import('../modules/pipeline');
  const totals = await vehicleTotals();
  check(
    'Convertible soft never exceeds soft',
    totals.every((t) => t.convertibleSoft <= t.soft + 0.0001),
    totals.map((t) => `${t.vehicleSlug} ${Math.round(t.convertibleSoft / 1e6)}≤${Math.round(t.soft / 1e6)}`).join(', '),
  );

  const danglingApply = await db.query<{ n: string }>(
    `select count(*)::text as n from governance.approval_ticket t
      where t.scope ? 'apply'
        and t.scope->'apply'->>'command' = 'pipeline.harden'
        and not exists (
          select 1 from pipeline.exposure x
           where x.exposure_id::text = t.scope->'apply'->'args'->>'exposureId')`,
  );
  check(
    'Every MONEY ticket points at an exposure that exists',
    Number(danglingApply[0]!.n) === 0,
    `${danglingApply[0]!.n} tickets with a dangling subject`,
  );

  const { ranked: rankedFor } = await import('../modules/scoring');
  const neurotechId = (await db.one<{ id: string }>("select id from platform.vehicle where slug = 'neurotech'"))!.id;
  const rankedRows = await rankedFor(neurotechId);
  check(
    'A target missing any factor is never given a score',
    rankedRows.every((r) => (r.missing.length > 0) === (r.score === null)),
    `${rankedRows.filter((r) => r.missing.length > 0).length} unscored of ${rankedRows.length}`,
  );

  const badWeights = await db.query<{ n: string }>(
    `select count(*)::text as n from scoring.weights
      where abs(capacity + affinity + propensity + time_to_decision - 1) > 0.0001`,
  );
  check(
    'Every weight set sums to one',
    Number(badWeights[0]!.n) === 0,
    `${badWeights[0]!.n} malformed sets`,
  );

  // Type, not behaviour. The wrap rules passed every behavioural check while
  // allowedAudiences was a raw string, because String.includes does substring matching and
  // no audience value happens to be a substring of another. The rules were right by luck.
  const { listWrapRules } = await import('../modules/content');
  const wrapRules = await listWrapRules();
  check(
    'Wrap rules deserialize as real arrays, not array literals',
    wrapRules.length > 0 && wrapRules.every((r) => Array.isArray(r.allowedAudiences)),
    `${wrapRules.filter((r) => Array.isArray(r.allowedAudiences)).length} of ${wrapRules.length} ` +
    'parsed — this harness migrates and reads on one connection, which is the shape that breaks',
  );

  const { wrongWrapSends } = await import('../modules/content');
  check(
    'Wrong-wrap sends = 0',
    (await wrongWrapSends()) === 0,
    'nothing has been sent under a wrap that refused it',
  );

  const ticketedRefusals = await db.query<{ n: string }>(
    "select count(*)::text as n from content.send where status = 'refused' and ticket_id is not null",
  );
  check(
    'A refused send never gets an approval ticket',
    Number(ticketedRefusals[0]!.n) === 0,
    `${ticketedRefusals[0]!.n} refused sends with a ticket`,
  );

  const { listAccreditation } = await import('../modules/compliance');
  const accreditation = await listAccreditation();
  const selfCert506c = accreditation.filter(
    (r) => r.exemption === '506(c)' && r.method === 'self_certified',
  );
  check(
    'Self-certification never satisfies a 506(c) vehicle',
    selfCert506c.length > 0 && selfCert506c.every((r) => !r.sufficient),
    `${selfCert506c.length} self-certified records on 506(c) vehicles, none of them sufficient`,
  );

  const solicit506b = await db.query<{ n: string }>(
    `select count(*)::text as n from compliance.solicitation s
       join platform.vehicle v on v.id = s.vehicle_id where v.exemption = '506(b)'`,
  );
  check(
    'No 506(b) vehicle appears in the solicitation log',
    Number(solicit506b[0]!.n) === 0,
    `${solicit506b[0]!.n} general-solicitation events against a 506(b) vehicle`,
  );

  const unsubstantiated = await db.query<{ n: string }>(
    "select count(*)::text as n from compliance.public_claim where status = 'in_use' and coalesce(substantiation, '') = ''",
  );
  check(
    'Every public claim in use has substantiation on file',
    Number(unsubstantiated[0]!.n) === 0,
    `${unsubstantiated[0]!.n} unsubstantiated claims in use`,
  );

  const disagreeing = await db.query<{ n: string }>(
    `select count(*)::text as n
       from close.pack_item p
       join close.cycle c on c.cycle_id = p.cycle_id
       join pipeline.exposure x on x.entity_id = p.entity_id and x.vehicle_id = c.vehicle_id
      where (p.status = 'countersigned') <> (x.track = 'hard')`,
  );
  check(
    'The pack and the exposure never disagree about a countersignature',
    Number(disagreeing[0]!.n) === 0,
    `${disagreeing[0]!.n} rows where the paperwork and the headline tell different stories`,
  );

  const unpinnedRuns = await db.query<{ n: string }>(
    `select count(*)::text as n from agents.run
      where config_hash is null or input_hash is null or prompt_hash is null
         or config_snapshot is null`,
  );
  check(
    'Every agent run pins its config, input and prompt',
    Number(unpinnedRuns[0]!.n) === 0,
    `${unpinnedRuns[0]!.n} runs without a full pin`,
  );

  const looseCases = await db.query<{ n: string }>(
    'select count(*)::text as n from agents.eval_case where not protected or from_failure is null',
  );
  check(
    'Every eval case is protected and traceable to a real failure',
    Number(looseCases[0]!.n) === 0,
    `${looseCases[0]!.n} cases that are unprotected or invented`,
  );

  const looseRestrictions = await db.query<{ n: string }>(
    `select count(*)::text as n from coordination.restriction
      where scope = 'connector' and connector_id is null`,
  );
  check(
    'A connector-scoped restriction names the connector',
    Number(looseRestrictions[0]!.n) === 0,
    `${looseRestrictions[0]!.n} unnamed`,
  );

  // ---- funder–vehicle fit -------------------------------------------------

  {
    const { listAssessments } = await import('../modules/fit');
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

  await db.close();

  // ---------------------------------------------------------------- variations

  const variations: Array<{
    name: string;
    describe: string;
    perturb: (db: Awaited<ReturnType<typeof freshDb>>, ids: (n: string) => string) => Promise<void>;
    expect: string;
    assert: (routes: Awaited<ReturnType<typeof planRoutes>>) => { ok: boolean; detail: string };
  }> = [
    {
      name: 'remove the tier-A route',
      describe: 'Delete the Duettmann → Roos edge.',
      expect: 'The best remaining route is a Hold, not a Recommend. Nothing is silently promoted.',
      perturb: async (d, ids) => {
        await d.query('delete from network.edge where from_entity = $1 and to_entity = $2', [
          ids('Allison Duettmann'), ids('Delia Roos'),
        ]);
      },
      assert: (r) => {
        const best = r!.routes[0];
        return {
          ok: Boolean(best) && best!.verdict === 'hold',
          detail: `best verdict is ${best?.verdict ?? 'none'}`,
        };
      },
    },
    {
      name: 'add a blanket do-not-contact',
      describe: 'Record a blanket restriction on Roos.',
      expect: 'Every route is excluded. Not one is downgraded to Hold and left clickable.',
      perturb: async (d, ids) => {
        await d.query(
          `insert into coordination.restriction (entity_id, scope, instruction, source)
           values ($1, 'blanket', 'Roos asked not to be approached about any fund this year.', 'S05')`,
          [ids('Delia Roos')],
        );
      },
      assert: (r) => ({
        ok: r!.routes.length > 0 && r!.routes.every((x) => x.verdict === 'excluded'),
        detail: `${r!.routes.filter((x) => x.verdict === 'excluded').length} of ${r!.routes.length} excluded`,
      }),
    },
    {
      name: 'a human reviews the tier-D edge',
      describe: 'Mark Navarro → Roos as confirmed by a person.',
      expect:
        'It becomes usable but not good: Hold, never Recommend. Review removes the refusal; ' +
        'it does not upgrade the evidence.',
      perturb: async (d, ids) => {
        const u = await d.one<{ id: string }>("select id from platform.app_user where handle = 'juan'");
        await d.query(
          `update network.edge set reviewed_by = $3, reviewed_at = now(),
                  review_note = 'Spoke to Navarro; she knows Roos slightly.'
            where from_entity = $1 and to_entity = $2`,
          [ids('Elena Navarro'), ids('Delia Roos'), u!.id],
        );
      },
      assert: (r) => {
        const path = r!.routes.find((x) => x.connectorNames.includes('Elena Navarro'));
        return {
          ok: path?.verdict === 'hold',
          detail: `Navarro route is ${path?.verdict ?? 'missing'}`,
        };
      },
    },
    {
      name: 'the connector reaches the cap',
      describe: 'Record one more ask through Duettmann this quarter.',
      expect: 'The tier-A route drops from Recommend to Hold on goodwill, not on evidence.',
      perturb: async (d, ids) => {
        const u = await d.one<{ id: string }>("select id from platform.app_user where handle = 'juan'");
        const v = await d.one<{ id: string }>("select id from platform.vehicle where slug = 'rails'");
        await d.query(
          `insert into coordination.ask
             (entity_id, connector_id, vehicle_id, status, owner_id, purpose, made_at, channel)
           values ($1,$2,$3,'made',$4,'Another ask this quarter', now() - interval '2 days', 'email')`,
          [ids('Anne Quill'), ids('Allison Duettmann'), v!.id, u!.id],
        );
      },
      assert: (r) => {
        const path = r!.routes.find((x) => x.connectorNames.includes('Allison Duettmann'));
        return {
          ok: path?.verdict === 'hold',
          detail: `Duettmann route is ${path?.verdict ?? 'missing'}`,
        };
      },
    },
  ];

  // The gate-to-action chain, end to end: approving the Cedar MONEY ticket is the only
  // thing in this system that can move the headline.
  {
    const d = await freshDb();
    const { vehicleTotals: vt } = await import('../modules/pipeline');
    const { getTicket, decideTicket } = await import('../modules/governance');
    const { applyApprovedTicket } = await import('../app/approvals/apply');

    const before = (await vt()).find((t) => t.vehicleSlug === 'neurotech')!;
    const t = await d.one<{ id: string }>(
      "select id from governance.approval_ticket where kind = 'MONEY' and decision is null",
    );
    const juan = await d.one<{ id: string }>("select id from platform.app_user where handle = 'juan'");
    await decideTicket(juan!.id, t!.id, 'approve', 'Countersigned copy on file.');
    const ticket = await getTicket(t!.id);
    await applyApprovedTicket(juan!.id, ticket!);
    const after = (await vt()).find((t2) => t2.vehicleSlug === 'neurotech')!;

    const moved = Math.round((after.hard - before.hard) / 1e6);
    const dropped = Math.round((before.soft - after.soft) / 1e6);
    const pack = await d.one<{ status: string }>(
      `select p.status::text as status from close.pack_item p
         join identity.entity e on e.entity_id = p.entity_id
        where e.display_name = 'Cedar Trust'`,
    );
    check(
      'Variation — approve the MONEY ticket',
      moved === 4 && dropped === 4 && after.cash === before.cash && pack?.status === 'countersigned',
      `hard +$${moved}M, soft -$${dropped}M, cash unchanged at $${Math.round(after.cash / 1e6)}M ` +
      `(an accepted commitment is not a wire), and the subscription pack moved to ${pack?.status} ` +
      'in the same transaction',
    );
    await d.close();
  }

  // Re-weighting is an argument, and the argument has to move the order in the direction
  // the weights say it should.
  {
    const d = await freshDb();
    const { ranked: rk, setActiveWeights } = await import('../modules/scoring');
    const vid = (await d.one<{ id: string }>("select id from platform.vehicle where slug = 'neurotech'"))!.id;
    const juan = (await d.one<{ id: string }>("select id from platform.app_user where handle = 'juan'"))!.id;

    const before = (await rk(vid)).find((r) => r.entityName === 'Roos Foundation')!;
    await setActiveWeights(juan, {
      label: 'Propensity over capacity',
      capacity: 0.1, affinity: 0.3, propensity: 0.4, timeToDecision: 0.2,
    });
    const after = (await rk(vid)).find((r) => r.entityName === 'Roos Foundation')!;

    check(
      'Variation — reweight toward propensity',
      (after.score ?? 1) < (before.score ?? 0),
      `Roos Foundation ${before.score?.toFixed(2)} → ${after.score?.toFixed(2)}; its weakest ` +
      'dimension is propensity (no LP positions in seven years), so raising that weight has to lower it',
    );
    await d.close();
  }

  // The wrap matrix, end to end: a genuinely approved public primer, refused for a 506(b)
  // vehicle before any approval is requested.
  {
    const d = await freshDb();
    const { requestSend } = await import('../modules/content');
    const asset = (await d.one<{ asset_id: string }>(
      "select asset_id from content.asset where title = 'Neurotech primer v4'",
    ))!;
    const halo = (await d.one<{ id: string }>("select id from platform.vehicle where slug = 'spv-halo'"))!;
    const target = (await d.one<{ entity_id: string }>(
      "select entity_id from identity.entity where display_name = 'Kaplan Family Trust'",
    ))!;
    const juan = (await d.one<{ id: string }>("select id from platform.app_user where handle = 'juan'"))!;

    const out = await requestSend(juan.id, {
      assetId: asset.asset_id, entityId: target.entity_id, vehicleId: halo.id, instrument: 'spv',
    });
    check(
      'Variation — public primer for the 506(b) SPV',
      !out.check.allowed && out.ticketId === null && out.check.refusals.length === 2,
      `refused with ${out.check.refusals.length} reasons and no ticket opened — audience and ` +
      'permitted-use both fail, and both are reported',
    );
    await d.close();
  }

  // Lineage: superseding a claim flags every derivative, and a flagged asset cannot be sent.
  {
    const d = await freshDb();
    const { invalidateForClaim, requestSend } = await import('../modules/content');
    const claim = (await d.one<{ claim_id: string }>(
      `select c.claim_id from research.claim c join content.claim_ref r on r.claim_id = c.claim_id
        limit 1`,
    ))!;
    const flagged = await invalidateForClaim(claim.claim_id, 'The cheque band changed after a call with the trustee.');

    const asset = (await d.one<{ asset_id: string }>(
      "select asset_id from content.asset where title = 'Neurotech primer v4'",
    ))!;
    const neuro = (await d.one<{ id: string }>("select id from platform.vehicle where slug = 'neurotech'"))!;
    const target = (await d.one<{ entity_id: string }>(
      "select entity_id from identity.entity where display_name = 'Kaplan Family Trust'",
    ))!;
    const juan = (await d.one<{ id: string }>("select id from platform.app_user where handle = 'juan'"))!;
    const out = await requestSend(juan.id, {
      assetId: asset.asset_id, entityId: target.entity_id, vehicleId: neuro.id, instrument: 'lp_commitment',
    });

    check(
      'Variation — a claim changes underneath an approved asset',
      flagged > 1 && !out.check.allowed,
      `${flagged} assets flagged transitively, and the send is refused: a deck goes wrong ` +
      'because a fact changed, not because time passed',
    );
    await d.close();
  }

  // The verification gate: complete, signed, and still insufficient.
  {
    const d = await freshDb();
    const { requestHardening } = await import('../modules/pipeline');
    const juan = (await d.one<{ id: string }>("select id from platform.app_user where handle = 'juan'"))!;
    const whitcomb = (await d.one<{ exposure_id: string }>(
      `select x.exposure_id from pipeline.exposure x
         join identity.entity e on e.entity_id = x.entity_id
         join platform.vehicle v on v.id = x.vehicle_id
        where e.display_name = 'Whitcomb Capital' and v.slug = 'neurotech'`,
    ))!;
    let refusal = '';
    try {
      await requestHardening(juan.id, {
        exposureId: whitcomb.exposure_id, evidenceRef: 'sub-doc:whitcomb', note: 'Countersigned.',
      });
    } catch (err) {
      refusal = err instanceof Error ? err.message : String(err);
    }
    check(
      'Variation — harden a subscriber who only self-certified',
      refusal.includes('reasonable steps'),
      refusal
        ? 'refused before a MONEY ticket was opened — the record is complete and still insufficient'
        : 'NOT REFUSED — a self-certified 506(c) subscriber was allowed to harden',
    );
    await d.close();
  }

  // Delegation cannot increase permission.
  {
    const d = await freshDb();
    const { createEnvelope, listEnvelopes, EnvelopeViolation } = await import('../modules/agents');
    const parent = (await listEnvelopes())[0]!;
    const juan = (await d.one<{ id: string }>("select id from platform.app_user where handle = 'juan'"))!;
    let refused = '';
    try {
      await createEnvelope(juan.id, {
        task: 'Draft and send the brief',
        scope: 'One target, one vehicle.',
        allowedEvidence: parent.allowedEvidence,
        allowedCommands: [...parent.allowedCommands, 'content.send'],
        budget: parent.budget,
        deadline: null,
        outputSchema: 'PrepBrief',
        acceptanceCriteria: parent.acceptanceCriteria,
        escalationOwnerId: juan.id,
        parentEnvelope: parent.envelopeId,
      });
    } catch (err) {
      refused = err instanceof EnvelopeViolation ? err.message : String(err);
    }
    check(
      'Variation — a child envelope asks for a command its parent lacks',
      refused.includes('cannot increase permission'),
      refused ? 'refused, and nothing was created' : 'NOT REFUSED — the child was created',
    );
    await d.close();
  }

  // A double click must not accept twice.
  {
    const d = await freshDb();
    const { acceptRun, listRuns } = await import('../modules/agents');
    const run = (await listRuns())[0]!;
    const juan = (await d.one<{ id: string }>("select id from platform.app_user where handle = 'juan'"))!;
    const first = await acceptRun(juan.id, run.runId, 'accept:run:1', 'Looks right.');
    const second = await acceptRun(juan.id, run.runId, 'accept:run:1', 'Looks right.');
    const rows = await d.one<{ n: string }>('select count(*)::text as n from agents.acceptance');
    check(
      'Variation — accepting the same run twice',
      !first.alreadyAccepted && second.alreadyAccepted && Number(rows!.n) === 1,
      'the second call is a no-op and exactly one acceptance exists',
    );
    await d.close();
  }

  // The grants gate: blocked, and not overridable.
  {
    const d = await freshDb();
    const { evaluateGuards } = await import('../modules/coordination');
    const halvorsen = (await d.one<{ entity_id: string }>(
      "select entity_id from identity.entity where display_name = 'Halvorsen Institute'",
    ))!;
    const orsini = (await d.one<{ entity_id: string }>(
      "select entity_id from identity.entity where display_name = 'Orsini Foundation'",
    ))!;
    const rail = (await d.one<{ id: string }>("select id from platform.vehicle where slug = 'grants'"))!;

    const blockedReport = await evaluateGuards({
      entityId: halvorsen.entity_id, connectorId: null, vehicleId: rail.id,
    });
    const openReport = await evaluateGuards({
      entityId: orsini.entity_id, connectorId: null, vehicleId: rail.id,
    });
    const gateBlock = blockedReport.blocks.find((b) => b.rule === 'no_unsolicited_grant');

    check(
      'Variation — grants-rail outreach without an invitation',
      Boolean(gateBlock) && !openReport.blocks.some((b) => b.rule === 'no_unsolicited_grant'),
      'blocked for the sourced funder, permitted for the one with an invitation on file',
    );
    await d.close();
  }

  for (const v of variations) {
    const d = await freshDb();
    const { listEntities: le } = await import('../modules/identity');
    const { planRoutes: pr } = await import('../modules/network');
    const ents = await le();
    const ids = (n: string) => ents.find((e) => e.displayName === n)!.entityId;
    await v.perturb(d, ids);
    const r = await pr('juan', ids('Delia Roos'));
    const out = v.assert(r);
    check(`Variation — ${v.name}`, out.ok, `${v.expect} (${out.detail})`);
    await d.close();
  }

  // ---------------------------------------------------------------- Affinity is read-only (N39)
  //
  // Every check runs the client that talks to Affinity, with a scripted transport in place
  // of the network, so what is proved is the code that enforces it rather than a copy.

  const adb = await freshDb();
  const aff = await import('../lib/connectors/affinity');
  const { AFFINITY_ORIGIN } = await import('../lib/connectors/affinity/fetch');
  const { httpsTransport } = await import('../lib/connectors/affinity/client');
  const KEY = 'test-key-5f2a9c-never-leaves';
  type Reply = { status: number; headers?: Record<string, string>; body: unknown };
  const scripted = (respond: (url: URL, n: number) => Reply) => {
    const calls: URL[] = [];
    return {
      calls,
      transport: {
        kind: 'scripted' as const,
        async get(url: URL) {
          calls.push(url);
          const r = respond(url, calls.length);
          return { status: r.status, headers: new Headers(r.headers ?? {}), text: async () => JSON.stringify(r.body) };
        },
      },
    };
  };
  const slept: number[] = [];
  const sleep = async (ms: number) => { slept.push(ms); };
  const ok = (body: unknown = { data: [], pagination: { nextUrl: null } }): Reply => ({
    status: 200,
    headers: { 'x-ratelimit-limit-user': '900', 'x-ratelimit-limit-user-remaining': '899', 'x-ratelimit-limit-user-reset': '60' },
    body,
  });
  const attempt = async (fn: () => Promise<unknown>) => {
    try { await fn(); return null; } catch (e) { return e as Error; }
  };

  {
    let sent = 0;
    const send = aff.guardedFetch(async () => { sent++; return new Response('{}'); });
    const url = new URL('/v2/lists', AFFINITY_ORIGIN);
    const refused: string[] = [];
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      if ((await attempt(() => send(url, { method }))) instanceof aff.ReadOnlyViolation) refused.push(method);
    }
    const body = await attempt(() => send(url, { method: 'GET', body: '{}' }));
    const elsewhere = await attempt(() => send(new URL('https://example.com/v2/lists'), { method: 'GET' }));
    check(
      'The Affinity client can send nothing but GET, and only to Affinity',
      refused.length === 4 && body instanceof aff.ReadOnlyViolation && elsewhere instanceof aff.ReadOnlyViolation && sent === 0,
      `${refused.join(', ')} refused; a body refused: ${body instanceof aff.ReadOnlyViolation}; another host refused: ${elsewhere instanceof aff.ReadOnlyViolation}; requests that reached fetch: ${sent}`,
    );
  }

  {
    const s1 = scripted(() => ok());
    const c = aff.affinity({ transport: s1.transport, key: KEY, sleep });
    const hook = await attempt(() => c.get('/v2/webhooks'));
    const entries = await attempt(() => c.get('/v2/transcripts/12'));
    const logged = await adb.query<{ n: string }>(`select count(*)::text as n from sources.request_log where outcome = 'refused' and endpoint = '(not allowlisted)'`);
    check(
      'Only allowlisted paths are asked for, and a refusal is logged',
      hook instanceof aff.AffinityRefused && entries instanceof aff.AffinityRefused && s1.calls.length === 0 && Number(logged[0]!.n) === 2,
      `webhooks refused: ${hook instanceof aff.AffinityRefused}; transcripts (never read) refused: ${entries instanceof aff.AffinityRefused}; sent: ${s1.calls.length}; refusals logged: ${logged[0]!.n}`,
    );
  }

  {
    const s2 = scripted(() => ok({ data: [{ id: 1 }], pagination: { nextUrl: 'https://example.com/v2/lists?cursor=2' } }));
    const c = aff.affinity({ transport: s2.transport, key: KEY, sleep });
    let pages = 0;
    const err = await attempt(async () => { for await (const _ of c.pages('/v2/lists')) pages++; });
    check(
      'A next page on another host is refused, so the key never goes there',
      pages === 1 && err instanceof aff.AffinityRefused && s2.calls.every((u) => u.origin === AFFINITY_ORIGIN),
      `pages read: ${pages}; followed elsewhere: ${!s2.calls.every((u) => u.origin === AFFINITY_ORIGIN)}`,
    );
  }

  {
    const s3 = scripted(() => ({ status: 401, body: { errors: [{ message: `bad token: Bearer ${KEY} (${KEY})` }] } }));
    const c = aff.affinity({ transport: s3.transport, key: KEY, sleep });
    const err = await attempt(() => c.get('/v2/auth/whoami'));
    const rows = await adb.query<{ t: string }>(`select concat_ws(' ', endpoint, path, note) as t from sources.request_log`);
    const leaked = [err?.message ?? '', ...rows.map((r) => r.t)].filter((t) => t.includes(KEY));
    check(
      'The key appears in no error and no log line, even when Affinity echoes it back',
      err instanceof aff.AffinityError && leaked.length === 0,
      leaked.length ? `leaked in ${leaked.length} places` : `401 surfaced as "${err?.message.slice(0, 70)}…"`,
    );
  }

  {
    slept.length = 0;
    const s4 = scripted((_u, n) => (n === 1 ? { status: 429, headers: { 'x-ratelimit-limit-user-reset': '3' }, body: {} } : ok({ tenant: {} })));
    const c = aff.affinity({ transport: s4.transport, key: KEY, sleep });
    const got = await attempt(() => c.get('/v2/auth/whoami'));
    const s5 = scripted(() => ({ status: 429, headers: { 'x-ratelimit-limit-user-reset': '1' }, body: {} }));
    const c2 = aff.affinity({ transport: s5.transport, key: KEY, sleep });
    const gaveUp = await attempt(() => c2.get('/v2/auth/whoami'));
    check(
      'A 429 waits for the reset Affinity gives, tries again, and gives up after four tries',
      got === null && slept[0] === 3000 && gaveUp instanceof aff.AffinityError && s5.calls.length === 4,
      `first: waited ${slept[0]} ms then succeeded: ${got === null}; always-429: ${s5.calls.length} tries, then ${gaveUp?.name}`,
    );
  }

  {
    const low = { ...ok().headers, 'x-ratelimit-limit-org': '100000', 'x-ratelimit-limit-org-remaining': '5000', 'x-ratelimit-limit-org-reset': '86400' };
    const s6 = scripted(() => ({ status: 200, headers: low, body: {} }));
    const c = aff.affinity({ transport: s6.transport, key: KEY, sleep });
    await attempt(() => c.get('/v2/auth/whoami'));
    const second = await attempt(() => c.get('/v2/rate-limit'));
    check(
      'Under the monthly floor the client stops before sending',
      second instanceof aff.AffinityRefused && s6.calls.length === 1,
      `5,000 of 100,000 left: second request ${second instanceof aff.AffinityRefused ? 'refused' : 'sent'}; sent in all: ${s6.calls.length}`,
    );
  }

  {
    let reached = 0;
    const https = httpsTransport(async () => { reached++; return new Response('{}'); });
    const refused = await attempt(async () => aff.affinity({ transport: https, key: KEY }));
    process.env.AFFINITY_API_KEY = KEY;
    const { affinityKey } = await import('../lib/connectors/affinity/key');
    const seen = affinityKey();
    delete process.env.AFFINITY_API_KEY;
    const fallback = aff.affinity();
    check(
      'The demo profile cannot reach Affinity, and never sees the key',
      refused !== null && reached === 0 && seen === null && fallback.transportKind === 'fixture',
      `HTTPS transport refused: ${refused !== null}; key read in demo: ${seen !== null}; default transport: ${fallback.transportKind}`,
    );
  }

  {
    const t = await aff.testConnection(null);
    check(
      'The connection test reads the plan tier from the account’s own limits',
      !!t?.ok && /Scale or Advanced/.test(t.tier ?? '') && /Enterprise/.test(aff.readTier(null)),
      t?.ok ? `fixture account: "${t.tier}"` : `test failed: ${t?.error}`,
    );
  }
  {
    const disc = await import('../lib/connectors/affinity/discover');
    const first = await disc.discoverLists(null);
    const rows1 = await adb.one<{ n: string }>(`select count(*)::text as n from sources.raw_record`);
    const second = await disc.discoverLists(null);
    const rows2 = await adb.one<{ n: string }>(`select count(*)::text as n from sources.raw_record`);
    check(
      'Discovery lands raw once: running it again stores nothing new',
      first?.status === 'ok' && second?.status === 'ok' && first.newRecords > 0 && second.newRecords === 0 && rows1!.n === rows2!.n,
      `first run: ${first?.newRecords} new of ${first?.records}; second: ${second?.newRecords} new; raw rows ${rows1!.n} → ${rows2!.n}`,
    );

    const match = await import('../lib/connectors/affinity/match');
    const found = await disc.discovered();
    const init = await disc.initForMatching();
    const m = match.matchLists(init!, found.lists);
    const got = (slug: string) => m.find((x) => x.vehicleSlug === slug)!;
    check(
      'A list name matches across dashes and case; a near miss is a suggestion, never a match',
      got('neurotech').list?.id === 101 && got('spv-cortex').list?.id === 103 &&
        got('rails').list === null && got('rails').closest?.list.id === 102,
      `hyphen for em dash: ${got('neurotech').list ? 'matched' : 'missed'}; en for em dash: ${got('spv-cortex').list ? 'matched' : 'missed'}; a word left out: ${got('rails').list ? 'MATCHED' : `suggests "${got('rails').closest?.list.name}"`}`,
    );

    {
      // One list whose fields Affinity refuses must not leave every other list undescribed.
      const lists = [{ id: 1, name: 'Open', creatorId: 1, ownerId: 1, isPublic: true, type: 'company', createdAt: '2026-01-01T00:00:00Z' },
        { id: 2, name: 'Guarded', creatorId: 1, ownerId: 1, isPublic: false, type: 'company', createdAt: '2026-01-01T00:00:00Z' }];
      const s7 = scripted((u) => {
        if (u.pathname === '/v2/lists') return ok({ data: lists, pagination: { nextUrl: null } });
        if (u.pathname === '/v2/lists/2/fields') return { status: 403, body: { errors: [{ message: 'Forbidden' }] } };
        if (u.pathname === '/v2/lists/1/fields') return ok({ data: [{ id: 'field-1', name: 'Stage', type: 'list', enrichmentSource: null, valueType: 'dropdown', createdAt: null }], pagination: { nextUrl: null } });
        return ok();
      });
      const run = await disc.discoverLists(null, { transport: s7.transport, key: KEY, sleep });
      check(
        'A list Affinity will not describe is reported, and the rest are still read',
        run?.status === 'ok' && /fields unavailable for 1 \(Guarded: 403\)/.test(run.note ?? '') && /1 fields/.test(run.note ?? ''),
        `status ${run?.status}; ${run?.note}`,
      );
    }

    {
      // The first slice (N42), on the fake Affinity, after the discovery above.
      const sl = await import('../lib/connectors/affinity/slice');
      const held = await sl.runSlice(null, { ceiling: 1 });
      const heldAsked = await adb.one<{ n: string }>(
        `select count(*)::text as n from sources.request_log where outcome = 'sent' and (endpoint like '%/notes' or endpoint like '%/relationships')`,
      );
      const estimate = Number((held?.detail as { estimate?: number }).estimate ?? 0);
      check(
        'Over the ceiling, the slice reads entries and holds the per-entry reads for a go-ahead',
        held?.status === 'held' && estimate > 0 && Number(heldAsked!.n) === 0,
        `status ${held?.status}; estimate ${estimate}; notes or relationships asked while held: ${heldAsked!.n}`,
      );

      const done = await sl.runSlice(null, { ceiling: 1, approvedUpTo: Math.ceil(estimate * 1.25) });
      const linked = await adb.query<{ t: string }>(
        `select distinct payload->>'entityType' || ':' || (payload->>'entityId') as t from sources.raw_record where kind = 'note_link'`,
      );
      const spvAsked = await adb.one<{ n: string }>(
        `select count(*)::text as n from sources.request_log where path ~ '^/v2/opportunities/8(3|4|5)[0-9]{2}/notes$'`,
      );
      const neuro = new Set(['person:7001', 'person:7003', 'person:7004', 'opportunity:8103']);
      check(
        'Note text is read only where the init file says so, and never on an SPV list',
        done?.status === 'ok' && linked.length === 4 && linked.every((r) => neuro.has(r.t)) && Number(spvAsked!.n) === 0,
        `approved run: ${done?.status}; notes landed for ${linked.map((r) => r.t).join(', ')}; notes asked on SPV lists: ${spvAsked!.n}`,
      );

      const again = await sl.runSlice(null, { approvedUpTo: 1000 });
      check(
        'A second slice stores nothing it already has',
        again?.status === 'ok' && again.newRecords === 0 && again.records > 0,
        `second run: ${again?.records} seen, ${again?.newRecords} new`,
      );

      const inv = await import('../lib/connectors/affinity/inventory');
      const flagged = ['Her husband is recovering from surgery.', 'Mentioned a death in the family.'].every(inv.mentionsHealth);
      const clean = ['Wants the data room before the IC.', 'Prefers the tax treatment of a feeder.', 'Closing conditions are met.'].every((t) => !inv.mentionsHealth(t));
      const report = await inv.inventory();
      const text = JSON.stringify(report);
      const outsiders = ['Delia', 'Roos', 'Lindqvist', 'Tanaka', 'Obi', 'surgery', 'data-room'].filter((w) => text.includes(w));
      const notes = report.notes;
      check(
        'The inventory flags health detail, names nobody outside the team, and sums no amount',
        flagged && clean && outsiders.length === 0 && notes?.health === 1 && !/"sum"|"total"/.test(text),
        `flagged ${flagged}; false alarms ${!clean}; outside names or note words in it: ${outsiders.join(', ') || 'none'}; health-flagged notes ${notes?.health}`,
      );

      const s8 = scripted(() => ok());
      await aff.affinity({ transport: s8.transport, key: KEY, sleep }).get('/v2/lists/1/list-entries', { limit: 100, fieldTypes: ['list', 'global'] });
      const sentTypes = s8.calls[0]?.searchParams.getAll('fieldTypes') ?? [];
      check(
        'A list parameter goes out repeated, the way Affinity asks for several field types',
        sentTypes.join(',') === 'list,global',
        `fieldTypes sent as: ${s8.calls[0]?.search ?? 'nothing'}`,
      );
    }

    const slug = aff.allowed('/v2/lists/12/fields/field-1234/dropdown-options');
    const sneaky = ['/v2/lists/12/fields/field.1/dropdown-options', '/v2/lists/12/fields/Field-1/dropdown-options', '/v2/lists/x1/fields'].filter((p) => aff.allowed(p));
    check(
      'A field id may be a slug, and nothing else passes in an id position',
      slug !== null && sneaky.length === 0,
      `field-1234 allowed: ${slug !== null}; odd ids let through: ${sneaky.length ? sneaky.join(', ') : 'none'}`,
    );
  }

  await adb.close();

  await rm(join(process.cwd(), SCRATCH), { recursive: true, force: true });

  // ---------------------------------------------------------------- the real profile (N38)
  //
  // This process is pinned to the demo, so each of these asks a child process started in
  // the real profile. None of them opens the real database.

  const inReal = (code: string, env: Record<string, string> = {}) => {
    const r = spawnSync('npx', ['tsx', '-e', code], {
      env: { ...process.env, DATA_PROFILE: 'real', PGLITE_DIR: '', DATABASE_URL: '', ...env },
      encoding: 'utf8',
    });
    return { status: r.status, out: `${r.stdout}${r.stderr}` };
  };

  const paths = inReal(
    `import('./config/deployment.ts').then(({ config: c }) => console.log(JSON.stringify([c.data.root, c.db.localDir, c.issues.dir])))`,
    { PGLITE_DIR: './somewhere-else' },
  );
  const where = (() => { try { return JSON.parse(paths.out.trim().split('\n').pop()!) as string[]; } catch { return []; } })();
  check(
    'The real profile keeps every path under data/real, even when PGLITE_DIR says otherwise',
    where.length === 3 && where.every((p) => p.replace(/^\.\//, '').startsWith('data/real')),
    where.length ? where.join(' · ') : `could not read the config: ${paths.out.slice(0, 200)}`,
  );

  const remote = inReal(`import('./config/deployment.ts').then(() => console.log('opened'))`, {
    DATABASE_URL: 'postgres://example.invalid/raise',
  });
  check(
    'The real profile refuses a remote database',
    remote.status !== 0 && remote.out.includes('DATABASE_URL is set in the real profile'),
    remote.status !== 0 ? 'refused at config load' : 'a DATABASE_URL was accepted',
  );

  const seeding = inReal(
    `import('./lib/seed.ts').then(async ({ seed }) => {
       let touched = 0;
       const db = new Proxy({}, { get: () => { touched++; return async () => []; } });
       try { await seed(db); console.log('seeded'); } catch (e) { console.log('refused', touched, e.message); }
     })`,
  );
  check(
    'Seeding refuses the real profile before it touches the database',
    /refused 0 Refusing to seed/.test(seeding.out),
    seeding.out.includes('refused') ? 'refused, with no call on the database' : `not refused: ${seeding.out.slice(0, 200)}`,
  );

  // ---------------------------------------------------------------- report

  const failed = results.filter((r) => !r.ok);
  for (const r of results) {
    console.log(`${r.ok ? '  ok  ' : ' FAIL '} ${r.name}`);
    console.log(`       ${r.detail}`);
  }
  console.log(`\n${results.length - failed.length} of ${results.length} properties hold.`);
  if (failed.length > 0) process.exit(1);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
