import { can, type Principal } from '@/lib/authz';
import type { Affiliation } from '@/modules/identity';
import { resolveSpv, spvRowMark, type SpvReading } from '@/modules/strategy';
import type { StatsData } from '@/lib/lp-stats/data';
import type { LpFact } from '@/lib/lp-stats/model';

export const licensedAccess = (user: Principal) => can(user, 'read', { fieldClass: 'R3' });
export function redactAffiliations(user: Principal, rows: Affiliation[]): Affiliation[] {
  return licensedAccess(user) ? rows : rows.filter(row => !/^dakota/i.test(row.source ?? ''));
}
export function redactSpv(user: Principal, reading: SpvReading): SpvReading {
  return licensedAccess(user) ? reading : resolveSpv(reading.evidence.filter(e => e.kind !== 'dakota'));
}
export function redactStats(user: Principal, data: StatsData): StatsData {
  if (licensedAccess(user)) return data;
  return { ...data, facts: data.facts.map(redactFact) };
}
/** One LP's facts as a reader without the licensed (R3) fields sees them. */
export function redactFact(f: LpFact): LpFact {
  return { ...f, context: null,
    // Compact statistics no longer retain provenance for their SPV band.
    spv: 'unknown' as const,
    ...(f.checkBasis === 'dakota' ? { check: 'unknown' as const, checkBasis: 'none' as const, checkText: null } : {}),
    ...(f.typeBasis === 'dakota' ? { type: 'unknown' as const, typeBasis: 'none' as const } : {}),
    // Borrowed locations may originate in a licensed account even when labelled firm/people.
    ...(['dakota', 'firm', 'people'].includes(f.countryBasis ?? '') ? { country: null, countryBasis: null } : {}),
  };
}
export { spvRowMark };
