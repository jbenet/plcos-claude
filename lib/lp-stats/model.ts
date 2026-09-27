/**
 * LP stats (Juan, 27 Sep 2026): counts of the LPs we are working, by what they are and where they
 * stand, with filters that narrow every count at once. The pure part: the segmentations, the
 * filters, and the counting. The page and the properties both use it; lib/lp-stats/data.ts gathers
 * the facts. Client-safe: no server imports.
 *
 * The unit is the LP unit (docs/23): an organisation, or a person in their own capacity. On one
 * vehicle that is one pursuit. Across vehicles an LP counts once; its status, owner, score and fit
 * come from its furthest-along pursuit, and money stays per vehicle — never added across them
 * (rule 1), so capital is shown only when one vehicle is in view.
 */
import { REGIONS, REGION_LABEL, regionOf, type Region } from './geo';

export type PursuitStatus = 'new' | 'sourcing' | 'selected' | 'connecting' | 'discussing' | 'committed' | 'passed';

// ── LP type ─────────────────────────────────────────────────────────────────────────────────────
/**
 * The segmentation of Report 1 §2.2 (the LP taxonomy for a frontier-science Fund I) and Report 4
 * §2.1 (single- and multi-family offices, RIAs), in the words Dakota and the research use.
 */
export const LP_TYPES = [
  'family_office', 'multi_family_office', 'individual', 'fund_of_funds', 'fund_manager', 'foundation', 'endowment',
  'corporate', 'wealth_platform', 'pension_insurance', 'sovereign_government', 'crypto_treasury', 'other_institution', 'unknown',
] as const;
export type LpType = (typeof LP_TYPES)[number];
export const LP_TYPE_LABEL: Record<LpType, string> = {
  family_office: 'Family office', multi_family_office: 'Multi-family office', individual: 'Individual',
  fund_of_funds: 'Fund of funds, OCIO or consultant', fund_manager: 'Fund manager or investment firm', foundation: 'Foundation',
  endowment: 'Endowment (university, hospital)', corporate: 'Corporate or strategic', wealth_platform: 'RIA, wealth manager or private bank',
  pension_insurance: 'Pension or insurance', sovereign_government: 'Sovereign or government-backed', crypto_treasury: 'Crypto treasury or DAO',
  other_institution: 'Other institution', unknown: 'Type not known',
};
export type TypeBasis = 'record' | 'dakota' | 'research' | 'contact' | 'name' | 'none';
export const TYPE_BASIS_LABEL: Record<TypeBasis, string> = {
  record: 'our record', dakota: 'Dakota account type', research: 'research profile', contact: 'a contact’s research profile',
  name: 'name only (weakest)', none: 'no evidence',
};

/** Dakota's account types, read by their words so a new spelling still lands. Order matters: the first match wins. */
const DAKOTA_TYPES: Array<[RegExp, LpType]> = [
  [/multi[- ]?family/i, 'multi_family_office'],
  [/family office|single[- ]family/i, 'family_office'],
  [/fund of funds|\bfof\b|ocio|outsourced|consultant/i, 'fund_of_funds'],
  [/endowment|university|college|healthcare|hospital/i, 'endowment'],
  [/foundation/i, 'foundation'],
  [/pension|taft|retirement|insurance/i, 'pension_insurance'],
  [/sovereign|government|public fund/i, 'sovereign_government'],
  [/\bria\b|wealth|private bank|bank trust|trust company|broker|advis/i, 'wealth_platform'],
  [/venture|private equity|hedge|asset manag|investment manag|\bgp\b/i, 'fund_manager'],
  [/corporat|company|strategic/i, 'corporate'],
  [/crypto|dao\b/i, 'crypto_treasury'],
];
/** The research profile's investorType (lib/enrich/schema.ts), for an organisation. */
const RESEARCH_ORG_TYPES: Record<string, LpType> = {
  fo_principal: 'family_office', fo_staff: 'family_office', fund_gp: 'fund_manager', fund_lp_program: 'fund_of_funds',
  foundation: 'foundation', corporate: 'corporate', institutional: 'other_institution', advisor: 'wealth_platform',
};
/** Names that say what an organisation is. The weakest reading (docs/23), labelled as such; "Capital" alone says nothing. */
const NAME_TYPES: Array<[RegExp, LpType]> = [
  [/multi[- ]family office|\bmfo\b/i, 'multi_family_office'],
  [/family office|family offices|\bfamily (?:holdings|investments|partners)\b/i, 'family_office'],
  [/fund of funds|\bfof\b/i, 'fund_of_funds'],
  [/endowment|university|college/i, 'endowment'],
  [/foundation|stiftung|fondation|fundación|charitable trust/i, 'foundation'],
  [/pension|retirement system|insurance|assurance/i, 'pension_insurance'],
  [/sovereign|investment authority|\bgovernment\b|national fund/i, 'sovereign_government'],
  [/wealth|private bank|\bria\b/i, 'wealth_platform'],
  [/\bdao\b/i, 'crypto_treasury'],
  [/\bventures?\b|\bvc\b/i, 'fund_manager'],
];

