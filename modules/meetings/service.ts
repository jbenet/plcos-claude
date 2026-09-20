import { claimsFor } from '@/modules/research';
import { restrictionsFor } from '@/modules/coordination';
import { pursuitFor } from '@/modules/strategy';
import { listObjections, listQuestions, upcomingMeetings } from './repo';
import type { PrepBrief } from './types';

/**
 * Build a prep brief.
 *
 * Rule 9, enforced by construction: a claim reaches `supported` only if it carries a
 * source, an as-of date and a confidence. Anything missing one goes to `refused` with the
 * reason, so the brief shows the gap rather than omitting the row and reading as complete.
 */
export async function prepBrief(entityId: string, vehicleId: string): Promise<PrepBrief | null> {
  const [claims, objections, questions, restrictions, pursuit, upcoming] = await Promise.all([
    claimsFor(entityId),
    listObjections(entityId),
    listQuestions(entityId),
    restrictionsFor(entityId),
    pursuitFor(entityId, vehicleId),
    upcomingMeetings(),
  ]);

  const supported: PrepBrief['supported'] = [];
  const refused: PrepBrief['refused'] = [];

  for (const c of claims) {
    const p = c.provenance;
    if (!p.source || !p.asOf || !p.confidence) {
      refused.push({ field: c.field, why: 'No complete provenance tuple. The brief will not state it.' });
      continue;
    }
    if (p.confidence === 'low' && !p.lastVerifiedBy) {
      refused.push({
        field: c.field,
        why: `Low confidence from ${p.source} and nobody has verified it. Usable as a question, not as a statement.`,
      });
      continue;
    }
    supported.push({
      field: c.field, value: c.value, source: p.source, asOf: p.asOf, verifiedBy: p.lastVerifiedBy,
    });
  }

  const meeting = upcoming.find((m) => m.entityId === entityId) ?? null;

  return {
    entityId,
    entityName: pursuit?.entityName ?? claims[0]?.entityId ?? 'Unknown',
    vehicleName: pursuit?.vehicleName ?? '',
    meeting,
    supported,
    refused,
    openObjections: objections.filter((o) => o.status === 'open' || o.status === 'fatal'),
    openQuestions: questions.filter((q) => q.status === 'open' || q.status === 'blocked'),
    currentRung: pursuit?.rung ?? null,
    restriction: restrictions[0]?.instruction ?? null,
  };
}
