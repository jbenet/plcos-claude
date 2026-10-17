import type { PipelineRow } from '@/components/strategy/pipeline-model';
import { getDb } from '@/lib/db';
import { listEntities } from '@/modules/identity';
import { buildCache, liveRevisions } from '@/lib/build-cache';
import { listVehicles } from '@/modules/platform';
import { listAssessments } from '@/modules/fit';
import { capacityEstimate, spvMarks, strategicMark, strategicRecords, strategicScope, strategyOf, pursuitsOn, touchesOn, type StrategicGrade } from '@/modules/strategy';
import { config } from '@/config/deployment';
import { provisionalParts, provisionalScore } from '@/lib/strategy-score';
import type { Strategy } from '@/lib/enrich/strategy';
import { GRADE_LABEL, GRADE_SCORE } from '@/modules/fit/client';
import { shortDate } from '@/lib/time';
import {
  IMPLIED_LABEL, PASSED_BY_LABEL, RUNGS, RUNG_LABEL,
  impliedRung, isPseudoOrg, rungIndex, type Pursuit,
} from '@/modules/strategy';
import { READ_LABEL, touchpointSummaries, type TouchpointSummary } from '@/modules/meetings';
import { CLOSE_STATE_LABEL, closeStates } from '@/modules/pipeline';
import { blanketRestricted } from '@/modules/coordination';
import { readingsFor, type NoteReading } from '@/lib/connectors/affinity/readings';
import { laterFacts, shownRead } from '@/lib/reads';
import { onFile } from '@/lib/reconcile';

/**
 * The log has got ahead of the status: a meeting on record for an LP still at Selected or
 * earlier. Shown as a question — the status is a person's call, and it is never moved for them.
 */
function aheadOfStatus(p: Pursuit, s: TouchpointSummary): boolean {
  return (p.status === 'new' || p.status === 'sourcing' || p.status === 'selected' || p.status === 'connecting') && s.meetingDates.length > 0;
}

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);


/**
 * The first few flags, each cut short, and how many there are. The whole list is on the LP's page
 * and in the selection page's detail (scoreDetail); sending every flag of 2,000 LPs to the browser
 * made them the largest part of the page (issue 0083).
 */
const FLAGS_SENT = 3, FLAG_CHARS = 160;
function flags(all: string[]) {
  return { risks: all.slice(0, FLAGS_SENT).map((f) => (f.length > FLAG_CHARS ? `${f.slice(0, FLAG_CHARS - 1).trimEnd()}…` : f)), riskCount: all.length };
}

