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

    // The close track (N52), on the commitment that just hardened and on one still soft.
    const pl = await import('../modules/pipeline');
    const attempt = async (fn: () => Promise<unknown>) => {
      try { await fn(); return null; } catch (e) { return e as Error; }
    };
    const expOf = async (name: string) => (await d.one<{ exposure_id: string; entity_id: string; vehicle_id: string }>(
      `select x.exposure_id, x.entity_id, x.vehicle_id from pipeline.exposure x join identity.entity e on e.entity_id = x.entity_id
        where e.display_name = $1 and x.closed_at is null order by x.amount desc limit 1`, [name]))!;
    const cedar = await expOf('Cedar Trust');
    const counter = await d.one<{ n: string }>(`select count(*)::text as n from pipeline.commitment_event where exposure_id = $1 and step = 'countersigned'`, [cedar.exposure_id]);
    await pl.recordWire(juan!.id, cedar.exposure_id, { on: new Date('2026-09-20T12:00:00Z'), amount: 1_500_000, reference: 'wire-0917' });
    const over = await attempt(() => pl.recordWire(juan!.id, cedar.exposure_id, { on: new Date('2026-09-21T12:00:00Z'), amount: 3_000_000, reference: 'wire-0918' }));
    await pl.recordClosing(juan!.id, cedar.exposure_id, { on: new Date('2026-09-22T12:00:00Z'), closing: 'First close' });
    const [ct] = await pl.closeTracksFor(cedar.entity_id, cedar.vehicle_id);
    const cash = (await vt()).find((t2) => t2.vehicleSlug === 'neurotech')!.cash;
    check(
      'A wire is an amount: a call in part counts in part, never past the commitment, and closing needs it hard',
      Number(counter!.n) === 1 && ct?.state === 'closed' && ct.wired === 1_500_000 && ct.outstanding === 2_500_000 &&
        over instanceof pl.CloseRefused && Math.round((cash - after.cash) / 1e5) === 15,
      `countersigned events ${counter!.n}; state ${ct?.state}; wired ${ct?.wired} of ${ct?.exposure.amount}, outstanding ${ct?.outstanding}; over-wire ${over ? 'refused' : 'ALLOWED'}; cash +$${((cash - after.cash) / 1e6).toFixed(1)}M`,
    );

    const northwood = await expOf('Northwood Capital');
    const wireSoft = await attempt(() => pl.recordWire(juan!.id, northwood.exposure_id, { on: new Date('2026-09-20T12:00:00Z'), amount: 100, reference: 'x' }));
    await pl.recordSignature(juan!.id, northwood.exposure_id, { on: new Date('2026-09-18T12:00:00Z'), document: 'Subscription agreement v1' });
    const noReason = await attempt(() => pl.recordSignature(juan!.id, northwood.exposure_id, { on: new Date('2026-09-21T12:00:00Z'), document: 'Subscription agreement v2' }));
    await pl.recordSignature(juan!.id, northwood.exposure_id, { on: new Date('2026-09-21T12:00:00Z'), document: 'Subscription agreement v2', reason: 'Their holding entity changed its name' });
    const [nt] = await pl.closeTracksFor(northwood.entity_id, northwood.vehicle_id);
    check(
      'Signing moves no money; signing again needs its reason; cash cannot land on a soft commitment',
      nt?.state === 'signed' && nt.exposure.track === 'soft' && nt.resigned === 1 && nt.signature?.document === 'Subscription agreement v2' &&
        noReason instanceof pl.CloseRefused && wireSoft instanceof pl.CloseRefused,
      `state ${nt?.state} on the ${nt?.exposure.track} track; re-signed ${nt?.resigned}; latest ${nt?.signature?.document}; second signature with no reason ${noReason ? 'refused' : 'ALLOWED'}; a wire on soft ${wireSoft ? 'refused' : 'ALLOWED'}`,
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
        `select count(*)::text as n from sources.request_log where outcome = 'sent' and endpoint like '%/relationships'`,
      );
      const estimate = Number((held?.detail as { estimate?: number }).estimate ?? 0);
      check(
        'Over the ceiling, the slice reads entries and holds the per-person reads for a go-ahead',
        held?.status === 'held' && estimate > 0 && Number(heldAsked!.n) === 0,
        `status ${held?.status}; estimate ${estimate}; relationships asked while held: ${heldAsked!.n}`,
      );

      const done = await sl.runSlice(null, { ceiling: 1, approvedUpTo: Math.ceil(estimate * 1.25) });
      const perEntry = await adb.one<{ n: string }>(
        `select count(*)::text as n from sources.request_log where outcome = 'sent' and path ~ '^/v2/(persons|companies|opportunities)/[0-9]+/notes$'`,
      );
      const s9 = scripted(() => ok());
      const offList = await attempt(() => aff.affinity({ transport: s9.transport, key: KEY, sleep }).get('/v2/persons/7001/notes'));
      check(
        'The slice reads no note one entry at a time, and the per-entry note paths are off the allowlist',
        done?.status === 'ok' && Number(perEntry!.n) === 0 && offList instanceof aff.AffinityRefused && s9.calls.length === 0,
        `approved run: ${done?.status}; per-entry note requests ${perEntry!.n}; /v2/persons/7001/notes ${offList instanceof aff.AffinityRefused ? 'refused before sending' : 'ALLOWED'}`,
      );

      const again = await sl.runSlice(null, { approvedUpTo: 1000 });
      check(
        'A second slice stores nothing it already has',
        again?.status === 'ok' && again.newRecords === 0 && again.records > 0,
        `second run: ${again?.records} seen, ${again?.newRecords} new`,
      );

      {
        // Every note, once (N49): the bulk read, on the fake Affinity and on scripted ones.
        const nt = await import('../lib/connectors/affinity/notes');
        const sentNotes = async () => Number((await adb.one<{ n: string }>(`select count(*)::text as n from sources.request_log where outcome = 'sent' and endpoint = '/v2/notes'`))!.n);

        const before = await sentNotes();
        const heldRead = await nt.readNotes(null, { ceiling: 1 });
        check(
          'A notes read over what is allowed holds after one request, the count, and reads no note',
          heldRead?.status === 'held' && heldRead.requests === 1 && (await sentNotes()) - before === 1 && heldRead.records === 0,
          `status ${heldRead?.status}; ${heldRead?.requests} request; ${heldRead?.note}`,
        );

        const first = await nt.readNotes(null, { approvedUpTo: 3 });
        const landed = await adb.one<{ n: string; previews: string }>(
          `select count(distinct source_id)::text as n, count(*) filter (where payload ? 'personsPreview' and payload ? 'repliesCount')::text as previews
             from sources.raw_record where kind = 'note'`,
        );
        const fd = (first?.detail ?? {}) as { mode?: string; estimate?: number; withReplies?: number };
        check(
          'Every note is read in bulk — counted first, each with what it is attached to, replies counted and left',
          first?.status === 'ok' && fd.mode === 'full' && first.requests === 2 && fd.estimate === 2 &&
            Number(landed!.n) === 17 && Number(landed!.previews) === 17 && fd.withReplies === 1,
          `${first?.status}: ${first?.note}; ${first?.requests} requests for ${landed!.n} notes, ${landed!.previews} with their attachments`,
        );

        const second = await nt.readNotes(null);
        const sd = (second?.detail ?? {}) as { mode?: string; since?: string };
        check(
          'After a complete read, the next asks only for what changed since, less a day — here, nothing',
          second?.status === 'ok' && sd.mode === 'since' && !!sd.since && second.requests === 2 && second.records === 0 && second.newRecords === 0,
          `${second?.status}: mode ${sd.mode} since ${sd.since}; ${second?.requests} requests, ${second?.records} notes`,
        );

        // An Affinity that counts 150 notes but keeps paging, and whose next page drops `includes`.
        const s10 = scripted((u, i) => {
          if (u.searchParams.get('limit') === '0') return ok({ data: [], pagination: { totalCount: 150, nextUrl: null } });
          const note = { id: 91000 + i, type: 'entities', content: { html: `<p>n${i}</p>` }, creator: null, mentions: [], createdAt: '2026-01-01T00:00:00Z', updatedAt: null };
          return ok({ data: [note], pagination: { nextUrl: `https://api.affinity.co/v2/notes?cursor=c${i}` } });
        });
        const capped = await nt.readNotes(null, { full: true, approvedUpTo: 4, overrides: { transport: s10.transport, key: KEY, sleep } });
        const pages = s10.calls.filter((u) => u.searchParams.get('limit') !== '0');
        const withIncludes = pages.every((u) => u.searchParams.getAll('includes').length === 4);
        check(
          'A notes read stops at the number approved, and every page asks for the attachments again',
          capped?.status === 'failed' && capped.requests === 4 && pages.length === 3 && withIncludes && /Stopped at 4 requests/.test(capped.note ?? ''),
          `status ${capped?.status}; ${capped?.requests} requests of 4 approved; ${pages.length} pages, includes on each: ${withIncludes}`,
        );
        await adb.query(`delete from sources.raw_record where kind = 'note' and source_id like '91%'`);

        // The calendar (N54): read in bulk under a cap, since the window, then only what changed.
        const mt = await import('../lib/connectors/affinity/meetings');
        const cal = await mt.readMeetings(null);
        const cal2 = await mt.readMeetings(null);
        const s11 = scripted((u, i) => ok({ data: [{ id: 92000 + i, title: null, startTime: '2026-01-01T00:00:00Z', endTime: null, createdAt: '2026-01-01T00:00:00Z', updatedAt: null, attendeesPreview: { data: [], totalCount: 0 } }], pagination: { nextUrl: `https://api.affinity.co/v2/meetings?cursor=m${i}` } }));
        const capped2 = await mt.readMeetings(null, { full: true, cap: 3, overrides: { transport: s11.transport, key: KEY, sleep } });
        const windowed = s11.calls[0]?.searchParams.get('filter') ?? '';
        check(
          'The calendar is read in bulk from its window, then only what changed, and stops at its cap',
          cal?.status === 'ok' && cal.records === 10 && cal.requests === 1 && cal2?.status === 'ok' && cal2.newRecords === 0 &&
            (cal2.detail as { mode?: string }).mode === 'since' && capped2?.status === 'failed' && capped2.requests === 3 &&
            (capped2.detail as { stoppedAtCap?: boolean }).stoppedAtCap === true && windowed.startsWith('startTime>='),
          `first read ${cal?.records} meetings in ${cal?.requests} request; second ${cal2?.newRecords} new (${(cal2?.detail as { mode?: string })?.mode}); capped read ${capped2?.status} at ${capped2?.requests} requests; window filter "${windowed}"`,
        );
        await adb.query(`delete from sources.raw_record where kind = 'meeting' and source_id like '92%'`);
      }

      const inv = await import('../lib/connectors/affinity/inventory');
      const flagged = ['Her husband is recovering from surgery.', 'Mentioned a death in the family.'].every(inv.mentionsHealth);
      const clean = ['Wants the data room before the IC.', 'Prefers the tax treatment of a feeder.', 'Closing conditions are met.'].every((t) => !inv.mentionsHealth(t));
      const namesHeld = inv.looksLikeNames('Organization (LP)', 30, 40) && inv.looksLikeNames('Referrer', 60, 70);
      const vocabShown = !inv.looksLikeNames('Pipeline stage', 14, 2000) && !inv.looksLikeNames('Do not contact', 1, 2) && !inv.looksLikeNames('Main contact at the firm?', 2, 50);
      check(
        'A dropdown of names is withheld from the inventory; a vocabulary is shown',
        namesHeld && vocabShown,
        `names withheld: ${namesHeld}; stage, do-not-contact and yes/no fields shown: ${vocabShown}`,
      );
      const report = await inv.inventory();
      const text = JSON.stringify(report);
      const outsiders = ['Nadia', 'Brandt', 'Vidal', 'Tanaka', 'Obi', 'surgery', 'data-room'].filter((w) => text.includes(w));
      const notes = report.notes;
      check(
        'The inventory flags health detail, names nobody outside the team, and sums no amount',
        flagged && clean && outsiders.length === 0 && notes?.health === 1 && !/"sum"|"total"/.test(text),
        `flagged ${flagged}; false alarms ${!clean}; outside names or note words in it: ${outsiders.join(', ') || 'none'}; health-flagged notes ${notes?.health}`,
      );

      {
        const map = await import('../lib/connectors/affinity/mapping');
        const { impliedRung } = await import('../modules/strategy');
        const { readFile: rf, writeFile: wf } = await import('node:fs/promises');
        const file = join('data', 'demo', 'props-mapping.jsonc');
        await rm(join(process.cwd(), file), { force: true });
        await map.writeMapping(report, {}, file);
        const fresh = await map.readMapping(report, file);
        const lists = Object.values(fresh.lists);
        check(
          'The proposed mapping places what it can, leaves the rest a question, and says nobody has reviewed it',
          fresh.exists && fresh.problems.length === 0 && fresh.mapped > 0 && lists.every((l) => !l.reviewed) && lists.some((l) => l.status.length > 0),
          `${fresh.mapped} of ${fresh.values} values placed; ${lists.length} lists, none reviewed; problems ${fresh.problems.length}`,
        );

        // One field, taken apart (N50): a status, who and why where it ended, and what the word
        // says happened — which claims a rung and is never a ladder event.
        const pv = map.proposeValue;
        const twice = pv('Second meeting done');
        const signedWord = pv('Subscription signed');
        const quiet = pv('Lost: went dark');
        const held = pv('Paused — verbal yes');
        const holdAlone = pv('On Hold');
        const contacted = pv('Contacted');
        check(
          'A status word becomes a status and what it says happened; only the latter claims a rung',
          twice?.status === 'discussing' && !!twice.implies?.includes('met_twice') && impliedRung(twice.implies ?? []) === 'meeting_held' &&
            signedWord?.status === 'committed' && impliedRung(signedWord.implies ?? []) === 'commitment_accepted' &&
            quiet?.status === 'selected' && !!quiet.implies?.includes('reached_out') &&
            holdAlone?.status === 'passed' && holdAlone.passedBy === 'us' && holdAlone.reason === 'do_not_contact' &&
            held?.status === 'committed' && held.next === 'On hold' &&
            contacted?.status === 'connecting' && impliedRung(contacted.implies ?? []) === null,
          `second meeting → ${twice?.status} (${twice?.implies}); signed → ${signedWord?.status}, claims ${impliedRung(signedWord?.implies ?? [])}; lost, went dark → ${quiet?.status} (silence is not a pass); on hold alone → ${holdAlone?.status}, ${holdAlone?.reason}; paused, verbal → ${held?.status}, next "${held?.next}"; contacted claims ${impliedRung(contacted?.implies ?? []) ?? 'nothing'}`,
        );

        // A person edits it — marks a list reviewed, takes a meaning away — and it is regenerated.
        const text0 = await rf(join(process.cwd(), file), 'utf8');
        const edited = text0.replace('"reviewed": false', '"reviewed": true').replace(/("Signed":\s*)\{[^}]*\}/, '$1null');
        await wf(join(process.cwd(), file), edited);
        await map.writeMapping(report, {}, file);
        const kept = await map.readMapping(report, file);
        const first = Object.values(kept.lists)[0]!;
        const signed = first.status.flatMap((s) => Object.entries(s.values)).find(([k]) => k === 'Signed');
        check(
          'Regenerating the mapping keeps every edit, a null a person wrote included',
          first.reviewed && !!signed && signed[1] === null,
          `reviewed ${first.reviewed}; "Signed" → ${JSON.stringify(signed?.[1])}`,
        );

        await wf(join(process.cwd(), file), edited.replace('"status":"committed"', '"status":"won"'));
        const wrong = await map.readMapping(report, file);
        check(
          'A status that is not one of ours is refused by name, and left unplaced',
          wrong.problems.some((p) => /status "won" is not one this tool has/.test(p)),
          wrong.problems[0] ?? 'no problem reported',
        );

        // A file written in stages (before N50) still reads: as statuses, the unreviewed lists
        // re-proposed when it is next written.
        await wf(join(process.cwd(), file), text0.replace(/"status": \[/, '"stage": [').replace(/\{"status":"connecting","implies":\["reached_out"\]\}/g, '{"stage":"contacted"}'));
        const old = await map.readMapping(report, file);
        const oldContacted = Object.values(old.lists).flatMap((l) => l.status.flatMap((src) => Object.entries(src.values))).find(([k]) => k === 'Contacted');
        check(
          'A mapping written in stages reads as statuses',
          old.problems.length === 0 && Object.values(old.lists).some((l) => l.legacy) && oldContacted?.[1]?.status === 'connecting',
          `legacy lists ${Object.values(old.lists).filter((l) => l.legacy).length}; "Contacted" → ${JSON.stringify(oldContacted?.[1])}; problems ${old.problems.length}`,
        );
        await rm(join(process.cwd(), file), { force: true });
      }

      {
        // Translation (N47), on the fake Affinity, through a mapping of its own.
        const map = await import('../lib/connectors/affinity/mapping');
        const tr = await import('../lib/connectors/affinity/translate');
        const { readFile: rf, writeFile: wf } = await import('node:fs/promises');
        const file = join('data', 'demo', 'props-translate.jsonc');
        await rm(join(process.cwd(), file), { force: true });
        await map.writeMapping(report, {}, file);
        const n = async (sql: string, params: unknown[] = []) => Number((await adb.one<{ n: string }>(sql, params))!.n);
        const ladderBefore = await n(`select count(*)::text as n from strategy.ladder_event`);
        const first = await tr.translate(null, { mappingPath: file });
        const hard = await n(`select count(*)::text as n from pipeline.exposure where source = 'affinity' and track = 'hard'`);
        const soft = await n(`select count(*)::text as n from pipeline.exposure where source = 'affinity' and track = 'soft'`);
        const ladderAfter = await n(`select count(*)::text as n from strategy.ladder_event`);
        check(
          'Translation makes nothing hard and writes nothing onto the ladder',
          first?.status === 'ok' && hard === 0 && soft > 0 && ladderBefore === ladderAfter,
          `${first?.status}: ${first?.note}; hard from Affinity ${hard}; ladder events ${ladderBefore} → ${ladderAfter}`,
        );

        const signed = await adb.one<{ track: string; claim: string }>(
          `select x.track::text as track, x.claim from pipeline.exposure x
             join identity.source_record r on r.entity_id = x.entity_id and r.source = 'affinity' and r.source_id = 'person:7006'`,
        );
        check(
          'A signed stage stays soft, marked ready to harden once countersigned',
          signed?.track === 'soft' && /ready to harden once countersigned/.test(signed.claim ?? ''),
          `track ${signed?.track}; "${signed?.claim}"`,
        );

        const claimSig = await adb.one<{ step: string; occurred_on: string | null; source: string; track: string }>(
          `select ce.step::text as step, ce.occurred_on::text as occurred_on, ce.source, x.track::text as track
             from pipeline.commitment_event ce join pipeline.exposure x on x.exposure_id = ce.exposure_id
             join identity.source_record r on r.entity_id = x.entity_id and r.source = 'affinity' and r.source_id = 'person:7006'`,
        );
        check(
          'Affinity’s “Signed” is an undated signature claimed by Affinity, and the money stays soft',
          claimSig?.step === 'signed' && claimSig.occurred_on === null && claimSig.source === 'affinity' && claimSig.track === 'soft',
          `${claimSig?.step}, dated ${claimSig?.occurred_on ?? 'never'}, by ${claimSig?.source}; track ${claimSig?.track}`,
        );

        const dnc = await n(
          `select count(*)::text as n from coordination.restriction c join identity.source_record r
             on r.entity_id = c.entity_id and r.source = 'affinity' and r.source_id = 'person:7005' where c.scope = 'blanket'`,
        );
        const dncPursuit = await adb.one<{ status: string; passed_by: string | null; status_reason: string | null }>(
          `select p.status::text as status, p.passed_by, p.status_reason from strategy.pursuit p join identity.source_record r
             on r.entity_id = p.entity_id and r.source = 'affinity' and r.source_id = 'person:7005'`,
        );
        const co = await import('../modules/coordination');
        const overview = (await co.listRestrictions()).filter((x) => (x.source ?? '').startsWith('affinity:list:')).length;
        const everywhere = (await co.listRestrictions({ includeListMarks: true })).filter((x) => (x.source ?? '').startsWith('affinity:list:')).length;
        check(
          'A do-not-contact mark is a do-not-approach restriction and a pass — shown where they come up, not in every overview',
          dnc === 1 && dncPursuit?.status === 'passed' && dncPursuit.passed_by === 'us' && dncPursuit.status_reason === 'do_not_contact' &&
            overview === 0 && everywhere === 1,
          `restrictions on the marked person: ${dnc}; their pursuit ${dncPursuit?.status} (${dncPursuit?.passed_by}, ${dncPursuit?.status_reason}); in overviews ${overview}, on their own page ${everywhere}`,
        );

        {
          const nt = await import('../lib/connectors/affinity/notes');
          const who = await adb.one<{ entity_id: string }>(`select entity_id from identity.source_record where source = 'affinity' and source_id = 'person:7001'`);
          const about = who ? await nt.notesAbout(who.entity_id) : [];
          const newestFirst = about.every((x, i) => i === 0 || x.createdAt <= about[i - 1]!.createdAt);
          check(
            'An LP’s page shows the notes attached to them, newest first, with health detail flagged',
            about.length === 3 && about[0]!.noteId === 30002 && about.filter((x) => x.health).length === 1 && newestFirst &&
              about.some((x) => x.kind === 'interaction:meeting'),
            `${about.length} notes: ${about.map((x) => `${x.noteId}${x.health ? ' (health)' : ''} ${x.kind}`).join(', ')}`,
          );
        }

        const counted = async () => [
          await n(`select count(*)::text as n from strategy.pursuit where source = 'affinity'`),
          await n(`select count(*)::text as n from pipeline.exposure where source = 'affinity'`),
          await n(`select count(*)::text as n from research.claim where source like 'affinity:%'`),
          await n(`select count(*)::text as n from coordination.restriction where source like 'affinity:%'`),
          await n(`select count(*)::text as n from identity.source_record where source = 'affinity'`),
        ].join(',');
        const before = await counted();
        await tr.translate(null, { mappingPath: file });
        const after = await counted();
        check('Translating twice adds nothing the second time', before === after, `pursuits, exposures, claims, restrictions, people: ${before} → ${after}`);

        const statusOf = (who: string) => adb.one<{ pursuit_id: string; status: string; status_said: string | null; stage_said: string | null; implied: string[]; status_source: string }>(
          `select p.pursuit_id, p.status::text as status, p.status_said::text as status_said, p.stage_said, p.implied, p.status_source
             from strategy.pursuit p join identity.source_record r
               on r.entity_id = p.entity_id and r.source = 'affinity' and r.source_id = $1`, [who],
        );
        // Omar: "Intro made". (Marcus, "Contacted", is marked do-not-contact, which outranks any word.)
        const was = (await statusOf('person:7002'))?.status;
        await wf(join(process.cwd(), file), (await rf(join(process.cwd(), file), 'utf8')).replace(/("Intro made":\s*)\{[^}]*\}/, '$1{"status":"discussing","implies":["replied"]}'));
        await tr.translate(null, { mappingPath: file });
        const now = (await statusOf('person:7002'))?.status;
        check('A mapping edit takes effect the next time it is translated — no request to Affinity', was === 'connecting' && now === 'discussing', `"Intro made" was ${was}, is ${now}`);

        // Money says yes: an amount on the commitment field makes an entry Committed, whatever the
        // word — here "Diligence", with a committed amount beside it.
        const nadia = await statusOf('person:7001');
        check(
          'An amount on the commitment field makes an entry Committed, and the word is kept beside it',
          nadia?.status === 'committed' && nadia.stage_said === 'Diligence' && nadia.implied.includes('soft') && nadia.implied.includes('diligence'),
          `status ${nadia?.status}; Affinity said "${nadia?.stage_said}", implying ${nadia?.implied.join(', ')}`,
        );

        // Touchpoints (N51): from each entry's interaction dates and from meeting, call and email
        // notes, one per interaction, the calendar's date over the note's.
        const mt = await import('../modules/meetings');
        const nadiaLog = await mt.touchpointsFor(nadia!.pursuit_id ? (await adb.one<{ entity_id: string }>(`select entity_id from strategy.pursuit where pursuit_id = $1`, [nadia!.pursuit_id]))!.entity_id : '', null);
        const nadiaSum = mt.summarize(nadiaLog, new Date('2026-09-23T00:00:00Z'));
        const touchBefore = await n(`select count(*)::text as n from meetings.meeting where source = 'affinity'`);
        await tr.translate(null, { mappingPath: file });
        const touchAfter = await n(`select count(*)::text as n from meetings.meeting where source = 'affinity'`);
        check(
          'Affinity’s interactions become dated touchpoints, one each, and translating again adds none',
          nadiaSum.meetingDates.map((d) => d.toISOString().slice(0, 10)).join(',') === '2026-06-18,2026-08-21,2026-09-10' &&
            nadiaSum.nextMeeting?.toISOString().slice(0, 10) === '2026-10-06' &&
            nadiaLog.every((t) => t.vehicleId === null && t.summary === null) && touchBefore > 0 && touchBefore === touchAfter,
          `meetings ${nadiaSum.meetingDates.map((d) => d.toISOString().slice(0, 10)).join(', ')}, next ${nadiaSum.nextMeeting?.toISOString().slice(0, 10)}; ${nadiaLog.length} touchpoints, none tied to a vehicle, no text copied; Affinity touchpoints ${touchBefore} → ${touchAfter}`,
        );

        // Logged here: rules at the door, and nothing reaches the ladder.
        const juanId = (await adb.one<{ id: string }>(`select id from platform.app_user where handle = 'juan'`))!.id;
        const ent = (await adb.one<{ entity_id: string; vehicle_id: string }>(`select entity_id, vehicle_id from strategy.pursuit where pursuit_id = $1`, [nadia!.pursuit_id]))!;
        const ladderT0 = await n(`select count(*)::text as n from strategy.ladder_event`);
        const noCorpus = await attempt(() => mt.logTouchpoint(juanId, { entityId: ent.entity_id, vehicleId: ent.vehicle_id, channel: 'research', on: new Date() }));
        const readAhead = await attempt(() => mt.logTouchpoint(juanId, { entityId: ent.entity_id, vehicleId: ent.vehicle_id, channel: 'meeting', on: new Date(Date.now() + 5 * 86_400_000), read: 'interested' }));
        await mt.logTouchpoint(juanId, { entityId: ent.entity_id, vehicleId: ent.vehicle_id, channel: 'meeting', on: new Date('2026-09-20T12:00:00Z'), direction: 'both', read: 'very_interested', summary: 'Third meeting: the data room walkthrough' });
        await mt.logTouchpoint(juanId, { entityId: ent.entity_id, vehicleId: ent.vehicle_id, channel: 'email', on: new Date('2026-09-21T12:00:00Z'), direction: 'ours', summary: 'Sent the side letter draft' });
        const logged = mt.summarize(await mt.touchpointsFor(ent.entity_id, ent.vehicle_id), new Date('2026-09-23T00:00:00Z'));
        const ladderT1 = await n(`select count(*)::text as n from strategy.ladder_event`);
        check(
          'A logged touchpoint counts, carries their read, and waits on their reply — and touches no rung',
          noCorpus instanceof mt.TouchpointRefused && readAhead instanceof mt.TouchpointRefused &&
            logged.meetingDates.length === 4 && logged.read?.read === 'very_interested' &&
            logged.awaitingSince?.toISOString().slice(0, 10) === '2026-09-21' && ladderT0 === ladderT1,
          `research with no corpus: ${noCorpus ? 'refused' : 'ALLOWED'}; a read before it happened: ${readAhead ? 'refused' : 'ALLOWED'}; meetings ${logged.meetingDates.length}; read ${logged.read?.read}; waiting since ${logged.awaitingSince?.toISOString().slice(0, 10)}; ladder ${ladderT0} → ${ladderT1}`,
        );

        // Readings of the notes (N55): suggestions, never over a person's read, never of health.
        {
          const rd = await import('../lib/connectors/affinity/readings');
          const { shownRead } = await import('../lib/reads');
          const entityOf = async (key: string) => (await adb.one<{ entity_id: string }>(`select entity_id from identity.source_record where source = 'affinity' and source_id = $1`, [key]))!.entity_id;
          const loaded = await n(`select count(*)::text as n from meetings.note_reading`);
          // The demo's health note has a line that says what it took out, so it loads (N56)...
          const redactedRow = await adb.one<{ summary: string }>(`select summary from meetings.note_reading where note_id = '30002'`);
          const { mentionsHealth } = await import('../lib/connectors/affinity/inventory');
          const health = redactedRow && rd.REDACTED.test(redactedRow.summary) && !mentionsHealth(redactedRow.summary) ? 0 : 1;
          // ...and a line that doesn't say so, or still carries the detail, is refused.
          const { writeFile, mkdtemp } = await import('node:fs/promises');
          const { tmpdir } = await import('node:os');
          const dir = await mkdtemp(join(tmpdir(), 'readings-'));
          const rawNotes = (await adb.query<{ payload: import('../lib/connectors/affinity/notes').AffinityNote }>(
            `select distinct on (source_id) payload from sources.raw_record where source = 'affinity' and kind = 'note' order by source_id, fetched_at desc, id desc`)).map((r) => r.payload);
          const refusedOf = async (line: object) => {
            const f = join(dir, `r${Math.random().toString(36).slice(2)}.jsonc`);
            await writeFile(f, JSON.stringify({ by: 'claude', at: '2026-09-23T00:00:00Z', notes: { '30002': line } }));
            return adb.transaction((tx) => rd.importReadings(tx, rawNotes, f));
          };
          const unmarked = await refusedOf({ summary: 'Slower on email this month.', read: 'interested', basis: 'not a signal about interest' });
          const leaky = await refusedOf({ summary: 'Slower on email; her husband is recovering from surgery [redacted].', read: null, basis: null });
          const stillClean = (await adb.one<{ summary: string }>(`select summary from meetings.note_reading where note_id = '30002'`))?.summary === redactedRow?.summary;
          const nadiaE = await entityOf('person:7001');
          const anaE = await entityOf('person:7004');
          const nadiaShown = shownRead(mt.summarize(await mt.touchpointsFor(nadiaE, null)).read, await rd.readingsFor([nadiaE]));
          const anaFirst = shownRead(null, await rd.readingsFor([anaE]));
          await rd.decideReading(juanId, '30003', 'dismiss');
          await tr.translate(null, { mappingPath: file });
          const anaAfter = shownRead(null, await rd.readingsFor([anaE]));
          const stillDismissed = await n(`select count(*)::text as n from meetings.note_reading where note_id = '30003' and dismissed_at is not null`);
          await rd.decideReading(juanId, '30008', 'confirm');
          const anaConfirmed = shownRead(null, await rd.readingsFor([anaE]));
          check(
            'A read suggested from a note never outranks a newer one a person took, reads health only redacted, and a dismissal lasts',
            loaded === 15 && health === 0 && unmarked.health === 1 && unmarked.loaded === 0 && leaky.health === 1 && leaky.loaded === 0 && stillClean &&
              nadiaShown?.suggested === false && nadiaShown.read === 'very_interested' &&
              anaFirst?.suggested === true && anaFirst.noteId === '30003' && anaAfter?.noteId === '30008' && stillDismissed === 1 &&
              anaConfirmed?.suggested === false && anaConfirmed.byName === 'Juan',
            `loaded ${loaded} (the health note's, redacted and marked: ${health === 0}; unmarked refused: ${unmarked.health === 1}; still carrying the detail refused: ${leaky.health === 1}); Nadia shows ${nadiaShown?.read} by ${nadiaShown?.byName}; Ana suggested ${anaFirst?.noteId} → after dismissing, ${anaAfter?.noteId}, still dismissed after translating again: ${stillDismissed === 1}; confirmed → ${anaConfirmed?.read} by ${anaConfirmed?.byName}`,
          );
        }

        // Reconciliation (N57): the climbs the records on file support, proposed by the system, recorded
        // only when a person approves; and a read superseded by a later record pointing the other way.
        {
          const rc = await import('../lib/reconcile');
          const gv = await import('../modules/governance');
          const ap = await import('../app/approvals/apply');
          const sg = await import('../modules/strategy');
          const pf = await import('../modules/platform');
          const sys = await rc.systemActor();
          const canBecome = await pf.getUserByHandle('reconciliation');
          const ladder0 = await n(`select count(*)::text as n from strategy.ladder_event`);
          const first = await rc.reconcile(null);
          const ladder1 = await n(`select count(*)::text as n from strategy.ladder_event`);
          const proposals = await adb.query<{ id: string; subject_id: string; requested_by: string; scope: { apply: { args: { rungs: Array<{ rung: string; evidenceRef: string }> } } } }>(
            `select id::text, subject_id::text, requested_by::text, scope from governance.approval_ticket
              where kind = 'STAGE' and decision is null and scope->'apply'->>'command' = 'strategy.recordClimb'`);
          // Every "Meeting held" it proposes rests on a meeting that happened, with this LP themselves.
          const heldFor = async (pursuitId: string) => n(
            `select count(*)::text as n from meetings.meeting t join strategy.pursuit p on p.entity_id = t.entity_id
              where p.pursuit_id = $1 and t.channel in ('meeting', 'call') and t.held_on <= current_date`, [pursuitId]);
          let unbacked = 0;
          for (const pr of proposals) {
            const rungs = pr.scope.apply.args.rungs;
            if (pr.requested_by !== sys || rungs.some((r) => !/^(affinity:|us:|touchpoint:|commitment_event:)/.test(r.evidenceRef))) unbacked++;
            if (rungs.some((r) => r.rung === 'meeting_held') && (await heldFor(pr.subject_id)) === 0) unbacked++;
          }
          const second = await rc.reconcile(null);
          const mine = proposals.find((pr) => pr.subject_id === nadia!.pursuit_id);
          if (mine) {
            await gv.decideTicket(juanId, mine.id, 'approve', null);
            await ap.applyApprovedTicket(juanId, (await gv.getTicket(mine.id))!);
          }
          const climbed = await sg.getPursuit(nadia!.pursuit_id);
          const replay = mine ? await attempt(async () => ap.applyApprovedTicket(juanId, (await gv.getTicket(mine.id))!)) : null;
          const other = proposals.find((pr) => pr.subject_id !== nadia!.pursuit_id);
          if (other) await gv.decideTicket(juanId, other.id, 'reject', null);
          const third = await rc.reconcile(null);
          check(
            'Reconciliation proposes only what records support, as the system, one ticket per LP; a person approves, and a rejection holds',
            proposals.length > 0 && first.proposed === proposals.length && unbacked === 0 && ladder0 === ladder1 &&
              second.proposed === 0 && canBecome === null && climbed?.rung === 'meeting_held' &&
              climbed.events.some((e) => e.rung === 'connector_willing' && e.evidenceKind === 'not_applicable') &&
              replay instanceof sg.LadderRefused && (!other || (third.rejectedBefore >= 1 && third.proposed === 0)),
            `${first.proposed} proposed (${unbacked} without a record behind them), ladder ${ladder0} → ${ladder1} before any approval; again: ${second.proposed} new, ${second.alreadyOpen} already open; ` +
              `the system actor can be switched to: ${canBecome ? 'YES' : 'no'}; approved Nadia's → ${climbed?.rung} (${climbed?.events.map((e) => `${e.rung}:${e.evidenceKind}`).join(', ')}); applied twice: ${replay ? 'refused' : 'RECORDED AGAIN'}; ` +
              `after a rejection, proposed again: ${third.proposed} (${third.rejectedBefore} held back)`,
          );

          // What a touchpoint is about (N59): the raise only when it says so, and only inside the
          // vehicle's window; and a proposal whose records no longer read the same is withdrawn.
          {
            const ab = await import('../lib/connectors/affinity/about');
            const mt = await import('../modules/meetings');
            const vs = [{ slug: 'neurotech', name: 'PLC Neurotech I', aliases: ['Neurotech I'] }, { slug: 'spv-x', name: 'SPV — X', aliases: ['Xylo'] }];
            const dom = ['fund.example'];
            const cases: Array<[string, string[], string, string]> = [
              ['Re: PLC Neurotech I — data room', [], 'raise', 'neurotech'],
              ['Acme monthly investor update', ['ceo@acme.example'], 'other', ''],
              ['Coffee next week?', ['sam@fund.example'], 'raise', ''],
              ['Coffee next week?', ['sam@research.example'], 'other', ''],
              ['Intro: would they invest in a first close?', [], 'raise', ''],
              ['Neuroscience seminar, spring schedule', [], 'other', ''],
              ['Xylo allocation', [], 'raise', 'spv-x'],
              ['Automatic reply: Invitation from PL Capital', ['sam@fund.example'], 'other', ''],
              ['Invitation from PL Capital: a dinner in April', [], 'raise', ''],
              // Someone at the fundraising domain only on copy: translation passes the sender and
              // the direct recipients, so here there is none.
              ['Re: Panel at the spring conference?', ['host@events.example'], 'other', ''],
            ];
            const wrong = cases.filter(([text, addrs, about, v]) => {
              const r = ab.aboutRaise(text, addrs, vs, dom, ['PL Capital']);
              return r.about !== about || (v ? !r.vehicles.includes(v) : r.vehicles.length > 0);
            });
            const w = { vehicleId: 'v1', slug: 'neurotech', name: 'N', opens: new Date('2026-01-01T00:00:00Z'), closes: null, note: null };
            const touch = (on: string, about: 'raise' | 'other', vehicles: string[] = []) => ({
              touchpointId: 't', entityId: 'e', entityName: 'E', vehicleId: null, vehicleName: null, channel: 'email' as const, kind: null,
              on: new Date(on), scheduledFor: null, direction: 'theirs' as const, ownerName: 'x', attendees: [], summary: null,
              read: null, readByName: null, source: 'affinity', sourceRef: 'r', viaOrganization: null, about, aboutVehicles: vehicles, aboutBasis: null,
            });
            const old2021 = mt.aboutThisRaise(touch('2021-05-01T00:00:00Z', 'raise'), w);
            const in2026 = mt.aboutThisRaise(touch('2026-03-01T00:00:00Z', 'raise'), w);
            const otherVehicle = mt.aboutThisRaise(touch('2026-03-01T00:00:00Z', 'raise', ['spv-x']), w);
            const aboutElse = mt.aboutThisRaise(touch('2026-03-01T00:00:00Z', 'other'), w);
            const noWindow = { ...w, slug: 'spv-x', opens: null };
            const generalNoWindow = mt.aboutThisRaise(touch('2026-03-01T00:00:00Z', 'raise'), noWindow);
            const namedNoWindow = mt.aboutThisRaise(touch('2026-03-01T00:00:00Z', 'raise', ['spv-x']), noWindow);
            const unread = await n(`select count(*)::text as n from meetings.meeting where source = 'affinity' and about is null`);
            const rows = await n(`select count(*)::text as n from meetings.meeting where source = 'affinity'`);
            // A proposal still open; its records then read as about something else.
            const still = await adb.one<{ id: string; subject_id: string }>(
              `select id::text, subject_id::text from governance.approval_ticket
                where kind = 'STAGE' and decision is null and scope->'apply'->>'command' = 'strategy.recordClimb' limit 1`);
            let withdrawn = 0;
            let deferred = 0;
            if (still) {
              await adb.query(`update meetings.meeting set about = 'other' where source = 'affinity' and entity_id = (select entity_id from strategy.pursuit where pursuit_id = $1)`, [still.subject_id]);
              withdrawn = (await rc.reconcile(null)).withdrawn;
              deferred = await n(`select count(*)::text as n from governance.approval_ticket where id = $1 and decision = 'defer'`, [still.id]);
            }
            check(
              'A touchpoint counts for a raise only when it says so and falls in its window; a proposal on records that changed is withdrawn',
              wrong.length === 0 && !old2021 && in2026 && !otherVehicle && !aboutElse && !generalNoWindow && namedNoWindow && unread === 0 && rows > 0 && (!still || (withdrawn >= 1 && deferred === 1)),
              `classifier: ${cases.length - wrong.length} of ${cases.length} right${wrong.length ? ` (wrong: ${wrong.map((c) => c[0]).join('; ')})` : ''}; ` +
                `about the raise but from 2021: ${old2021 ? 'COUNTED' : 'not counted'}; in 2026: ${in2026 ? 'counted' : 'NOT COUNTED'}; naming another vehicle: ${otherVehicle ? 'COUNTED' : 'not counted'}; ` +
                `about something else: ${aboutElse ? 'COUNTED' : 'not counted'}; no window, about a raise in general: ${generalNoWindow ? 'COUNTED' : 'not counted'}, naming it: ${namedNoWindow ? 'counted' : 'NOT COUNTED'}; ${unread} of ${rows} Affinity touchpoints unread after translating; ` +
                `open proposal whose records changed: ${still ? (deferred ? 'withdrawn' : 'STILL OPEN') : 'none open to test'}`,
            );
          }

          const { shownRead } = await import('../lib/reads');
          const at = new Date('2026-09-24T00:00:00Z');
          const note = (read: 'interested' | 'not_very_interested', on: string) => ({
            noteId: '1', entityId: 'e', on: new Date(on), summary: null, read, basis: null, by: 'claude',
            confirmedByName: null, confirmedAt: null, dismissed: false,
          });
          const cooledThenCommitted = shownRead(null, [note('not_very_interested', '2025-10-21T00:00:00Z')], [{ on: new Date('2026-09-23T00:00:00Z'), points: 'up', what: 'committed' }], at);
          const keenThenDeclined = shownRead(null, [note('interested', '2026-05-01T00:00:00Z')], [{ on: new Date('2026-07-01T00:00:00Z'), points: 'down', what: 'they declined' }], at);
          const keenThenCommitted = shownRead(null, [note('interested', '2026-05-01T00:00:00Z')], [{ on: new Date('2026-07-01T00:00:00Z'), points: 'up', what: 'committed' }], at);
          const declinedBefore = shownRead(null, [note('interested', '2026-05-01T00:00:00Z')], [{ on: new Date('2026-04-01T00:00:00Z'), points: 'down', what: 'they declined' }], at);
          const aged = shownRead(null, [note('interested', '2025-10-21T00:00:00Z')], [], at);
          check(
            'A read is superseded only by a later record pointing the other way, and is old past the threshold',
            Boolean(cooledThenCommitted?.superseded) && Boolean(keenThenDeclined?.superseded) && !keenThenCommitted?.superseded &&
              !declinedBefore?.superseded && aged?.old === true && keenThenCommitted?.old === false,
            `not very interested, then committed: ${cooledThenCommitted?.superseded ? 'superseded' : 'STILL SHOWN'}; interested, then declined: ${keenThenDeclined?.superseded ? 'superseded' : 'STILL SHOWN'}; ` +
              `interested, then committed: ${keenThenCommitted?.superseded ? 'SUPERSEDED' : 'stands'}; a decline before the read: ${declinedBefore?.superseded ? 'SUPERSEDED' : 'stands'}; 11 months old: ${aged?.old ? 'old' : 'NOT OLD'}`,
          );
        }

        // A person sets a status; the next translation keeps it, and keeps Affinity's word beside it.
        const st = await import('../modules/strategy');
        const juan = (await adb.one<{ id: string }>(`select id from platform.app_user where handle = 'juan'`))!.id;
        const ruth = (await statusOf('person:7003'))!;
        const refused = await attempt(() => st.setStatus(juan, ruth.pursuit_id, { status: 'passed' }));
        const ladder0 = await n(`select count(*)::text as n from strategy.ladder_event`);
        await st.setStatus(juan, nadia!.pursuit_id, { status: 'discussing', reason: 'Committed amount is their ask, not a yes', nextStep: 'IC on 14 Oct', nextStepOn: new Date('2026-10-14T00:00:00Z') });
        await tr.translate(null, { mappingPath: file });
        const kept2 = await statusOf('person:7001');
        const ladder1 = await n(`select count(*)::text as n from strategy.ladder_event`);
        check(
          'A status set here survives the next translation; Affinity’s reading stays beside it; the ladder is untouched',
          refused instanceof st.StatusRefused && kept2?.status === 'discussing' && kept2.status_source === 'us' &&
            kept2.status_said === 'committed' && kept2.stage_said === 'Diligence' && ladder0 === ladder1,
          `passed with nobody said to end it: ${refused ? 'refused' : 'ALLOWED'}; after translating again: ${kept2?.status} (set ${kept2?.status_source}), Affinity reads ${kept2?.status_said}; ladder events ${ladder0} → ${ladder1}`,
        );

        // An update (N61, issue 0004): read into suggestions, each resting on its words; saved with
        // what the person ticked, all of it in one write, once per form; never a rung or an amount.
        {
          const today = '2026-09-24'; // a Thursday
          const read = (text: string, status: string) => st.readUpdate(text, { status: status as never, today });
          const kinds = (xs: ReturnType<typeof read>) => xs.map((x) => x.kind).join(',');
          const met = read('Met them Tuesday; they want the deck before a second meeting.', 'selected');
          const notMet = read("Haven't met yet.", 'selected');
          const inFor = read("They're in for $2M, verbally.", 'discussing');
          const boston = read('They are in Boston next week.', 'discussing');
          const declined = read('They passed — timing, next fund maybe.', 'discussing');
          const ours = read("We're passing for now.", 'discussing');
          const again = read('Met again today; still in.', 'committed');
          const wrote = read('Emailed Anneliese this morning to ask for twenty minutes.', 'selected');
          const theyWrote = read('They emailed yesterday, keen to talk.', 'connecting');
          const all = [met, notMet, inFor, boston, declined, ours, again, wrote, theyWrote].flat();
          const dir = (xs: ReturnType<typeof read>) => (xs.find((x) => x.kind === 'touch') as { direction?: string } | undefined)?.direction;
          const status = (xs: ReturnType<typeof read>) => xs.find((x) => x.kind === 'status') as { to: string; passedBy?: string; reason?: string } | undefined;
          const touch = met.find((x) => x.kind === 'touch') as { on: string; channel: string } | undefined;
          const readerOk =
            status(met)?.to === 'discussing' && touch?.on === '2026-09-22' && touch.channel === 'meeting' &&
            (met.find((x) => x.kind === 'next') as { step?: string } | undefined)?.step === 'Send the deck' &&
            notMet.length === 0 && status(inFor)?.to === 'committed' && inFor.some((x) => x.kind === 'amount') &&
            !status(boston) && status(declined)?.to === 'passed' && status(declined)?.passedBy === 'them' && status(declined)?.reason === 'timing' &&
            status(ours)?.passedBy === 'us' && !status(again) && again.some((x) => x.kind === 'touch') &&
            status(wrote)?.to === 'connecting' && dir(wrote) === 'ours' && status(theyWrote)?.to === 'discussing' && dir(theyWrote) === 'theirs' &&
            all.every((x) => ['status', 'touch', 'read', 'next', 'amount'].includes(x.kind) && x.basis.length > 0);
          check(
            'An update is read into suggestions, each resting on the words it quotes; forward only; never a rung, and an amount only pointed at',
            readerOk,
            `met Tuesday → ${kinds(met)} (${status(met)?.to}, ${touch?.on}); haven't met → ${kinds(notMet) || 'nothing'}; in for $2M → ${kinds(inFor)}; ` +
              `in Boston → ${kinds(boston) || 'nothing'}; passed on timing → ${status(declined)?.to}/${status(declined)?.passedBy}/${status(declined)?.reason}; we're passing → ${status(ours)?.passedBy}; ` +
              `met again, already committed → ${kinds(again)}; emailed someone by name → ${status(wrote)?.to}/${dir(wrote)}; they emailed → ${status(theyWrote)?.to}/${dir(theyWrote)}`,
          );

          // The audit log in words (N62, issue 0007): what a known action did, and to whom.
          const words = await import('../lib/audit-words');
          const row = (action: string, detail: Record<string, unknown>) => ({ at: new Date(), action, subjectType: 'pursuit', subjectId: 'x', actor: 'Juan', detail });
          const said = [
            words.describeAudit(row('pursuit.status_set', { entity: 'Omar Haddad', vehicle: 'PLC Neurotech I', from: 'Selected', to: 'Discussing' })),
            words.describeAudit(row('ladder.climbed', { entity: 'Omar Haddad', vehicle: 'PLC Neurotech I', rungs: ['target_opted_in:calendar:x', 'meeting_held:calendar:x'] })),
            words.describeAudit(row('touchpoint.logged', { entity: 'Omar Haddad', vehicle: 'PLC Neurotech I', channel: 'email' })),
          ];
          const unknown = words.describeAudit(row('something.new_here', {}));
          check(
            'The audit log reads as sentences that name who and what; an action it does not know is shown by its name, not guessed',
            said[0]!.what === 'Juan set the status to Discussing, from Selected' && said[0]!.about === 'Omar Haddad · PLC Neurotech I' &&
              /LP opted in, Meeting held recorded on the ladder, approved by Juan/.test(said[1]!.what) && said[2]!.what === 'Juan logged an email' &&
              unknown.what === 'Juan · something new here',
            said.map((x) => `${x.what} — ${x.about}`).join('; ') + `; unknown: ${unknown.what}`,
          );

          const up = await import('../lib/updates');
          const target = await adb.one<{ pursuit_id: string; status: string }>(
            `select p.pursuit_id::text, p.status::text from strategy.pursuit p join platform.vehicle v on v.id = p.vehicle_id
              where v.phase <> 'historical' and p.status in ('new', 'sourcing', 'selected', 'connecting')
                and not exists (select 1 from strategy.ladder_event l where l.pursuit_id = p.pursuit_id
                                   and l.rung not in ('connector_willing', 'target_opted_in'))
                and not exists (select 1 from governance.approval_ticket t where t.subject_id = p.pursuit_id and t.kind = 'STAGE' and t.decision is null)
              order by p.opened_at limit 1`);
          if (!target) throw new Error('No pursuit below Meeting held without an open STAGE ticket, for the update property');
          const rungs0 = await n(`select count(*)::text as n from strategy.ladder_event`);
          const empty = await attempt(() => up.addUpdate(juan, { pursuitId: target!.pursuit_id, body: '   ', idempotencyKey: 'k-empty' }));
          const yesterday = new Date(Date.now() - 86_400_000);
          const input = {
            pursuitId: target!.pursuit_id, body: 'Met them yesterday; they want the deck.\nMore after the IC.', idempotencyKey: 'k-n61-1',
            status: { to: 'discussing' as const }, touch: { channel: 'meeting' as const, direction: 'both' as const, on: yesterday, read: 'interested' as const },
            nextStep: { step: 'Send the deck', on: null },
          };
          const saved = await up.addUpdate(juan, input);
          const twice = await up.addUpdate(juan, input);
          const after = await adb.one<{ status: string; status_source: string; status_reason: string; next_step: string }>(
            `select status::text, status_source, status_reason, next_step from strategy.pursuit where pursuit_id = $1`, [target!.pursuit_id]);
          const rows = await n(`select count(*)::text as n from strategy.pursuit_update where pursuit_id = $1`, [target!.pursuit_id]);
          const logged = await n(`select count(*)::text as n from meetings.meeting where pursuit_id = $1 and source = 'us' and summary like 'Met them yesterday%'`, [target!.pursuit_id]);
          const tied = await n(`select count(*)::text as n from platform.audit_log where subject_id = $1 and action = 'pursuit.status_set' and detail->>'updateId' = $2`, [target!.pursuit_id, saved.updateId]);
          const rungs1 = await n(`select count(*)::text as n from strategy.ladder_event`);
          const sysId = await (await import('../lib/reconcile')).systemActor();
          const asked = await n(`select count(*)::text as n from governance.approval_ticket where subject_id = $1 and kind = 'STAGE' and decision is null and requested_by = $2`, [target!.pursuit_id, sysId]);
          const stored = (await st.updatesFor(target!.pursuit_id))[0];
          check(
            'An update writes its status, touchpoint and next step together, once per form, and never a rung; a meeting it logs is proposed for the ladder',
            empty instanceof st.StatusRefused && saved.created && !twice.created && twice.updateId === saved.updateId && rows === 1 && logged === 1 &&
              after?.status === 'discussing' && after.status_source === 'us' && after.status_reason === 'Met them yesterday; they want the deck.' &&
              after.next_step === 'Send the deck' && tied === 1 && rungs1 === rungs0 && saved.proposed && asked === 1 &&
              stored?.applied.status?.from === target!.status && stored.applied.touchpointId !== undefined && stored.suggested.reader === 'rules-1',
            `empty refused: ${empty instanceof st.StatusRefused}; saved ${saved.created}, again ${twice.created ? 'SAVED TWICE' : 'found the first'}; ${rows} update, ${logged} meeting logged; ` +
              `status ${target!.status} → ${after?.status} (${after?.status_source}), why "${after?.status_reason}", next "${after?.next_step}"; audit tied to the update: ${tied}; ` +
              `rungs ${rungs0} → ${rungs1}; ladder proposal from the system: ${asked}; reader pinned: ${stored?.suggested.reader}`,
          );
        }

        await adb.query(`update platform.vehicle set phase = 'historical' where slug = 'neurotech'`);
        await tr.translate(null, { mappingPath: file });
        const open = await n(
          `select count(*)::text as n from pipeline.exposure x join platform.vehicle v on v.id = x.vehicle_id
            where v.slug = 'neurotech' and x.source = 'affinity' and x.closed_at is null`,
        );
        await adb.query(`update platform.vehicle set phase = 'active' where slug = 'neurotech'`);
        await tr.translate(null, { mappingPath: file });
        check('On a historical vehicle, translated money is closed and counts in no current figure', open === 0, `open Affinity exposures on the vehicle while historical: ${open}`);
        await rm(join(process.cwd(), file), { force: true });
      }

      {
        const cmp = await import('../lib/connectors/affinity/compare');
        const [c] = await cmp.compareLists();
        check(
          'An older list is checked against the one in use: who is covered, and who would be lost',
          !!c && c.total === 5 && c.byPerson === 3 && c.missing.length === 1 && c.missing[0]!.status === 'To Research' && c.unlinked.length === 1,
          c ? `${c.total} on the old list: ${c.byPerson} by person, ${c.byOrganization} by organization, ${c.missing.length} missing, ${c.unlinked.length} linked to nobody` : 'no comparison',
        );
      }

      {
        const sl2 = await import('../lib/connectors/affinity/slice');
        const notesBefore = await adb.one<{ n: string }>(`select count(*)::text as n from sources.raw_record where kind = 'note'`);
        const counted = await sl2.countNotes(null);
        const notesAfter = await adb.one<{ n: string }>(`select count(*)::text as n from sources.raw_record where kind = 'note'`);
        const d = counted?.detail as { total?: number; bulkRequests?: number };
        check(
          'Counting the notes costs one request and lands none of them',
          counted?.status === 'ok' && d.total === 17 && d.bulkRequests === 1 && counted.requests === 1 && notesBefore!.n === notesAfter!.n,
          `${d.total} notes counted, a bulk read would be ${d.bulkRequests} requests; notes landed ${notesBefore!.n} → ${notesAfter!.n}`,
        );
      }

      {
        // A dropped connection is tried again; three in a row is an outage, and says why.
        let failures = 0;
        const flaky = {
          kind: 'scripted' as const,
          async get(url: URL) {
            if (url.pathname === '/v2/lists' && failures < 1) {
              failures++;
              throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } });
            }
            if (url.pathname === '/v2/lists/9') throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } });
            return { status: 200, headers: new Headers(ok().headers), text: async () => JSON.stringify({ data: [], pagination: { nextUrl: null } }) };
          },
        };
        const client = aff.affinity({ transport: flaky, key: KEY, sleep });
        const recovered = await attempt(() => client.get('/v2/lists'));
        const down = await attempt(() => client.get('/v2/lists/9'));
        const tries = await adb.query<{ note: string }>(`select note from sources.request_log where outcome = 'network_error' and path = '/v2/lists/9' order by id`);
        check(
          'A network failure is tried again, and after three in a row the error names its cause',
          recovered === null && down instanceof aff.AffinityError && /ENOTFOUND/.test(down.message) && tries.length === 3 && /trying again/.test(tries[0]!.note),
          `first read after a dropped connection: ${recovered ? recovered.message : 'ok'}; outage: ${down?.message}; attempts logged ${tries.length}`,
        );
      }

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