export interface TypeInput {
  unit: 'organisation' | 'individual';
  entityType: string | null;
  dakotaType: string | null;
  researchType: string | null;
  /** investorType on the research profiles of the organisation's people, most common first. */
  contactTypes: string[];
  name: string;
}
/** One LP type and what it rests on. A person in their own capacity is an individual, whatever their firm is. */
export function lpTypeOf(x: TypeInput): { type: LpType; basis: TypeBasis } {
  if (x.unit === 'individual') return { type: 'individual', basis: 'record' };
  if (x.entityType === 'family') return { type: 'family_office', basis: 'record' };
  if (x.entityType === 'foundation') return { type: 'foundation', basis: 'record' };
  if (x.dakotaType) {
    const hit = DAKOTA_TYPES.find(([re]) => re.test(x.dakotaType!));
    if (hit) return { type: hit[1], basis: 'dakota' };
  }
  const own = x.researchType ? RESEARCH_ORG_TYPES[x.researchType] : undefined;
  if (own) return { type: own, basis: 'research' };
  if (x.entityType === 'vehicle') return { type: 'fund_manager', basis: 'record' };
  for (const t of x.contactTypes) {
    const via = RESEARCH_ORG_TYPES[t];
    if (via && via !== 'wealth_platform' && via !== 'other_institution') return { type: via, basis: 'contact' };
  }
  const named = NAME_TYPES.find(([re]) => re.test(x.name));
  if (named) return { type: named[1], basis: 'name' };
  return { type: 'unknown', basis: 'none' };
}

// ── Typical check size ──────────────────────────────────────────────────────────────────────────
export const CHECK_BANDS = ['lt100k', '100k_250k', '250k_1m', '1m_5m', '5m_plus', 'open', 'unknown'] as const;
export type CheckBand = (typeof CHECK_BANDS)[number];
export const CHECK_LABEL: Record<CheckBand, string> = {
  lt100k: 'Under $100K', '100k_250k': '$100–250K', '250k_1m': '$250K–1M', '1m_5m': '$1–5M', '5m_plus': '$5M+',
  open: 'Open range only', unknown: 'Not known',
};
export type CheckBasis = 'strategy' | 'dakota' | 'affinity' | 'prospect' | 'none';
export const CHECK_BASIS_LABEL: Record<CheckBasis, string> = {
  strategy: 'strategy or research band', dakota: 'Dakota ticket size', affinity: 'Affinity check-size field',
  prospect: 'prospect list (a guess)', none: 'nothing on file',
};

export function bandOfAmount(usd: number | null | undefined): CheckBand {
  if (usd == null || !Number.isFinite(usd) || usd <= 0) return 'unknown';
  return usd < 100e3 ? 'lt100k' : usd < 250e3 ? '100k_250k' : usd < 1e6 ? '250k_1m' : usd < 5e6 ? '1m_5m' : '5m_plus';
}
const money = (n: string, unit: string | undefined) => Number(n.replace(/,/g, '')) * ({ k: 1e3, m: 1e6, b: 1e9 }[(unit ?? '').toLowerCase()] ?? 1);
/**
 * A written band ("$250K–1M", "$500K–$1M", "<$25K", ">$25M", "$100K+ (floor)") in these bands, by
 * its midpoint. A band open at one end that could sit in two of them ("<$250K", "$100K+") is
 * "Open range only", not a narrower guess.
 */
export function bandOfText(text: string | null | undefined): CheckBand {
  if (!text) return 'unknown';
  const t = text.replace(/\s/g, '');
  const range = /^\$?([\d.,]+)([kmb])?[–-]\$?([\d.,]+)([kmb])$/i.exec(t);
  if (range) {
    const hi = money(range[3]!, range[4]), lo = money(range[1]!, range[2] ?? range[4]);
    return hi >= lo ? bandOfAmount((lo + hi) / 2) : 'unknown';
  }
  const below = /^<\$?([\d.,]+)([kmb])?/i.exec(t);
  if (below) { const x = money(below[1]!, below[2]); return x <= 100e3 ? 'lt100k' : 'open'; }
  const above = /^(?:>|\$?([\d.,]+)([kmb])?\+)/i.exec(t);
  if (above) {
    const m = /([\d.,]+)([kmb])?/i.exec(t);
    const x = m ? money(m[1]!, m[2]) : 0;
    return x >= 5e6 ? '5m_plus' : 'open';
  }
  const one = /^\$?([\d.,]+)([kmb])?$/i.exec(t);
  return one ? bandOfAmount(money(one[1]!, one[2])) : 'unknown';
}

