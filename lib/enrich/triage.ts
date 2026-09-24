import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Candidate } from './candidates';
import type { Path } from './connect';

/**
 * W9, triage the cold (N64, docs/19): the LPs we have reached out to and not heard from, sorted
 * from what we already hold — no web. Deterministic, and run again whenever the files change.
 *
 *   warm now        a way in exists today: a colleague at their firm has met us, they were inside
 *                   the Protocol Labs network, the team marks them close, or they opened our deck
 *   research first  senior, at a firm that invests, and nothing public read yet — who the research
 *                   budget should go to next
 *   long process    an institution that decides by committee over quarters (a sovereign fund, a
 *                   pension, an endowment, a bank): the 2027 list, unless a warm path says otherwise
 *   cold            none of the above: find a connector before writing again
 *
 * Every lane comes with its reasons, so a person can overrule it knowing why.
 */

export type Lane = 'warm now' | 'research first' | 'long process' | 'cold';

export interface Triage { key: string; name: string; lane: Lane; reasons: string[]; senior: boolean; researched: boolean; waitedDays: number | null }

const SENIOR = /\b(founder|co-?founder|managing|partner|principal|chief|cio|ceo|cfo|president|chair|head|director|owner|general partner|gp|trustee|board)\b/i;
const JUNIOR = /\b(analyst|associate|specialist|research|intern|coordinator|assistant|junior)\b/i;
const SLOW = /\b(investment authority|sovereign|pension|retirement|endowment|university|college|bank|insurance|holdings? (?:plc|group)|asset management)\b/i;
const INVESTS = /venture|capital|partners|fund|family office|investments?|ventures|holdings|trust|foundation|asset|advisors|group/i;

export async function triage(dir: string, now = new Date()): Promise<Triage[]> {
  const candidates = (await readFile(join(dir, 'candidates.jsonl'), 'utf8')).split('\n').filter(Boolean).map((l) => JSON.parse(l) as Candidate);
  const paths = (await readFile(join(dir, 'connections.jsonl'), 'utf8').catch(() => '')).split('\n').filter(Boolean).map((l) => JSON.parse(l) as Path);
  const researched = new Set((await readdir(join(dir, 'raw')).catch(() => [])).map((f) => f.replace(/\.json$/, '')));
  const out: Triage[] = [];
  for (const c of candidates) {
    const status = c.pursuits[0]?.status;
    if (status !== 'connecting' && status !== 'selected') continue;
    const mine = paths.filter((p) => p.lp === c.key);
    const reasons: string[] = [];
    const title = c.role ?? c.enriched['Current Job Title'] ?? '';
    const senior = SENIOR.test(title) && !JUNIOR.test(title);
    const org = `${c.org ?? ''} ${c.enriched['Industry'] ?? ''}`;
    const waitedDays = c.contact.awaitingSince ? Math.round((now.getTime() - new Date(c.contact.awaitingSince).getTime()) / 86_400_000) : null;

    const colleagueMet = mine.find((p) => p.kind === 'same_firm' && p.tier === 'B');
    const insider = mine.find((p) => p.kind === 'colleague' && p.tier === 'B' && p.other.type === 'ours');
    const close = /close/i.test(c.enriched['Relationship Tier'] ?? '');
    const opened = c.notes.find((n) => /viewed|opened|docsend/i.test(n.summary ?? ''));
    const backer = mine.find((p) => p.other.type === 'backer' && p.tier === 'C');
    const researchPath = mine.find((p) => ['A', 'B'].includes(p.tier) && p.kind !== 'met');

    if (colleagueMet) reasons.push(`A colleague at their firm has met us: ${colleagueMet.other.name}`);
    if (insider) reasons.push(`They were inside the Protocol Labs network: ${insider.basis.toLowerCase()}`);
    if (close) reasons.push('The team marks them a close contact');
    if (opened) reasons.push(`They opened our material: ${opened.summary}`);
    if (researchPath && researchPath !== colleagueMet && researchPath !== insider) reasons.push(`A documented tie: ${researchPath.basis}`);
    const warm = Boolean(colleagueMet || insider || close || opened || researchPath);

    if (backer) reasons.push(`Their firm backed Protocol Labs (${backer.other.name}): a clue, the firm’s tie, not theirs`);
    if (senior) reasons.push(`Senior title: ${title}`);
    else if (title) reasons.push(`Not the decision-maker by title (${title}): likely the first contact and a gatekeeper`);
    if (waitedDays !== null) reasons.push(`We wrote last, ${waitedDays} days ago`);
    const slow = SLOW.test(org);
    if (slow) reasons.push(`An institution that decides by committee: ${c.org}`);

    const lane: Lane = warm ? 'warm now'
      : slow ? 'long process'
      : senior && INVESTS.test(org) && !researched.has(c.key) ? 'research first'
      : 'cold';
    out.push({ key: c.key, name: c.name, lane, reasons, senior, researched: researched.has(c.key), waitedDays });
  }
  const order: Record<Lane, number> = { 'warm now': 0, 'research first': 1, 'long process': 2, cold: 3 };
  return out.sort((a, b) => order[a.lane] - order[b.lane] || Number(b.senior) - Number(a.senior) || (a.waitedDays ?? 9e9) - (b.waitedDays ?? 9e9));
}
