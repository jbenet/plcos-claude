/**
 * W4 and W5 — fit, angle, strategy and the next action (N64, docs/19): what a working session
 * writes for one LP, `data/<profile>/enrich/strategy/<key>.json`, from the public profile (W1),
 * the paths (W3), and where they stand with us. A proposal for a person, never a decision: the
 * import turns it into a suggestion someone accepts or dismisses, and accepting changes only the
 * pursuit's next step. It never sets a status, records a rung, touches money, or sends anything.
 *
 * The scores follow docs/04 §4 — capacity, affinity, propensity, time to decision — each with
 * its evidence, never collapsed into one number; and docs/04 §0's two lists, this year's close
 * and 2027.
 */

export type Level = 'high' | 'medium' | 'low' | 'unknown';

export interface Strategy {
  key: string;
  name: string;
  made: { at: string; by: string; workflow: 'W5'; version: number };
  fit: Record<string, { verdict: 'strong' | 'good' | 'possible' | 'weak' | 'unknown'; why: string; gates?: Array<{ gate: string; answer: 'yes' | 'no' | 'unknown'; basis: string }> }>;
  scores: {
    capacity: { band: string; basis: string };
    affinity: { level: Level; basis: string };
    propensity: { level: Level; basis: string };
    timeToDecision: { band: 'weeks' | '1–2 months' | 'a quarter or more' | 'unknown'; basis: string };
  };
  /** Why they'd care, from their own record, in a sentence or two. */
  angle: string;
  /** The best path in, from W3 — or none, said so. */
  route: { via: string; tier: 'A' | 'B' | 'C' | 'D'; why: string } | null;
  next: { what: string; who: string; when: string; material?: string | null };
  ask: { vehicle: string; shape: 'fund commitment' | 'SPV' | 're-up or upsize' | 'intro to others' | 'advice' | 'none yet'; range?: string | null };
  openQuestions: string[];
  risks: string[];
  list: 'this year' | '2027' | 'not now';
  confidence: 'high' | 'medium' | 'low';
}

const isStr = (x: unknown): x is string => typeof x === 'string' && x.trim().length > 0;

export function checkStrategy(s: unknown, expectKey?: string): string[] {
  const p: string[] = [];
  const x = s as Partial<Strategy>;
  if (!x || typeof x !== 'object') return ['not an object'];
  if (!isStr(x.key)) p.push('no key');
  if (expectKey && x.key !== expectKey) p.push('key does not match its file name');
  if (!x.fit || typeof x.fit !== 'object' || !Object.keys(x.fit).length) p.push('no fit');
  for (const k of ['capacity', 'affinity', 'propensity', 'timeToDecision'] as const) {
    if (!x.scores?.[k] || !isStr((x.scores[k] as { basis?: string }).basis)) p.push(`scores.${k} needs a basis`);
  }
  if (!isStr(x.angle)) p.push('no angle');
  if (!x.next || !isStr(x.next.what) || !isStr(x.next.who)) p.push('next needs what and who');
  if (x.next && /\b(send|email|message|post)\b.*\b(now|automatically)\b/i.test(x.next.what)) p.push('next reads as an automatic send');
  if (!x.ask || !isStr(x.ask.vehicle)) p.push('ask needs a vehicle');
  if (!['this year', '2027', 'not now'].includes(x.list ?? '')) p.push('list must be this year, 2027 or not now');
  if (x.route && !['A', 'B', 'C', 'D'].includes(x.route.tier)) p.push('route tier must be A–D');
  return p;
}
