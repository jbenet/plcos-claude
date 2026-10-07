import type { Db, Queryable } from '@/lib/db';
import { STATUSES, type PursuitStatus } from './types';

const RULE = 'rule:pursuit-merge';
export interface PursuitMergeReport {
  merged: number;
  merges: Array<{ id: string; survivorId: string; loserIds: string[] }>;
  ambiguous: Array<{ entityId: string; vehicleId: string; pursuitIds: string[]; reason: string }>;
}
export type Row = Record<string, unknown>;
export type Change = { table: string; key: Row; before: Row | null; after: Row };
export type Reference = { table: string; column: string };
type Candidate = {
  id: string; entity: string; vehicle: string; status: PursuitStatus; status_source: string;
  human_protected: boolean; human_at: string | null; human_status: string | null; opened_at: string;
};
const ident = (s: string) => {
  if (!/^[a-z_][a-z_0-9]*$/.test(s)) throw new Error('Invalid database identifier');
  return `"${s}"`;
};
const tableSql = (s: string) => s.split('.').map(ident).join('.');
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
/** Journal keys are catalog-discovered primary keys, including composite keys.
 * Compare typed columns so their indexes apply; converting every row to JSON first
 * made one pursuit update scan and serialize the complete table.
 */
const keyPredicate = (key: Row) => {
  const keys=Object.keys(key);
  if(!keys.length)throw new Error('Cannot locate a journalled row without its primary key');
  return keys.map(k=>`t.${ident(k)}=k.${ident(k)}`).join(' and ');
};

/** Inventory from the catalog, so a new FK cannot silently retain a loser. Historical
 * origin_pursuit_id columns are provenance, deliberately not foreign keys to active state. */
export async function pursuitReferences(tx: Queryable): Promise<Reference[]> {
  return tx.query<Reference>(`select n.nspname || '.' || t.relname as "table", a.attname as "column"
    from pg_constraint c join pg_class t on t.oid=c.conrelid
    join pg_namespace n on n.oid=t.relnamespace
    join pg_attribute a on a.attrelid=t.oid and a.attnum=any(c.conkey)
    where c.contype='f' and c.confrelid='strategy.pursuit'::regclass
      and c.conrelid <> 'strategy.pursuit'::regclass order by 1,2`);
}
async function keyFor(tx: Queryable, table: string, row: Row): Promise<Row> {
  const keys = await tx.query<{ name: string }>(`select a.attname name from pg_index i
    join pg_attribute a on a.attrelid=i.indrelid and a.attnum=any(i.indkey)
    where i.indrelid=$1::regclass and i.indisprimary order by a.attnum`, [table]);
  if (!keys.length) throw new Error(`Cannot journal ${table} without a primary key`);
  return Object.fromEntries(keys.map(k => [k.name, row[k.name]]));
}
export async function write(tx: Queryable, changes: Change[], table: string, before: Row, patch: Row) {
  const key = await keyFor(tx, table, before), name = tableSql(table);
  const after = (await tx.one<{ row: Row }>(`update ${name} t set
    ${Object.keys(patch).map(k => `${ident(k)}=v.${ident(k)}`).join(',')}
    from jsonb_populate_record(null::${name},$1::jsonb) v,
      jsonb_populate_record(null::${name},$2::jsonb) k
    where ${keyPredicate(key)} returning to_jsonb(t) as row`, [JSON.stringify({ ...before, ...patch }), JSON.stringify(key)]))!.row;
  changes.push({ table, key, before, after });
}
export async function inserted(tx: Queryable, changes: Change[], table: string, row: Row) {
  changes.push({ table, key: await keyFor(tx, table, row), before: null, after: row });
}
function redirectJson(value: unknown, losers: Set<string>, survivor: string): unknown {
  if (Array.isArray(value)) return value.map(v => redirectJson(v, losers, survivor));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k,
    (k === 'pursuitId' || k === 'pursuit_id') && typeof v === 'string' && losers.has(v)
      ? survivor : redirectJson(v, losers, survivor)]));
}
export async function lockMergeTables(tx: Queryable, refs: Reference[], extra: string[] = []) {
  // Match identity import's lock order. Locks cover inserts as well as rows already seen.
  // Not platform.audit_log (7 Oct 2026): the findings import consolidates inside its one long transaction, so that
  // lock held every audit insert in the app (sync pushes, MCP and outreach calls) until the import committed, and
  // they hit the 20 s statement timeout. The audit rows this reads are a person's status changes, and every writer
  // of one updates strategy.pursuit first (setStatus, the prospects import, LP units), which the lock below holds.
  await tx.exec('lock table identity.entity, identity.source_record in share row exclusive mode');
  const names = [...new Set(['strategy.pursuit', 'strategy.pursuit_merge',
    'research.note', 'governance.approval_ticket', ...extra, ...refs.map(r => r.table)])].sort();
  await tx.exec(`lock table ${names.map(tableSql).join(',')} in share row exclusive mode`);
}