// ── Score, fit, path, source, recency ───────────────────────────────────────────────────────────
export const SCORE_BANDS = ['80', '60', '40', '0', 'none'] as const;
export type ScoreBand = (typeof SCORE_BANDS)[number];
export const SCORE_LABEL: Record<ScoreBand, string> = { '80': '80–100', '60': '60–79', '40': '40–59', '0': 'Under 40', none: 'No score yet' };
export const scoreBandOf = (score: number | null): ScoreBand =>
  score === null || !Number.isFinite(score) ? 'none' : score >= 80 ? '80' : score >= 60 ? '60' : score >= 40 ? '40' : '0';

/** The fit page's groups (app/[vehicle]/fit), in its order. */
export const FIT_GROUPS = ['strong', 'good', 'possible', 'weak', 'unknown', 'gate', 'missing'] as const;
export type FitGroup = (typeof FIT_GROUPS)[number];
export const FIT_LABEL: Record<FitGroup, string> = {
  strong: 'Strong fit', good: 'Good fit', possible: 'Possible fit', weak: 'Weak fit', unknown: 'Fit not known',
  gate: 'Fails a gate', missing: 'No reading yet',
};

export const TIERS = ['A', 'B', 'C', 'D', 'none', 'unsearched'] as const;
export type Tier = (typeof TIERS)[number];
export const TIER_LABEL: Record<Tier, string> = {
  A: 'A · direct', B: 'B · documented', C: 'C · shared affiliation', D: 'D · proximity only',
  none: 'None found in search', unsearched: 'Not searched yet',
};

export const SOURCES = ['affinity', 'dakota', 'research', 'network', 'here', 'other'] as const;
export type Source = (typeof SOURCES)[number];
export const SOURCE_LABEL: Record<Source, string> = {
  affinity: 'Affinity', dakota: 'Dakota', research: 'Research (prospect lists)', network: 'PL network (warehouse)',
  here: 'Added here', other: 'Other rule',
};
/** Where a pursuit came from: strategy.pursuit.source, and for a prospect, the key its research gave it. */
export function sourceOf(pursuitSource: string | null, prospectKey: string | null): Source {
  const s = (pursuitSource ?? 'us').toLowerCase();
  if (s === 'affinity') return 'affinity';
  if (s === 'dakota') return 'dakota';
  if (s === 'prospects') return /^(warehouse|w3_person):/.test(prospectKey ?? '') ? 'network' : 'research';
  if (s.startsWith('investing-organization')) return 'research';
  if (s === 'us') return 'here';
  return 'other';
}

export const RECENCY = ['d30', 'd90', 'd180', 'd365', 'older', 'never'] as const;
export type Recency = (typeof RECENCY)[number];
export const RECENCY_LABEL: Record<Recency, string> = {
  d30: 'In the last 30 days', d90: '31–90 days ago', d180: '3–6 months ago', d365: '6–12 months ago', older: 'Over a year ago',
  never: 'No touch on record',
};
export function recencyOf(iso: string | null, now: Date): Recency {
  if (!iso) return 'never';
  const days = (now.getTime() - new Date(iso).getTime()) / 864e5;
  return days <= 30 ? 'd30' : days <= 90 ? 'd90' : days <= 182 ? 'd180' : days <= 365 ? 'd365' : 'older';
}

/**
 * SPV stance (modules/strategy/spv-rules.ts): does SPVs, with the least number of SPV or
 * co-investment deals we know of in bands; doesn't; or unknown, which reads as likely open (rule 7).
 * A count is a lower bound, so "5–9 known" may be more.
 */
export const SPV_BANDS = ['d10', 'd5', 'd2', 'd1', 'd0', 'no', 'unknown'] as const;
export type SpvBand = (typeof SPV_BANDS)[number];
export const SPV_LABEL: Record<SpvBand, string> = {
  d10: 'Does · ≥10 known deals', d5: 'Does · 5–9 known', d2: 'Does · 2–4 known', d1: 'Does · 1 known', d0: 'Does · count not known',
  no: 'Doesn’t do SPVs', unknown: 'Unknown, likely open',
};
export function spvBandOf(stance: 'does' | 'does-not' | 'unknown', minDeals: number | null): SpvBand {
  if (stance === 'does-not') return 'no';
  if (stance !== 'does') return 'unknown';
  const n = minDeals ?? 0;
  return n >= 10 ? 'd10' : n >= 5 ? 'd5' : n >= 2 ? 'd2' : n >= 1 ? 'd1' : 'd0';
}

