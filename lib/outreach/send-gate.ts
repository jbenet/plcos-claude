import { getDb } from '@/lib/db';
import { emailBars } from './addresses';
import { grantGate } from '@/modules/grants';

/** Each vehicle kind's own instrument, when the LP holds nothing on it yet (as the mail desk's queue reads it). */
const BY_KIND: Record<string, string> = { fund: 'lp_commitment', spv: 'spv', grant_rail: 'grant' };

/**
 * What a material send to this target on this vehicle must clear, for everyone (rules 8, 11 and 12; red team, 17 Oct 2026):
 * the instrument is theirs on the vehicle (their commitment's, else the vehicle kind's), never a sender's pick; a
 * restriction that bars email refuses; a grants funder with no invitation on file refuses.
 */
export async function sendGate(entityId: string, vehicleId: string): Promise<{ instrument: string; refusals: string[] }> {
  const db = await getDb();
  const v = await db.one<{ kind: string; held: string | null }>(`select v.kind::text kind,
      (select x.instrument::text from pipeline.exposure x where x.vehicle_id = v.id and x.closed_at is null
          and identity.canonical_entity_id(x.entity_id) = identity.canonical_entity_id($1::uuid) order by x.amount desc limit 1) held
     from platform.vehicle v where v.id = $2`, [entityId, vehicleId]);
  if (!v) return { instrument: '', refusals: ['Unknown vehicle.'] };
  const refusals: string[] = [];
  const bars = await emailBars(entityId, db);
  if (bars.length) refusals.push(`A do-not-contact restriction is on file: ${bars.join(' · ')}`);
  if (v.kind === 'grant_rail') {
    const g = await grantGate(entityId);
    if (g.blocked && g.reason) refusals.push(g.reason);
  }
  return { instrument: v.held ?? BY_KIND[v.kind] ?? 'lp_commitment', refusals };
}

