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
  const { juan, fund, token, entity, pursuit } = await fixtures(db);
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
}
