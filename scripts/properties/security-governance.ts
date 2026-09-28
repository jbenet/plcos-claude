import { randomUUID } from 'node:crypto';
import type { Check, Db } from './harness';
import { withDb } from '../../lib/db';
import { decideTicket, openTicket, type ApprovalKind } from '../../modules/governance';

const refused = async (work: () => Promise<unknown>) => {
  try { await work(); return false; } catch { return true; }
};

/** Invented tickets only; exercise the command and the real database triggers. */
export async function securityGovernanceProperties(check: Check, db: Db) {
  await withDb(db, async () => {
    const users = await db.query<{ id: string }>('select id from platform.app_user where active order by handle');
    const requester = users[0]!.id, approver = users[1]!.id;
    const snapshot = async () => JSON.stringify(await db.query('select * from platform.audit_log order by id'));
    const ticket = (kind: ApprovalKind, subjectId: string = randomUUID(), subjectType = 'security_fixture', vehicleId: string | null = null) =>
      openTicket(requester, { kind, subjectId, subjectType, vehicleId, subjectLabel: 'Invented security test',
        scope: { authorizes: 'Invented bounded action', excludes: ['Any external action'] } });
    for (const kind of ['SEND', 'INTRO_ASK', 'MONEY', 'ALLOCATION_EXCEPTION'] as const) {
      const id = await ticket(kind);
      const before = await snapshot();
      const blocked = await refused(() => decideTicket(requester, id, 'approve', null));
      const row = await db.one<{ decision: string | null; decided_by: string | null }>(
        'select decision, decided_by from governance.approval_ticket where id = $1', [id]);
      check(`SECURITY ${kind} self-approval refuses without changing ticket or audit`,
        blocked && row?.decision === null && row.decided_by === null && before === await snapshot(), 'Same requester cannot authorize the action.');
      await decideTicket(approver, id, 'approve', 'Independent invented reviewer');
      const count = async () => (await db.one<{ n: number }>(
        "select count(*)::int n from platform.audit_log where subject_id = $1 and action = 'ticket.approve'", [id]))!.n;
      await decideTicket(approver, id, 'approve', 'Repeated click');
      check(`SECURITY ${kind} independent approval succeeds once`, await count() === 1, 'A repeated decision does not append another decision record.');
    }
    const entity = (await db.one<{ id: string }>(
      "insert into identity.entity (entity_type, display_name) values ('person', 'Invented Security Stage Owner') returning entity_id id"))!;
    const pursuit = (await db.one<{ pursuit_id: string; vehicle_id: string }>(
      `insert into strategy.pursuit (entity_id, owner_id, vehicle_id)
       select $1, $2, id from platform.vehicle order by slug limit 1 returning pursuit_id, vehicle_id`, [entity.id, requester]))!;
    // Fresh subjects avoid the open-ticket uniqueness rule interfering with this check.
    const stage = await ticket('STAGE', pursuit.pursuit_id, 'pursuit', pursuit.vehicle_id);
    await decideTicket(requester, stage, 'approve', 'Owner confirms invented evidence');
    check('SECURITY STAGE owner can self-approve', (await db.one<{ decision: string }>(
      'select decision from governance.approval_ticket where id = $1', [stage]))?.decision === 'approve', 'The documented owner exception remains.');
    const nonowner = await openTicket(approver, { kind: 'STAGE', subjectId: pursuit.pursuit_id,
      subjectType: 'pursuit', vehicleId: pursuit.vehicle_id, subjectLabel: 'Invented nonowner request',
      scope: { authorizes: 'Invented rung', excludes: [] } });
    check('SECURITY STAGE nonowner cannot self-approve',
      await refused(() => decideTicket(approver, nonowner, 'approve', null)), 'STAGE is not a blanket self-approval exception.');
    await decideTicket(approver, nonowner, 'reject', 'Withdraw invented request');
    check('SECURITY requester may reject own ticket', (await db.one<{ decision: string }>(
      'select decision from governance.approval_ticket where id = $1', [nonowner]))?.decision === 'reject', 'Rejecting does not authorize a mutation.');
    const inactive = (await db.one<{ id: string }>('select id from platform.app_user where not active limit 1'))!;
    const pending = await ticket('SEND');
    const beforeInactive = await snapshot();
    check('SECURITY inactive and unknown actors cannot decide tickets',
      await refused(() => decideTicket(inactive.id, pending, 'approve', null)) &&
      await refused(() => decideTicket(randomUUID(), pending, 'approve', null)) && beforeInactive === await snapshot(),
      'The command itself validates an active app_user.');

    const audit = (await db.one<{ id: string }>(`insert into platform.audit_log (actor_id, action, subject_type, detail)
      values ($1, 'security.fixture', 'invented', '{"immutable":true}') returning id::text`, [requester]))!;
    const beforeAudit = await snapshot();
    for (const [operation, sql] of [
      ['UPDATE', `update platform.audit_log set detail = '{}' where id = ${audit.id}`],
      ['DELETE', `delete from platform.audit_log where id = ${audit.id}`],
      ['TRUNCATE', 'truncate platform.audit_log'],
    ]) {
      check(`SECURITY audit ${operation} refused and all rows unchanged`,
        await refused(() => db.exec(sql!)) && beforeAudit === await snapshot(), 'The database enforces append-only history.');
    }
    await db.query("insert into platform.audit_log (action, subject_type) values ('security.append', 'invented')");
    check('SECURITY audit INSERT remains allowed', (await db.one<{ n: number }>(
      "select count(*)::int n from platform.audit_log where action = 'security.append'"))?.n === 1, 'Normal audit appends still work.');
    const triggers = await db.one<{ n: number }>(`select count(*)::int n from pg_trigger
      where tgrelid = 'platform.audit_log'::regclass and tgname = 'audit_log_append_only' and tgenabled = 'O'`);
    const acl = await db.one<{ n: number }>(`select count(*)::int n from pg_class c,
      lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
      where c.oid = 'platform.audit_log'::regclass and a.privilege_type in ('UPDATE','DELETE','TRUNCATE')
        and (a.grantee = 0 or a.grantee in (select oid from pg_roles where rolname in (current_user, 'plcos_app')))`);
    check('SECURITY audit trigger enabled and rewrite grants revoked', triggers?.n === 1 && acl?.n === 0,
      'Checks ACL entries even when the disposable test database uses a superuser; owners can still deliberately override DDL.');
  });
}
