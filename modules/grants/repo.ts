import { getDb, type Queryable } from '@/lib/db';
import type { Funder, FunderStatus, GrantGate } from './types';

type Row = {
  funder_id: string; entity_id: string; entity_name: string; programme: string;
  cycle: string | null; status: FunderStatus; invitation_ref: string | null;
  invited_on: Date | string | null; invited_by: string | null; fit_note: string | null;
  owner_name: string | null;
};

const SELECT = `
  select f.funder_id, f.entity_id, e.display_name as entity_name, f.programme, f.cycle,
         f.status, f.invitation_ref, f.invited_on, f.invited_by, f.fit_note, u.name as owner_name
    from grants.funder f
    join identity.entity e on e.entity_id = f.entity_id
    left join platform.app_user u on u.id = f.owner_id`;

const toFunder = (r: Row): Funder => ({
  funderId: r.funder_id, entityId: r.entity_id, entityName: r.entity_name,
  programme: r.programme, cycle: r.cycle, status: r.status,
  invitationRef: r.invitation_ref,
  invitedOn: r.invited_on ? new Date(r.invited_on) : null,
  invitedBy: r.invited_by, fitNote: r.fit_note, ownerName: r.owner_name,
  mayApproach: r.invitation_ref !== null,
});

export async function listFunders(): Promise<Funder[]> {
  const db = await getDb();
  return (await db.query<Row>(`${SELECT} order by (f.invitation_ref is null) desc, e.display_name`)).map(toFunder);
}

/**
 * The no-unsolicited gate. Called by the ask guard for anything on the grants rail.
 *
 * "Sourced, not applied for" is a state machine guard rather than advice: without an
 * invitation record the approach is blocked, and an encouraging conversation is not an
 * invitation.
 */
export async function grantGate(entityId: string, q?: Queryable): Promise<GrantGate> {
  const db = q ?? (await getDb());
  const rows = await db.query<Row>(`${SELECT} where f.entity_id = $1`, [entityId]);
  if (rows.length === 0) {
    return {
      blocked: true,
      reason:
        'No funder record exists for this entity on the grants rail. Sourcing a funder is not ' +
        'the same as being invited to apply, and the rail refuses outreach either way.',
    };
  }
  const withInvitation = rows.find((r) => r.invitation_ref !== null);
  if (withInvitation) return { blocked: false, reason: null };
  const f = toFunder(rows[0]!);
  return {
    blocked: true,
    reason:
      `${f.entityName} is ${f.status} on the ${f.programme} programme and no invitation is on ` +
      'file. Grants-rail outreach is blocked until a funder invitation exists — that is a guard, ' +
      'not a recommendation.',
  };
}

export async function recordInvitation(
  actorId: string,
  args: { funderId: string; reference: string; invitedOn: string; invitedBy: string },
): Promise<void> {
  if (!args.reference.trim()) {
    throw new Error('An invitation needs a reference. A recollection that someone was encouraging is not one.');
  }
  const db = await getDb();
  await db.transaction(async (tx) => {
    await tx.query(
      `update grants.funder
          set invitation_ref = $2, invited_on = $3::date, invited_by = $4, status = 'invited'
        where funder_id = $1`,
      [args.funderId, args.reference, args.invitedOn, args.invitedBy],
    );
    await tx.query(
      `insert into platform.audit_log (actor_id, action, subject_type, subject_id, detail)
       values ($1, 'grants.invited', 'funder', $2, $3)`,
      [actorId, args.funderId, JSON.stringify(args)],
    );
  });
}
