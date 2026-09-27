import type { PursuitStatus } from './types';

/**
 * Who the LP is (issues 0111, 0112; docs/23-lp-units.md). Pure rules, no database: the re-point
 * job gathers the facts and these decide, so the properties can check the rules directly.
 *
 * The LP is the committing unit: an organisation (a fund, family office, foundation, company, or a
 * vehicle like a GP's joint fund), or a person in their own capacity. A person at a firm is a
 * contact on the firm's pursuit. A person who also invests on their own account is an LP of their
 * own too, linked to the same person, beside the firm.
 */

export const LP_RULE = 'rule:lp-unit-repoint';

/**
 * "Personal" is not a firm (0111): an organisation record named for a capacity rather than an
 * institution. A person listed under one is evidence of investing on their own account.
 */
const PSEUDO = /^\s*(?:personal(?:\s+(?:investing|investments?|capacity|account|funds?|money|office))?|individual(?:\s+investor)?|self|self[- ]employed|private(?:\s+investor)?|angel(?:\s+investor)?|independent|n\/?a|none|-+)\s*$/i;
export const isPseudoOrg = (name: string | null | undefined): boolean => !name || PSEUDO.test(name);

/** Names that say an organisation manages or allocates money. A company name alone does not. */
export const INVESTING_NAME = /\b(capital|ventures?|partners|fund|funds|investments?|investors|asset management|investment management|holdings?|family office|family trust|foundation|endowment|trust|equity|philanthrop\w*|donor.advised|DAF|LP)\b/i;

export type EvidenceKind =
  | 'signed_personally' | 'angel_deals' | 'personal_lp' | 'profile_angel' | 'profile_fo_principal'
  | 'strategy_personal' | 'prospect_personal' | 'listed_personal';
export interface Evidence { kind: EvidenceKind; label: string; ref?: string }

export interface Firm {
  orgId: string; name: string; type: string; role: string | null; primary: boolean;
  /** Why it counts as an investing organisation, or null when nothing on file says it invests. */
  investing: string | null;
}
export interface LpFacts {
  personal: Evidence[];
  /** Open affiliations, pseudo-organisations included (they are read as evidence here). */
  firms: Firm[];
  /** The unit a strategy for this pursuit names as the one that commits ("NFDG", "personal"). */
  unit: string | null;
  /** A research profile reads them as a family office's principal. */
  foPrincipal: boolean;
  /** An amount on record in their name in this vehicle, not signed. */
  moneyHere: boolean;
  /** A number or a signature on this pursuit's ladder. */
  highRung: boolean;
}
export type LpDecision =
  | { decision: 'personal'; reason: string; evidence: Evidence[] }
  | { decision: 'moved'; firm: Firm; reason: string; evidence: Evidence[] }
  | { decision: 'review'; reason: string; evidence: Evidence[] }
  | { decision: 'unaffiliated'; reason: string; evidence: Evidence[] };

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const names = (fs: Firm[]) => fs.map(f => f.name).join(', ');

/**
 * One person's pursuit in one vehicle:
 *   1. evidence of investing on their own account keeps it, as an individual LP (capacity personal);
 *   2. money or a number on this pursuit with no such evidence is a question for a person: whose money?
 *   3. an open affiliation with one investing organisation moves it there, the person kept as a contact;
 *   4. a firm not known to invest, or several investing firms, is a question for a person;
 *   5. no organisation at all keeps it: they can only be an LP in their own right.
 */
export function decideLpUnit(f: LpFacts): LpDecision {
  const personal = [...f.personal];
  if (f.firms.some(x => isPseudoOrg(x.name))) personal.push({ kind: 'listed_personal', label: 'Listed as investing personally' });
  const firms = f.firms.filter(x => !isPseudoOrg(x.name));
  if (f.unit && /^\s*personal\b/i.test(f.unit)) personal.push({ kind: 'strategy_personal', label: 'The strategy names their own account as the one that commits' });
  if (f.foPrincipal && !firms.some(x => x.type === 'family' || /family office/i.test(x.name))) {
    personal.push({ kind: 'profile_fo_principal', label: 'Principal of a family office with no separate entity on record' });
  }
  if (personal.length) return { decision: 'personal', reason: personal.map(e => e.label).join('; '), evidence: personal };
  if (f.moneyHere) return { decision: 'review', reason: 'An amount is on record in their name here, with no evidence they invest personally. Whose money is it?', evidence: [] };
  if (f.highRung) return { decision: 'review', reason: 'A number or a signature is on this pursuit, with no evidence they invest personally. Whose money is it?', evidence: [] };
  if (!firms.length) return { decision: 'unaffiliated', reason: 'No organisation on record: they can only be an LP in their own right.', evidence: [] };
  const investing = firms.filter(x => x.investing);
  if (!investing.length) return { decision: 'review', reason: `At ${names(firms)}, which nothing on file says invests. Firm or personal?`, evidence: [] };
  const unit = f.unit ? norm(f.unit) : '';
  let target = unit ? investing.filter(x => { const n = norm(x.name); return n.length > 1 && (unit.includes(n) || n.includes(unit)); }) : [];
  if (target.length !== 1) target = investing.length === 1 ? investing : investing.filter(x => x.primary);
  if (target.length !== 1) return { decision: 'review', reason: `At several investing organisations (${names(investing)}). Which one is the LP?`, evidence: [] };
  const firm = target[0]!;
  return { decision: 'moved', firm, reason: `${firm.role ? `${firm.role}, ` : ''}${firm.name}: ${firm.investing}. No evidence of investing personally.`, evidence: [] };
}

export interface StatusSide { status: PursuitStatus; human: boolean }
/** Pipeline order for combining: Passed is an exit, not a stage, so it is handled apart. */
const LIVE: PursuitStatus[] = ['new', 'sourcing', 'selected', 'connecting', 'discussing', 'committed'];

/**
 * The status the LP unit's pursuit keeps when a person's pursuit folds into it. The furthest live
 * status wins, so no status is lowered, a person-set one least of all. Passed loses to a live
 * status only when a rule set it; a person's Passed against a live row is a question for a person.
 */
export function combineStatus(person: StatusSide, org: StatusSide | null): { from: 'person' | 'org'; conflict: string | null } {
  if (!org) return { from: 'person', conflict: null };
  const pp = person.status === 'passed', op = org.status === 'passed';
  if (pp && op) return { from: 'org', conflict: null };
  if (pp || op) {
    const passed = pp ? person : org;
    if (passed.human) return { from: 'org', conflict: `A person set Passed on the ${pp ? 'person' : 'organisation'} while the other is ${pp ? org.status : person.status}; decide which stands.` };
    return { from: pp ? 'org' : 'person', conflict: null };
  }
  const a = LIVE.indexOf(person.status), b = LIVE.indexOf(org.status);
  if (a > b) return { from: 'person', conflict: null };
  if (a < b) return { from: 'org', conflict: null };
  // Equal: a person's word is kept over a rule's.
  return { from: person.human && !org.human ? 'person' : 'org', conflict: null };
}
