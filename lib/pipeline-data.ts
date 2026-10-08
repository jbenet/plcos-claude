import type { PipelineRow } from '@/components/strategy/pipeline-model';
import { getDb } from '@/lib/db';
import { listEntities } from '@/modules/identity';
import { buildCache } from '@/lib/build-cache';
import { listVehicles } from '@/modules/platform';
import { listAssessments } from '@/modules/fit';
import { capacityEstimate, spvMarks, strategicMark, strategicRecords, strategicScope, vehicleStrategy, type StrategicGrade } from '@/modules/strategy';
import { config } from '@/config/deployment';
import { provisionalParts, provisionalScore } from '@/lib/strategy-score';
import type { Strategy } from '@/lib/enrich/strategy';
import { GRADE_LABEL, GRADE_SCORE } from '@/modules/fit/client';
import { shortDate } from '@/lib/time';
import {
  IMPLIED_LABEL, PASSED_BY_LABEL, RUNGS, RUNG_LABEL,
  impliedRung, isPseudoOrg, listPursuits, rungIndex, type Pursuit,
} from '@/modules/strategy';
import { READ_LABEL, touchpointSummaries, touchpointsByPair, type TouchpointSummary } from '@/modules/meetings';
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

const strategyFor = buildCache(async (vehicleId: string) => vehicleStrategy(vehicleId));
/** Both tables start from pursuits, never the sparse manual-factor table. */
export const pipelineData = buildCache(async (vehicleId: string) => {
  const [vehicles, all] = await Promise.all([listVehicles(), listPursuits(vehicleId || null)]);
  const history = new Set(vehicles.filter(v => v.phase === 'historical').map(v => v.id));
  const pursuits = all.filter(p => vehicleId || !history.has(p.vehicleId));
  // Plans, people and touchpoints each need only the pursuits: they load side by side, and the plans
  // (the slowest, through each vehicle's strategy) are awaited last (performance pass, 8 Oct 2026).
  const planned = Promise.all([
    listAssessments(vehicleId || null),
    Promise.all([...new Set(pursuits.map(p => p.vehicleId))].map(id => strategyFor(id))),
  ]);
  planned.catch(() => undefined); // awaited below; a failure there, not an unhandled rejection here
  const pairs = pursuits.map((p) => ({ entityId: p.entityId, vehicleId: p.vehicleId }));
  const entityIds = [...new Set(pursuits.map((p) => p.entityId))];
  const db = await getDb();
  const touched = (async () => {
    const touchesBy = await touchpointsByPair(pairs);
    const [sums, closes, restricted, readings, spv] = await Promise.all([
      touchpointSummaries(pairs, new Date(), touchesBy), closeStates(pairs), blanketRestricted(entityIds), readingsFor(entityIds),
      spvMarks(db, entityIds),
    ]);
    return { touchesBy, sums, closes, restricted, readings, spv };
  })();
  touched.catch(() => undefined);
  const entities = await listEntities(entityIds);
  const organisations = new Set(entities.filter(e => e.entityType !== 'person').map(e => e.entityId));
  // The LP is the committing unit (docs/23): an organisation's row names its people — its contacts on
  // this pursuit first, then everyone acting for it now — and a person's row names their firms.
  const orgPursuits = pursuits.filter(p => organisations.has(p.entityId)).map(p => p.pursuitId);
  const personIds = entityIds.filter(id => !organisations.has(id));
  const [people, contacts, affiliations] = await Promise.all([
    db.query<{ org_id: string; id: string; name: string; role: string }>(
      // Aliases first (identity.alias_pairs): index probes, not canonical_entity_id() on every affiliation.
      `select distinct o.canonical_id::text as org_id,
        e.entity_id::text as id, e.display_name as name, coalesce(a.role, '') as role
        from identity.alias_pairs($1::uuid[]) o join identity.affiliation a on a.org_entity=o.entity_id
        join identity.entity e on e.entity_id=identity.canonical_entity_id(a.person_entity)
        where a.ended_on is null
        order by name`, [[...organisations]]),
    db.query<{ pursuit_id: string; id: string; name: string; role: string }>(
      `select c.pursuit_id::text, e.entity_id::text id, e.display_name name, coalesce(c.role, '') role
         from strategy.pursuit_contact c join identity.entity e on e.entity_id=identity.canonical_entity_id(c.person_entity)
        where c.pursuit_id=any($1::uuid[]) order by c.created_at, name`, [orgPursuits]),
    db.query<{ person: string; id: string; name: string; role: string | null }>(
      `select p.canonical_id::text person, o.entity_id::text id, o.display_name name, a.role
         from identity.alias_pairs($1::uuid[]) p join identity.affiliation a on a.person_entity=p.entity_id
         join identity.entity o on o.entity_id=identity.canonical_entity_id(a.org_entity)
        where a.ended_on is null and o.entity_type<>'person' and o.retired_at is null
        order by 1, a.is_primary desc, a.as_of desc nulls last`, [personIds]),
  ]);
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
  // Strategic value (issue 0120): each vehicle's field and, for an SPV, its company; then the records.
  const scopes = new Map(vehicles.map(v => [v.id, strategicScope(v, config.strategic.domains)]));
  const inView = [...new Set(pursuits.map(p => p.vehicleId))].map(id => scopes.get(id)!);
  const [strategicOn, { touchesBy, sums, closes, restricted, readings, spv }, [assessments, plans]] = await Promise.all([
    strategicRecords(db, entityIds, inView.flatMap(x => [...x.terms, ...(x.company ? [x.company] : [])])), touched, planned,
  ]);
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
  for (const r of readings) readsOf.set(r.entityId, [...(readsOf.get(r.entityId) ?? []), r]);
  const sum = (p: Pursuit) => sums.get(`${p.entityId}:${p.vehicleId}`)!;

  // Furthest along first: by evidence, then meetings held, then what the source's word says
  // happened; then the most recently in touch, then the name. The table can re-sort by column.
  pursuits.sort(
    (a, b) =>
      rungIndex(b.rung) - rungIndex(a.rung) ||
      sum(b).meetingDates.length - sum(a).meetingDates.length ||
      rungIndex(impliedRung(b.implied)) - rungIndex(impliedRung(a.implied)) ||
      (sum(b).lastTouch?.getTime() ?? 0) - (sum(a).lastTouch?.getTime() ?? 0) ||
      a.entityName.localeCompare(b.entityName),
  );

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
});

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

/**
 * Why one LP scores what it does, read when someone opens it on the selection page (issue 0089):
 * the fit assessment's graded dimensions where one exists, otherwise the proposed strategy's four
 * readings, each with the sentence it rests on. Read-only; null when the pursuit is not in the vehicle.
 */
export async function scoreDetail(vehicleId: string, pursuitId: string): Promise<ScoreDetail | null> {
  const [plan, assessments] = await Promise.all([strategyFor(vehicleId), assessmentsFor(vehicleId)]);
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
