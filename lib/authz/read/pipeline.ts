import { currentUser } from '@/lib/auth';
import { pipelineData as raw, scoreDetail as rawScoreDetail } from '@/lib/pipeline-data';
import { getDb } from '@/lib/db';
import { spvMarks } from './strategy';
import { licensedAccess } from './r3';
export type { ScoreDetail, ScorePart } from '@/lib/pipeline-data';
import { can } from '@/lib/authz';
export async function scoreDetail(...args: Parameters<typeof rawScoreDetail>) {
  const user = await currentUser();
  if (!can(user, 'read', { vehicle: args[0], fieldClass: 'R2' })) return null;
  return rawScoreDetail(...args);
}
/** Redact after the shared cache; never mutate its rows or its nested arrays. */
export async function pipelineData(...args: Parameters<typeof raw>) {
  const [user, data] = await Promise.all([currentUser(), raw(...args)]);
  if (licensedAccess(user)) return data;
  const db = await getDb();
  const spv = await spvMarks(db, data.rows.map(row => row.entityId));
  return { ...data, rows: data.rows.map(row => ({ ...row,
    // These compact rows discard source provenance. Suppress contact details rather than infer their licence.
    people: [], firms: [], orgId: null, org: row.isOrg ? row.org : null,
    priority: row.licensedCapacity ? null : row.priority,
    capacity: row.licensedCapacity ? null : row.capacity,
    capacitySort: row.licensedCapacity ? null : row.capacitySort,
    spv: spv.get(row.entityId)!,
    ...(row.licensedStatusReason ? { ended: null, headline: null } : {}),
  })) };
}