const strategyFor = strategyOf;
/** Both tables start from pursuits, never the sparse manual-factor table. */
export const pipelineData = buildCache(async (vehicleId: string) => {
  // One vehicle's pursuits and touchpoints are shared with its plan (pursuitsOn, touchesOn): one read each. Every
  // vehicle's list is those lists merged, not a read of all pursuits of its own: each plan starts the moment its
  // vehicle's pursuits are in, rather than after the whole list and a second read of its part (after a person's
  // write, all/pipeline waited 120 ms for the plans to begin; 17 Oct 2026).
  const vehicles = await listVehicles();
  const history = new Set(vehicles.filter(v => v.phase === 'historical').map(v => v.id));
  const lists = (vehicleId ? [vehicleId] : vehicles.map(v => v.id)).map(id => ({ id, list: pursuitsOn(id) }));
  const shown = lists.filter(l => vehicleId || !history.has(l.id));
  // One vehicle's plan and touchpoints start beside its pursuits, not after them: each asks the revision and then the
  // same pursuits (shared while they load), and waiting put those asks in the pool's queue behind every other read of a
  // rebuild (17 Oct 2026). Still only used when the vehicle has pursuits. Every vehicle's list keeps waiting, so an
  // empty vehicle's plan is never built.
  const sideBySide = <T,>(each: (id: string) => Promise<T>) =>
    Promise.all(shown.map(l => {
      const early = vehicleId ? each(l.id) : null;
      early?.catch(() => undefined); // used below, or not at all when the vehicle has no pursuits
      return l.list.then(list => (list.length ? early ?? each(l.id) : null));
    }));
  // Plans, people and touchpoints each need only the pursuits: they load side by side, and the plans
  // (the slowest, through each vehicle's strategy) are awaited last (performance pass, 8 Oct 2026).
  const planned = Promise.all([listAssessments(vehicleId || null), sideBySide(id => strategyFor(id))]);
  planned.catch(() => undefined); // awaited below; a failure there, not an unhandled rejection here
  const touches = sideBySide(id => touchesOn(id));
  touches.catch(() => undefined); // awaited below
  // In the order one read of them all gave (opened_at), before the sort below.
  const all = (await Promise.all(lists.map(l => l.list))).flat().sort((a, b) => a.openedAt.getTime() - b.openedAt.getTime());
  const pursuits = all.filter(p => vehicleId || !history.has(p.vehicleId));
  const pairs = pursuits.map((p) => ({ entityId: p.entityId, vehicleId: p.vehicleId }));
  const entityIds = [...new Set(pursuits.map((p) => p.entityId))];
  const db = await getDb();
  const touched = (async () => {
    // Each vehicle's touchpoints are cached with its plan; every vehicle's list merges them (keys never collide).
    const touchesBy = new Map((await touches).flatMap(m => (m ? [...m] : [])));
    const [sums, closes, restricted, readings, spv] = await Promise.all([
      touchpointSummaries(pairs, new Date(), touchesBy), closeStates(pairs), blanketRestricted(entityIds), readingsFor(entityIds),
      spvMarks(db, entityIds),
    ]);
    return { touchesBy, sums, closes, restricted, readings, spv };
  })();
  touched.catch(() => undefined);
  // Strategic value (issue 0120): each vehicle's field and, for an SPV, its company; then the records. Read beside the
  // entities and people, not after them: it needs only the pursuits, and waiting put it last on a rebuild's path
  // (~50 ms of 340 after a person's own change, 16 Oct 2026).
  const scopes = new Map(vehicles.map(v => [v.id, strategicScope(v, config.strategic.domains)]));
  const inView = [...new Set(pursuits.map(p => p.vehicleId))].map(id => scopes.get(id)!);
  const strategicP = strategicRecords(db, entityIds, inView.flatMap(x => [...x.terms, ...(x.company ? [x.company] : [])]));
  strategicP.catch(() => undefined); // awaited below
  // The LP is the committing unit (docs/23): an organisation's row names its people — its contacts on
  // this pursuit first, then everyone acting for it now — and a person's row names their firms. Asked of every LP,
  // beside the entities rather than after them (16 Oct 2026): each row reads only what fits its kind, so the extra
  // answers are never used, and a rebuild no longer waits on the entity types before it can start these.
  const linked = Promise.all([
    db.query<{ org_id: string; id: string; name: string; role: string }>(
      // Aliases first (identity.alias_pairs): index probes, not canonical_entity_id() on every affiliation.
      `select distinct o.canonical_id::text as org_id,
        e.entity_id::text as id, e.display_name as name, coalesce(a.role, '') as role
        from identity.alias_pairs($1::uuid[]) o join identity.affiliation a on a.org_entity=o.entity_id
        join identity.entity a_e on a_e.entity_id=a.person_entity
        join identity.entity e on e.entity_id=case when a_e.merged_into is null then a.person_entity else identity.canonical_entity_id(a.person_entity) end
        where a.ended_on is null
        order by name, id`, [entityIds]),
    db.query<{ pursuit_id: string; id: string; name: string; role: string }>(
      // Each person by key (lateral … offset 0), not a hash of every entity twice: the planner chose that for 40 contacts
      // (17 Oct 2026, Neurotech: 8.6 → 0.6 ms). The same goes for the firms below (6.6 → 3.0 ms).
      `select c.pursuit_id::text, e.entity_id::text id, e.display_name name, coalesce(c.role, '') role
         from strategy.pursuit_contact c
         cross join lateral (select case when c_e.merged_into is null then c_e.entity_id else identity.canonical_entity_id(c_e.entity_id) end person
           from identity.entity c_e where c_e.entity_id=c.person_entity offset 0) p
         join identity.entity e on e.entity_id=p.person
        where c.pursuit_id=any($1::uuid[]) order by c.created_at, name, id`, [pursuits.map(p => p.pursuitId)]),
    db.query<{ person: string; id: string; name: string; role: string | null }>(
      `select p.canonical_id::text person, o.entity_id::text id, o.display_name name, a.role
         from identity.alias_pairs($1::uuid[]) p
         cross join lateral (select a.org_entity, a.role, a.is_primary, a.as_of from identity.affiliation a
           where a.person_entity=p.entity_id and a.ended_on is null offset 0) a
         cross join lateral (select case when a_o.merged_into is null then a_o.entity_id else identity.canonical_entity_id(a_o.entity_id) end org
           from identity.entity a_o where a_o.entity_id=a.org_entity offset 0) x
         join identity.entity o on o.entity_id=x.org
        where o.entity_type<>'person' and o.retired_at is null
        order by 1, a.is_primary desc, a.as_of desc nulls last, o.entity_id`, [entityIds]),
  ]);
  linked.catch(() => undefined); // awaited below
  const entities = await listEntities(entityIds);
  const organisations = new Set(entities.filter(e => e.entityType !== 'person').map(e => e.entityId));
  const [people, contacts, affiliations] = await linked;
  const lpRow = new Map(pursuits.map(p => [`${p.entityId}:${p.vehicleId}`, p.pursuitId]));
  // Grouped once: a scan of every contact and affiliation per row was quadratic in the vehicle's size.
  const group = <T,>(rows: T[], key: (row: T) => string) => {
    const out = new Map<string, T[]>();
    for (const row of rows) { const k = key(row); const list = out.get(k); if (list) list.push(row); else out.set(k, [row]); }
    return out;
  };
  const contactsOf = group(contacts, (c) => c.pursuit_id), peopleOf = group(people, (a) => a.org_id);
  const peopleFor = (p: Pursuit): PipelineRow['people'] => {
    const out = new Map<string, PipelineRow['people'][number]>();
    for (const c of contactsOf.get(p.pursuitId) ?? []) if (!out.has(c.id)) out.set(c.id, { id: c.id, name: c.name, role: c.role, contact: true, individual: lpRow.get(`${c.id}:${p.vehicleId}`) ?? null });
    for (const a of peopleOf.get(p.entityId) ?? []) if (!out.has(a.id)) out.set(a.id, { id: a.id, name: a.name, role: a.role, contact: false, individual: lpRow.get(`${a.id}:${p.vehicleId}`) ?? null });
    return [...out.values()];
  };
  const firmsOf = new Map<string, Array<{ id: string; name: string; role: string | null }>>();
  for (const a of affiliations) {
    if (isPseudoOrg(a.name)) continue;
    const list = firmsOf.get(a.person) ?? [];
    if (!list.some(f => f.id === a.id)) list.push({ id: a.id, name: a.name, role: a.role });
    firmsOf.set(a.person, list);
  }
  const firmsFor = (p: Pursuit): PipelineRow['firms'] =>
    (firmsOf.get(p.entityId) ?? []).map(f => ({ ...f, lpRow: lpRow.get(`${f.id}:${p.vehicleId}`) ?? null }));
  const spvKind = new Set(vehicles.filter(v => v.kind === 'spv').map(v => v.id));
  const [strategicOn, { touchesBy, sums, closes, restricted, readings, spv }, [assessments, plans]] = await Promise.all([strategicP, touched, planned]);
  const strategies = new Map(plans.flatMap(plan => plan?.rows.map(r => [r.pursuit.pursuitId, r] as const) ?? []));
  const fit = new Map(assessments.map(a => [`${a.entityId}:${a.vehicleId}`, a]));
  const scoreFor = (p: Pursuit) => {
    const a = fit.get(`${p.entityId}:${p.vehicleId}`);
    const strategy = strategies.get(p.pursuitId);
    const suggestion = strategy?.suggestion;
    if (a?.dimensions.length) return { score: Math.round(a.weightedFit * 100), kind: 'Fit assessment', at: iso(a.updatedAt) };
    return { score: provisionalScore(suggestion?.data.scores), kind: strategy?.stale ? 'Provisional · stale' : 'Provisional', at: iso(suggestion ? new Date(suggestion.made_at) : null) };
  };
  const readsOf = new Map<string, NoteReading[]>();
  for (const r of readings) { const list = readsOf.get(r.entityId); if (list) list.push(r); else readsOf.set(r.entityId, [r]); }
  const sum = (p: Pursuit) => sums.get(`${p.entityId}:${p.vehicleId}`)!;

  // Furthest along first: by evidence, then meetings held, then what the source's word says
  // happened; then the most recently in touch, then the name. The table can re-sort by column.
  // Keys worked out once per row, and one collator: localeCompare per comparison was most of this sort.
  const byName = new Intl.Collator().compare;
  const keys = new Map(pursuits.map((p) => [p, {
    rung: rungIndex(p.rung), meetings: sum(p).meetingDates.length, implied: rungIndex(impliedRung(p.implied)), touch: sum(p).lastTouch?.getTime() ?? 0,
  }]));
  pursuits.sort((a, b) => {
    const x = keys.get(a)!, y = keys.get(b)!;
    return y.rung - x.rung || y.meetings - x.meetings || y.implied - x.implied || y.touch - x.touch || byName(a.entityName, b.entityName);
  });

  const rows: PipelineRow[] = pursuits.map((p) => {
    const s = sum(p);
    const reading = scoreFor(p);
    const plan = strategies.get(p.pursuitId);
    const assessment = fit.get(`${p.entityId}:${p.vehicleId}`);
    const c = closes.get(`${p.entityId}:${p.vehicleId}`);
    const read = shownRead(s.read, readsOf.get(p.entityId) ?? [], laterFacts(p, c ? [c] : []));
    // What the records support beside what the ladder has accepted (N57, docs/18).
    const file = onFile(p, touchesBy.get(`${p.entityId}:${p.vehicleId}`) ?? [], c ? [c] : []);
    const onFileRungs = new Set(file.climb.map((x) => x.rung));
    const beyond = assessment?.dimensions.find((d) => d.code === 'strategic_value');
    const w5 = plan?.suggestion?.data as Partial<Strategy> | undefined;
    const spvMark = spv.get(p.entityId)!;
    const strategic = strategicMark(scopes.get(p.vehicleId)!, {
      assessed: beyond ? { grade: beyond.grade as StrategicGrade, finding: beyond.finding, certainty: beyond.certainty, asOf: iso(beyond.asOf)?.slice(0, 10) ?? null } : null,
      prospect: strategicOn.prospects.get(`${p.entityId}:${p.vehicleId}`) ?? null,
      strategy: w5 ? { affinity: w5.scores?.affinity ?? null, askShape: w5.ask?.shape ?? null } : null,
      // The SPV stance's research quote is research text too: "two neurotech rounds" is a portfolio tie.
      // Only research: a derived mark's words are our own records ("In 2 of our SPVs: …") or a fixed label.
      texts: [...(strategicOn.texts.get(p.entityId) ?? []), ...(spvMark.why && spvMark.basis === 'research' ? [{ field: 'spv', value: spvMark.why, asOf: null }] : [])],
    });
    return {
      licensedCapacity: plan?.usingDakota ?? false,
      licensedStatusReason: p.source === 'dakota' && p.statusSource === 'rule',
      id: p.pursuitId,
      entityId: p.entityId,
      isOrg: organisations.has(p.entityId),
      people: organisations.has(p.entityId) ? peopleFor(p) : [],
      firms: organisations.has(p.entityId) ? [] : firmsFor(p),
      lpCapacity: organisations.has(p.entityId) ? 'organisation' : p.lpCapacity === 'personal' ? 'personal' : null,
      lpReview: organisations.has(p.entityId) ? null : p.lpReview,
      capacitySort: capacityEstimate(plan?.capacityBand),
      vehicleId: p.vehicleId,
      vehicleSlug: vehicles.find(v => v.id === p.vehicleId)!.slug,
      orgId: organisations.has(p.entityId) ? p.entityId : firmsOf.get(p.entityId)?.[0]?.id ?? null,
      score: reading.score,
      scoreKind: reading.kind,
      scoreAt: reading.at,
      priority: strategies.get(p.pursuitId)?.score?.priority ?? null,
      capacity: strategies.get(p.pursuitId)?.capacityBand ?? null,
      route: strategies.get(p.pursuitId)?.route?.count ?? null,
      ...flags([...(plan?.risks ?? []), ...(assessment && assessment.gateStatus !== 'clear' ? [assessment.diagnosis.statement] : [])]),
      list: plan?.suggestion?.data.list ?? null,
      nextKind: plan?.group ?? null,
      name: p.entityName,
      org: organisations.has(p.entityId) ? p.entityName : firmsOf.get(p.entityId)?.[0]?.name ?? null,
      // The row is the LP unit's own: its name leads, whoever it is (docs/23).
      orgFirst: organisations.has(p.entityId),
      headline: p.headline,
      vehicle: p.vehicleName,
      owner: p.ownerSaid ?? p.ownerName,
      status: p.status,
      ended: p.status === 'passed'
        ? [p.passedBy ? PASSED_BY_LABEL[p.passedBy] : 'Passed', p.statusReason?.replace(/_/g, ' ')].filter(Boolean).join(' · ')
        : null,
      next: p.nextStep ?? strategies.get(p.pursuitId)?.action ?? null,
      nextOn: iso(p.nextStepOn),
      said: p.source !== 'us' ? p.stageSaid : null,
      implied: p.implied.map((i) => IMPLIED_LABEL[i]),
      setHere: p.statusSource === 'us' && p.statusSetAt ? `set here ${shortDate(p.statusSetAt)}${p.statusSetByName ? ` by ${p.statusSetByName}` : ''}` : null,
      ahead: aheadOfStatus(p, s),
      doNotContact: restricted.has(p.entityId),
      spv: spvMark,
      spvVehicle: spvKind.has(p.vehicleId),
      strategic,
      money: c
        ? {
            state: CLOSE_STATE_LABEL[c.state], amount: c.exposure.amount, wired: c.wired, hard: c.exposure.track === 'hard',
            signedPer: c.state === 'signed' && c.signature
              ? c.signature.on ? shortDate(c.signature.on) : `per ${c.signature.bySource === 'affinity' ? 'Affinity' : c.signature.bySource}`
              : null,
          }
        : null,
      meetings: s.meetingDates.length,
      lastMeeting: iso(s.meetingDates[s.meetingDates.length - 1]),
      lastTouch: iso(s.lastTouch),
      waitingSince: iso(s.awaitingSince),
      read: read ? READ_LABEL[read.read] : null,
      readOn: iso(read?.on),
      readSuggested: Boolean(read?.suggested),
      readSuperseded: read?.superseded?.what ?? null,
      readOld: Boolean(read?.old),
      rung: rungIndex(p.rung),
      needs: rungIndex(p.rung) + 1 + file.climb.length,
      rungs: RUNGS.map((r) => {
        const ev = p.events.find((e) => e.rung === r);
        return ev ? (ev.evidenceKind === 'not_applicable' ? 'na' : 'on') : onFileRungs.has(r) ? 'file' : 'off';
      }),
      rungLabel: file.to
        ? `${p.rung ? `${RUNG_LABEL[p.rung]} · ` : ''}${RUNG_LABEL[file.to]} on file, not accepted`
        : p.rung ? RUNG_LABEL[p.rung] : 'Nothing on file',
    };
  });

  return { rows, onHistory: all.length - pursuits.length, asOf: new Date().toISOString() };
}, 16, liveRevisions);

