import type { Check, SeedContext } from './harness';
import { freshDb } from './harness';

export async function pipelineProperties({ check, db }: SeedContext) {
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

  const { vehicleTotals } = await import('../../modules/pipeline');
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

  const { vehicleCloseStatus, vehicleStatusCounts, closeTracksFor } = await import('../../modules/pipeline');
  const vehicle = totals.find(t => t.vehicleSlug === 'neurotech')!;
  const status = await vehicleCloseStatus(vehicle.vehicleId, 1);
  const stats = await vehicleStatusCounts(vehicle.vehicleId);
  const expected = await db.one<{ n: number }>('select count(*)::int as n from strategy.pursuit where vehicle_id = $1', [vehicle.vehicleId]);
  const expectedExposures = await db.one<{ n: number }>(`select count(*)::int as n from pipeline.exposure
    where vehicle_id = $1 and closed_at is null and identity.canonical_entity_id(entity_id) = any($2::uuid[])`,
    [vehicle.vehicleId, status.rows.map(r => r.entity_id)]);
  check('Vehicle status keeps counts, close records and questions in the selected vehicle',
    status.rows.length > 0 && status.rows.every(r => r.vehicle_id === vehicle.vehicleId &&
      r.questions.every(q => q.vehicle_id === vehicle.vehicleId) && r.tracks.every(t => t.exposure.vehicleId === vehicle.vehicleId)) &&
      stats.reduce((sum, c) => sum + c.n, 0) === expected?.n &&
      status.rows.reduce((sum, r) => sum + r.tracks.length, 0) === expectedExposures?.n,
    'All statuses counted; every open exposure for displayed LPs included; no cross-vehicle questions.');
  let matches = true;
  for (const row of status.rows) {
    const individual = await closeTracksFor(row.entity_id, row.vehicle_id);
    // Equal-amount exposures have no relative-order contract in either reader.
    const byExposure = (tracks: typeof individual) => [...tracks].sort((a, b) => a.exposure.exposureId.localeCompare(b.exposure.exposureId));
    matches &&= JSON.stringify(byExposure(individual)) === JSON.stringify(byExposure(row.tracks));
  }
  check('Batched status close tracks preserve pack signatures, dates and cash semantics', matches,
    'Bulk details match the established per-LP reader, including returned packs.');
  const last = await vehicleCloseStatus(vehicle.vehicleId, Number.MAX_SAFE_INTEGER);
  const first = await vehicleCloseStatus(vehicle.vehicleId, NaN);
  check('Close status clamps invalid and out-of-range pages', first.page === 1 && last.page >= 1 && last.rows.length > 0,
    'Malformed and oversized page requests retain a reachable result page.');

}

