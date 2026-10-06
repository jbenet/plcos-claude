import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { check, type Finding } from '@/lib/enrich/schema';
import { quoteOnPage, type CitedPage } from './cited-pages';

/**
 * W1c's second step in the cloud (docs/28 §6.1; docs/workflows/w1c-fact-check.md, "Correcting the findings"):
 * from the grades, by rule, and only from the pages the finding already cites. The model proposes the
 * corrected finding; the server holds it to what the protocol says a correction may not do, mechanically,
 * and records the correction itself (`researched.corrected`), so the model never writes its own provenance.
 */

export const CORRECTED_BY = 'claude (cloud), W1c';
type Grade = { i: number; grade: string; note: string };

export async function correctionSystemPrompt(cwd = process.cwd()): Promise<string> {
  const w1c = await readFile(join(cwd, 'docs/workflows/w1c-fact-check.md'), 'utf8');
  const w1 = await readFile(join(cwd, 'docs/workflows/w1-profile.md'), 'utf8');
  const correcting = w1c.slice(w1c.indexOf('## Correcting the findings'), w1c.indexOf('## Running W1c as a sub-agent'));
  const facts = w1.slice(w1.indexOf('## Facts'), w1.indexOf('## Capacity'));
  if (correcting.length < 100 || facts.length < 100) throw new Error('The W1c correction rules could not be found; nothing was run.');
  return [
    'You correct one research finding from its fact-check grades, under the rules below (W1c, the second step).',
    'Use only the text of the pages given, which are the pages the finding already cites. You have no tools.',
    'Keep every fact graded "supported" or "unavailable" exactly as it is. Change the identity in no way. Do not touch researched; the host records the correction.',
    'Leave out religion, health, politics, addresses, emails and phone numbers.',
    'Answer with JSON only, no prose and no code fence: {"finding": <the whole corrected finding>, "what": "<one sentence: what was corrected, by count and kind, with no names>"}.',
    '', correcting.trim(), '', facts.trim(),
  ].join('\n');
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * What a proposed correction does that the protocol forbids, or that the server cannot verify. Empty means
 * it may be written. `pages` are the pages read in this run, by URL.
 */
export function correctionProblems(original: Finding, proposed: unknown, grades: Grade[], pages: Map<string, CitedPage>): string[] {
  const p: string[] = [];
  const x = proposed as Finding;
  if (!x || typeof x !== 'object' || Array.isArray(x)) return ['not an object'];
  if (x.key !== original.key || x.name !== original.name) p.push('the key or name changed');
  if (!same(x.identity, original.identity)) p.push('the identity changed; a correction changes no identity');
  if (!same(x.profile?.capacity?.band ?? null, original.profile?.capacity?.band ?? null)) p.push('the capacity band changed; that is left for a person');
  if (!Array.isArray(x.facts)) { p.push('facts is not a list'); return p; }
  const cited = new Set(original.facts.map((f) => f.source?.url).filter(Boolean));
  for (const [i, f] of x.facts.entries()) {
    const url = f?.source?.url;
    if (!url || !cited.has(url)) { p.push(`fact ${i}: cites a page the finding did not already cite`); continue; }
    const page = pages.get(url);
    const unchanged = original.facts.some((o) => same(o, f));
    if (!unchanged && (!page || page.state !== 'read')) p.push(`fact ${i}: changed or added on a page that was not read`);
    if (!unchanged && f.quote && page?.state === 'read' && !page.sec && !quoteOnPage(f.quote, page.text)) p.push(`fact ${i}: its quote is not on its page word for word`);
  }
  // Supported and unavailable facts stay exactly as they were: there is nothing to correct, or nothing to correct from.
  for (const g of grades) if ((g.grade === 'supported' || g.grade === 'unavailable') && !x.facts.some((f) => same(f, original.facts[g.i]))) {
    p.push(`fact ${g.i} was graded ${g.grade} and must stay as it was`);
  }
  p.push(...check({ ...x, researched: original.researched }, original.key).map((s) => `validator: ${s}`));
  return p;
}

/** The corrected finding as written: the proposal, with the original reading's record and one dated correction added. */
export function withCorrection(original: Finding, proposed: Finding, what: string, at = new Date().toISOString().slice(0, 10)): Finding {
  return { ...proposed, researched: { ...original.researched, corrected: [...(original.researched.corrected ?? []), { at, by: CORRECTED_BY, what: what.slice(0, 300) }] } };
}
