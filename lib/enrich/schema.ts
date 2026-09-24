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
   * `corrected` lists edits made later by rule without a new reading (W1c, the fact check): the
   * reading's date stays, so what was read when stays true.
   */
  researched: { at: string; by: string; workflow: 'W1'; version: string | number; method?: 'search' | 'pages';
    corrected?: Array<{ at: string; by: string; what: string }> };
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
export const pagesOnly = (f: { researched?: { method?: string } }) => f.researched?.method === 'pages';
/**
 * A pages finding that ran a few web searches before the session's budget ran out: too few to
 * follow the protocol, so still due the pass, but not one made "with no web search" (rule 7).
 */
export const partialSearch = (f: { researched?: { method?: string }; coverage?: { searched?: string[] } | null }) =>
  pagesOnly(f) && (f.coverage?.searched ?? []).some((s) => /(?<!\bno )\bweb search\b/i.test(s));
/**
 * Contact-data brokers, people-search sites and LP-contact databases (W1 1.26): never a source, and
 * passed as `blocked_domains` on every search but the near-us check (1.27). A name matches a
 * domain's own label — "zoominfo" is zoominfo.com and zoominfo.co.uk — and is kept to distinctive
 * names; a domain matches itself and its subdomains. Both whole, hyphens ignored (1.29): the old
 * pattern's "cience.com" caught every "…science.com", and "alphamaven" missed alpha-maven.com.
 */
