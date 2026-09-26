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

}

export async function hardeningVariations(check: Check) {
  // The gate-to-action chain, end to end: approving the Cedar MONEY ticket is the only
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
    const pl = await import('../../modules/pipeline');
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
}
