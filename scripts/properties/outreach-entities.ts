/**
 * The send-to role and entities that are not LPs (docs/27 §5c; JuanMail 0173 and 0174), over REST, on invented data:
 *   - /contacts role send-to marks one address per LP, read back as entity.sendTo; a new one replaces the old; none clears;
 *   - /entities adds a company with its relation, matched first and never duplicated; a new relation replaces the old;
 *   - a person links to a company's team or an LP's assistant; an assistant of a non-LP is refused;
 *   - search returns the relation and a person's links; undo takes an add back.
 */
import type { Check, Db } from './harness';
import { fixtures, outreachClient } from './outreach-api';

export async function outreachEntitiesProperties(check: Check, db: Db) {
  const { resetWindows } = await import('../../lib/mcp/envelope');
  const { OUTREACH_READ, OUTREACH_WRITE } = await import('../../lib/outreach/scopes');
  resetWindows();
  const call = await outreachClient();
  const { juan, fund, spv, token, entity, pursuit } = await fixtures(db);
  const rw = await token(juan, [OUTREACH_READ, OUTREACH_WRITE, 'search']);
  const post = (op: string, body: Record<string, unknown>) => call(rw, op, {}, { method: 'POST', body });
  const evidence = { gmailMessageIds: ['19e2inventedentity'], words: 'INVENTED_EVIDENCE: named in a thread.' };

  // ── Send-to ──
  const lp = await entity('Invented SendTo Capital');
  const lpP = await pursuit(lp, fund.id, 'connecting');
  const first = await post('contacts', { pursuitId: lpP, email: 'Investments@Invented-SendTo.example', source: 'gmail', confirmedBy: 'juan', role: 'send-to' });
  const second = await post('contacts', { pursuitId: lpP, email: 'ir@invented-sendto.example', source: 'gmail', confirmedBy: 'juan', role: 'send-to' });
  const rows = (await db.one<{ n: number }>('select count(*)::int n from identity.send_to where entity_id = $1', [lp]))!.n;
  const read = await call(rw, 'contacts', { vehicle: fund.slug });
  const row = read.json?.data?.rows?.find?.((r: any) => r.pursuitId === lpP) ?? (Array.isArray(read.json?.data) ? read.json.data.find((r: any) => r.pursuitId === lpP) : null);
  const noEmail = await post('contacts', { pursuitId: lpP, phone: '+1 555 0100', source: 'gmail-signature', role: 'send-to' });
  check('Send-to: /contacts role send-to marks the address, a new one replaces the old (one row), and the contacts read gives entity.sendTo; a role without an address is refused',
    first.status === 200 && first.json.data.sendTo?.email === 'investments@invented-sendto.example' && first.json.data.sendTo.replaced === null
    && second.status === 200 && second.json.data.sendTo?.replaced === 'investments@invented-sendto.example' && rows === 1
    && row?.entity?.sendTo?.email === 'ir@invented-sendto.example' && row.entity.sendTo.setBy === 'juan' && noEmail.status === 400,
    `first ${first.status} ${JSON.stringify(first.json?.data?.sendTo ?? first.json)?.slice(0, 120)}; second ${second.status} replaced ${second.json?.data?.sendTo?.replaced}; rows ${rows}; read ${read.status} ${JSON.stringify(row?.entity ?? null)?.slice(0, 160)}; no email ${noEmail.status}`);
  // A replaced send-to stays recoverable (red team, 17 Oct 2026): the old address, who set it and when in the audit entry,
  // read back as the previous one, and put back through the same path; an autonomous replacement is the Mail desk's.
  const { previousSendTo } = await import('../../lib/outreach/entity-reads');
  const { setSendTo } = await import('../../lib/outreach/entities');
  const desk = (await db.one<{ id: string }>(`select id::text from platform.app_user where handle = 'mail-desk'`))!.id;
  const audit = await db.one<{ actor: string; detail: any }>(`select actor_id::text actor, detail from platform.audit_log
    where action = 'contact.send_to_set' and subject_id = $1 order by id desc limit 1`, [lp]);
  const before = await previousSendTo(lp, db);
  const agentSet = await call(rw, 'contacts', {}, { method: 'POST', headers: { 'x-autonomous': '1' },
    body: { pursuitId: lpP, email: 'deals@invented-sendto.example', source: 'gmail-signature', role: 'send-to' } });
  const agentAudit = await db.one<{ actor: string; detail: any }>(`select actor_id::text actor, detail from platform.audit_log
    where action = 'contact.send_to_set' and subject_id = $1 order by id desc limit 1`, [lp]);
  const agentPrev = await previousSendTo(lp, db);
  await db.transaction((tx) => setSendTo(tx, { entityId: lp, email: agentPrev!.email, claimId: null, actorId: juan.id, tokenId: null, autonomous: false, source: 'restored' }));
  const restored = await db.one<{ email: string; set_by: string }>('select email, set_by::text from identity.send_to where entity_id = $1', [lp]);
  check('Send-to: a replacement keeps the old address in history — its address, who set it and when in the audit entry, read back as the previous one — an autonomous one is the Mail desk\'s, and a person restores it through the same path',
    audit?.actor === juan.id && audit.detail.previous?.email === 'investments@invented-sendto.example' && audit.detail.previous.setBy === juan.id && !!audit.detail.previous.setAt
    && before?.email === 'investments@invented-sendto.example' && before.autonomous === false
    && agentSet.status === 200 && agentAudit?.actor === desk && agentAudit.detail.autonomous === true && typeof agentAudit.detail.tokenId === 'string'
    && agentAudit.detail.previous?.email === 'ir@invented-sendto.example' && agentPrev?.email === 'ir@invented-sendto.example' && agentPrev.autonomous === true
    && restored?.email === 'ir@invented-sendto.example' && restored.set_by === juan.id && (await previousSendTo(lp, db))?.email === 'deals@invented-sendto.example',
    `person: actor ${audit?.actor === juan.id ? 'juan' : audit?.actor}, previous ${JSON.stringify(audit?.detail?.previous ?? null)}, read ${before?.email}; agent ${agentSet.status}${agentSet.json?.error ? ` (${agentSet.json.error})` : ''}: actor ${agentAudit?.actor === desk ? 'desk' : agentAudit?.actor}, autonomous ${agentAudit?.detail?.autonomous}, previous ${agentAudit?.detail?.previous?.email}; restored ${restored?.email}`);
  const other = await post('contacts', { pursuitId: lpP, email: 'investments@invented-sendto.example', source: 'gmail', confirmedBy: 'juan', role: 'none' });
  const clear = await post('contacts', { pursuitId: lpP, email: 'ir@invented-sendto.example', source: 'gmail', confirmedBy: 'juan', role: 'none' });
  const left = (await db.one<{ n: number }>('select count(*)::int n from identity.send_to where entity_id = $1', [lp]))!.n;
  check('Send-to: role none clears it only when it names the send-to address',
    other.status === 200 && other.json.data.sendToCleared === false && clear.status === 200 && clear.json.data.sendToCleared === true && left === 0,
    `other ${other.status} ${other.json?.data?.sendToCleared}; clear ${clear.status} ${clear.json?.data?.sendToCleared}; left ${left}`);

  // ── Non-LP entities ──
  const co = await post('entities', { type: 'portfolio-company', name: 'Invented Neuroco Labs', email: 'hello@invented-neuroco.example', evidence, idempotencyKey: 'props-entity-co-1' });
  const coId = co.json?.data?.entityId as string;
  const coAgain = await post('entities', { type: 'portfolio-company', name: 'Invented Neuroco Labs', evidence, idempotencyKey: 'props-entity-co-2' });
  const coRelabel = await post('entities', { type: 'prospect-company', name: 'invented neuroco labs', evidence, idempotencyKey: 'props-entity-co-3' });
  const orgs = (await db.one<{ n: number }>(`select count(*)::int n from identity.entity where lower(display_name) = 'invented neuroco labs' and retired_at is null`))!.n;
  check('Entities: a company is added with its relation; the same name again is the same company, changing nothing; a new relation replaces the old; never a second record',
    co.status === 200 && co.json.data.created.entity === true && co.json.data.relation === 'portfolio-company' && co.json.data.type === 'org'
    && coAgain.status === 200 && coAgain.json.data.entityId === coId && coAgain.json.data.created.entity === false && coAgain.json.data.created.relation === false
    && coRelabel.status === 200 && coRelabel.json.data.entityId === coId && coRelabel.json.data.replacedRelation === 'portfolio-company' && orgs === 1,
    `add ${co.status} ${JSON.stringify(co.json?.data ?? co.json)?.slice(0, 140)}; again ${coAgain.status} ${coAgain.json?.data?.entityId === coId}; relabel ${coRelabel.status} ${coRelabel.json?.data?.replacedRelation}; records ${orgs}`);

  const team = await post('entities', { type: 'person', name: 'Invented Tess Team', email: 'tess@invented-neuroco.example', companyEntityId: coId, role: 'team', evidence, idempotencyKey: 'props-entity-team' });
  const teamId = team.json?.data?.entityId as string;
  const asst = await post('entities', { type: 'person', name: 'Invented Ada Assistant', email: 'ada@invented-sendto.example', companyEntityId: lp, role: 'assistant', evidence, idempotencyKey: 'props-entity-asst' });
  const asstOfNonLp = await post('entities', { type: 'person', name: 'Invented Nobody Assistant', companyEntityId: coId, role: 'assistant', evidence, idempotencyKey: 'props-entity-asst-2' });
  const roleOnCompany = await post('entities', { type: 'other', name: 'Invented Odd Org', companyEntityId: coId, role: 'team', evidence, idempotencyKey: 'props-entity-odd' });
  const primary = (await db.one<{ n: number }>(`select count(*)::int n from identity.affiliation where person_entity = any($1::uuid[]) and is_primary`, [[teamId, asst.json?.data?.entityId]]))!.n;
  check('Entities: a person links to a company\'s team or an LP\'s assistant (never as the LP\'s primary contact); an assistant of a non-LP, or a role on a company, is refused',
    team.status === 200 && team.json.data.link?.role === 'team' && team.json.data.link.entityId === coId
    && asst.status === 200 && asst.json.data.link?.role === 'assistant' && asst.json.data.link.entityId === lp && primary === 0
    && asstOfNonLp.status === 422 && roleOnCompany.status === 400,
    `team ${team.status} ${JSON.stringify(team.json?.data?.link ?? team.json)?.slice(0, 100)}; assistant ${asst.status} ${JSON.stringify(asst.json?.data?.link ?? asst.json)?.slice(0, 100)}; primary ${primary}; of non-LP ${asstOfNonLp.status}; role on company ${roleOnCompany.status}`);

  const sCo = await call(rw, 'search', { query: 'Invented Neuroco' });
  const sTeam = await call(rw, 'search', { query: 'Invented Tess Team' });
  const sLp = await call(rw, 'search', { query: 'Invented SendTo Capital' });
  const coHit = sCo.json?.data?.find?.((r: any) => r.entityId === coId);
  const teamHit = sTeam.json?.data?.find?.((r: any) => r.entityId === teamId);
  const lpHit = sLp.json?.data?.find?.((r: any) => r.entityId === lp);
  check('Entities: search returns each one\'s relation (a company\'s as set, an LP as lp) and a person\'s links',
    coHit?.relation === 'prospect-company' && coHit.type === 'org' && teamHit?.links?.[0]?.role === 'team' && teamHit.links[0].entityId === coId && lpHit?.relation === 'lp',
    `company ${sCo.status} ${JSON.stringify(coHit ?? sCo.json)?.slice(0, 120)}; person ${JSON.stringify(teamHit?.links ?? null)}; lp ${lpHit?.relation}`);

  const undo = await call(rw, 'entities', { entityId: teamId }, { method: 'DELETE' });
  const after = await db.one<{ links: number; retired: boolean }>(`select (select count(*)::int from identity.affiliation where person_entity = $1) links,
    (select retired_at is not null from identity.entity where entity_id = $1) retired`, [teamId]);
  const undoCo = await call(rw, 'entities', { entityId: coId }, { method: 'DELETE' });
  const rel = await db.one<{ relation: string }>('select relation from identity.entity_relation where entity_id = $1', [coId]);
  check('Entities: undo removes the link and retires the person it created; undoing a relabel puts the earlier relation back',
    undo.status === 200 && after?.links === 0 && after.retired === true && undoCo.status === 200 && rel?.relation === 'portfolio-company',
    `undo ${undo.status} ${JSON.stringify(undo.json?.data ?? undo.json)?.slice(0, 100)}; links ${after?.links}, retired ${after?.retired}; company undo ${undoCo.status}, relation ${rel?.relation}`);

  // Red team, 17 Oct 2026: a person linked to a company that is also on a vehicle the caller may not change is linked,
  // with their address unconfirmed and the answer saying so.
  const fundOnly = await token(juan, [OUTREACH_READ, OUTREACH_WRITE], [fund.id]);
  const twoCo = await entity('Invented Two Vehicle Firm');
  await pursuit(twoCo, fund.id, 'connecting'); await pursuit(twoCo, spv.id, 'selected');
  const linked = await call(fundOnly, 'entities', {}, { method: 'POST', body: { type: 'person', name: 'Invented Pia Twoveh', email: 'pia@invented-twoveh-firm.example',
    companyEntityId: twoCo, role: 'team', evidence, idempotencyKey: 'props-entity-twoveh' } });
  const piaClaim = await db.one<{ confidence: string; verifier: string | null }>(`select confidence::text, last_verified_by::text verifier from research.claim
    where entity_id = $1 and value = 'pia@invented-twoveh-firm.example'`, [linked.json?.data?.entityId ?? null]);
  check('Entities: a person linked to a company also on a vehicle the caller can\'t change is linked, the address unconfirmed (medium, no verifier), and the answer says so',
    linked.status === 200 && linked.json.data.link?.entityId === twoCo && typeof linked.json.data.unconfirmed === 'string' && piaClaim?.confidence === 'medium' && piaClaim.verifier === null,
    `add ${linked.status} ${JSON.stringify(linked.json?.data ?? linked.json)?.slice(0, 160)}; claim ${JSON.stringify(piaClaim)}`);

  // Undo of an add matched to a record already here takes back the alias it attached (red team, 17 Oct 2026).
  const otto = await entity('Invented Otto Existing', 'person');
  await db.query(`insert into research.source_doc (doc_id, title, kind, origin, as_of, strength, supports, body)
    values ('props:entities-otto', 'Invented record', 'crm', 'affinity', current_date, 'weak', 'Invented', '') on conflict do nothing`);
  await db.query(`insert into research.claim (entity_id, field, value, source, as_of, confidence) values ($1, 'email', 'office@invented-otto.example', 'props:entities-otto', current_date, 'medium')`, [otto]);
  const ottoAdd = await post('entities', { type: 'person', name: 'Invented Otto Existing', email: 'otto@invented-otto.example', evidence, idempotencyKey: 'props-entity-otto' });
  const aliasOf = () => db.one(`select 1 from identity.source_record where source = 'mail_desk' and source_id = 'email:otto@invented-otto.example'`);
  const aliasBefore = Boolean(await aliasOf());
  const ottoUndo = await call(rw, 'entities', { entityId: otto }, { method: 'DELETE' });
  const ottoAfter = await db.one<{ retired: boolean }>('select retired_at is not null retired from identity.entity where entity_id = $1', [otto]);
  check('Entities: undoing an add matched to a record already here removes the mail-desk alias it attached and keeps the record',
    ottoAdd.status === 200 && ottoAdd.json.data.entityId === otto && ottoAdd.json.data.created.entity === false && aliasBefore
    && ottoUndo.status === 200 && !(await aliasOf()) && ottoAfter?.retired === false,
    `add ${ottoAdd.status} ${JSON.stringify(ottoAdd.json?.data ?? ottoAdd.json)?.slice(0, 140)}; alias before ${aliasBefore}; undo ${ottoUndo.status}; alias after ${Boolean(await aliasOf())}; retired ${ottoAfter?.retired}`);
}