export const STATUS_ORDER: PursuitStatus[] = ['new', 'sourcing', 'selected', 'connecting', 'discussing', 'committed', 'passed'];
export const STATUS_WORD: Record<PursuitStatus, string> = {
  new: 'New', sourcing: 'Sourcing', selected: 'Selected', connecting: 'Connecting', discussing: 'Discussing', committed: 'Committed', passed: 'Passed',
};
/** Furthest along first; Passed last, so a live pursuit on another vehicle wins. */
const FURTHEST: PursuitStatus[] = ['committed', 'discussing', 'connecting', 'selected', 'sourcing', 'new', 'passed'];

// ── Facts ───────────────────────────────────────────────────────────────────────────────────────
export interface Money { hard: number; soft: number }
/** One pursuit's facts: an LP unit on one vehicle. Several of one LP merge into its unit across vehicles. */
export interface LpFact {
  entityId: string;
  name: string;
  /** For a person: their firm, as context. */
  context: string | null;
  unit: 'organisation' | 'individual';
  /** Vehicle slugs, each with the pursuit that serves it (for links). */
  pursuits: Array<{ vehicle: string; id: string; status: PursuitStatus }>;
  type: LpType; typeBasis: TypeBasis;
  check: CheckBand; checkBasis: CheckBasis; checkText: string | null;
  score: number | null; scoreKind: string | null;
  fit: FitGroup;
  /** Where the country was read: the LP's own Dakota record or research, else its firm's (a person) or its people's (a firm). */
  country: string | null; countryBasis: 'dakota' | 'research' | 'firm' | 'people' | null;
  spv: SpvBand;
  status: PursuitStatus;
  tier: Tier;
  source: Source;
  owner: string;
  strategy: boolean;
  research: 'profile' | 'claims' | 'none';
  lastTouch: string | null;
  openedAt: string | null;
  /** Soft and hard per vehicle slug, never summed together or across vehicles. */
  money: Record<string, Money>;
}

const TIER_RANK: Record<Tier, number> = { A: 0, B: 1, C: 2, D: 3, none: 4, unsearched: 5 };
const CHECK_RANK: Record<CheckBasis, number> = { strategy: 0, dakota: 1, affinity: 2, prospect: 3, none: 4 };

/** One LP unit from its pursuits on the vehicles in view. */
export function mergeUnit(parts: LpFact[]): LpFact {
  if (parts.length === 1) return parts[0]!;
  const lead = [...parts].sort((a, b) => FURTHEST.indexOf(a.status) - FURTHEST.indexOf(b.status) || (b.score ?? -1) - (a.score ?? -1))[0]!;
  const check = [...parts].sort((a, b) => CHECK_RANK[a.checkBasis] - CHECK_RANK[b.checkBasis])[0]!;
  const first = [...parts].sort((a, b) => (a.openedAt ?? '').localeCompare(b.openedAt ?? ''))[0]!;
  const touches = parts.map((p) => p.lastTouch).filter((t): t is string => !!t).sort();
  const money: Record<string, Money> = {};
  for (const p of parts) for (const [v, m] of Object.entries(p.money)) money[v] = { hard: (money[v]?.hard ?? 0) + m.hard, soft: (money[v]?.soft ?? 0) + m.soft };
  return {
    ...lead,
    // The lead pursuit first: the LP's link goes to it.
    pursuits: [lead, ...parts.filter((p) => p !== lead)].flatMap((p) => p.pursuits),
    check: check.check, checkBasis: check.checkBasis, checkText: check.checkText,
    tier: parts.map((p) => p.tier).sort((a, b) => TIER_RANK[a] - TIER_RANK[b])[0]!,
    source: first.source, openedAt: first.openedAt,
    strategy: parts.some((p) => p.strategy),
    research: parts.some((p) => p.research === 'profile') ? 'profile' : parts.some((p) => p.research === 'claims') ? 'claims' : 'none',
    lastTouch: touches.at(-1) ?? null,
    money,
  };
}

// ── Dimensions ──────────────────────────────────────────────────────────────────────────────────
export type DimKey =
  | 'type' | 'check' | 'region' | 'country' | 'score' | 'fit' | 'status' | 'tier' | 'spv' | 'source' | 'owner'
  | 'touch' | 'strategy' | 'research' | 'unit' | 'vehicle';