export async function hardeningVariations(check: Check) {
  // Two records of one LP merged leave two commitments on the vehicle: hardening either would count it twice, and a
  // withdrawal or revision of a commitment no longer soft and open changes nothing (red team, 17 Oct 2026).
  {
    const d = await freshDb();
    const { getTicket, decideTicket } = await import('../../modules/governance');
    const { applyApprovedTicket } = await import('../../app/approvals/apply');
    const pl = await import('../../modules/pipeline');
    const t = (await d.one<{ id: string; exposure: string }>(
      "select id, scope->'apply'->'args'->>'exposureId' exposure from governance.approval_ticket where kind = 'MONEY' and decision is null"))!;
    const juan = (await d.one<{ id: string }>("select id from platform.app_user where handle = 'juan'"))!;
    const twin = (await d.one<{ id: string }>(`with alias as (
        insert into identity.entity (entity_type, display_name, merged_into)
        select e.entity_type, 'Invented duplicate record', e.entity_id from pipeline.exposure x join identity.entity e on e.entity_id = x.entity_id where x.exposure_id = $1
        returning entity_id)
      insert into pipeline.exposure (entity_id, vehicle_id, instrument, track, amount, owner_id)
      select a.entity_id, x.vehicle_id, x.instrument, 'soft', x.amount, x.owner_id from alias a, pipeline.exposure x where x.exposure_id = $1
      returning exposure_id::text id`, [t.exposure]))!.id;
    await decideTicket(juan.id, t.id, 'approve', 'Countersigned copy on file.');
    let refused: string | null = null;
    try { await applyApprovedTicket(juan.id, (await getTicket(t.id))!); } catch (e) { refused = (e as Error).message; }
    const asked = await pl.requestHardening(juan.id, { exposureId: twin, evidenceRef: 'invented-ref', note: 'x' }).then(() => null, (e: Error) => e.message);
    const was = (await d.one<{ a: string }>('select amount::text a from pipeline.exposure where exposure_id = $1', [twin]))!.a;
    await pl.reviseSoft(juan.id, twin, { on: new Date('2026-09-19T12:00:00Z'), amount: 123 });
    const revised = await d.one<{ detail: { before: number; amount: number } }>(
      "select detail from platform.audit_log where subject_id = $1 and action = 'commitment.soft' order by at desc limit 1", [twin]);
    check('Variation — revising a soft amount keeps the old amount on the record',
      revised?.detail.before === Number(was) && revised.detail.amount === 123, `audit ${JSON.stringify(revised?.detail)}, was ${was}`);
    const eventsBefore = (await d.one<{ n: number }>("select count(*)::int n from pipeline.commitment_event where exposure_id = $1", [twin]))!.n;
    await d.query("update pipeline.exposure set closed_at = now() where exposure_id = $1", [twin]);
    const tryWithdraw = await pl.withdraw(juan.id, twin, { on: new Date('2026-09-20T12:00:00Z'), reason: 'Invented' }).then(() => null, (e: Error) => e);
    const events = await d.one<{ n: number }>("select count(*)::int n from pipeline.commitment_event where exposure_id = $1", [twin]);
    check('Variation — an LP with two open commitments on one vehicle (merged records) is hardened by neither; a closed one is not withdrawn again',
      !!refused && /another open commitment/.test(refused) && !!asked && /another open commitment/.test(asked)
        && tryWithdraw instanceof Error && events?.n === eventsBefore,
      `apply: ${refused ?? 'HARDENED'}; ask: ${asked ?? 'OPENED'}; withdraw of a closed one: ${tryWithdraw ? 'refused' : 'RECORDED'}, events ${events?.n}`);
  }
  // A MONEY ticket approves an amount: if the commitment changed after the ask (an Affinity read, a revision),
  // approving it hardens nothing (red team, 17 Oct 2026).
  {
    const d = await freshDb();
    const { getTicket, decideTicket } = await import('../../modules/governance');
    const { applyApprovedTicket } = await import('../../app/approvals/apply');
    const t = (await d.one<{ id: string; exposure: string }>(
      "select id, scope->'apply'->'args'->>'exposureId' exposure from governance.approval_ticket where kind = 'MONEY' and decision is null"))!;
    const juan = (await d.one<{ id: string }>("select id from platform.app_user where handle = 'juan'"))!;
    await d.query('update pipeline.exposure set amount = amount * 2.5 where exposure_id = $1', [t.exposure]);
    await decideTicket(juan.id, t.id, 'approve', 'Countersigned copy on file.');
    let refused: string | null = null;
    try { await applyApprovedTicket(juan.id, (await getTicket(t.id))!); } catch (e) { refused = (e as Error).message; }
    const track = await d.one<{ track: string }>('select track::text from pipeline.exposure where exposure_id = $1', [t.exposure]);
    check('Variation — a MONEY ticket approved for one amount hardens nothing once the commitment changed',
      !!refused && /ticket approved/.test(refused) && track?.track === 'soft', refused ?? `HARDENED (${track?.track})`);
  }
  // The gate-to-action chain, end to end: approving the Fernhollow Umberfield MONEY ticket is the only
  // thing in this system that can move the headline.
  {
    const d = await freshDb();
    const { vehicleTotals: vt } = await import('../../modules/pipeline');
    const { getTicket, decideTicket } = await import('../../modules/governance');
    const { applyApprovedTicket } = await import('../../app/approvals/apply');

    const before = (await vt()).find((t) => t.vehicleSlug === 'neurotech')!;
    const t = await d.one<{ id: string }>(
      "select id from governance.approval_ticket where kind = 'MONEY' and decision is null",
    );
    const juan = await d.one<{ id: string }>("select id from platform.app_user where handle = 'juan'");
    await ticketDecisionProperties(check, d, juan!.id);
    await decideTicket(juan!.id, t!.id, 'approve', 'Countersigned copy on file.');
    const ticket = await getTicket(t!.id);
    await applyApprovedTicket(juan!.id, ticket!);
    const after = (await vt()).find((t2) => t2.vehicleSlug === 'neurotech')!;

    const moved = Math.round((after.hard - before.hard) / 1e6);
    const dropped = Math.round((before.soft - after.soft) / 1e6);
    const pack = await d.one<{ status: string }>(
      `select p.status::text as status from close.pack_item p
         join identity.entity e on e.entity_id = p.entity_id
        where e.display_name = 'Fernhollow Umberfield Trust'`,
    );
    check(
      'Variation — approve the MONEY ticket',
      moved === 4 && dropped === 4 && after.cash === before.cash && pack?.status === 'countersigned',
      `hard +$${moved}M, soft -$${dropped}M, cash unchanged at $${Math.round(after.cash / 1e6)}M ` +
      `(an accepted commitment is not a wire), and the subscription pack moved to ${pack?.status} ` +
      'in the same transaction',
    );

    // The close track (N52), on the commitment that just hardened and on one still soft.
    const pl = await import('../../modules/pipeline');
    const attempt = async (fn: () => Promise<unknown>) => {
      try { await fn(); return null; } catch (e) { return e as Error; }
    };
    const expOf = async (name: string) => (await d.one<{ exposure_id: string; entity_id: string; vehicle_id: string }>(
      `select x.exposure_id, x.entity_id, x.vehicle_id from pipeline.exposure x join identity.entity e on e.entity_id = x.entity_id
        where e.display_name = $1 and x.closed_at is null order by x.amount desc limit 1`, [name]))!;
    const fernhollowUmberfield = await expOf('Fernhollow Umberfield Trust');
    const counter = await d.one<{ n: string }>(`select count(*)::text as n from pipeline.commitment_event where exposure_id = $1 and step = 'countersigned'`, [fernhollowUmberfield.exposure_id]);
    await pl.recordWire(juan!.id, fernhollowUmberfield.exposure_id, { on: new Date('2026-09-20T12:00:00Z'), amount: 1_500_000, reference: 'wire-0917' });
    const over = await attempt(() => pl.recordWire(juan!.id, fernhollowUmberfield.exposure_id, { on: new Date('2026-09-21T12:00:00Z'), amount: 3_000_000, reference: 'wire-0918' }));
    await pl.recordClosing(juan!.id, fernhollowUmberfield.exposure_id, { on: new Date('2026-09-22T12:00:00Z'), closing: 'First close' });
    const [ct] = await pl.closeTracksFor(fernhollowUmberfield.entity_id, fernhollowUmberfield.vehicle_id);
    const cash = (await vt()).find((t2) => t2.vehicleSlug === 'neurotech')!.cash;
    check(
      'A wire is an amount: a call in part counts in part, never past the commitment, and closing needs it hard',
      Number(counter!.n) === 1 && ct?.state === 'closed' && ct.wired === 1_500_000 && ct.outstanding === 2_500_000 &&
        over instanceof pl.CloseRefused && Math.round((cash - after.cash) / 1e5) === 15,
      `countersigned events ${counter!.n}; state ${ct?.state}; wired ${ct?.wired} of ${ct?.exposure.amount}, outstanding ${ct?.outstanding}; over-wire ${over ? 'refused' : 'ALLOWED'}; cash +$${((cash - after.cash) / 1e6).toFixed(1)}M`,
    );
    const raced = await Promise.all([1, 2].map((n) => attempt(() => pl.recordWire(juan!.id, fernhollowUmberfield.exposure_id, { on: new Date('2026-09-21T12:00:00Z'), amount: 2_000_000, reference: `wire-race-${n}` }))));
    check('Two wires at once cannot both fit under the commitment: one lands, the other is refused',
      raced.filter((e) => e instanceof pl.CloseRefused).length === 1 && raced.filter((e) => e === null).length === 1, raced.map((e) => (e ? 'refused' : 'recorded')).join(', '));

    const vetchlingWagtail = await expOf('Vetchling Wagtail Capital');
    const wireSoft = await attempt(() => pl.recordWire(juan!.id, vetchlingWagtail.exposure_id, { on: new Date('2026-09-20T12:00:00Z'), amount: 100, reference: 'x' }));
    await pl.recordSignature(juan!.id, vetchlingWagtail.exposure_id, { on: new Date('2026-09-18T12:00:00Z'), document: 'Subscription agreement v1' });
    const noReason = await attempt(() => pl.recordSignature(juan!.id, vetchlingWagtail.exposure_id, { on: new Date('2026-09-21T12:00:00Z'), document: 'Subscription agreement v2' }));
    await pl.recordSignature(juan!.id, vetchlingWagtail.exposure_id, { on: new Date('2026-09-21T12:00:00Z'), document: 'Subscription agreement v2', reason: 'Their holding entity changed its name' });
    const [nt] = await pl.closeTracksFor(vetchlingWagtail.entity_id, vetchlingWagtail.vehicle_id);
    check(
      'Signing moves no money; signing again needs its reason; cash cannot land on a soft commitment',
      nt?.state === 'signed' && nt.exposure.track === 'soft' && nt.resigned === 1 && nt.signature?.document === 'Subscription agreement v2' &&
        noReason instanceof pl.CloseRefused && wireSoft instanceof pl.CloseRefused,
      `state ${nt?.state} on the ${nt?.exposure.track} track; re-signed ${nt?.resigned}; latest ${nt?.signature?.document}; second signature with no reason ${noReason ? 'refused' : 'ALLOWED'}; a wire on soft ${wireSoft ? 'refused' : 'ALLOWED'}`,
    );
    // A second instrument must not disappear behind the LP's largest position.
    await d.query(`insert into pipeline.exposure (entity_id, vehicle_id, instrument, track, amount, owner_id)
      select entity_id, vehicle_id, 'direct', 'soft', 1234, owner_id from pipeline.exposure where exposure_id = $1`, [vetchlingWagtail.exposure_id]);
    const statusPage = await pl.vehicleCloseStatus(vetchlingWagtail.vehicle_id, 1);
    const statusLp = statusPage.rows.find(r => r.entity_id === vetchlingWagtail.entity_id);
    check('Status keeps multiple instruments and does not promote a signature into hard money',
      statusLp?.tracks.length === 2 && statusLp.tracks.every(t => t.exposure.track === 'soft') &&
      statusLp.tracks.some(t => t.signature?.document === 'Subscription agreement v2'),
      'A signed soft position and a second soft position both remain visible and soft.');
    const noExposure = await d.one<{ pursuit_id: string; entity_id: string; vehicle_id: string }>(`
      select p.pursuit_id, p.entity_id, p.vehicle_id from strategy.pursuit p
       where not exists (select 1 from pipeline.exposure x where x.entity_id = p.entity_id and x.vehicle_id = p.vehicle_id)
       limit 1`);
    if (!noExposure) throw new Error('Status fixture needs an LP without an exposure.');
    await d.query(`update strategy.pursuit set status = 'committed', closed_at = null where pursuit_id = $1`, [noExposure.pursuit_id]);
    const missing = await pl.vehicleCloseStatus(noExposure.vehicle_id, 1);
    check('Committed pipeline status remains visible when the close record is missing',
      missing.rows.some(r => r.entity_id === noExposure.entity_id && r.tracks.length === 0),
      'The candidate is included without manufacturing a soft/hard amount or close date.');
    await d.close();
  }
}

