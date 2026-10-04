/**
 * The mail desk's asks of Capital OS (docs/27-outreach-api.md), on invented data:
 *   §1 an indicated amount is recorded per LP per vehicle, read beside soft and hard, and never summed into
 *      either (rule 1); an SPV seat's IOI stage stays in step with it; the update box records it.
 */
import { config } from '../../config/deployment';
import type { AppUser } from '../../modules/platform';
import type { Check, Db } from './harness';

export async function outreachProperties(check: Check, db: Db) {
  const pipeline = await import('../../modules/pipeline');
  const { amountRange } = await import('../../modules/strategy');
  const { addUpdate } = await import('../../lib/updates');
  void config;

  const juan = (await db.one<AppUser>(`select id::text, handle, name, initials, role, email, access::text, vehicles, approves from platform.app_user where handle = 'juan'`))!;
  const fund = (await db.one<{ id: string; slug: string }>(`select id::text, slug from platform.vehicle where kind = 'fund' and phase <> 'historical' order by sort_order limit 1`))!;
  const spv = (await db.one<{ id: string; slug: string }>(`select id::text, slug from platform.vehicle where kind = 'spv' and phase <> 'historical' order by sort_order limit 1`))!;
  const entity = async (name: string, type = 'org') => (await db.one<{ id: string }>(`insert into identity.entity (entity_type, display_name) values ($1::identity.entity_type, $2) returning entity_id::text id`, [type, name]))!.id;
  const pursuit = async (e: string, v: string, status = 'discussing') => (await db.one<{ id: string }>(`insert into strategy.pursuit (entity_id, vehicle_id, owner_id, status)
    values ($1, $2, $3, $4::strategy.pursuit_status) returning pursuit_id::text id`, [e, v, juan.id, status]))!.id;

  // ── §1 Indicated amounts ──────────────────────────────────────────────────────────────
  const lp = await entity('Invented Outreach Indicating Org');
  const onFund = await pursuit(lp, fund.id), onSpv = await pursuit(lp, spv.id);
  await db.query(`insert into pipeline.exposure (entity_id, vehicle_id, owner_id, instrument, track, amount, probability) values ($1, $2, $3, 'lp_commitment', 'soft', 1000000, 0.5)`, [lp, fund.id, juan.id]);
  const money = (t: Awaited<ReturnType<typeof pipeline.vehicleTotals>>) => JSON.stringify(t.map((x) => [x.vehicleId, x.hard, x.soft, x.cash, x.convertibleSoft, x.coverage, x.gapToTarget, x.softCount, x.hardCount]));
  const before = money(await pipeline.vehicleTotals());
  await db.query(`insert into close.spv_seat (vehicle_id, entity_id, stage, owner_id) values ($1, $2, 'invited', $3)`, [spv.id, lp, juan.id]);
  await pipeline.recordIndication(juan.id, { pursuitId: onFund, low: 3_000_000, high: 4_000_000, on: new Date('2026-10-01T12:00:00Z') });
  await pipeline.recordIndication(juan.id, { pursuitId: onFund, low: 5_000_000, on: new Date('2026-10-03T12:00:00Z') });
  await pipeline.recordIndication(juan.id, { pursuitId: onSpv, low: 250_000, high: 500_000 });
  const after = money(await pipeline.vehicleTotals());
  const ind = await pipeline.currentIndications([fund.id, spv.id]);
  const onF = ind.get(`${lp}:${fund.id}`), onS = ind.get(`${lp}:${spv.id}`);
  const totals = await pipeline.indicatedTotals([fund.id]);
  const seat = await db.one<{ stage: string; amount: string; ioi: boolean }>(`select stage::text, amount::text, ioi_at is not null ioi from close.spv_seat where vehicle_id = $1 and entity_id = $2`, [spv.id, lp]);
  const history = await db.one<{ n: number }>('select count(*)::int n from pipeline.indication where pursuit_id = $1', [onFund]);
  const exposures = await db.one<{ n: number }>('select count(*)::int n from pipeline.exposure where entity_id = $1', [lp]);
  // Rule 1, by construction: no money total has a field for it, and the totals object has none for money.
  const totalsKeys = Object.keys((await pipeline.vehicleTotals())[0] ?? {});
  check('Outreach §1: an indicated amount is never summed into soft or hard, and no exposure is written for it',
    before === after && exposures?.n === 1 && !totalsKeys.some((k) => /indicat/i.test(k))
    && Object.keys(totals.get(fund.id) ?? {}).sort().join() === 'count,high,low,vehicleId'
    && onF?.low === 5_000_000 && onF.high === 5_000_000 && history?.n === 2,
    `vehicle totals ${before === after ? 'unchanged' : 'CHANGED'}; exposures ${exposures?.n}; current on the fund ${onF?.low}–${onF?.high} (2 recorded, latest counts); totals keys ${Object.keys(totals.get(fund.id) ?? {}).join(',')}`);
  check('Outreach §1: an indication on an SPV moves an invited seat to IOI given, and a seat at IOI reads as indicated',
    seat?.stage === 'ioi' && Number(seat.amount) === 250_000 && seat.ioi && onS?.low === 250_000 && onS.high === 500_000 && onS.source === 'us',
    `seat ${seat?.stage} at ${seat?.amount}; SPV indication ${onS?.low}–${onS?.high} (${onS?.source})`);
  const seatOnly = await entity('Invented Outreach Seat-only Org');
  await db.query(`insert into close.spv_seat (vehicle_id, entity_id, stage, amount, owner_id, ioi_at) values ($1, $2, 'ioi', 750000, $3, now())`, [spv.id, seatOnly, juan.id]);
  const fromSeat = (await pipeline.currentIndications([spv.id])).get(`${seatOnly}:${spv.id}`);
  let refused = 0;
  for (const bad of [[-1, null], [5, 4], [Number.NaN, null], [1e13, null]] as const) {
    try { await pipeline.recordIndication(juan.id, { pursuitId: onFund, low: bad[0], high: bad[1] }); } catch (e) { if (e instanceof pipeline.IndicationRefused) refused++; }
  }
  check('Outreach §1: a seat at IOI with no indication recorded reads as one (source "spv seat"); a negative, inverted or absurd range is refused',
    fromSeat?.source === 'spv seat' && fromSeat.low === 750_000 && fromSeat.indicationId === null && refused === 4,
    `seat-only: ${fromSeat?.source} ${fromSeat?.low}; ${refused}/4 bad ranges refused`);

  const ranges = {
    one: amountRange('$3M'), dash: amountRange('$3M–4M'), words: amountRange('3 to 5 million'), mixed: amountRange('$500k-$1M'),
    bare: amountRange('2 meetings'), dollars: amountRange('$250,000'),
  };
  check('Outreach §1: the update reader reads an amount as a range of dollars, and a bare number as none',
    ranges.one?.low === 3e6 && ranges.one.high === 3e6 && ranges.dash?.low === 3e6 && ranges.dash.high === 4e6
    && ranges.words?.low === 3e6 && ranges.words.high === 5e6 && ranges.mixed?.low === 5e5 && ranges.mixed.high === 1e6
    && ranges.bare === null && ranges.dollars?.low === 250_000,
    JSON.stringify(ranges));

  // The update box records it, sourced to the touchpoint the same update logs, and only when ticked.
  const boxLp = await entity('Invented Outreach Box Org');
  const boxP = await pursuit(boxLp, fund.id);
  const unticked = await addUpdate(juan.id, { pursuitId: boxP, body: 'Call today: they are thinking $2M.', idempotencyKey: `props-outreach-${boxP}-a` });
  const ticked = await addUpdate(juan.id, {
    pursuitId: boxP, body: 'Call today: they are thinking $2M-3M.', idempotencyKey: `props-outreach-${boxP}-b`,
    touch: { channel: 'call', direction: 'both', on: new Date(), read: null }, indicated: { low: 2e6, high: 3e6 },
  });
  const twice = await addUpdate(juan.id, {
    pursuitId: boxP, body: 'Call today: they are thinking $2M-3M.', idempotencyKey: `props-outreach-${boxP}-b`,
    touch: { channel: 'call', direction: 'both', on: new Date(), read: null }, indicated: { low: 2e6, high: 3e6 },
  });
  const boxInd = await pipeline.indicationFor(boxLp, fund.id);
  const boxRows = await db.one<{ n: number }>('select count(*)::int n from pipeline.indication where pursuit_id = $1', [boxP]);
  check('Outreach §1: the update box records an indicated amount only when ticked, sourced to the touchpoint it logs, once per form',
    !unticked.applied.indicated && unticked.applied.declined?.includes('amount') === true
    && ticked.applied.indicated?.low === 2e6 && ticked.applied.indicated.high === 3e6 && ticked.applied.indicated.touchpointId === ticked.applied.touchpointId
    && boxInd?.touchpointId === ticked.applied.touchpointId && boxRows?.n === 1 && twice.created === false,
    `unticked: ${unticked.applied.indicated ? 'RECORDED' : 'not recorded'}; ticked: ${boxInd?.low}–${boxInd?.high} from touchpoint ${boxInd?.touchpointId ? 'yes' : 'NO'}; rows ${boxRows?.n}; resubmitted: ${twice.created ? 'WROTE AGAIN' : 'nothing'}`);
}