export interface Dimension {
  key: DimKey;
  title: string;
  /** What the counts rest on, in one line. */
  note: string;
  /** Fixed order of values; empty for a dimension whose values come from the data (country, owner, vehicle). */
  order: readonly string[];
  label: (value: string) => string;
  /** The value(s) of one LP. Only the vehicle is multi-valued: an LP on two vehicles is in both. */
  of: (f: LpFact, now: Date) => string;
  multi?: boolean;
}

const yesNo = (v: string) => (v === 'yes' ? 'Has a strategy' : 'No strategy yet');
export const DIMENSIONS: Dimension[] = [
  { key: 'type', title: 'LP type', order: LP_TYPES, label: (v) => LP_TYPE_LABEL[v as LpType] ?? v, of: (f) => f.type,
    note: 'Our record’s type first, then Dakota’s account type, the research profile, a contact’s profile, and last the name.' },
  { key: 'check', title: 'Typical check size', order: CHECK_BANDS, label: (v) => CHECK_LABEL[v as CheckBand] ?? v, of: (f) => f.check,
    note: 'Estimates, not commitments: the strategy or research band, then Dakota’s ticket size, Affinity’s check-size field, a prospect list’s guess.' },
  { key: 'region', title: 'Region', order: REGIONS, label: (v) => REGION_LABEL[v as Region] ?? v, of: (f) => regionOf(f.country),
    note: 'From the country below.' },
  { key: 'country', title: 'Country', order: [], label: (v) => (v === 'unknown' ? 'Not known' : v), of: (f) => f.country ?? 'unknown',
    note: 'Dakota’s billing or mailing country, else the research location; failing both, a person’s firm’s country or a firm’s people’s. Affinity’s location is not imported.' },
  { key: 'score', title: 'Selection score', order: SCORE_BANDS, label: (v) => SCORE_LABEL[v as ScoreBand] ?? v, of: (f) => scoreBandOf(f.score),
    note: 'The score Selection ranks by: a fit assessment where one exists, otherwise the strategy’s provisional score.' },
  { key: 'fit', title: 'Fit reading', order: FIT_GROUPS, label: (v) => FIT_LABEL[v as FitGroup] ?? v, of: (f) => f.fit,
    note: 'The group on Funder–vehicle fit: a formal assessment where one exists, otherwise the latest strategy’s reading.' },
  { key: 'status', title: 'Pipeline status', order: STATUS_ORDER, label: (v) => STATUS_WORD[v as PursuitStatus] ?? v, of: (f) => f.status,
    note: 'Our plan, set by a person or a rule; not evidence of the LP’s interest.' },
  { key: 'tier', title: 'Best path', order: TIERS, label: (v) => TIER_LABEL[v as Tier] ?? v, of: (f) => f.tier,
    note: 'The best evidence tier among the routes the last search recorded. “None found” means none in the material searched, not that none exists.' },
  { key: 'spv', title: 'SPVs', order: SPV_BANDS, label: (v) => SPV_LABEL[v as SpvBand] ?? v, of: (f) => f.spv,
    note: 'Whether they do SPVs: a person’s setting on the LP page, then research, then our own SPVs, Dakota’s co-investment flag and research text. Counts are lower bounds.' },
  { key: 'source', title: 'Source', order: SOURCES, label: (v) => SOURCE_LABEL[v as Source] ?? v, of: (f) => f.source,
    note: 'Where the pursuit came from. No record names an intake spreadsheet, so none is counted.' },
  { key: 'owner', title: 'Owner', order: [], label: (v) => v, of: (f) => f.owner, note: 'Who holds the pursuit.' },
  { key: 'touch', title: 'Last touch', order: RECENCY, label: (v) => RECENCY_LABEL[v as Recency] ?? v, of: (f, now) => recencyOf(f.lastTouch, now),
    note: 'The latest meeting, email or note on record with them or their contacts.' },
  { key: 'strategy', title: 'Strategy', order: ['yes', 'no'], label: yesNo, of: (f) => (f.strategy ? 'yes' : 'no'),
    note: 'A proposed or accepted strategy for this vehicle.' },
  { key: 'research', title: 'Research', order: ['profile', 'claims', 'none'],
    label: (v) => ({ profile: 'Profile on file', claims: 'Claims only', none: 'Nothing researched' } as Record<string, string>)[v] ?? v,
    of: (f) => f.research, note: 'A W1 research profile, or sourced claims without one.' },
  { key: 'unit', title: 'LP unit', order: ['organisation', 'individual'],
    label: (v) => (v === 'organisation' ? 'Organisation' : 'Individual'), of: (f) => f.unit,
    note: 'The committing unit (docs/23): a firm, or a person in their own capacity (an individual).' },
  { key: 'vehicle', title: 'Vehicle', order: [], label: (v) => v, of: () => '', multi: true,
    note: 'An LP on two vehicles counts on each, so these can add up to more than the LPs shown.' },
];
export const DIM = Object.fromEntries(DIMENSIONS.map((d) => [d.key, d])) as Record<DimKey, Dimension>;

