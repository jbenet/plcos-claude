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
import { rm } from 'node:fs/promises';
import { join } from 'node:path';

const SCRATCH = join('local', 'props');
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

  const looseRestrictions = await db.query<{ n: string }>(
    `select count(*)::text as n from coordination.restriction
      where scope = 'connector' and connector_id is null`,
  );
  check(
    'A connector-scoped restriction names the connector',
    Number(looseRestrictions[0]!.n) === 0,
    `${looseRestrictions[0]!.n} unnamed`,
  );

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
    check(
      'Variation — approve the MONEY ticket',
      moved === 4 && dropped === 4 && after.cash === before.cash,
      `hard +$${moved}M, soft -$${dropped}M, cash unchanged at $${Math.round(after.cash / 1e6)}M ` +
      '(an accepted commitment is not a wire)',
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

  await rm(join(process.cwd(), SCRATCH), { recursive: true, force: true });

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