const BROKER_NAMES = [
  'zoominfo', 'rocketreach', 'contactout', 'signalhire', 'lusha', 'flashlabs', 'datanyze', 'leadiq', 'clearbit', 'spokeo',
  'beenverified', 'whitepages', 'peoplefinders', 'aeroleads', 'instantcheckmate', 'connectsafely', 'voilanorbert', 'kaspr',
  'uplead', 'prospeo', 'fintrx', 'alphamaven', 'altss', 'lead411', 'visualvisitor', 'datalead', 'muraena', 'premieralts',
  'radaris', 'truepeoplesearch', 'fastpeoplesearch', 'nuwber', 'peekyou', 'thatsthem', 'clustrmaps', 'usphonebook',
  'intelius', 'truthfinder', 'zabasearch', 'idcrawl', 'peoplelooker', 'anywho', 'massinvestordatabase', 'massinvestor',
  'growjo', 'cisleads', 'opengovny', 'pipelineroad', 'venturecapitalarchive', 'shortlyst', 'unmask', 'freepeoplesearch',
  'equilar', 'wealthmetrica', 'lpbacked', 'clodura', 'vcsheet', 'lpallocator', 'angelspartners', 'flashintel',
  'startupfundraising', 'theraiselist', 'findlimitedpartners', 'bookyourdata', 'startupinvestorsdirectory', 'finalscout',
  'businessprofiles', 'buzzfile', 'findlps', 'allfamilyoffices', 'praxisrock', 'activefamilyoffices', 'relationshipscience',
  'askforfunding', 'leadferret', 'reachinbox', 'peoplesearch', 'veripages', 'dastelefonbuch', 'venturebanc', 'familyofficehub',
  'fundinfolks', 'opendatany', 'inforcapital', 'angelbacked', 'highperformr', 'scalelist', 'theofficialboard', 'getemail',
  'allpeople', 'konaequity', 'realtyhop', 'getprospect', 'officialusa',
];
const BROKER_DOMAINS = ['apollo.io', 'seamless.ai', 'success.ai', 'wiza.co', 'cience.com', 'adapt.io', 'hunter.io', 'snov.io', 'me.sh', 'clay.com', 'clay.earth', 'mylife.com', 'dnb.com', 'salesflow.io', 'investorfundraising.gumroad.com', 'x-ray.contact', 'mycity.com', 'ic-research.com', 'maven-data.com', 'sales.superagi.com'];
/** The same list as domains, for a search's `blocked_domains`. */
export const BLOCKED_DOMAINS = [
  'zoominfo.com', 'rocketreach.co', 'contactout.com', 'signalhire.com', 'lusha.com', 'datanyze.com', 'leadiq.com', 'clearbit.com',
  'spokeo.com', 'beenverified.com', 'whitepages.com', 'peoplefinders.com', 'aeroleads.com', 'instantcheckmate.com', 'voilanorbert.com',
  'kaspr.io', 'uplead.com', 'prospeo.io', 'fintrx.com', 'alphamaven.com', 'alpha-maven.com', 'altss.com', 'lead411.com',
  'visualvisitor.com', 'data-lead.com', 'muraena.ai', 'premieralts.com', 'radaris.com', 'truepeoplesearch.com',
  'fastpeoplesearch.com', 'nuwber.com', 'peekyou.com', 'thatsthem.com', 'clustrmaps.com', 'usphonebook.com', 'intelius.com',
  'truthfinder.com', 'zabasearch.com', 'idcrawl.com', 'peoplelooker.com', 'anywho.com', 'massinvestordatabase.com', 'growjo.com', 'cisleads.com', 'opengovny.com', 'pipelineroad.com', 'venturecapitalarchive.com', 'shortlyst.ai', 'unmask.com',
  'freepeoplesearch.com', 'equilar.com', 'wealthmetrica.com', 'lpbacked.com', 'clodura.ai', 'vcsheet.com', 'lpallocator.com', 'angelspartners.com', 'flashintel.ai',
  'startupfundraising.com', 'theraiselist.com', 'findlimitedpartners.com', 'bookyourdata.com', 'startupinvestorsdirectory.com', 'finalscout.com',
  'businessprofiles.com', 'buzzfile.com', 'findlps.com', 'allfamilyoffices.com', 'praxisrock.com', 'activefamilyoffices.com',
  'relationshipscience.com', 'askforfunding.com', 'leadferret.com', 'reachinbox.ai', 'peoplesearch.com', 'veripages.com',
  'dastelefonbuch.de', 'venturebanc.com', 'familyofficehub.io', 'fundinfolks.com', 'opendatany.com', 'inforcapital.com',
  'angelbacked.co', 'highperformr.ai', 'scalelist.com', 'theofficialboard.com', 'getemail.io', 'allpeople.com', 'konaequity.com',
  'realtyhop.com', 'getprospect.com', 'officialusa.com', ...BROKER_DOMAINS,
];
export function isBroker(url: string | null | undefined): boolean {
  if (!url) return false;
  let host: string;
  try { host = new URL(url).hostname.toLowerCase(); } catch { return false; }
  const bare = host.replace(/-/g, '');
  const labels = bare.split('.').slice(0, -1);
  return BROKER_NAMES.some((n) => labels.includes(n))
    || BROKER_DOMAINS.some((d) => { const b = d.replace(/-/g, ''); return bare === b || bare.endsWith(`.${b}`); });
}
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.]+/;
/** A phone number: ten or more digits in a run of digits and separators — once dates and year ranges are set aside. */
const hasPhone = (t: string) => {
  const rest = t.replace(/\b\d{4}[-/.]\d{1,2}[-/.]\d{1,2}\b/g, ' ').replace(/\b(19|20)\d{2}\s*[–-]\s*(19|20)?\d{2}\b/g, ' ');
  return (rest.match(/\+?\d[\d\s().-]{8,}\d/g) ?? []).some((m) => m.replace(/\D/g, '').length >= 10);
};

/**
 * A street address (c16): a number and a street word, a suite or floor, a post-office box. The
 * reader hands them back from filings even when asked not to. A city alone is fine.
 */