// ── Filters ─────────────────────────────────────────────────────────────────────────────────────
export interface Filters {
  q: string; sel: Partial<Record<DimKey, string[]>>; sort: 'score' | 'name' | 'touch'; page: number;
  /** The Coverage panel's chosen bases, by id (cr, ct in the address); unset is the file's default. */
  cov?: { region?: string; type?: string };
}

/** Filters from the address: ?q=…&type=family_office,foundation&status=discussing (repeated keys read too). */
export function parseFilters(sp: Record<string, string | string[] | undefined>): Filters {
  const sel: Filters['sel'] = {};
  for (const d of DIMENSIONS) {
    const raw = sp[d.key];
    const values = (Array.isArray(raw) ? raw : raw ? [raw] : []).flatMap((x) => x.split(',')).map((x) => x.trim()).filter(Boolean);
    if (values.length) sel[d.key] = [...new Set(values)];
  }
  const q = typeof sp.q === 'string' ? sp.q.trim().slice(0, 120) : '';
  const sort = sp.sort === 'name' || sp.sort === 'touch' ? sp.sort : 'score';
  const page = Math.max(1, Number.parseInt(typeof sp.page === 'string' ? sp.page : '1', 10) || 1);
  const id = (x: unknown) => (typeof x === 'string' && /^[\w-]{1,60}$/.test(x) ? x : undefined);
  const cov = { region: id(sp.cr), type: id(sp.ct) };
  return { q, sel, sort, page, ...(cov.region || cov.type ? { cov } : {}) };
}

/** The address for a set of filters; the order of keys is fixed so one view has one address. */
export function filterQuery(f: Filters): string {
  const p = new URLSearchParams();
  if (f.q) p.set('q', f.q);
  for (const d of DIMENSIONS) { const v = f.sel[d.key]; if (v?.length) p.set(d.key, v.join(',')); }
  if (f.sort !== 'score') p.set('sort', f.sort);
  if (f.page > 1) p.set('page', String(f.page));
  if (f.cov?.region) p.set('cr', f.cov.region);
  if (f.cov?.type) p.set('ct', f.cov.type);
  const s = p.toString();
  return s ? `?${s.replace(/%2C/g, ',')}` : '';
}

/** A value added to or taken out of a dimension's filter; the page goes back to 1. */
export function toggle(f: Filters, key: DimKey, value: string): Filters {
  const now = f.sel[key] ?? [];
  const next = now.includes(value) ? now.filter((v) => v !== value) : [...now, value];
  const sel = { ...f.sel, [key]: next };
  if (!next.length) delete sel[key];
  return { ...f, sel, page: 1 };
}
export const without = (f: Filters, key: DimKey): Filters => { const sel = { ...f.sel }; delete sel[key]; return { ...f, sel, page: 1 }; };

const words = (q: string) => q.toLowerCase().split(/\s+/).filter(Boolean);
export const matchesSearch = (f: LpFact, q: string) => {
  const w = words(q);
  if (!w.length) return true;
  const text = `${f.name} ${f.context ?? ''}`.toLowerCase();
  return w.every((x) => text.includes(x));
};

/** Whether an LP passes every filter but `except` (and the vehicle, which is applied before merging). */
export function passes(f: LpFact, filters: Filters, now: Date, except: DimKey | null = null): boolean {
  for (const d of DIMENSIONS) {
    if (d.key === except || d.key === 'vehicle') continue;
    const want = filters.sel[d.key];
    if (want?.length && !want.includes(d.of(f, now))) return false;
  }
  return true;
}

// ── Counting ────────────────────────────────────────────────────────────────────────────────────
export interface Segment { value: string; label: string; count: number; share: number; selected: boolean; money: Money | null }
export interface Panel { dim: Dimension; base: number; segments: Segment[]; extra: string | null }
export interface Stats {
  total: number;
  /** LPs that pass every filter and the search. */
  rows: LpFact[];
  panels: Panel[];
  /** The one vehicle whose money can be shown, or null when more than one is in view (rule 1). */
  moneyVehicle: string | null;
  vehiclesInView: string[];
}