/** Direct service calls must obey the gate even when no server action is involved. */
async function ticketDecisionProperties(check: Check, db: Awaited<ReturnType<typeof freshDb>>, adminId: string) {
  const { openTicket, decideTicket, getTicket } = await import('../../modules/governance');
  const { AuthorizationError } = await import('../../lib/authz');
  const vehicles = await db.query<{ id: string }>('select id::text from platform.vehicle order by sort_order limit 2');
  const [inside, outside] = vehicles.map(v => v.id);
  const actor = async (handle: string, access: string, active = true) => (await db.one<{ id: string }>(
    `insert into platform.app_user(handle,name,initials,role,email,access,vehicles,approves,active)
     values($1,$1,'FX','Invented test actor',$1 || '@example.test',$2::platform.access_role,$3::uuid[],$4::text[],$5) returning id::text`,
    [handle, access, [inside], ['STAGE', 'INTRO_ASK', 'SEND'], active]))!.id;
  const gp = await actor('invented-authz-approver', 'team');
  const viewer = await actor('invented-authz-viewer', 'viewer');
  const inactive = await actor('invented-authz-inactive', 'admin', false);
  const entity = (await db.one<{ id: string }>(`insert into identity.entity(entity_type,display_name)
    values('org','Invented service authorization LP') returning entity_id::text id`))!.id;
  const pursuit = (await db.one<{ id: string }>(`insert into strategy.pursuit(entity_id,vehicle_id,owner_id,status)
    values($1,$2,$3,'new') returning pursuit_id::text id`, [entity, inside, gp]))!.id;
  const request = (kind: import('../../modules/governance').ApprovalKind, requester: string, vehicle = inside!) => openTicket(requester,
    { kind, subjectType: 'pursuit', subjectId: pursuit, subjectLabel: 'Invented service authorization request',
      scope: { authorizes: 'Test approval gate only', excludes: ['Any executed action'] }, vehicleId: vehicle });
  const denied = async (who: string, ticket: string) => {
    try { await decideTicket(who, ticket, 'approve', null); return false; }
    catch (e) { return e instanceof AuthorizationError && (await getTicket(ticket))?.decision === null; }
  };
  const stage = await request('STAGE', adminId);
  const viewerDenied = await denied(viewer, stage), inactiveDenied = await denied(inactive, stage);
  await decideTicket(gp, stage, 'approve', 'Invented independent approval');
  const elsewhere = await request('STAGE', adminId, outside!);
  const outsideDenied = await denied(gp, elsewhere);
  await decideTicket(adminId, elsewhere, 'reject', 'Invented fixture complete');
  check('Ticket service enforces active role and vehicle scope without a server action',
    viewerDenied && inactiveDenied && outsideDenied && (await getTicket(stage))?.decidedByName === 'invented-authz-approver',
    'Viewer, inactive Admin and out-of-scope GP refused; explicitly permitted in-scope GP approves.');
  let selfDenied = true;
  for (const kind of ['SEND', 'INTRO_ASK', 'MONEY', 'ALLOCATION_EXCEPTION'] as const) {
    const own = await request(kind, adminId);
    selfDenied = await denied(adminId, own) && selfDenied;
    await decideTicket(adminId, own, 'reject', 'Invented fixture complete');
  }
  const notOwner = await request('STAGE', adminId);
  selfDenied = await denied(adminId, notOwner) && selfDenied;
  await decideTicket(adminId, notOwner, 'reject', 'Invented fixture complete');
  const ownStage = await request('STAGE', gp);
  await decideTicket(gp, ownStage, 'approve', null);
  check('Ticket service forbids self-approval except STAGE by the pursuit owner',
    selfDenied && (await getTicket(ownStage))?.decision === 'approve',
    'Admin cannot self-approve SEND, INTRO_ASK, MONEY, ALLOCATION_EXCEPTION or another owner’s STAGE; scoped owner can approve STAGE.');
  let moneyDenied = true;
  for (const kind of ['MONEY', 'ALLOCATION_EXCEPTION'] as const) {
    const ticket = await request(kind, viewer);
    moneyDenied = await denied(gp, ticket) && moneyDenied;
    await decideTicket(adminId, ticket, 'approve', null);
    moneyDenied = (await getTicket(ticket))?.decision === 'approve' && moneyDenied;
  }
  check('Ticket service reserves MONEY and ALLOCATION_EXCEPTION for independent Admin approval', moneyDenied,
    'Scoped GP approval grants do not authorize money or allocation exceptions; an independent Admin can decide.');
}
