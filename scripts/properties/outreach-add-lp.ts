/**
 * The mail desk adds an LP from mail (docs/27-outreach-api.md §5, 9 Oct 2026), through the real route handler, on
 * invented data:
 *   - a new person: added with their pursuit, a person's status as asked, the indicated amount through the update box's
 *     service, the address confirmed by the token's owner, the mail kept as ids and a sentence, one audit entry without words;
 *   - matched first: by the address on record, or by the resolver on the name with the address's domain as evidence;
 *     a person already on the vehicle changes nothing; a name that could be someone here is refused (409), nothing written;
 *   - autonomous: allowed, with the system's status (a person's later choice wins) and an unconfirmed address; an amount
 *     is refused (400);
 *   - the same idempotencyKey replays the first answer;
 *   - undo: within a day, by the same owner, while nothing has happened; refused after an update; the person it created
 *     is retired;
 *   - a server that is not the live one refuses with NOT_LIVE_REFUSAL and writes nothing.
 */
import type { Check, Db } from './harness';
import { fixtures, outreachClient } from './outreach-api';

export async function outreachAddLpProperties(check: Check, db: Db) {
  const { resetWindows } = await import('../../lib/mcp/envelope');
  const { OUTREACH_READ, OUTREACH_WRITE } = await import('../../lib/outreach/scopes');
  const { TOOLS } = await import('../../lib/mcp/tools');
  const { config } = await import('../../config/deployment');
  const { NOT_LIVE_REFUSAL } = await import('../../lib/mutation-policy');
  resetWindows();
  const call = await outreachClient();
  const { juan, fund, token, entity } = await fixtures(db);
  const rw = await token(juan, [OUTREACH_READ, OUTREACH_WRITE]);
  const ro = await token(juan, [OUTREACH_READ]);
  const desk = (await db.one<{ id: string }>(`select id::text from platform.app_user where handle = 'mail-desk'`))!;
  const post = (body: unknown, secret = rw) => call(secret, 'lps', {}, { method: 'POST', body });
  const agent = (body: unknown) => call(rw, 'lps', {}, { method: 'POST', body, headers: { 'x-autonomous': '1' } });
  const undo = (pursuitId: string, secret = rw) => call(secret, 'lps', { pursuitId }, { method: 'DELETE' });
  let n = 0;
  const add = (person: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
    vehicle: fund.slug, person, idempotencyKey: `props-add-lp-${++n}`,
    evidence: { gmailMessageIds: [`19e2invented${n}`], messageIds: [`<props-add-lp-${n}@mail.invented.example>`], words: 'INVENTED_EVIDENCE: Juan pitched the fund on Oct 2; they replied Oct 4 considering it.' },
    ...extra,
  });
  await db.query(`insert into research.source_doc (doc_id, title, kind, origin, as_of, strength, supports, body)
    values ('affinity:props-add-lp', 'Invented Affinity record', 'crm', 'affinity', current_date, 'weak', 'Invented', '') on conflict do nothing`);

  check('Outreach add-LP: outreach_add_lp and outreach_undo_add_lp are registered as write-guarded, behind outreach:write, needing no ticket',
    ['outreach_add_lp', 'outreach_undo_add_lp'].every((name) => { const t = TOOLS.find((x) => x.name === name); return t?.policy.risk === 'write-guarded' && t.policy.scopes.includes(OUTREACH_WRITE) && t.policy.ticket === 'none'; }),
    TOOLS.filter((t) => /add_lp/.test(t.name)).map((t) => `${t.name}:${t.policy.risk}`).join(', '));

  // ── A new person, a person's call ─────────────────────────────────────────────────────
  const newBody = add({ name: 'Invented Mail Newperson', nameAsWritten: '発明 新人', email: 'New.Person@Invented-Newfirm.example', firm: 'Invented Newfirm' },
    { status: 'discussing', indicated: { low: 350000, on: '2026-10-04' } });
  const a1 = await post(newBody);
  const id1 = a1.json?.data?.pursuitId as string | undefined;
  const p1 = id1 ? await db.one<{ status: string; status_source: string; source: string; set_by: string; entity: string; retired: boolean }>(`select p.status::text, p.status_source, p.source,
    p.status_set_by::text set_by, p.entity_id::text entity, e.retired_at is not null retired from strategy.pursuit p join identity.entity e on e.entity_id = p.entity_id where p.pursuit_id = $1`, [id1]) : null;
  const claim1 = p1 ? await db.one<{ value: string; verifier: string | null; confidence: string; source: string }>(`select value, last_verified_by::text verifier, confidence::text, source from research.claim
    where entity_id = $1 and field = 'email' and superseded_by is null`, [p1.entity]) : null;
  const ind1 = id1 ? await db.one<{ low: number; ind_day: string }>(`select low::float8 low, indicated_on::text ind_day from pipeline.indication where pursuit_id = $1`, [id1]) : null;
  const note1 = p1 ? await db.one<{ data: Record<string, any> }>(`select data from research.note where entity_id = $1 and kind = 'context' and data->>'source' = 'mail_desk'`, [p1.entity]) : null;
  const audit1 = id1 ? await db.one<{ detail: Record<string, any> }>(`select detail from platform.audit_log where action = 'outreach.lp_added' and subject_id = $1`, [id1]) : null;
  const ro1 = await post(add({ name: 'Invented Mail Readonly', email: 'ro@invented-ro.example' }), ro);
  check('Outreach add-LP: a new person is added with their pursuit — a person\'s status as asked, the amount through the update box\'s service, the address confirmed by the owner, the mail kept as ids and a sentence; the audit keeps no words; a read token cannot',
    a1.status === 200 && a1.json.data.created?.entity === true && a1.json.data.created?.pursuit === true && a1.json.data.status === 'discussing' && a1.json.data.autonomous === false
    && p1?.status === 'discussing' && p1.status_source === 'us' && p1.source === 'mail_desk' && p1.set_by === juan.id && !p1.retired
    && claim1?.value === 'new.person@invented-newfirm.example' && claim1.verifier === juan.id && claim1.confidence === 'high' && claim1.source === `gmail:${juan.handle}`
    && ind1?.low === 350000 && ind1.ind_day === '2026-10-04'
    && note1?.data.gmailMessageIds?.[0] === newBody.evidence.gmailMessageIds[0] && note1.data.messageIds?.[0] === newBody.evidence.messageIds[0] && note1.data.nameAsWritten === '発明 新人'
    && !!audit1 && !JSON.stringify(audit1.detail).includes('INVENTED_EVIDENCE') && audit1.detail.created?.entity === true && ro1.status === 403,
    `${a1.status}${a1.json?.error ? ` (${a1.json.error})` : ''} ${JSON.stringify(a1.json?.data?.created)}; pursuit ${JSON.stringify(p1)}; claim ${JSON.stringify(claim1)}; indication ${JSON.stringify(ind1)}; note ids ${JSON.stringify(note1?.data.gmailMessageIds)}; audit ${audit1 ? (JSON.stringify(audit1.detail).includes('INVENTED_EVIDENCE') ? 'HAS WORDS' : 'no words') : 'MISSING'}; read token ${ro1.status}`);

  // ── The same key again: the first answer ──────────────────────────────────────────────
  const count = async () => db.one<{ p: number; e: number; c: number }>(`select (select count(*)::int from strategy.pursuit) p, (select count(*)::int from identity.entity) e,
    (select count(*)::int from research.claim) c`);
  const before = await count();
  const a1b = await post(newBody);
  check('Outreach add-LP: the same idempotencyKey replays the first answer and writes nothing',
    a1b.status === 200 && a1b.json.data.pursuitId === id1 && a1b.json.data.created?.pursuit === true && JSON.stringify(await count()) === JSON.stringify(before),
    `${a1b.status} ${a1b.json?.data?.pursuitId === id1 ? 'same pursuit' : 'ANOTHER'}; counts ${JSON.stringify(before)} → ${JSON.stringify(await count())}`);

  // ── Matched by the address on record; then already on the vehicle: no change ───────────
  const known = await entity('Invented Mail Known Person', 'person');
  await db.query(`insert into research.claim (entity_id, field, value, source, as_of, confidence) values ($1, 'email', 'Known@Invented-Known.example', 'affinity:props-add-lp', current_date, 'medium')`, [known]);
  const m1 = await post(add({ name: 'K. Invented-Known', email: 'known@invented-known.example' }));
  const before2 = await count();
  const m2 = await post(add({ name: 'Invented Mail Known Person', email: 'known@invented-known.example' }, { status: 'selected' }));
  const after2 = await count();
  const m2status = m1.json?.data?.pursuitId ? await db.one<{ s: string }>('select status::text s from strategy.pursuit where pursuit_id = $1', [m1.json.data.pursuitId]) : null;
  check('Outreach add-LP: a person whose address is on record is that person (no new record, whatever the name); already on the vehicle, nothing changes and the answer names the pursuit',
    m1.status === 200 && m1.json.data.entityId === known && m1.json.data.created?.entity === false && m1.json.data.created?.pursuit === true
    && m2.status === 200 && m2.json.data.pursuitId === m1.json.data.pursuitId && m2.json.data.created?.pursuit === false && m2.json.data.created?.entity === false
    && JSON.stringify(before2) === JSON.stringify(after2) && m2status?.s === 'connecting',
    `match ${m1.status}${m1.json?.error ? ` (${m1.json.error})` : ''} → ${m1.json?.data?.entityId === known ? 'the known person' : 'ANOTHER'}; again ${m2.status} created ${JSON.stringify(m2.json?.data?.created)}; counts ${JSON.stringify(before2)} → ${JSON.stringify(after2)}; status ${m2status?.s}`);

  // ── Matched by the resolver: the same name with the address's domain on record ─────────
  const domain = await entity('Invented Mail Domain Person', 'person');
  await db.query(`insert into research.claim (entity_id, field, value, source, as_of, confidence) values ($1, 'email', 'old@invented-domainfirm.example', 'affinity:props-add-lp', current_date, 'medium')`, [domain]);
  const r1 = await post(add({ name: 'Invented Mail Domain Person', email: 'new@invented-domainfirm.example' }));
  check('Outreach add-LP: with no address on record, the resolver matches the name with the address\'s domain as evidence (resolveEntity), never a second record',
    r1.status === 200 && r1.json.data.entityId === domain && r1.json.data.created?.entity === false,
    `${r1.status}${r1.json?.error ? ` (${r1.json.error})` : ''} → ${r1.json?.data?.entityId === domain ? 'the same person' : 'ANOTHER'}`);

  // ── A name that could be someone here: refused, nothing written ────────────────────────
  await entity('Invented Mail Twin', 'person');
  await entity('Invented Mail Twin', 'person');
  const before3 = await count();
  const t1 = await post(add({ name: 'Invented Mail Twin', email: 'twin@invented-twinfirm.example' }));
  const after3 = await count();
  const pm = await db.one<{ n: number }>(`select count(*)::int n from identity.possible_match pm join identity.entity e on e.entity_id in (pm.left_entity, pm.right_entity) where e.display_name = 'Invented Mail Twin'`);
  check('Outreach add-LP: a name that could be someone already here, with no evidence that picks one, is refused (409) naming the candidates; nothing is written',
    t1.status === 409 && /Invented Mail Twin; Invented Mail Twin/.test(t1.json?.error ?? '') && /Nothing was written/.test(t1.json?.error ?? '')
    && JSON.stringify(before3) === JSON.stringify(after3) && pm?.n === 0,
    `${t1.status}: ${String(t1.json?.error).slice(0, 160)}; counts ${JSON.stringify(before3)} → ${JSON.stringify(after3)}; possible matches ${pm?.n}`);

  // ── Autonomous: the system's status, an unconfirmed address, no amount ─────────────────
  const auto400 = await agent(add({ name: 'Invented Mail Auto Amount', email: 'amount@invented-auto.example' }, { indicated: { low: 100000 } }));
  const autoBody = add({ name: 'Invented Mail Autoperson', email: 'auto@invented-autofirm.example' });
  const au = await agent(autoBody);
  const idA = au.json?.data?.pursuitId as string | undefined;
  const pA = idA ? await db.one<{ status: string; status_source: string; set_by: string; reason: string; human: boolean; entity: string }>(`select status::text, status_source, status_set_by::text set_by,
    status_reason reason, strategy.pursuit_has_human_status(pursuit_id) human, entity_id::text entity from strategy.pursuit where pursuit_id = $1`, [idA]) : null;
  const claimA = pA ? await db.one<{ verifier: string | null; verified: string | null }>(`select last_verified_by::text verifier, last_verified_at::text verified from research.claim where entity_id = $1 and field = 'email'`, [pA.entity]) : null;
  const noAmount = await db.one<{ n: number }>(`select count(*)::int n from identity.entity where display_name = 'Invented Mail Auto Amount'`);
  check('Outreach add-LP: an autonomous call may add, but its status is the system\'s (rule, set by the Mail desk actor, no person\'s), its address unconfirmed and marked as the desk\'s own; an amount is refused (400) and nothing written',
    auto400.status === 400 && noAmount?.n === 0 && au.status === 200 && au.json.data.autonomous === true && au.json.data.status === 'connecting'
    && pA?.status === 'connecting' && pA.status_source === 'rule' && pA.set_by === desk.id && pA.human === false && /mail desk on its own/.test(pA.reason)
    && claimA?.verifier === null && claimA.verified === null,
    `amount ${auto400.status}: ${String(auto400.json?.error).slice(0, 80)}; add ${au.status}${au.json?.error ? ` (${au.json.error})` : ''}; pursuit ${JSON.stringify(pA)}; claim ${JSON.stringify(claimA)}`);

  // ── Undo ──────────────────────────────────────────────────────────────────────────────
  const u1 = idA ? await undo(idA) : null;
  const gone = idA ? await db.one<{ p: number; retired: boolean; claims: number }>(`select (select count(*)::int from strategy.pursuit where pursuit_id = $1) p,
    (select retired_at is not null from identity.entity where entity_id = $2) retired, (select count(*)::int from research.claim where entity_id = $2) claims`, [idA, pA!.entity]) : null;
  const u1again = idA ? await undo(idA) : null;
  // Re-adding the same address afterwards creates a fresh person: the retired one does not match.
  const readd = await agent(add({ name: 'Invented Mail Autoperson', email: 'auto@invented-autofirm.example' }));
  check('Outreach add-LP: undo removes a pursuit this endpoint created, with its address and evidence, and retires the person it created when nothing else refers to them; a second undo is refused',
    u1?.status === 200 && u1.json.data.removed?.pursuit === true && u1.json.data.removed?.entity === true && gone?.p === 0 && gone.retired === true && gone.claims === 0
    && u1again?.status === 409 && readd.status === 200 && readd.json.data.created?.entity === true && readd.json.data.entityId !== pA?.entity,
    `undo ${u1?.status}${u1?.json?.error ? ` (${u1.json.error})` : ''} ${JSON.stringify(u1?.json?.data?.removed)}; after ${JSON.stringify(gone)}; again ${u1again?.status}; re-add ${readd.status} ${readd.json?.data?.entityId !== pA?.entity ? 'a new person' : 'THE RETIRED ONE'}`);

  // A person's add with an amount, undone at once: the amount and its update go too; a person who was already here stays.
  const withAmount = await post(add({ name: 'Invented Mail Amount Undo', email: 'amount@invented-undo.example' }, { indicated: { low: 250000 } }));
  const idW = withAmount.json?.data?.pursuitId as string | undefined;
  const uW = idW ? await undo(idW) : null;
  const leftW = idW ? await db.one<{ i: number; u: number }>(`select (select count(*)::int from pipeline.indication where pursuit_id = $1) i,
    (select count(*)::int from strategy.pursuit_update where pursuit_id = $1) u`, [idW]) : null;
  const uKnown = m1.json?.data?.pursuitId ? await undo(m1.json.data.pursuitId) : null;
  const knownKept = await db.one<{ retired: boolean; claims: number }>(`select retired_at is not null retired, (select count(*)::int from research.claim where entity_id = $1) claims
    from identity.entity where entity_id = $1`, [known]);
  check('Outreach add-LP: undoing a person\'s add removes the amount and update it recorded; undoing an add for a person already here keeps them and their address on record',
    uW?.status === 200 && leftW?.i === 0 && leftW.u === 0 && uKnown?.status === 200 && uKnown.json.data.removed?.entity === false && knownKept?.retired === false && knownKept.claims === 1,
    `amount undo ${uW?.status}${uW?.json?.error ? ` (${uW.json.error})` : ''}, left ${JSON.stringify(leftW)}; known undo ${uKnown?.status}${uKnown?.json?.error ? ` (${uKnown.json.error})` : ''} ${JSON.stringify(uKnown?.json?.data?.removed)}; known ${JSON.stringify(knownKept)}`);

  const upd = id1 ? await call(rw, 'update', {}, { method: 'POST', body: { pursuitId: id1, words: 'Invented: a call is being set.', idempotencyKey: 'props-add-lp-update-1' } }) : null;
  const u2 = id1 ? await undo(id1) : null;
  const still = id1 ? await db.one<{ n: number }>('select count(*)::int n from strategy.pursuit where pursuit_id = $1', [id1]) : null;
  const existingP = (await db.one<{ id: string }>(`select pursuit_id::text id from strategy.pursuit where source is distinct from 'mail_desk' and vehicle_id = $1 limit 1`, [fund.id]))?.id;
  const u3 = existingP ? await undo(existingP) : null;
  check('Outreach add-LP: undo is refused (409, saying what happened) once anything has happened on the LP — here an update — and is 404 for a pursuit this endpoint did not create',
    upd?.status === 200 && u2?.status === 409 && /happened/.test(u2.json?.error ?? '') && /update/.test(u2.json?.error ?? '') && still?.n === 1 && u3?.status === 404,
    `update ${upd?.status}; undo ${u2?.status}: ${String(u2?.json?.error).slice(0, 200)}; pursuit ${still?.n ? 'kept' : 'REMOVED'}; another's pursuit ${u3?.status}`);

  // ── Not the live server: refused, nothing written ─────────────────────────────────────
  const original = { ...config.data };
  const before4 = await count();
  let nl: Awaited<ReturnType<typeof post>> | null = null, nlUndo: Awaited<ReturnType<typeof post>> | null = null;
  try {
    Object.assign(config.data, { profile: 'real', copyTakenAt: '2026-10-09T00:00:00Z' });
    nl = await post(add({ name: 'Invented Mail Preview', email: 'preview@invented-preview.example' }));
    nlUndo = id1 ? await undo(id1) : null;
  } finally {
    Object.assign(config.data, original);
  }
  const reserved = await db.one<{ n: number }>(`select count(*)::int n from email.outreach_request where op = 'lps' and request_key like $1`, [`%props-add-lp-${n}`]);
  check('Outreach add-LP: a server that is not the live one refuses an add and an undo with NOT_LIVE_REFUSAL (403) and writes nothing, not even the request key',
    nl?.status === 403 && nl.json?.error === NOT_LIVE_REFUSAL && nlUndo?.status === 403 && JSON.stringify(before4) === JSON.stringify(await count()) && reserved?.n === 0,
    `add ${nl?.status}: ${String(nl?.json?.error).slice(0, 80)}; undo ${nlUndo?.status}; key reserved ${reserved?.n}`);
}