const sumMoney = (facts: LpFact[], vehicle: string): Money => {
  let hard = 0, soft = 0;
  for (const f of facts) { const m = f.money[vehicle]; if (m) { hard += m.hard; soft += m.soft; } }
  return { hard, soft };
};

/**
 * Every panel's counts. Each panel counts the LPs that pass the search and every *other* filter, so
 * a chosen segment can be widened from the same panel; its segments add up to that base, one LP
 * each (the vehicle, multi-valued, excepted). `facts` are pursuit-level; `vehicles` are the slugs in
 * scope, in rail order; `scope` is the vehicle in the address, or null for all.
 */
export function computeStats(facts: LpFact[], filters: Filters, vehicles: Array<{ slug: string; name: string }>, scope: string | null, now: Date): Stats {
  const scopeSlugs = scope ? [scope] : vehicles.map((v) => v.slug);
  const chosen = scope ? [scope] : (filters.sel.vehicle ?? []).filter((v) => scopeSlugs.includes(v));
  const inView = chosen.length ? chosen : scopeSlugs;
  const merge = (list: LpFact[]) => {
    const by = new Map<string, LpFact[]>();
    for (const f of list) by.set(f.entityId, [...(by.get(f.entityId) ?? []), f]);
    return [...by.values()].map(mergeUnit);
  };
  const scoped = facts.filter((f) => scopeSlugs.includes(f.pursuits[0]!.vehicle));
  const total = new Set(scoped.map((f) => f.entityId)).size;
  const units = merge(scoped.filter((f) => inView.includes(f.pursuits[0]!.vehicle) && matchesSearch(f, filters.q)));
  const rows = units.filter((u) => passes(u, filters, now));
  const moneyVehicle = inView.length === 1 ? inView[0]! : null;

  const panels: Panel[] = [];
  for (const d of DIMENSIONS) {
    if (d.key === 'vehicle') {
      if (scope) continue;
      // If this vehicle were the choice: its own pursuits that pass the search and the other filters.
      const segs = vehicles.map((v) => {
        const own = scoped.filter((f) => f.pursuits[0]!.vehicle === v.slug && matchesSearch(f, filters.q) && passes(f, filters, now));
        return { value: v.slug, label: v.name, count: own.length, share: 0, selected: chosen.includes(v.slug), money: null };
      });
      const base = new Set(scoped.filter((f) => matchesSearch(f, filters.q) && passes(f, filters, now)).map((f) => f.entityId)).size;
      for (const s of segs) s.share = base ? s.count / base : 0;
      panels.push({ dim: d, base, segments: segs, extra: null });
      continue;
    }
    const pool = units.filter((u) => passes(u, filters, now, d.key));
    const counts = new Map<string, LpFact[]>();
    for (const u of pool) { const v = d.of(u, now); counts.set(v, [...(counts.get(v) ?? []), u]); }
    const want = filters.sel[d.key] ?? [];
    let order: string[];
    if (d.order.length) order = [...d.order];
    else order = [...counts.keys()].filter((k) => k !== 'unknown').sort((a, b) => counts.get(b)!.length - counts.get(a)!.length || a.localeCompare(b)).concat(counts.has('unknown') ? ['unknown'] : []);
    // Every value an LP has is shown, so a panel always adds up to its base; a selected value with
    // no LPs left stays visible, so it can be taken off.
    for (const v of [...counts.keys(), ...want]) if (!order.includes(v)) order.push(v);
    const segments = order
      .filter((v) => counts.has(v) || want.includes(v) || (d.order.length > 0 && !['open', 'crypto_treasury', 'other_institution', 'other'].includes(v)))
      .map((v) => {
        const list = counts.get(v) ?? [];
        return { value: v, label: d.label(v), count: list.length, share: pool.length ? list.length / pool.length : 0,
          selected: want.includes(v), money: moneyVehicle ? sumMoney(list, moneyVehicle) : null };
      });
    let extra: string | null = null;
    if (d.key === 'type') extra = basisLine(pool.map((u) => TYPE_BASIS_LABEL[u.typeBasis]));
    if (d.key === 'check') extra = basisLine(pool.map((u) => CHECK_BASIS_LABEL[u.checkBasis]));
    if (d.key === 'score') { const kinds = pool.filter((u) => u.score !== null).map((u) => (u.scoreKind ?? '').startsWith('Fit') ? 'fit assessment' : 'provisional'); extra = kinds.length ? basisLine(kinds) : null; }
    panels.push({ dim: d, base: pool.length, segments, extra });
  }
  return { total, rows, panels, moneyVehicle, vehiclesInView: inView };
}

