/** Target-only cutover transform. No getDb(), profile, files or connector access. */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { Db } from '../lib/db';
import { restoreChanges, type Change } from '../modules/strategy/merge';

export async function stripDakota(db: Db): Promise<Record<string, number>> {
  return db.transaction(async tx => {
    // LP re-pointing can copy a Dakota title under a rule source. Undo its journal
    // before deleting the original evidence; a later edit is a conflict, never overwritten.
    const repoints = await tx.query<{ id: string; changes: Change[]; reversed_at: unknown }>(`
      select r.id::text,r.changes,r.reversed_at from strategy.lp_repoint r
      where r.reason like '%an allocator on record in Dakota%' or exists (
        select 1 from identity.affiliation a where a.source='dakota'
          and identity.canonical_entity_id(a.person_entity)=r.person_entity
          and identity.canonical_entity_id(a.org_entity)=r.org_entity
          and not exists (select 1 from identity.affiliation b where b.source is distinct from 'dakota'
            and identity.canonical_entity_id(b.person_entity)=r.person_entity
            and identity.canonical_entity_id(b.org_entity)=r.org_entity and b.role=a.role))
      order by r.created_at desc,r.id desc`);
    for (const row of repoints) {
      if (!row.reversed_at) await restoreChanges(tx, row.changes, 'cutover stopped');
      await tx.query('delete from strategy.lp_repoint where id=$1', [row.id]);
    }
    // Owner-only maintenance, transactionally restored. Never disable FK checks.
    const hadAuditDelete = (await tx.one<{ allowed: boolean }>("select has_table_privilege(current_user,'platform.audit_log','DELETE') allowed"))!.allowed;
    if (!hadAuditDelete) await tx.exec("do $$ begin execute format('grant delete on platform.audit_log to %I',current_user); end $$");
    await tx.exec('alter table platform.audit_log disable trigger audit_log_append_only');
    if (repoints.length) await tx.query(`delete from platform.audit_log where detail->>'repointId'=any($1::text[])`, [repoints.map(r => r.id)]);
    await tx.exec(await readFile(new URL('./strip-dakota.sql', import.meta.url), 'utf8'));
    await tx.exec('alter table platform.audit_log enable trigger audit_log_append_only');
    if (!hadAuditDelete) await tx.exec("do $$ begin execute format('revoke delete on platform.audit_log from %I',current_user); end $$");
    const rows = await tx.query<{ operation: string; count: string }>('select operation,count::text from strip_counts');
    return { repoints: repoints.length, ...Object.fromEntries(rows.map(r => [r.operation, Number(r.count)])) };
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  // Explicit target only; never fall back to the Mac's DATABASE_URL.
  const target = process.argv[2];
  if (!target) { console.error('strip-dakota requires an explicit target URL'); process.exit(2); }
  try {
    const { openPostgres } = await import('../lib/db/postgres');
    const db = await openPostgres(target, { max: 1, statementTimeoutMs: 0 });
    try { console.log(JSON.stringify(await stripDakota(db))); } finally { await db.close(); }
  } catch {
    // Driver errors can include failing row contents. Counts-only output even on failure.
    console.error('strip-dakota failed; transaction rolled back; inspect provenance on the Mac');
    process.exitCode = 1;
  }
}
