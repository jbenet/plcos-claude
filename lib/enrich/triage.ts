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
 * Every lane comes with its reasons, so a person can overrule it knowing why. The Discussing and
 * Committed get a line only when we owe them a reply (s13). Iteration 3 added
 * three that change the first step rather than the lane (docs/19): our last word was a mailing,
 * not a personal ask; nobody on the team owns the pursuit; and the stage on file claims contact
 * that no touch on record shows. A pages-only finding (v1.6) still counts as owed its search pass.
 */

export type Lane = 'warm now' | 'research first' | 'long process' | 'cold';

export interface Triage {
  key: string; name: string; lane: Lane; reasons: string[]; senior: boolean; researched: boolean; waitedDays: number | null;
  /** The first step these reasons point to, before any outreach: a person's check, or none. */
  first: 'name an owner' | 'check sent mail' | 'first personal note' | 'reply we owe' | null;
}

const SENIOR = /\b(founder|co-?founder|managing|partner|principal|chief|cio|ceo|cfo|president|chair|head|director|owner|general partner|gp|trustee|board|angel)\b/i;
const JUNIOR = /\b(analyst|associate|specialist|research|intern|coordinator|assistant|junior)\b/i;
const SLOW = /\b(investment authority|sovereign|pension|retirement|endowment|university|college|bank|insurance|holdings? (?:plc|group)|asset management)\b/i;
const INVESTS = /venture|capital|partners|fund|family office|investments?|ventures|holdings|trust|foundation|asset|advisors|group/i;
/**
 * A firm saying in its own words that it doesn't invest in funds (1.17) — "does not invest in private
 * equity, venture capital or real estate funds" — but not one that only doesn't invest directly
 * ("does not invest directly in venture companies" is a firm that backs managers).
 */
