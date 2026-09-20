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
