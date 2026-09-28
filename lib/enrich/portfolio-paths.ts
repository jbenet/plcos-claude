import type { Candidate } from './candidates';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { affirms, connectionPersonKey, norm, type ConnectionPerson, type Path } from './connect';
import { portfolioProblems, type PortfolioInput, type PortfolioSource } from './portfolio';
import { plSourceNode } from './pl-network';
import type { Finding } from './schema';

const reference = (s: PortfolioSource) => `${s.file}#page=${s.page}; as_of=${s.as_of}; confidence=${s.confidence}; last_verified_by=${s.last_verified_by}`;

export async function readConnectionPortfolio(enrichDir: string): Promise<PortfolioInput | undefined> {
  let text: string;
  try { text = await readFile(join(enrichDir, '..', 'portfolio', 'portfolio.json'), 'utf8'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
  let input: PortfolioInput;
  try { input = JSON.parse(text) as PortfolioInput; }
  catch { throw new Error('W3 portfolio input is not valid JSON.'); }
  const errors = portfolioProblems(input);
  if (errors.length) throw new Error(`W3 portfolio input failed validation (${errors.length} problems).`);
  return input;
}

/** Join a validated portfolio snapshot into W3 without database access. A name alone
 * never merges a portfolio founder with an LP or a research endpoint. */
export function portfolioPaths(paths: Path[], candidates: Candidate[], findings: Map<string, Finding>, input: PortfolioInput): Path[] {
  if (portfolioProblems(input).length) throw new Error('W3 portfolio input failed validation.');
  const out = [...paths], hub = plSourceNode();
  const excluded = new Set(input.excluded?.map(r => r.id));
  for (const row of [...input.rows, ...(input.spv_rows ?? [])]) {
    if (excluded.has(row.id) || row.portfolio_status === 'research_scope_only' || row.portfolio_status?.startsWith('warehouse_')) continue;
    const firms = [row.company.name, ...(row.company.organization_names ?? [])];
    for (const founder of row.founders) {
      const name = norm(founder.name);
      const founded = (f: Finding | undefined) => f?.facts.some(fact => fact.confidence !== 'low'
        && fact.scope !== 'firm' && ['role', 'prior_role'].includes(fact.field)
        && /\b(?:co-?founder|founder|founded)\b/i.test(fact.value)
        && firms.some(firm => norm(String(fact.detail?.company ?? '')) === norm(firm)
          || affirms(fact.value, firm)));
      const namesakes = candidates.filter(c => c.type === 'person' && norm(c.name) === name);
      const matches = namesakes.filter(c => {
        const f = findings.get(c.key);
        if (f && ['ambiguous', 'not_found'].includes(f.identity.match)) return false;
        return [c.org, f?.identity.canonical?.org, ...(c.enriched.Organizations ?? '').split(/;\s*/)]
          .some(org => org && firms.some(firm => norm(org) === norm(firm))) || founded(f);
      });
      // A sourced research profile can represent a connector outside the LP export.
      const researched = [...findings.values()].filter(f => !candidates.some(c => c.key === f.key)
        && norm(f.name) === name && ['confirmed', 'probable'].includes(f.identity.match)
        && ((f.identity.canonical?.org && firms.some(firm => norm(f.identity.canonical!.org!) === norm(firm))) || founded(f)));
      const identities = [...matches.map(c => c.key), ...researched.map(f => f.key)];
      const key = identities.length === 1 ? identities[0]! : connectionPersonKey(founder.name, `portfolio:${row.id}`);
      const person: ConnectionPerson = { key, name: founder.name, source: `portfolio:${row.id}`, entityType: 'person' };
      const lpPerson = identities.length === 1 ? undefined : person;
      for (let i = 0; i < out.length; i++) {
        const p = out[i]!;
        if (p.lp === key && lpPerson) out[i] = { ...p, lpPerson };
        // Preserve explicit endpoint keys. Otherwise require both the person's name and
        // the portfolio company in the relationship record, with no competing identity.
        if (p.other.key === key) out[i] = { ...out[i]!, other: { ...p.other, ...(lpPerson ? { person } : {}) } };
        else if (!p.other.key && !p.other.handle && p.other.entityType !== 'org' && p.source && !p.source.includes('source not recorded')
          && norm(p.other.name) === name && identities.length <= 1
          && namesakes.length <= 1 && !namesakes.some(c => !matches.includes(c))
          && !/\(the firm[’']s tie\)/.test(p.basis) && firms.some(firm => affirms(p.basis, firm))) {
          out[i] = { ...p, other: { ...p.other, key, entityType: 'person', ...(lpPerson ? { person } : {}) } };
        }
      }
      out.push({ lp: key, ...(lpPerson ? { lpPerson } : {}),
        other: { type: 'ours', name: hub.name, key: hub.key, person: hub }, kind: 'portfolio', tier: 'B',
        tie: { kind: 'investor_founder', withUs: 'pl_founder' },
        source: reference(founder.source),
        basis: `${founder.name} is a documented founder of ${row.company.name}, a ${row.vehicle} portfolio company (${reference(row.source)}). PL network relationship; no meeting or intro consent is inferred.` });
    }
  }
  return out;
}
