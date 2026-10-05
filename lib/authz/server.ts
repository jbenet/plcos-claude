import type { AppUser } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { requireServerActionMutation } from '@/lib/mutation-guard';
import { getDb, type Queryable } from '@/lib/db';
import { AuthorizationError, requireCan, type Principal } from './index';
import { actionRules, type ActionId, type ScopeRule } from './rules';

const value = (input: unknown, key: string): unknown => input instanceof FormData ? input.get(key) : (input as Record<string, unknown> | null)?.[key];
const values = (input: unknown, key: string): unknown[] => input instanceof FormData ? input.getAll(key) : [value(input, key)];
const id = (v: unknown): string => {
  if (typeof v !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)) throw new AuthorizationError();
  return v;
};

/** Resolve persisted targets before checking scope. Browser-supplied vehicle metadata is not authority. */
export async function authorizeAction(user: Principal & { id: string }, name: ActionId, args: unknown[], q: Queryable): Promise<void> {
  const rule = actionRules[name];
  if (!rule) throw new AuthorizationError();
  // Fail before reading target details for a role that cannot invoke this operation at all.
  if (user.access === 'viewer' && !['read', 'feedback', 'session'].includes(rule.action)) throw new AuthorizationError();
  if (rule.action === 'admin') { requireCan(user, 'admin'); return; }
  const input = args[0];
  let vehicle: string[] | null = null;
  const rows = async (sql: string, ids: unknown[]) => {
    const result = await q.query<{ vehicle_id: string }>(sql, ids);
    if (!result.length) throw new AuthorizationError();
    return result.map(r => r.vehicle_id);
  };
  const pursuitVehicles = async (ids: unknown[]) => {
    if (!ids.length) throw new AuthorizationError();
    const out: string[] = [];
    for (const target of new Set(ids.map(id))) out.push(...await rows(
      'select vehicle_id::text from strategy.pursuit where pursuit_id = strategy.canonical_pursuit_id($1::uuid)', [target]));
    return out;
  };
  const byVehicle = async (v: unknown, slug = false) => rows(`select id::text vehicle_id from platform.vehicle where ${slug ? 'slug' : 'id'} = $1`, [slug ? String(v) : id(v)]);
  const scope: ScopeRule = rule.scope;
  switch (scope) {
    case 'global': break;
    case 'context':
    case 'touch': {
      const p = await q.one<{ vehicle_id: string; same_entity: boolean }>(`select vehicle_id::text,
        identity.canonical_entity_id(entity_id)=identity.canonical_entity_id($2::uuid) same_entity
        from strategy.pursuit where pursuit_id=strategy.canonical_pursuit_id($1::uuid)`,
        [id(value(input, 'pursuitId')), id(value(input, 'entityId'))]);
      if (!p?.same_entity) throw new AuthorizationError();
      const specific = scope === 'context' ? !!value(input, 'vehicleId') : (value(input, 'vehicle') ?? 'this') === 'this';
      if (specific) {
        if (id(value(input, 'vehicleId')) !== p.vehicle_id) throw new AuthorizationError();
        vehicle = [p.vehicle_id];
      }
      break;
    }
    case 'spvEntity': {
      if (!await q.one('select entity_id from identity.entity where entity_id=$1', [id(input)])) throw new AuthorizationError();
      // An entity's blanket SPV stance applies to every SPV, not only the page it was edited on.
      vehicle = (await q.query<{ id: string }>("select id::text from platform.vehicle where kind='spv'")).map(v => v.id);
      break;
    }
    case 'signal': {
      const signal = await q.one<{ entity_id: string }>('select entity_id::text from signals.signal where signal_id=$1', [id(value(input, 'signalId'))]);
      if (!signal) throw new AuthorizationError();
      const scopes = await q.query<{ vehicle_id: string }>(`select vehicle_id::text from strategy.active_pursuit
        where identity.canonical_entity_id(entity_id)=identity.canonical_entity_id($1::uuid)`, [signal.entity_id]);
      vehicle = scopes.length ? scopes.map(s => s.vehicle_id) : null;
      break;
    }
    case 'pursuit': vehicle = await pursuitVehicles(values(input, 'pursuitId')); break;
    case 'pursuitArg': vehicle = await pursuitVehicles([input]); break;
    case 'score': vehicle = await pursuitVehicles([args[1]]); if (!vehicle.includes(id(input))) throw new AuthorizationError(); break;
    case 'bulk': {
      const selected = value(input, 'rows');
      if (!Array.isArray(selected) || selected.length > 5000) throw new AuthorizationError();
      vehicle = await pursuitVehicles(selected.map(r => value(r, 'id'))); break;
    }
    case 'undo': {
      const key = value(input, 'of');
      if (typeof key !== 'string' || !key.length || key.length > 100) throw new AuthorizationError();
      vehicle = await rows(`select p.vehicle_id::text from strategy.pursuit_update u
        join strategy.pursuit p on p.pursuit_id = strategy.canonical_pursuit_id(u.pursuit_id)
        where u.created_by = $1 and starts_with(u.idempotency_key, $2)`, [user.id, `table:${user.id}:${key}:`]); break;
    }
    case 'exposure': vehicle = await rows('select vehicle_id::text from pipeline.exposure where exposure_id = $1', [id(value(input, 'exposureId'))]); break;
    case 'suggestion': vehicle = await rows(`select p.vehicle_id::text from strategy.suggestion s join strategy.pursuit p
      on p.pursuit_id = strategy.canonical_pursuit_id(s.pursuit_id) where s.suggestion_id = $1`, [id(value(input, 'suggestionId'))]); break;
    case 'play': vehicle = await rows('select vehicle_id::text from plays.play where play_id = $1', [id(input)]); break;
    case 'vehicleArg': vehicle = await byVehicle(input); break;
    case 'vehicle': vehicle = await byVehicle(value(input, 'vehicleId')); break;
    case 'vehicleSlug': vehicle = await byVehicle(value(input, 'vehicleSlug'), true); break;
    case 'move': vehicle = await rows('select vehicle_id::text from strategy.move_vehicle where move_id = $1 and vehicle_id = $2', [value(input, 'id'), id(value(input, 'vehicleId'))]); break;
    case 'conflict': vehicle = await rows(`select a.vehicle_id::text from coordination.conflict_case c
      join coordination.ask a on a.ask_id in (c.claimant_a, c.claimant_b) where c.case_id = $1`, [id(value(input, 'caseId'))]); break;
    // A person's own connection (docs/25): no vehicle; a viewer was refused above.
    case 'self': return;
    // An email draft is its owner's alone, on the vehicle it was made for.
    case 'emailDraft': {
      const d = await q.one<{ vehicle_id: string; owner_id: string }>('select vehicle_id::text, owner_id::text from email.draft where draft_id = $1', [id(value(input, 'draftId'))]);
      if (!d || d.owner_id !== user.id) throw new AuthorizationError();
      vehicle = [d.vehicle_id];
      break;
    }
    case 'emailNew': {
      const reply = value(input, 'replyToDraftId');
      if (reply) {
        const d = await q.one<{ vehicle_id: string; owner_id: string }>('select vehicle_id::text, owner_id::text from email.draft where draft_id = $1', [id(reply)]);
        if (!d || d.owner_id !== user.id) throw new AuthorizationError();
        vehicle = [d.vehicle_id];
      } else if (value(input, 'pursuitId')) vehicle = await pursuitVehicles([value(input, 'pursuitId')]);
      else vehicle = await byVehicle(value(input, 'vehicleId'));
      const supplied = value(input, 'vehicleId');
      if (supplied && !vehicle.includes(id(supplied))) throw new AuthorizationError();
      break;
    }
    case 'tickets': {
      const ids = values(input, 'ticketId');
      if (!ids.length) throw new AuthorizationError();
      for (const ticketId of ids) {
        const ticket = await q.one<{ vehicle_id: string | null; kind: string; requested_by: string; subject_type: string; subject_id: string }>('select vehicle_id::text, kind::text, requested_by::text, subject_type, subject_id from governance.approval_ticket where id = $1', [id(ticketId)]);
        if (!ticket) throw new AuthorizationError();
        if (value(input, 'decision') === 'approve' && ticket.requested_by === user.id) {
          if (ticket.kind !== 'STAGE' || ticket.subject_type !== 'pursuit') throw new AuthorizationError();
          const pursuit = await q.one<{ owner_id: string }>('select owner_id::text from strategy.pursuit where pursuit_id = strategy.canonical_pursuit_id($1::uuid)', [id(ticket.subject_id)]);
          if (pursuit?.owner_id !== user.id) throw new AuthorizationError();
        }
        // Money/allocation remain Admin-only until a named per-vehicle approver mechanism is configured.
        requireCan(user, ['MONEY', 'ALLOCATION_EXCEPTION'].includes(ticket.kind) ? 'admin' : 'approve', { vehicle: ticket.vehicle_id, ticketKind: ticket.kind });
      }
      return;
    }
  }
  requireCan(user, rule.action, { vehicle });
  // Context and touchpoint forms also name an entity/vehicle: refuse a mismatched scope.
  if (scope === 'pursuit' && value(input, 'vehicleId')) {
    const supplied = id(value(input, 'vehicleId'));
    if (!vehicle?.includes(supplied)) throw new AuthorizationError();
  }
}

/** First statement of every server action: transport/user guard, then policy on that same user. */
export async function requireAction(name: ActionId, ...args: unknown[]): Promise<AppUser> {
  const user = await requireServerActionMutation();
  try {
    await authorizeAction(user, name, args, await getDb());
  } catch (error) {
    // A policy refusal is expected, not a server failure. Next carries this redirect
    // through both enhanced actions and ordinary form posts (303, then the message).
    if (error instanceof AuthorizationError) {
      // A refused Admin action is a security event, not noise: logged with the action's name, never its input.
      if (actionRules[name]?.action === 'admin') {
        const { appendAudit } = await import('@/modules/platform');
        await appendAudit({ actorId: user.id, action: 'authz.refused', subjectType: 'action', subjectId: name, detail: { action: name, access: user.access } }).catch(() => undefined);
      }
      redirect('/access-denied');
    }
    throw error;
  }
  return user;
}
