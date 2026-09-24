/**
 * The findings a research workflow writes, one file per LP: `data/<profile>/enrich/raw/<key>.json`
 * (docs/19). Written outside the app — by Claude in a working session, or a local sub-agent —
 * and read by the import, which checks it here before mapping anything in. A file that fails the
 * check is reported with its problems and not mapped; nothing half-valid gets in.
 */

export type Match = 'confirmed' | 'probable' | 'ambiguous' | 'not_found';
export type Confidence = 'high' | 'medium' | 'low';
export type SourceKind = 'primary' | 'filing' | 'press' | 'podcast' | 'database' | 'social' | 'other';

export const FACT_FIELDS = [
  'role', 'prior_role', 'education', 'board', 'investment', 'fund_lp', 'fund_gp', 'exit', 'philanthropy',
  'capacity', 'aum', 'check_size', 'interest', 'statement', 'news', 'location', 'investor_type', 'affiliation',
] as const;
export type FactField = (typeof FACT_FIELDS)[number];

export const INVESTOR_TYPES = [
  'angel', 'fo_principal', 'fo_staff', 'fund_gp', 'fund_lp_program', 'foundation', 'corporate', 'operator',
  'institutional', 'advisor', 'unknown',
] as const;
export type InvestorType = (typeof INVESTOR_TYPES)[number];

export const CAPACITY_BANDS = ['<$250K', '$250K–1M', '$1–5M', '$5–25M', '>$25M', 'unknown'] as const;

export interface Source { url: string; title?: string; published?: string | null; kind: SourceKind }

export interface Fact {
  field: FactField;
  value: string;
  /** Structured parts when there are some: a company, a year, a round, an amount as written. */
  detail?: Record<string, string | number | null>;
  source: Source;
  /** A short quote from the source, 25 words or fewer — a verbatim fragment is enough. */
  quote?: string;
  confidence: Confidence;
  /**
   * Whose fact it is (v1.3): the person's own, or their firm's — a firm's thesis or portfolio says
   * what the firm does, not what the person cares about. Unset reads as the person's.
   */
  scope?: 'person' | 'firm';
}

export interface Connection {
  /** Who or what on our side, or in the ecosystem: a team member, Protocol Labs, a portfolio company. */
  to: string;
  kind: 'coinvestor' | 'colleague' | 'board' | 'advisor' | 'portfolio' | 'event_coattendee' | 'social_public' | 'podcast_guest' | 'alumni' | 'other';
  basis: string;
  source?: string | null;
  /** B: documented association, one strong source. C: shared affiliation only. D: proximity only. */
  tier: 'B' | 'C' | 'D';
  /** A firm's tie (its seed check in Protocol Labs) is not a personal relationship: tier C at most for the person. */
  scope?: 'person' | 'firm';
}

export interface Finding {
  key: string;
  name: string;
  /**
   * `version` is the protocol's latest amendment as written, a string ("1.6"); older findings carry
   * a number, read by `protocolOf`. `method` is how it was made (v1.6): `search`, the protocol as
   * written; or `pages`, from page reads with no search or too few to follow it (W1d, or a batch
   * the search budget ran out under) — then "not found" means not named in what could be read, not
   * that nothing exists, and the LP is owed a pass with search. Unset reads as search.
   */
  researched: { at: string; by: string; workflow: 'W1'; version: string | number; method?: 'search' | 'pages' };
  identity: {
    match: Match;
    basis: string;
    canonical?: { name?: string; role?: string | null; org?: string | null; location?: string | null };
    links?: Array<{ kind: 'website' | 'bio' | 'linkedin' | 'x' | 'crunchbase' | 'wikipedia' | 'podcast' | 'other'; url: string }>;
  };
  facts: Fact[];
  profile?: {
    summary: string;
    investorType: InvestorType;
    howTheyInvest?: string;
    interests?: string[];
    /** The likely commitment to one fund, as a band (v1.3) — an estimate, with its basis. */
    capacity?: { band: (typeof CAPACITY_BANDS)[number]; basis: string };
    signals?: Array<{ what: string; on?: string | null; source?: string | null }>;
    cautions?: string[];
  };
  connections?: Connection[];
  queries?: Array<{ q: string; useful?: boolean }>;
  coverage?: { searched?: string[]; notFound?: string[]; note?: string };
}

