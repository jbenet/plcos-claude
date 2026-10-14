/**
 * outreach_check_parties (docs/27 §4e) over REST, on invented data:
 *   - it needs the outreach read scope;
 *   - the team's own addresses come back internal, with nothing more said;
 *   - an address with an email claim is on file, with its pursuit; one with none is not_on_file;
 *   - a To-line send whose subject names an active vehicle the party is not in suggests add_lp for it; a copied-in one never;
 *   - nobody in the Affinity copy: not_in_affinity, with affinity_add_person and affinity_add_note;
 *   - nothing is written.
 */
import type { Check, Db } from './harness';
import { fixtures, outreachClient } from './outreach-api';

export async function outreachPartiesProperties(check: Check, db: Db) {
  const { resetWindows } = await import('../../lib/mcp/envelope');
  const { OUTREACH_READ } = await import('../../lib/outreach/scopes');
  const { READ_TOOLS } = await import('../../lib/mcp/tools');
  resetWindows();
  const call = await outreachClient();
  const { juan, fund, token, entity, pursuit } = await fixtures(db);
  const fundName = (await db.one<{ name: string; phase: string }>(`select name, phase from platform.vehicle where id = $1`, [fund.id]))!;
  const known = await entity('Invented Parties Known Person', 'person');
  await pursuit(known, fund.id, 'selected');
  await db.query(`insert into research.source_doc (doc_id, title, kind, origin, as_of, strength, supports, body)
    values ('props:parties', 'Invented record', 'crm', 'affinity', current_date, 'weak', 'Invented', '') on conflict do nothing`);
  await db.query(`insert into research.claim (entity_id, field, value, source, as_of, confidence) values ($1, 'email', 'known@invented-parties.example', 'props:parties', current_date, 'medium')`, [known]);

  const at = new Date().toISOString();
  const body = { parties: [
    { address: 'Known@Invented-Parties.example', sends: [{ at, subject: 'Hello' }] },
    { address: 'stranger@invented-parties.example', name: 'Invented Stranger', sends: [{ at, subject: `${fundName.name} — invented update`, to: true }] },
    { address: 'copied@invented-parties.example', sends: [{ at, subject: `${fundName.name} — invented update`, to: false }] },
    { address: juan.email, sends: [{ at }] },
  ] };
  const before = (await db.one<{ n: number }>(`select (select count(*) from strategy.pursuit) + (select count(*) from identity.entity) n`))!.n;
  const plain = await call(await token(juan, [...READ_TOOLS]), 'parties', {}, { method: 'POST', body });
  const r = await call(await token(juan, [...READ_TOOLS, OUTREACH_READ]), 'parties', {}, { method: 'POST', body });
  const after = (await db.one<{ n: number }>(`select (select count(*) from strategy.pursuit) + (select count(*) from identity.entity) n`))!.n;
  const by = new Map<string, any>((r.json?.data?.parties ?? []).map((p: any) => [p.address, p]));
  const k = by.get('known@invented-parties.example'), s = by.get('stranger@invented-parties.example');
  const c = by.get('copied@invented-parties.example'), me = by.get(String(juan.email).toLowerCase());
  const active = fundName.phase === 'active';
  check('Check parties: needs the outreach scope; internal addresses say nothing more; a claimed address is on file with its pursuit',
    plain.status === 403 && r.status === 200 && me?.internal === true && me.issues.join() === 'internal' && !me.onFile
    && k?.onFile?.entityId === known && k.onFile.matchedBy === 'claim' && k.pursuits.some((p: any) => p.vehicle === fund.slug && p.via === 'self')
    && !k.issues.includes('not_on_file') && !k.suggest.some((x: any) => x.action === 'add_lp'),
    `plain ${plain.status}, scoped ${r.status}; internal: ${me?.issues}; known: ${JSON.stringify({ onFile: k?.onFile?.matchedBy, pursuits: k?.pursuits })}`);
  check('Check parties: raise mail to an unknown suggests add_lp for that vehicle (To line only); nobody in Affinity suggests adding the person and a note; nothing is written',
    s?.issues.includes('not_on_file') && s.issues.includes('not_in_affinity') && s.raiseVehicles.includes(fund.slug)
    && s.suggest.some((x: any) => x.action === 'add_lp' && x.vehicle === fund.slug) === active
    && s.suggest.some((x: any) => x.action === 'affinity_add_person') && s.suggest.some((x: any) => x.action === 'affinity_add_note')
    && c?.raiseVehicles.length === 0 && !c.suggest.some((x: any) => x.action === 'add_lp') && c.suggest.some((x: any) => x.action === 'research')
    && r.json.data.counts.parties === 4 && r.json.data.counts.internal === 1 && before === after,
    `stranger: ${JSON.stringify({ issues: s?.issues, raise: s?.raiseVehicles, suggest: s?.suggest?.map((x: any) => x.action) })}; copied: ${c?.suggest?.map((x: any) => x.action)}; rows ${before}→${after}`);
}