/**
 * Fold pursuits into a survivor, journalling every row it writes (shared by the merge and the
 * LP re-point, docs/23): the owner ledger, every foreign key, approval tickets (retargeted and
 * expired), notes naming a loser, the losers' plans, an update carrying each loser's own words,
 * and the redirect itself. Returns the retargeted ticket ids.
 */
export async function absorbPursuits(tx: Queryable, changes: Change[], refs: Reference[], survivorId: string, originals: Row[],
  actorId: string | null, rule: string, ledger: 'all' | 'losers', noteFor: (row: Row, owner: string) => string): Promise<unknown[]> {
  const losers = originals.map(r => String(r.pursuit_id)).filter(id => id !== survivorId), loserSet = new Set(losers);
  for (const row of originals) {
    if (ledger === 'losers' && !loserSet.has(String(row.pursuit_id))) continue;
    const owner = (await tx.one<{ row: Row }>(`insert into strategy.pursuit_owner(pursuit_id,owner_id,origin_pursuit_id,owner_said)
      values($1,$2,$3,$4) returning to_jsonb(pursuit_owner) row`, [survivorId,row.owner_id,row.pursuit_id,row.owner_said]))!.row;
    await inserted(tx, changes, 'strategy.pursuit_owner', owner);
  }
  for (const ref of refs) {
    const rows = await tx.query<{ row: Row }>(`select to_jsonb(t) row from ${tableSql(ref.table)} t where ${ident(ref.column)}=any($1::uuid[])`, [losers]);
    for (const { row } of rows) await write(tx, changes, ref.table, row, { [ref.column]: survivorId });
  }
  // Tickets describe a bounded action against the original pursuit. Retarget the record
  // but expire authorization; pending proposals are deferred, preserving the open-ticket gate.
  const tickets = await tx.query<{ row: Row }>(`select to_jsonb(t) row from governance.approval_ticket t
    where subject_type='pursuit' and subject_id=any($1::uuid[])`, [losers]);
  for (const { row } of tickets) {
    await write(tx, changes, 'governance.approval_ticket', row, {
      subject_id: survivorId, scope: redirectJson(row.scope, loserSet, survivorId),
      expires_at: new Date().toISOString(),
      ...(row.decision === null ? { decision: 'defer', decision_note: 'Pursuit merged; review and request fresh approval.', decided_by: actorId, decided_at: new Date().toISOString() } : {}),
    });
  }
  for (const { row } of await tx.query<{ row: Row }>(`select to_jsonb(n) row from research.note n where data::text like any($1::text[])`, [losers.map(id => `%${id}%`)])) {
    const data = redirectJson(row.data, loserSet, survivorId);
    if (!same(data,row.data)) await write(tx, changes, 'research.note', row, { data });
  }
  const survivorRow = (await tx.one<{ row: Row }>('select to_jsonb(p) row from strategy.pursuit p where pursuit_id=$1', [survivorId]))!.row;
  const plans = originals.filter(r => loserSet.has(String(r.pursuit_id))).flatMap(r => Array.isArray(r.plan) ? r.plan : []);
  if (plans.length) await write(tx, changes, 'strategy.pursuit', survivorRow, { plan: [...(survivorRow.plan as unknown[]), ...plans] });
  for (const row of originals.filter(r => loserSet.has(String(r.pursuit_id)))) {
    const owner = await tx.one<{ name: string }>('select name from platform.app_user where id=$1', [row.owner_id]);
    const note = (await tx.one<{ row: Row }>(`insert into strategy.pursuit_update(pursuit_id,body,suggested,created_by,idempotency_key)
      values($1,$2,$3::jsonb,$4,$5) returning to_jsonb(pursuit_update) row`, [survivorId,
      noteFor(row, owner?.name ?? String(row.owner_id)),
      JSON.stringify({ rule, original: row }), actorId ?? row.owner_id, `${rule}:${row.pursuit_id}`]))!.row;
    await inserted(tx, changes, 'strategy.pursuit_update', note);
    const current = (await tx.one<{ row: Row }>('select to_jsonb(p) row from strategy.pursuit p where pursuit_id=$1', [row.pursuit_id]))!.row;
    await write(tx, changes, 'strategy.pursuit', current, { merged_into: survivorId });
  }
  return tickets.map(t => t.row.id);
}