const isStr = (x: unknown): x is string => typeof x === 'string' && x.trim().length > 0;

/** The amendment a finding followed, as written: 1 → "1.0", 5 (as the first batches wrote 1.5) → "1.5". */
export function protocolOf(f: Pick<Finding, 'researched'>): string {
  const v = f.researched?.version;
  if (typeof v === 'string') return v;
  if (typeof v !== 'number') return '?';
  return Number.isInteger(v) ? (v === 1 ? '1.0' : `1.${v}`) : String(v);
}

/** Made from page reads alone, and so due a pass with search (v1.6). */
export const pagesOnly = (f: Pick<Finding, 'researched'>) => f.researched?.method === 'pages';
const BROKERS = /zoominfo|rocketreach|contactout|signalhire|apollo\.io|lusha|flashlabs|datanyze|seamless\.ai|leadiq|clearbit|spokeo|success\.ai|wiza|cience\.com|beenverified|whitepages|peoplefinders|aeroleads|adapt\.io|instantcheckmate|connectsafely|voilanorbert|hunter\.io|snov\.io|kaspr|uplead|prospeo|fintrx|alphamaven/i;
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.]+/;
/** A phone number: ten or more digits in a run of digits and separators — once dates and year ranges are set aside. */
const hasPhone = (t: string) => {
  const rest = t.replace(/\b\d{4}[-/.]\d{1,2}[-/.]\d{1,2}\b/g, ' ').replace(/\b(19|20)\d{2}\s*[–-]\s*(19|20)?\d{2}\b/g, ' ');
  return (rest.match(/\+?\d[\d\s().-]{8,}\d/g) ?? []).some((m) => m.replace(/\D/g, '').length >= 10);
};

/** Problems with a finding, in words. Empty means it may be mapped in. */
export function check(f: unknown, expectKey?: string): string[] {
  const p: string[] = [];
  const x = f as Partial<Finding>;
  if (!x || typeof x !== 'object') return ['not an object'];
  if (!isStr(x.key)) p.push('no key');
  if (expectKey && x.key !== expectKey) p.push(`key ${x.key} does not match its file name`);
  if (!isStr(x.name)) p.push('no name');
  if (!x.identity || !['confirmed', 'probable', 'ambiguous', 'not_found'].includes(x.identity.match)) p.push('identity.match missing or unknown');
  if (!Array.isArray(x.facts)) p.push('facts is not a list');
  if (x.researched?.method && !['search', 'pages'].includes(x.researched.method)) p.push('researched.method must be search or pages');
  const unsure = x.identity?.match === 'ambiguous' || x.identity?.match === 'not_found';
  if (unsure && (x.facts?.length ?? 0) > 0) p.push('facts recorded for an identity that is not resolved');
  for (const [i, fact] of (x.facts ?? []).entries()) {
    if (!FACT_FIELDS.includes(fact.field)) p.push(`fact ${i}: unknown field "${fact.field}"`);
    if (!isStr(fact.value)) p.push(`fact ${i}: no value`);
    if (!fact.source || !isStr(fact.source.url) || !/^https?:\/\//.test(fact.source.url)) p.push(`fact ${i}: no source URL`);
    if (fact.source && BROKERS.test(fact.source.url)) p.push(`fact ${i}: from a contact-data broker`);
    if (!['high', 'medium', 'low'].includes(fact.confidence)) p.push(`fact ${i}: no confidence`);
    if (fact.quote && fact.quote.split(/\s+/).length > 40) p.push(`fact ${i}: quote longer than 40 words`);
    const said = `${fact.value} ${fact.quote ?? ''}`;
    if (EMAIL.test(said) || hasPhone(said)) p.push(`fact ${i}: carries an email address or phone number`);
  }
  if (x.profile && !INVESTOR_TYPES.includes(x.profile.investorType)) p.push(`profile.investorType "${x.profile.investorType}" is not one of the types`);
  for (const [i, c] of (x.connections ?? []).entries()) {
    if (!isStr(c.to) || !isStr(c.basis)) p.push(`connection ${i}: needs who and why`);
    if (!['B', 'C', 'D'].includes(c.tier)) p.push(`connection ${i}: tier must be B, C or D — A needs our own record of an interaction`);
    if (c.scope === 'firm' && c.tier === 'B') p.push(`connection ${i}: a firm's tie is tier C at most for the person`);
  }
  return p;
}
