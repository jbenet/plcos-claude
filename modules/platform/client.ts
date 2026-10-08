/**
 * The vehicle rules a browser may run too (Settings → Vehicles derives and checks a slug as you type):
 * no server imports. The server checks again in ./vehicles.ts, which writes the row.
 */
import { RESERVED } from '@/lib/paths';

export type VehicleKindName = 'fund' | 'spv' | 'grant_rail';
export type Exemption = '506(b)' | '506(c)' | 'n/a' | 'unknown';
export type VehiclePhase = 'active' | 'historical';
export interface VehicleRowInput {
  slug: string; name: string; kind: VehicleKindName;
  /** Required and never defaulted: it decides what may be said in public material. */
  exemption: Exemption;
  phase: VehiclePhase;
  target: number | null;
  raise: { opens: string | null; closes: string | null; note: string | null };
  aliases: string[];
}

export const VEHICLE_SLUG = /^[a-z][a-z0-9-]{0,39}$/;
export const VEHICLE_KINDS: readonly VehicleKindName[] = ['fund', 'spv', 'grant_rail'];
export const EXEMPTIONS: readonly Exemption[] = ['506(b)', '506(c)', 'n/a', 'unknown'];
export const VEHICLE_PHASES: readonly VehiclePhase[] = ['active', 'historical'];
const DATE = /^\d{4}-\d{2}-\d{2}$/;
// First segments a vehicle's address cannot take (lib/paths.ts): pages of their own, and the all-vehicles view.
// `email` and `strategy` are top-level or vehicle routes that RESERVED does not list.
const TAKEN = new Set([...RESERVED, 'all', 'email', 'strategy', 'new']);

/** A slug from a name: lowercase letters, digits and dashes, starting with a letter, at most 40 long. */
export function slugFromName(name: string): string {
  const s = name.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^[^a-z]+/, '').replace(/-+$/, '');
  return s.slice(0, 40).replace(/-+$/, '');
}

/** Why a slug cannot name a vehicle, or null. Uniqueness is checked against the database separately. */
export function slugProblem(slug: string): string | null {
  if (!VEHICLE_SLUG.test(slug)) return 'The slug must start with a letter and hold only lowercase letters, digits and dashes (at most 40).';
  if (/--|-$/.test(slug)) return 'The slug cannot end with a dash or hold two in a row.';
  if (TAKEN.has(slug)) return `"${slug}" is the address of a page of its own; choose another slug.`;
  return null;
}

/** What the Add a vehicle form sends, before checking. */
export interface NewVehicle {
  name: string; slug: string; kind: string; exemption: string; phase?: string;
  target?: string | number | null; opens?: string | null; closes?: string | null; aliases?: string | string[] | null;
}

/** Check and normalize the form; every problem at once. */
export function checkNewVehicle(input: NewVehicle): { vehicle: VehicleRowInput | null; problems: string[] } {
  const problems: string[] = [];
  const name = (input.name ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);
  const slug = (input.slug ?? '').trim();
  if (!name) problems.push('Give the vehicle a name.');
  const sp = slugProblem(slug);
  if (sp) problems.push(sp);
  const kind = input.kind as VehicleKindName;
  if (!VEHICLE_KINDS.includes(kind)) problems.push('Choose a kind: fund, SPV or grant rail.');
  const phase = (input.phase || 'active') as VehiclePhase;
  if (!VEHICLE_PHASES.includes(phase)) problems.push('Choose a phase: active or historical.');
  const exemption = input.exemption as Exemption;
  if (!EXEMPTIONS.includes(exemption)) problems.push('Choose the exemption: 506(b), 506(c) or n/a. It is never defaulted: it decides what may be said in public.');
  else if (exemption === 'unknown' && phase !== 'historical') problems.push('"Unknown" is only for a historical vehicle. An active one needs 506(b), 506(c) or n/a.');
  let target: number | null = null;
  const t = typeof input.target === 'number' ? String(input.target) : (input.target ?? '').replace(/[$,\s_]/g, '');
  if (t) {
    const m = /^(\d+(?:\.\d+)?)([kmb])?$/i.exec(t);
    const n = m ? Number(m[1]) * ({ k: 1e3, m: 1e6, b: 1e9 }[(m[2] ?? '').toLowerCase() as 'k' | 'm' | 'b'] ?? 1) : NaN;
    if (!Number.isFinite(n) || n <= 0 || n >= 1e14) problems.push('The target is a positive number of dollars, like 25000000 or 25M, or blank.');
    else target = Math.round(n * 100) / 100;
  }
  const date = (d: string | null | undefined, which: string) => {
    const v = (d ?? '').trim();
    if (!v) return null;
    if (!DATE.test(v) || !Number.isFinite(Date.parse(`${v}T00:00:00Z`))) { problems.push(`The raise ${which} date must be YYYY-MM-DD, or blank.`); return null; }
    return v;
  };
  const opens = date(input.opens, 'opens'), closes = date(input.closes, 'closes');
  if (opens && closes && closes < opens) problems.push('The raise closes before it opens.');
  const rawAliases = Array.isArray(input.aliases) ? input.aliases : (input.aliases ?? '').split(',');
  const aliases = [...new Set(rawAliases.map((a) => a.replace(/\s+/g, ' ').trim()).filter(Boolean))];
  if (aliases.some((a) => a.length > 80) || aliases.length > 20) problems.push('Aliases are up to 20 words or short phrases, comma-separated.');
  if (problems.length) return { vehicle: null, problems };
  return { vehicle: { slug, name, kind, exemption, phase, target, raise: { opens, closes, note: null }, aliases }, problems };
}

/**
 * A raise window an Admin sets on an existing vehicle (setRaiseWindow): each date YYYY-MM-DD or blank, the
 * close not before the open, a short note. The init file's own check is lib/real/init.ts.
 */
export function checkRaiseWindow(input: { opens?: string | null; closes?: string | null; note?: string | null }):
  { window: { opens: string | null; closes: string | null; note: string | null } | null; problems: string[] } {
  const problems: string[] = [];
  const date = (d: string | null | undefined, which: string) => {
    const v = (d ?? '').trim();
    if (!v) return null;
    if (!DATE.test(v) || !Number.isFinite(Date.parse(`${v}T00:00:00Z`))) { problems.push(`The raise ${which} date must be YYYY-MM-DD, or blank.`); return null; }
    return v;
  };
  const opens = date(input.opens, 'opens'), closes = date(input.closes, 'closes');
  if (opens && closes && closes < opens) problems.push('The raise closes before it opens.');
  const note = (input.note ?? '').replace(/\s+/g, ' ').trim() || null;
  if (note && note.length > 200) problems.push('The note is at most 200 characters.');
  return problems.length ? { window: null, problems } : { window: { opens, closes, note }, problems };
}