function basisLine(labels: string[]): string | null {
  if (!labels.length) return null;
  const c = new Map<string, number>();
  for (const l of labels) c.set(l, (c.get(l) ?? 0) + 1);
  return [...c.entries()].sort((a, b) => b[1] - a[1]).map(([l, n]) => `${l} ${n.toLocaleString('en-US')}`).join(' · ');
}

// ── Coverage against a reference ────────────────────────────────────────────────────────────────
/**
 * One published figure to compare with (config/lp-market-reference.json). A basis with shares is a
 * distribution over our keys (lib/lp-stats) or over groups of them (`groups`); one without shares is
 * a figure that is not a distribution (a count in one country), shown for context and never compared.
 */
export interface Basis {
  id: string;
  dimension: 'region' | 'type';
  label: string;
  /** What it counts, in the source's terms: what is counted, where, weighted how. */
  what: string;
  source: string;
  asOf: string;
  confidence: string;
  shares: Record<string, number> | null;
  /** For a figure that is not a distribution: the figure in words, and which of our counts to show beside it. */
  figure?: string;
  compare?: Array<{ label: string; members: string[] }>;
}
export interface Reference {
  source: string; asOf: string; placeholder: boolean; note: string;
  /** The default bases' shares, kept for a simple reader; the bases are the full record. */
  region: Record<string, number>;
  type: Record<string, number>;
  /** A key a basis uses that is several of ours: Asia-Pacific, or family offices of both kinds. */
  groups: Record<string, { label: string; members: string[] }>;
  bases: Basis[];
}
export interface CoverageRow {
  value: string; label: string; ours: number; reference: number | null; gap: number | null; count: number;
}
/** The values a basis can match for one LP: its region and its country (as `country:<name>`), or its type. */
const coverageValues = (r: LpFact, dimension: Basis['dimension'], now: Date): string[] =>
  dimension === 'region' ? [DIM.region.of(r, now), ...(r.country ? [`country:${r.country}`] : [])] : [r.type];

/**
 * Our share of each of a basis's segments beside the basis's own, among the LPs whose segment is
 * known (a basis has no "unknown"). LPs in none of its segments get a row of their own with no
 * reference and no gap. The gap is in percentage points: positive means over-represented.
 */
export function coverage(rows: LpFact[], basis: Basis, groups: Reference['groups'], now: Date): { rows: CoverageRow[]; known: number; unknown: number } {
  const shares = basis.shares ?? {};
  const keys = Object.keys(shares);
  const total = keys.reduce((n, k) => n + shares[k]!, 0) || 1;
  const members = new Map(keys.map((k) => [k, new Set(groups[k]?.members ?? [k])]));
  const known = rows.filter((r) => coverageValues(r, basis.dimension, now)[0] !== 'unknown');
  const counts = new Map<string, number>();
  for (const r of known) {
    const values = coverageValues(r, basis.dimension, now);
    const key = keys.find((k) => values.some((v) => members.get(k)!.has(v))) ?? '';
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const dim = DIM[basis.dimension];
  const out: CoverageRow[] = keys.map((k) => {
    const ours = known.length ? (counts.get(k) ?? 0) / known.length : 0;
    const reference = shares[k]! / total;
    return { value: k, label: groups[k]?.label ?? dim.label(k), ours, reference, gap: (ours - reference) * 100, count: counts.get(k) ?? 0 };
  });
  const outside = counts.get('') ?? 0;
  if (outside) out.push({ value: '', label: 'Not in this basis’s segments', ours: outside / known.length, reference: null, gap: null, count: outside });
  return { known: known.length, unknown: rows.length - known.length, rows: out };
}

/** The basis to show for a dimension: the one asked for, else the first distribution. */
export function chosenBasis(ref: Reference, dimension: Basis['dimension'], id: string | undefined): Basis | null {
  const all = ref.bases.filter((b) => b.dimension === dimension);
  return all.find((b) => b.id === id) ?? all.find((b) => b.shares) ?? null;
}

/** How many of our known LPs fall in some segments (our keys, `country:` names or groups), for a figure's context. */
export function ourCount(rows: LpFact[], members: string[], groups: Reference['groups'], dimension: Basis['dimension'], now: Date): { count: number; known: number } {
  const want = new Set(members.flatMap((m) => groups[m]?.members ?? [m]));
  const known = rows.filter((r) => coverageValues(r, dimension, now)[0] !== 'unknown');
  return { count: known.filter((r) => coverageValues(r, dimension, now).some((v) => want.has(v))).length, known: known.length };
}