const STREET = /\b\d{1,6}\s+(?:[NSEW]\.?\s+)?(?:[A-Z][A-Za-z.'-]*\s+){1,4}(?:Street|St\.?|Avenue|Ave\.?|Road|Rd\.?|Boulevard|Blvd\.?|Drive|Dr\.?|Lane|Ln\.?|Way|Place|Pl\.?|Court|Ct\.?|Parkway|Pkwy\.?|Square|Sq\.?|Highway|Hwy\.?|Terrace|Circle|Plaza)\b|\b(?:Suite|Ste\.?|Floor|Fl\.)\s*#?\d+\b|\bP\.?\s?O\.?\s+Box\s+\d+/;
export const hasAddress = (t: string) => STREET.test(t);

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
  const corrected = (x.researched as { corrected?: unknown } | undefined)?.corrected;
  if (corrected !== undefined && (!Array.isArray(corrected) || corrected.some((c) => !c || !isStr((c as { at?: unknown }).at) || !isStr((c as { by?: unknown }).by) || !isStr((c as { what?: unknown }).what))))
    p.push('researched.corrected must list { at, by, what }');
  const unsure = x.identity?.match === 'ambiguous' || x.identity?.match === 'not_found';
  if (unsure && (x.facts?.length ?? 0) > 0) p.push('facts recorded for an identity that is not resolved');
  for (const [i, fact] of (x.facts ?? []).entries()) {
    if (!FACT_FIELDS.includes(fact.field)) p.push(`fact ${i}: unknown field "${fact.field}"`);
    if (!isStr(fact.value)) p.push(`fact ${i}: no value`);
    if (!fact.source || !isStr(fact.source.url) || !/^https?:\/\//.test(fact.source.url)) p.push(`fact ${i}: no source URL`);
    if (fact.source && isBroker(fact.source.url)) p.push(`fact ${i}: from a contact-data broker`);
    if (!['high', 'medium', 'low'].includes(fact.confidence)) p.push(`fact ${i}: no confidence`);
    if (fact.quote && fact.quote.split(/\s+/).length > 40) p.push(`fact ${i}: quote longer than 40 words`);
    const said = `${fact.value} ${fact.quote ?? ''}`;
    if (EMAIL.test(said) || hasPhone(said)) p.push(`fact ${i}: carries an email address or phone number`);
    // Each text on its own: joined, a quote ending "in 2014" and a company "Sixth Street Partners" read as an address.
    if ([fact.value, fact.quote ?? '', ...Object.values(fact.detail ?? {}).filter((v): v is string => typeof v === 'string')].some(hasAddress)) p.push(`fact ${i}: carries a street address`);
  }
  if (x.profile && !INVESTOR_TYPES.includes(x.profile.investorType)) p.push(`profile.investorType "${x.profile.investorType}" is not one of the types`);
  // Contact details anywhere, not only in facts (v1.16): firm pages hand them to the reader freely.
  const prose: Array<[string, string | null | undefined]> = [
    ['identity.basis', x.identity?.basis], ['profile.summary', x.profile?.summary], ['profile.howTheyInvest', x.profile?.howTheyInvest],
    ...(x.profile?.cautions ?? []).map((t, i) => [`profile.cautions ${i}`, t] as [string, string]),
    ...(x.profile?.signals ?? []).map((t, i) => [`profile.signals ${i}`, t.what] as [string, string]),
    ['coverage.note', x.coverage?.note], ...(x.coverage?.notFound ?? []).map((t, i) => [`coverage.notFound ${i}`, t] as [string, string]),
    ...(x.connections ?? []).map((c, i) => [`connection ${i}`, c.basis] as [string, string]),
  ];
  // A broker is no source anywhere in a finding, not only under a fact (1.29).
  for (const [i, l] of (x.identity?.links ?? []).entries()) if (isBroker(l.url)) p.push(`identity link ${i}: a contact-data broker`);
  for (const [i, sg] of (x.profile?.signals ?? []).entries()) if (isBroker(sg.source)) p.push(`profile.signals ${i}: from a contact-data broker`);
  for (const [where, text] of prose) {
    if (text && (EMAIL.test(text) || hasPhone(text))) p.push(`${where}: carries an email address or phone number`);
    if (text && hasAddress(text)) p.push(`${where}: carries a street address`);
  }
  for (const [i, c] of (x.connections ?? []).entries()) {
    if (!isStr(c.to) || !isStr(c.basis)) p.push(`connection ${i}: needs who and why`);
    if (!['B', 'C', 'D'].includes(c.tier)) p.push(`connection ${i}: tier must be B, C or D — A needs our own record of an interaction`);
    if (c.scope === 'firm' && c.tier === 'B') p.push(`connection ${i}: a firm's tie is tier C at most for the person`);
  }
  return p;
}