/** Undo journalled changes in reverse order, checking each exact postimage first. Any
 * conflict throws, and the caller's transaction rolls back every earlier step. */
export async function restoreChanges(tx: Queryable, changes: Change[], label: string): Promise<void> {
  for (const change of [...changes].reverse()) {
    const table = tableSql(change.table);
    const current = await tx.one<{ row: Row }>(`select to_jsonb(t) row from ${table} t,
      jsonb_populate_record(null::${table},$1::jsonb) k where ${keyPredicate(change.key)}`,[JSON.stringify(change.key)]);
    if (!current || !same(current.row,change.after)) throw new Error(`Reversal conflicts with later edits in ${change.table}; ${label}`);
    if (!change.before) await tx.query(`delete from ${table} t using jsonb_populate_record(null::${table},$1::jsonb) k
      where ${keyPredicate(change.key)}`,[JSON.stringify(change.key)]);
    else await write(tx,[],change.table,current.row,change.before);
  }
}

/** Transaction-owned identity pass. No files or external systems are opened here. */
export async function consolidatePursuitsInTransaction(tx: Queryable, actorId: string | null): Promise<PursuitMergeReport> {
  const refs = await pursuitReferences(tx);
  await lockMergeTables(tx, refs);
  const report: PursuitMergeReport = { merged: 0, merges: [], ambiguous: [] };
  const candidates = await tx.query<Candidate>(`with grouped as materialized (
      select p.*,identity.canonical_entity_id(p.entity_id) canonical from strategy.active_pursuit p
    ), duplicates as (
      select canonical,vehicle_id from grouped group by canonical,vehicle_id having count(*)>1
    ) select p.pursuit_id::text id,
    identity.canonical_entity_id(p.entity_id)::text entity,p.vehicle_id::text vehicle,
    p.status::text,p.status_source,p.opened_at::text,
    strategy.pursuit_has_human_status(p.pursuit_id) human_protected,
    coalesce(h.at,case when p.status_source='us' then p.status_set_at end)::text human_at,
    h.status human_status
    from grouped p join duplicates d on d.canonical=p.canonical and d.vehicle_id=p.vehicle_id
    join identity.entity e on e.entity_id=identity.canonical_entity_id(p.entity_id)
    left join lateral (select a.at,a.detail->>'toId' status from platform.audit_log a
      where a.subject_type='pursuit' and a.action='pursuit.status_set'
        and a.detail->>'statusSource' is distinct from 'rule'
        and a.subject_id in (with recursive aliases as (
          select p.pursuit_id id union all
          select q.pursuit_id from strategy.pursuit q join aliases on q.merged_into=aliases.id
        ) select id::text from aliases)
      order by a.at desc,a.id desc limit 1) h on true
    where e.entity_type in ('person','org') and e.retired_at is null`);
  const groups = new Map<string, Candidate[]>();
  for (const p of candidates) groups.set(`${p.entity}:${p.vehicle}`, [...(groups.get(`${p.entity}:${p.vehicle}`) ?? []), p]);
  const rank = (s: PursuitStatus) => STATUSES.findIndex(x => x.id === s);
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const human = group.filter(p => p.human_protected);
    let reason: string | null = null;
    if (new Set(human.map(p => p.human_status ?? p.status)).size > 1) reason = 'Conflicting person-set statuses; resolve the statuses before merging.';
    if (human.some(p => p.human_status && p.human_status !== p.status)) reason = 'A person-set status differs from the current rule status; review its history before merging.';
    // A reversal is an explicit local decision. Never silently re-apply it on the next import.
    if (await tx.one(`select id from strategy.pursuit_merge where reversed_at is not null
      and (loser_ids && $1::uuid[] or survivor_id=any($1::uuid[])) limit 1`, [group.map(p => p.id)])) reason = 'A prior merge was reversed; resolve this group manually.';
    if (reason) {
      report.ambiguous.push({ entityId: group[0]!.entity, vehicleId: group[0]!.vehicle, pursuitIds: group.map(p => p.id), reason });
      continue;
    }
    group.sort((a,b) => rank(b.status)-rank(a.status)
      || (b.human_at ? Date.parse(b.human_at) : -Infinity)-(a.human_at ? Date.parse(a.human_at) : -Infinity)
      || Date.parse(a.opened_at)-Date.parse(b.opened_at) || a.id.localeCompare(b.id));
    const survivor = group[0]!, losers = group.slice(1).map(p => p.id);
    const changes: Change[] = [];
    const originals = await tx.query<{ row: Row }>('select to_jsonb(p) row from strategy.pursuit p where pursuit_id=any($1::uuid[]) order by pursuit_id', [group.map(p => p.id)]);
    const tickets = await absorbPursuits(tx, changes, refs, survivor.id, originals.map(r => r.row), actorId, RULE, 'all',
      (row, owner) => `Merged pursuit ${row.pursuit_id}. Owner: ${owner}${row.owner_said ? ` (${row.owner_said})` : ''}. Status: ${row.status}. ${row.headline ?? ''}${row.next_step ? ` Next step: ${row.next_step}${row.next_step_on ? ` (${row.next_step_on})` : ''}.` : ''}`);
    const merge = (await tx.one<{ id: string }>(`insert into strategy.pursuit_merge(survivor_id,loser_ids,rule,actor_id,changes)
      values($1,$2,$3,$4,$5::jsonb) returning id::text`, [survivor.id,losers,RULE,actorId,JSON.stringify(changes)]))!;
    await tx.query(`insert into platform.audit_log(actor_id,action,subject_type,subject_id,detail)
      values($1,'pursuit.merged','pursuit',$2,$3::jsonb)`, [actorId,survivor.id,JSON.stringify({rule:RULE,mergeId:merge.id,loserIds:losers,expiredTickets:tickets})]);
    report.merged += losers.length;
    report.merges.push({ id:merge.id,survivorId:survivor.id,loserIds:losers });
  }
  return report;
}
export const consolidatePursuits = (db: Db, actorId: string | null) => db.transaction(tx => consolidatePursuitsInTransaction(tx,actorId));

