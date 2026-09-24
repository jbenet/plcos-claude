import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Candidate } from './candidates';
import type { Path } from './connect';
import { pagesOnly, type Finding } from './schema';

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
 * Every lane comes with its reasons, so a person can overrule it knowing why. Iteration 3 added
 * three that change the first step rather than the lane (docs/19): our last word was a mailing,
 * not a personal ask; nobody on the team owns the pursuit; and the stage on file claims contact
 * that no touch on record shows. A pages-only finding (v1.6) still counts as owed its search pass.
 */

export type Lane = 'warm now' | 'research first' | 'long process' | 'cold';

export interface Triage {
  key: string; name: string; lane: Lane; reasons: string[]; senior: boolean; researched: boolean; waitedDays: number | null;
  /** The first step these reasons point to, before any outreach: a person's check, or none. */
  first: 'name an owner' | 'check sent mail' | 'first personal note' | null;
}

const SENIOR = /\b(founder|co-?founder|managing|partner|principal|chief|cio|ceo|cfo|president|chair|head|director|owner|general partner|gp|trustee|board)\b/i;
const JUNIOR = /\b(analyst|associate|specialist|research|intern|coordinator|assistant|junior)\b/i;
const SLOW = /\b(investment authority|sovereign|pension|retirement|endowment|university|college|bank|insurance|holdings? (?:plc|group)|asset management)\b/i;
const INVESTS = /venture|capital|partners|fund|family office|investments?|ventures|holdings|trust|foundation|asset|advisors|group/i;

export async function triage(dir: string, now = new Date()): Promise<Triage[]> {
  const candidates = (await readFile(join(dir, 'candidates.jsonl'), 'utf8')).split('\n').filter(Boolean).map((l) => JSON.parse(l) as Candidate);
  const paths = (await readFile(join(dir, 'connections.jsonl'), 'utf8').catch(() => '')).split('\n').filter(Boolean).map((l) => JSON.parse(l) as Path);
  // Researched means the protocol as written ran; a pages-only finding (v1.6) is still owed its search pass.
  const researched = new Set<string>();
  const pagesFoundNothing = new Set<string>();
  for (const f of (await readdir(join(dir, 'raw')).catch(() => [])).filter((x) => x.endsWith('.json'))) {
    try {
      const x = JSON.parse(await readFile(join(dir, 'raw', f), 'utf8')) as Finding;
      if (!pagesOnly(x)) researched.add(x.key);
      else if (x.identity.match === 'not_found' || x.identity.match === 'ambiguous') pagesFoundNothing.add(x.key);
    } catch { /* the checker reports it */ }
  }
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
    if (close) reasons.push('The team marks them a close contact — relationship strength, a tier C mark that doesn’t say whose contact they are');
    if (opened) reasons.push(`They opened our material: ${opened.summary}`);
    if (researchPath && researchPath !== colleagueMet && researchPath !== insider) reasons.push(`A documented tie: ${researchPath.basis}`);
    const warm = Boolean(colleagueMet || insider || close || opened || researchPath);

    if (backer) reasons.push(`Their firm backed Protocol Labs (${backer.other.name}): a clue, the firm’s tie, not theirs`);
    if (pagesFoundNothing.has(c.key)) reasons.push('Page reads found nothing on them: they wait for the search pass, not another read of the same pages');
    if (senior) reasons.push(`Senior title: ${title}`);
    else if (title) reasons.push(`Not the decision-maker by title (${title}): likely the first contact and a gatekeeper`);
    const mailing = c.contact.outreachShared >= 10;
    if (waitedDays !== null) {
      reasons.push(mailing
        ? `Our last word was a mailing, ${waitedDays} days ago, the same day as ${c.contact.outreachShared - 1} others: they have had no personal note`
        : `We wrote last, ${waitedDays} days ago`);
    }
    const owner = c.pursuits[0]?.owner;
    const unowned = !owner || owner === 'Not on the team';
    if (unowned) reasons.push('Nobody on the team owns the pursuit');
    const stage = c.pursuits[0]?.stageSaid ?? '';
    const claimsContact = /contact|meeting|call|intro|follow|no response|replied|sent/i.test(stage);
    const noTouch = !c.contact.lastTouch && c.contact.meetings === 0;
    if (claimsContact && noTouch) reasons.push(`The stage on file says “${stage}”, but no touch is on record: check sent mail before writing`);
    const slow = SLOW.test(org);
    if (slow) reasons.push(`An institution that decides by committee: ${c.org}`);

    const lane: Lane = warm ? 'warm now'
      : slow ? 'long process'
      : senior && INVESTS.test(org) && !researched.has(c.key) ? 'research first'
      : 'cold';
    const first: Triage['first'] = unowned && warm ? 'name an owner' : claimsContact && noTouch ? 'check sent mail' : mailing ? 'first personal note' : null;
    out.push({ key: c.key, name: c.name, lane, reasons, senior, researched: researched.has(c.key), waitedDays, first });
  }
  const order: Record<Lane, number> = { 'warm now': 0, 'research first': 1, 'long process': 2, cold: 3 };
  return out.sort((a, b) => order[a.lane] - order[b.lane] || Number(b.senior) - Number(a.senior) || (a.waitedDays ?? 9e9) - (b.waitedDays ?? 9e9));
}
