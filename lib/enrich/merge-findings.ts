import type { Finding } from './schema';

/**
 * One LP's findings, merged (7 Oct 2026). The 30 Sep–7 Oct refreshes were written under canonical keys beside the older
 * alias findings and replaced them rather than adding to them: in 6 of 10 LPs in one batch the only evidence of the LP's
 * own money (angel checks, holdings) was in the older file, so W5 read "operator" and "capacity unknown". The newest
 * finding stays the record; each fact and connection an older one held and it lacks is added, with its own source.
 * Nothing it says is changed. The merge is a dated correction, so strategies written before it are read again.
 */
export function mergeFindings(newest: Finding, older: Finding[], at: string, by: string): { merged: Finding; facts: number; connections: number } {
  const text = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v ?? '')).toLowerCase().replace(/\s+/g, ' ').trim();
  const factKey = (f: { field?: string; value?: unknown }) => `${f.field ?? ''}|${text(f.value)}`;
  const connKey = (c: { to?: string; kind?: string }) => `${text(c.to)}|${c.kind ?? ''}`;
  const haveFacts = new Set((newest.facts ?? []).map(factKey));
  const haveConns = new Set((newest.connections ?? []).map(connKey));
  const facts = [...(newest.facts ?? [])], connections = [...(newest.connections ?? [])];
  const from: string[] = [];
  for (const o of [...older].sort((a, b) => b.researched.at.localeCompare(a.researched.at))) {
    let took = false;
    for (const f of o.facts ?? []) if (!haveFacts.has(factKey(f))) { haveFacts.add(factKey(f)); facts.push(f); took = true; }
    for (const c of o.connections ?? []) if (!haveConns.has(connKey(c))) { haveConns.add(connKey(c)); connections.push(c); took = true; }
    if (took) from.push(`${o.key} (${o.researched.at.slice(0, 10)})`);
  }
  const addedFacts = facts.length - (newest.facts ?? []).length, addedConns = connections.length - (newest.connections ?? []).length;
  if (!addedFacts && !addedConns) return { merged: newest, facts: 0, connections: 0 };
  const merged: Finding = {
    ...newest, facts, ...(connections.length ? { connections } : {}),
    researched: { ...newest.researched, corrected: [...(Array.isArray(newest.researched.corrected) ? newest.researched.corrected : []), {
      at, by, what: `merged ${addedFacts} ${addedFacts === 1 ? 'fact' : 'facts'} and ${addedConns} ${addedConns === 1 ? 'connection' : 'connections'} from the older finding${from.length === 1 ? '' : 's'} ${from.join(', ')} that this one no longer carried; the profile is unchanged, for W5 to read against them`,
    }] },
  };
  return { merged, facts: addedFacts, connections: addedConns };
}