/** Compare-and-restore: later edits refuse reversal instead of being overwritten. New
 * survivor work remains there. Undo newer dependent merges before an older merge. */
export async function reversePursuitMerge(db: Db, id: string, actorId: string, reason: string): Promise<boolean> {
  if (!reason.trim()) throw new Error('A reversal reason is required');
  return db.transaction(async tx => {
    await lockMergeTables(tx,await pursuitReferences(tx));
    const merge = await tx.one<{ survivor_id: string; loser_ids: string[]; changes: Change[]; reversed_at: unknown }>('select * from strategy.pursuit_merge where id=$1 for update',[id]);
    if (!merge) throw new Error('Merge not found');
    if (merge.reversed_at) return false;
    const active = await tx.one('select pursuit_id from strategy.active_pursuit where pursuit_id=$1',[merge.survivor_id]);
    if (!active) throw new Error('Reverse the newer merge first');
    // Undo in reverse order, checking the exact postimage at each step. Any conflict rolls
    // back the entire reversal, including earlier steps in this loop.
    await restoreChanges(tx, merge.changes, 'review them first');
    await tx.query('update strategy.pursuit_merge set reversed_at=now(),reversed_by=$2,reversal_reason=$3 where id=$1',[id,actorId,reason]);
    await tx.query(`insert into platform.audit_log(actor_id,action,subject_type,subject_id,detail)
      values($1,'pursuit.merge_reversed','pursuit',$2,$3::jsonb)`,[actorId,merge.survivor_id,JSON.stringify({rule:RULE,mergeId:id,reason})]);
    return true;
  });
}