const assessmentsFor = buildCache(async (vehicleId: string) => listAssessments(vehicleId));

export interface ScorePart { label: string; weight: number; value: number | null; level: string | null; basis: string | null }
export interface ScoreDetail {
  kind: 'fit' | 'provisional' | 'none';
  stale: boolean;
  at: string | null;
  parts: ScorePart[];
  angle: string | null;
  route: { via: string; tier: string; why: string } | null;
  ask: string | null;
  list: string | null;
  confidence: string | null;
  next: string | null;
  risks: string[];
}

const DETAIL_RECENT_MS = 60_000; // GUESS: see scoreDetail.

/**
 * Why one LP scores what it does, read when someone opens it on the selection page (issue 0089):
 * the fit assessment's graded dimensions where one exists, otherwise the proposed strategy's four
 * readings, each with the sentence it rests on. Read-only; null when the pursuit is not in the vehicle.
 */
export async function scoreDetail(vehicleId: string, pursuitId: string): Promise<ScoreDetail | null> {
  // The detail opens beside the list, most often on the next LP right after a move to Selected. That
  // move is a person's write, so the plans would rebuild first (0.7 s on the invented copy at the live
  // scale) though nothing about this LP changed: a build from the last minute answers, and the next one
  // runs behind it (performance pass, 8 Oct 2026). The minute is a guess.
  const [plan, assessments] = await Promise.all([strategyFor.recent(DETAIL_RECENT_MS, vehicleId), assessmentsFor.recent(DETAIL_RECENT_MS, vehicleId)]);
  const row = plan?.rows.find((r) => r.pursuit.pursuitId === pursuitId);
  if (!row) return null;
  const a = assessments.find((x) => x.entityId === row.pursuit.entityId && x.vehicleId === vehicleId);
  const data = (row.suggestion?.data ?? null) as Partial<Strategy> | null;
  const bases = data?.scores as Record<string, { basis?: string } | undefined> | undefined;
  let parts: ScorePart[];
  let kind: ScoreDetail['kind'];
  if (a?.dimensions.length) {
    kind = 'fit';
    const total = a.dimensions.reduce((n, d) => n + d.weightUs, 0) || 1;
    parts = a.dimensions.map((d) => ({ label: d.label, weight: d.weightUs / total, value: GRADE_SCORE[d.grade], level: GRADE_LABEL[d.grade], basis: d.finding || null }));
  } else {
    parts = provisionalParts(data?.scores).map((p) => ({ label: p.label, weight: p.weight, value: p.value, level: p.level, basis: bases?.[p.key]?.basis ?? null }));
    kind = provisionalScore(data?.scores) === null ? 'none' : 'provisional';
  }
  return {
    kind, stale: row.stale, parts,
    at: a?.dimensions.length ? iso(a.updatedAt) : iso(row.suggestion ? new Date(row.suggestion.made_at) : null),
    angle: data?.angle ?? null,
    route: data?.route ?? null,
    ask: data?.ask && data.ask.shape !== 'none yet' ? [data.ask.shape, data.ask.range].filter(Boolean).join(' · ') : null,
    list: data?.list ?? null,
    confidence: data?.confidence ?? null,
    next: row.action,
    risks: [...row.risks, ...(a && a.gateStatus !== 'clear' ? [a.diagnosis.statement] : [])],
  };
}
