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

/**
 * outreach_add_research (docs/27 §5a), on invented data: a person goes into the research set on no vehicle, matched
 * first; a second request changes nothing; the research export takes them with no pursuit; undo takes it back.
 */
export async function outreachResearchProperties(check: Check, db: Db) {
  const { resetWindows } = await import('../../lib/mcp/envelope');
  const { OUTREACH_READ, OUTREACH_WRITE } = await import('../../lib/outreach/scopes');
  const { researchSet } = await import('../../lib/enrich/candidates');
  resetWindows();
  const call = await outreachClient();
  const { juan, token } = await fixtures(db);
  const rw = await token(juan, [OUTREACH_READ, OUTREACH_WRITE]);
  const ro = await token(juan, [OUTREACH_READ]);
  const body = { address: 'Quill@Invented-Research.example', name: 'Invented Quill Research', firm: 'Invented Research Partners', note: 'Invented: emailed about a talk.', source: 'props-reconcile', idempotencyKey: 'props-research-1' };
  const refused = await call(ro, 'research', {}, { method: 'POST', body });
  const r = await call(rw, 'research', {}, { method: 'POST', body });
  const id = r.json?.data?.entityId as string;
  const again = await call(rw, 'research', {}, { method: 'POST', body: { ...body, idempotencyKey: 'props-research-2' } });
  const pursuits = (await db.one<{ n: number }>(`select count(*)::int n from strategy.pursuit where entity_id = $1`, [id]))!.n;
  const claim = await db.one(`select 1 from research.claim where entity_id = $1 and field = 'email' and value = 'quill@invented-research.example'`, [id]);
  const inSet = (await researchSet()).some((c) => c.key === id && c.pursuits.length === 0);
  check('Research on no vehicle: needs outreach:write; adds the person with the address and a request, in no pipeline; a second request changes nothing; the research set takes them',
    refused.status === 403 && r.status === 200 && r.json.data.created === true && r.json.data.requested === true && pursuits === 0 && Boolean(claim)
    && again.status === 200 && again.json.data.entityId === id && again.json.data.requested === false && inSet,
    `read-only ${refused.status}; add ${r.status} ${JSON.stringify(r.json?.data ?? r.json)?.slice(0, 120)}; again requested=${again.json?.data?.requested}; pursuits ${pursuits}; in set ${inSet}`);
  const undo = await call(rw, 'research', { entityId: id }, { method: 'DELETE' });
  const left = await db.one<{ notes: number; retired: boolean }>(`select (select count(*)::int from research.note where entity_id = $1 and kind = 'research_request') notes,
    (select retired_at is not null from identity.entity where entity_id = $1) retired`, [id]);
  const twice = await call(rw, 'research', { entityId: id }, { method: 'DELETE' });
  check('Research on no vehicle: undo removes the request and retires the person it created; a second undo is refused',
    undo.status === 200 && left?.notes === 0 && left.retired === true && twice.status === 409,
    `undo ${undo.status} ${JSON.stringify(undo.json?.data ?? undo.json)?.slice(0, 120)}; notes left ${left?.notes}, retired ${left?.retired}; again ${twice.status}`);
}
