import type { Queryable } from '@/lib/db';
import { lpUnitReviewInputs } from '@/modules/strategy/lp-units';

/** These fields are identity context, never arbitrary notes, claims or strategy text.
 * Scrub embedded contact strings and numeric figures even in a name/role/reason. */
function clean(text: string): string {
  try { for (let i = 0; i < 3; i++) { const next = decodeURIComponent(text); if (next === text) break; text = next; } }
  catch { /* Still scrub malformed escapes as ordinary text. */ }
  return text.replace(/[\w.!#$%&'*+/=?^`{|}~-]+@[\w.-]+/giu, '[contact omitted]')
    .replace(/(?:https?:\/\/|www\.|mailto:|tel:|sms:)\S+/gi, '[contact omitted]')
    .replace(/(?:\+?\d[\d\s().-]{5,}\d)/g, '[number omitted]')
    .replace(/(?:[$€£¥]\s*)?\d[\d,.]*(?:\s*(?:million|billion|thousand|USD|EUR|GBP|[kmb])\b)?/gi, '[number omitted]').trim();
}

export async function exportLpUnitReview(tx: Queryable) {
  const rows = await lpUnitReviewInputs(tx);
  return rows.map(r => ({
    pursuitId: r.pursuitId, vehicle: { id: r.vehicle.id, name: clean(r.vehicle.name) },
    person: { entityId: r.person.entityId, name: clean(r.person.name) },
    firms: r.firms.map(f => ({ entityId: f.orgId, name: clean(f.name), role: f.role ? clean(f.role) : null,
      knownToInvest: !!f.investing, investingEvidence: f.investing ? clean(f.investing) : null, primary: f.primary })),
    evidence: { personal: r.evidence.map(e => ({ kind: e.kind, label: clean(e.label), ...(e.ref ? { ref: e.ref } : {}) })),
      familyOfficePrincipal: r.foPrincipal, strategyNamesPersonalAccount: r.strategyPersonal,
      numberOrSignatureOnLadder: r.numberOrSignatureOnLadder },
    amountsOnFile: r.amountsOnFile, reason: clean(r.reason),
  }));
}