export const NO_FUNDS = /\b(does not|doesn['’]t|do not|don['’]t|will not|won['’]t|never)\s+(do\s+venture|(invest|allocate)\w*\s+(?!directly)(in|to)\s+[^.;]{0,60}?\b(venture capital|venture funds?|funds?|fund managers))\b|\bno\s+(third[- ]party\s+)?fund\s+investments?\b/i;

export async function triage(dir: string, now = new Date()): Promise<Triage[]> {
  const candidates = (await readFile(join(dir, 'candidates.jsonl'), 'utf8')).split('\n').filter(Boolean).map((l) => JSON.parse(l) as Candidate);
  const paths = (await readFile(join(dir, 'connections.jsonl'), 'utf8').catch(() => '')).split('\n').filter(Boolean).map((l) => JSON.parse(l) as Path);
  // Researched means the protocol as written ran; a pages-only finding (v1.6) is still owed its search pass.
  const researched = new Set<string>();
  const pagesFoundNothing = new Set<string>();
  const findingByKey = new Map<string, Finding>();
  /** What each finding says about domains that don't work, kept to test against the domains on file. */
  const domainTalk = new Map<string, string>();
  for (const f of (await readdir(join(dir, 'raw')).catch(() => [])).filter((x) => x.endsWith('.json'))) {
    try {
      const x = JSON.parse(await readFile(join(dir, 'raw', f), 'utf8')) as Finding;
      if (x.identity.match === 'confirmed' || x.identity.match === 'probable') findingByKey.set(x.key, x);
      // A work domain the research found dead (s15): our mailings there may have bounced.
      const said = [x.coverage?.note ?? '', ...(x.coverage?.notFound ?? []), ...(x.profile?.cautions ?? []), x.identity.basis].join(' ');
      domainTalk.set(x.key, said);
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
    // The finding's confirmed role wins over ours (s08): a council membership on file hid a founding partner.
    const title = findingByKey.get(c.key)?.identity.canonical?.role ?? c.role ?? c.enriched['Current Job Title'] ?? '';
    const senior = SENIOR.test(title) && !JUNIOR.test(title);
    // The organization the research found wins over ours (s20): a school on file hid a seed fund's GP.
    const org = `${findingByKey.get(c.key)?.identity.canonical?.org ?? c.org ?? ''} ${c.enriched['Industry'] ?? ''}`;
    const waitedDays = c.contact.awaitingSince ? Math.round((now.getTime() - new Date(c.contact.awaitingSince).getTime()) / 86_400_000) : null;
    // They wrote to us last, with nothing from us since (s22): a reply we owe, whatever the status.
    const theyWroteLast = Boolean(c.contact.lastFromThem && !c.contact.awaitingSince && c.contact.lastTouchChannel && c.contact.lastTouchChannel !== 'meeting' && c.contact.lastTouchChannel !== 'call');

    const colleagueMet = mine.find((p) => p.kind === 'same_firm' && p.tier === 'B');
    const insider = mine.find((p) => p.kind === 'colleague' && p.tier === 'B' && p.other.type === 'ours');
    const close = /close/i.test(c.enriched['Relationship Tier'] ?? '');
    const opened = c.notes.find((n) => /viewed|opened|docsend/i.test(n.summary ?? ''));
    const backer = mine.find((p) => p.other.type === 'backer' && p.tier === 'C');
    const researchPath = mine.find((p) => ['A', 'B'].includes(p.tier) && p.kind !== 'met');

    if (colleagueMet) reasons.push(`A colleague at their firm has met us: ${colleagueMet.other.name}`);
    if (insider) {
      reasons.push(/portfolio\)$/.test(insider.other.name)
        ? `A founder or executive of one of our portfolio companies (${insider.other.name.replace(/ \(.*\)$/, '')}): a reference and a connector first`
        : `They were inside the Protocol Labs network: ${insider.basis.charAt(0).toLowerCase()}${insider.basis.slice(1)}`);
    }
    if (close) reasons.push('The team marks them a close contact — relationship strength, a tier C mark that doesn’t say whose contact they are');
    if (opened) reasons.push(`They opened our material: ${opened.summary}`);
    if (researchPath && researchPath !== colleagueMet && researchPath !== insider) reasons.push(`A documented tie: ${researchPath.basis}`);
    const warm = Boolean(colleagueMet || insider || close || opened || researchPath);

    if (backer) reasons.push(`Their firm backed Protocol Labs (${backer.other.name}): a clue, the firm’s tie, not theirs`);
    if (pagesFoundNothing.has(c.key)) reasons.push('Page reads found nothing on them: they wait for the search pass, not another read of the same pages');
    // The firm's own words ruling out our field (s18): "generally avoids medical devices", buyouts
    // only. W5 parks those instead of writing; triage says so before proposing a note.
    const outOfField = findingByKey.get(c.key)?.facts.find((x) => x.scope === 'firm'
      && /\b(avoid|avoids|does not invest|doesn['’]t invest|excludes?|no)\b[^.;]{0,60}\b(medical|health|healthcare|biotech|life sciences?|neuro|venture)\b/i.test(`${x.value} ${x.quote ?? ''}`));
    if (outOfField) reasons.push('Their firm’s own words rule out our field or venture: read that before writing a note');
    // A mandate the firm states itself (1.17, 1.19): "doesn't invest in funds" closes a fund ask.
    const excl = findingByKey.get(c.key)?.facts.find((x) => NO_FUNDS.test(`${x.value} ${x.quote ?? ''}`));
    if (excl) reasons.push('Their firm says it doesn’t invest in funds: a fund ask is closed — read what else its own words rule out before any note');
    // The research's warning about a look-alike travels with the line (s23): a title beside a
    // company that shares its name with one in our field can mislead a note written from here.
    const lookalike = findingByKey.get(c.key)?.profile?.cautions?.find((x) => /look-?alike|same name|shares? (its|a|the) name|namesake|not to be confused/i.test(x));
    if (lookalike) reasons.push('The research warns of a look-alike name: read its cautions before writing');
    // A warm signal only our notes hold (W5, iteration 3): an invitation promised, a referral.
    const invite = c.notes.find((n) => /invit|invite list|guest list|future events|referr/i.test(n.summary ?? ''));
    if (invite) reasons.push(`Our notes mention an invitation or a referral (${invite.on}): check it was followed through before anything else`);
    if (senior) reasons.push(`Senior title: ${title}`);
    else if (title) reasons.push(`Not the decision-maker by title (${title}): likely the first contact and a gatekeeper`);
    // A mailing, unless we wrote again after it (s16): then that later note is what they last had.
    const laterNote = Boolean(c.contact.lastTouch && c.contact.awaitingSince && c.contact.lastTouch > c.contact.awaitingSince);
    const mailing = c.contact.outreachShared >= 10 && !laterNote;
    if (laterNote && c.contact.outreachShared >= 10) reasons.push(`We wrote again after the mailing, on ${c.contact.lastTouch}: read that note before anything else`);
    if (waitedDays !== null) {
      reasons.push(mailing
        ? `Our last word was a mailing, ${waitedDays} ${waitedDays === 1 ? 'day' : 'days'} ago, the same day as ${c.contact.outreachShared - 1} others: they have had no personal note`
        : `We wrote last, ${waitedDays} ${waitedDays === 1 ? 'day' : 'days'} ago`);
    }
    const owner = c.pursuits[0]?.owner;
    const unowned = !owner || owner === 'Not on the team';
    if (unowned) reasons.push('Nobody on the team owns the pursuit');
    const stage = c.pursuits[0]?.stageSaid ?? '';
    const claimsContact = /contact|meeting|call|intro|follow|no response|replied|sent/i.test(stage);
    // Only a domain on our record (s19): a caution about a parked look-alike isn't about theirs.
    const DEAD = /(does(n['’]t| not) resolve|no longer resolves|refus(ed|es|ing) (every |the )?connections?|connection reset|resets? the connection|dead|NXDOMAIN|domain-for-sale|parked|placeholder page|empty (lander|page)|\/lander\b|certificate for another host)/i;
    const talk = domainTalk.get(c.key) ?? '';
    const dead = c.domains.some((d) => talk.split(/(?<=[.;])\s+/).some((sentence) => sentence.toLowerCase().includes(d) && DEAD.test(sentence)))
      || talk.split(/(?<=[.;])\s+/).some((sentence) => /work domain (on file|on our record)/i.test(sentence) && DEAD.test(sentence));
    if (dead) reasons.push('Their work domain no longer works: check whether our mailings bounced before anything else');
    const noTouch = !c.contact.lastTouch && c.contact.meetings === 0;
    if (claimsContact && noTouch) reasons.push(`The stage on file says “${stage}”, but no touch is on record: check sent mail before writing`);
    const slow = SLOW.test(org);
    if (slow) reasons.push(`An institution that decides by committee: ${c.org}`);

    const lane: Lane = warm || theyWroteLast ? 'warm now'
      : slow ? 'long process'
      : senior && INVESTS.test(org) && !researched.has(c.key) ? 'research first'
      : 'cold';
    if (theyWroteLast) reasons.unshift(`They wrote last, on ${c.contact.lastFromThem}, and nothing from us is on record since: check sent mail, then answer`);
    const first: Triage['first'] = theyWroteLast ? 'reply we owe' : unowned && warm ? 'name an owner' : (claimsContact && noTouch) || dead ? 'check sent mail' : mailing ? 'first personal note' : null;
    out.push({ key: c.key, name: c.name, lane, reasons, senior, researched: researched.has(c.key), waitedDays, first });
  }
  // The warm side (s13): Discussing or Committed, and the last word on record is theirs — a message,
  // not a meeting — with nothing from us since. One line each, with that one first step.
  for (const c of candidates) {
    const status = c.pursuits[0]?.status;
    if (status !== 'discussing' && status !== 'committed') continue;
    const theirs = c.contact.lastFromThem && !c.contact.awaitingSince && Boolean(c.contact.lastTouchChannel) && c.contact.lastTouchChannel !== 'meeting' && c.contact.lastTouchChannel !== 'call';
    if (!theirs) continue;
    const days = Math.round((now.getTime() - new Date(c.contact.lastFromThem!).getTime()) / 86_400_000);
    out.push({ key: c.key, name: c.name, lane: 'warm now', senior: false, researched: researched.has(c.key), waitedDays: null, first: 'reply we owe',
      reasons: [`They wrote last, ${days === 0 ? 'today' : `${days} ${days === 1 ? 'day' : 'days'} ago`} (${c.contact.lastFromThem}), and nothing from us is on record since: check sent mail, then answer`] });
  }
  const order: Record<Lane, number> = { 'warm now': 0, 'research first': 1, 'long process': 2, cold: 3 };
  return out.sort((a, b) => order[a.lane] - order[b.lane] || Number(b.senior) - Number(a.senior) || (a.waitedDays ?? 9e9) - (b.waitedDays ?? 9e9));
}
