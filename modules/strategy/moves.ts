import { createHash } from 'node:crypto';
import type { Db } from '@/lib/db';
import { config } from '@/config/deployment';
import type { StrategyAction } from './vehicle';

export interface Estimate { value: number; basis: string; label: 'GUESS' }
export interface MoveEstimates {
  reach: Estimate; check: Estimate; baseline: Estimate; conversionLift: Estimate;
  checkLift: Estimate; confidence: Estimate; teamHours: Estimate; cashCost: Estimate; effectDays: Estimate;
  audience: string; dependencies: string;
}
export interface MoveEvidence { source: string; as_of: string; confidence: string; last_verified_by: string; supports: string }
export interface MoveInput { id: string; title: string; category: string; detail: string; evidence: MoveEvidence[]; vehicles: Array<{ slug: string; estimates: MoveEstimates }> }
export interface MoveFile { version: 1; moves: MoveInput[] }
export interface MoveRow { id: string; title: string; category: string; detail: string; evidence: MoveEvidence[]; estimates: MoveEstimates; state: 'proposed'|'chosen'|'dismissed'; position: number|null; version: number; vehicles: string[] }
const fields = ['reach','check','baseline','conversionLift','checkLift','confidence','teamHours','cashCost','effectDays'] as const;
export function validateMoves(raw: unknown): MoveFile {
  const f = raw as MoveFile;
  if (f?.version !== 1 || !Array.isArray(f.moves) || f.moves.length > 200) throw Error('Invalid move file.');
  const ids = new Set<string>();
  for (const m of f.moves) {
    if (!m || !/^[a-z0-9-]{1,100}$/.test(m.id) || ids.has(m.id) || !m.title?.trim() || !m.category?.trim() || !m.detail?.trim()) throw Error('Invalid move identity.');
    ids.add(m.id);
    if (!Array.isArray(m.evidence) || !m.evidence.length || m.evidence.some(e => !e.source?.trim() || !Number.isFinite(Date.parse(e.as_of)) || !e.confidence?.trim() || !e.last_verified_by?.trim() || !e.supports?.trim())) throw Error('Missing provenance.');
    const slugs = new Set<string>();
    if (!Array.isArray(m.vehicles) || !m.vehicles.length) throw Error('Missing vehicle.');
    for (const v of m.vehicles) {
      if (!v.slug || slugs.has(v.slug)) throw Error('Duplicate vehicle.');
      slugs.add(v.slug); const e = v.estimates;
      if (!e?.audience?.trim() || !e.dependencies?.trim()) throw Error('Missing effect basis.');
      for (const k of fields) if (e[k]?.label !== 'GUESS' || !e[k].basis?.trim() || !Number.isFinite(e[k].value) || e[k].value < 0) throw Error('Invalid GUESS estimate.');
      if (e.teamHours.value <= 0 || e.baseline.value + e.conversionLift.value > 1 || e.confidence.value > 1 || !Number.isInteger(e.reach.value)) throw Error('Invalid effect bounds.');
      const scored = moveScore(e);
      if (!Number.isFinite(scored.expected) || !Number.isFinite(scored.priority)) throw Error('Estimate overflow.');
    }
  }
  return f;
}
/** Incremental conversion plus incremental check size, without counting their cross term twice. */
export function moveScore(e: MoveEstimates) {
  const expected = e.reach.value * (e.check.value * e.conversionLift.value + e.checkLift.value * (e.baseline.value + e.conversionLift.value)) * e.confidence.value;
  return { expected, priority: expected / e.teamHours.value };
}
export function lpEffortScore(r: StrategyAction) {
  const teamHours = config.strategyRanking.actionTeamHours;
  const lift = config.strategyRanking.actionValueFraction;
  const expected = !r.held && r.capacity !== null && r.likelihood !== null && r.routeWeight !== null
    ? r.capacity * r.likelihood * r.routeWeight * r.conversion.factor * lift : null;
  return { expected, priority: expected === null ? null : expected / teamHours, teamHours, lift };
}
/** Atomic, hash-idempotent import. Human state/order survive revisions; removed scopes are refused. */
export async function importMoves(db: Db, raw: unknown, actorId: string | null) {
  const input = validateMoves(raw); let written = 0;
  await db.transaction(async tx => {
    for (const m of input.moves) {
      const vehicles = await tx.query<{ id: string; slug: string; kind: string }>('select id,slug,kind::text from platform.vehicle where slug=any($1::text[])', [m.vehicles.map(v => v.slug)]);
      if (vehicles.length !== m.vehicles.length || vehicles.some(v => v.kind === 'grant_rail')) throw Error('Unknown vehicle or unverified grant scope.');
      const hash = createHash('sha256').update(JSON.stringify(m)).digest('hex');
      const prior = await tx.one<{file_hash:string}>('select file_hash from strategy.move where id=$1 for update', [m.id]);
      if (prior?.file_hash === hash) continue;
      const existing = await tx.query<{vehicle_id:string}>('select vehicle_id from strategy.move_vehicle where move_id=$1', [m.id]);
      if (existing.some(v => !vehicles.some(x => x.id === v.vehicle_id))) throw Error('Removing a move scope requires a separate decision.');
      await tx.query(`insert into strategy.move(id,title,category,detail,evidence,file_hash) values($1,$2,$3,$4,$5,$6)
        on conflict(id) do update set title=excluded.title,category=excluded.category,detail=excluded.detail,evidence=excluded.evidence,file_hash=excluded.file_hash,imported_at=now()`, [m.id,m.title,m.category,m.detail,JSON.stringify(m.evidence),hash]);
      for (const scope of m.vehicles) await tx.query(`insert into strategy.move_vehicle(move_id,vehicle_id,estimates) values($1,$2,$3)
        on conflict(move_id,vehicle_id) do update set estimates=excluded.estimates,version=strategy.move_vehicle.version+1`, [m.id,vehicles.find(v => v.slug === scope.slug)!.id,JSON.stringify(scope.estimates)]);
      await tx.query(`insert into platform.audit_log(actor_id,action,subject_type,subject_id,detail) values($1,'strategy.move_imported','strategy_move',$2,$3)`, [actorId,m.id,JSON.stringify({ hash, previousHash: prior?.file_hash ?? null })]);
      written++;
    }
  });
  return { read: input.moves.length, written };
}
export async function listMoves(db: Db, vehicleId: string): Promise<MoveRow[]> {
  return db.query<MoveRow>(`select m.id,m.title,m.category,m.detail,m.evidence,s.estimates,s.state,s.position,s.version,
    (select jsonb_agg(v.name order by v.sort_order) from strategy.move_vehicle mv join platform.vehicle v on v.id=mv.vehicle_id where mv.move_id=m.id) vehicles
    from strategy.move m join strategy.move_vehicle s on s.move_id=m.id where s.vehicle_id=$1 order by m.id`, [vehicleId]);
}
export async function decideMove(db: Db, actorId: string, input: {id:string;vehicleId:string;version:number;state:MoveRow['state'];position:number|null;note:string}) {
  if (!['proposed','chosen','dismissed'].includes(input.state) || !Number.isInteger(input.version) || (input.position !== null && (!Number.isInteger(input.position) || input.position < 1 || input.position > 10000)) || !input.note.trim()) throw Error('Choose a valid state, position and reason.');
  await db.transaction(async tx => {
    const actor = await tx.one<{active:boolean}>('select active from platform.app_user where id=$1', [actorId]);
    if (!actor?.active) throw Error('An active person must make the decision.');
    const old = await tx.one<{state:string;position:number|null;version:number}>('select state,position,version from strategy.move_vehicle where move_id=$1 and vehicle_id=$2 for update', [input.id,input.vehicleId]);
    if (!old) throw Error('Move is not in this vehicle.');
    // A retry of the exact decision has no duplicate audit event.
    if (old.state === input.state && old.position === input.position) return;
    if (old.version !== input.version) throw Error('This move changed. Reload before deciding.');
    await tx.query('update strategy.move_vehicle set state=$3,position=$4,version=version+1 where move_id=$1 and vehicle_id=$2', [input.id,input.vehicleId,input.state,input.position]);
    await tx.query(`insert into platform.audit_log(actor_id,action,subject_type,subject_id,detail) values($1,'strategy.move_decided','strategy_move',$2,$3)`, [actorId,input.id,JSON.stringify({vehicleId:input.vehicleId,before:old,after:{state:input.state,position:input.position},note:input.note.trim()})]);
  });
}

export async function moveHistory(db: Db, vehicleId: string) {
  return db.query<{at:Date;title:string;actor:string;detail:{note:string;before:{state:string;position:number|null};after:{state:string;position:number|null}}}>(`select a.at,m.title,u.name actor,a.detail from platform.audit_log a
    join strategy.move m on m.id=a.subject_id left join platform.app_user u on u.id=a.actor_id
    where a.action='strategy.move_decided' and a.detail->>'vehicleId'=$1 order by a.at desc,a.id desc limit 30`,[vehicleId]);
}
