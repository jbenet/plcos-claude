import type { PipelineRow } from '@/components/strategy/pipeline-model';
import { getDb } from '@/lib/db';
import { listEntities } from '@/modules/identity';
import { buildCache } from '@/lib/build-cache';
import { listVehicles } from '@/modules/platform';
import { listAssessments } from '@/modules/fit';
import { capacityEstimate, vehicleStrategy } from '@/modules/strategy';
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
  const vehicles = await listVehicles();
  const history = new Set(vehicles.filter(v => v.phase === 'historical').map(v => v.id));
  const all = await listPursuits(vehicleId || null);
  const pursuits = all.filter(p => vehicleId || !history.has(p.vehicleId));
  const [assessments, plans] = await Promise.all([
    listAssessments(vehicleId || null),
    Promise.all([...new Set(pursuits.map(p => p.vehicleId))].map(id => strategyFor(id))),
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
  const pairs = pursuits.map((p) => ({ entityId: p.entityId, vehicleId: p.vehicleId }));
  const entityIds = [...new Set(pursuits.map((p) => p.entityId))];
  const entities = await listEntities(entityIds);
  const organisations = new Set(entities.filter(e => e.entityType !== 'person').map(e => e.entityId));
  // The LP is the committing unit (docs/23): an organisation's row names its people — its contacts on
  // this pursuit first, then everyone acting for it now — and a person's row names their firms.
  const db = await getDb();
  const orgPursuits = pursuits.filter(p => organisations.has(p.entityId)).map(p => p.pursuitId);
  const personIds = entityIds.filter(id => !organisations.has(id));
  const [people, contacts, affiliations] = await Promise.all([
    db.query<{ org_id: string; id: string; name: string; role: string }>(
      `select distinct identity.canonical_entity_id(a.org_entity)::text as org_id,
        e.entity_id::text as id, e.display_name as name, coalesce(a.role, '') as role
        from identity.affiliation a join identity.entity e on e.entity_id=identity.canonical_entity_id(a.person_entity)
        where identity.canonical_entity_id(a.org_entity)=any($1::uuid[]) and a.ended_on is null
        order by name`, [[...organisations]]),
    db.query<{ pursuit_id: string; id: string; name: string; role: string }>(
      `select c.pursuit_id::text, e.entity_id::text id, e.display_name name, coalesce(c.role, '') role
         from strategy.pursuit_contact c join identity.entity e on e.entity_id=identity.canonical_entity_id(c.person_entity)
        where c.pursuit_id=any($1::uuid[]) order by c.created_at, name`, [orgPursuits]),
    db.query<{ person: string; id: string; name: string; role: string | null }>(
      `select identity.canonical_entity_id(a.person_entity)::text person, o.entity_id::text id, o.display_name name, a.role
         from identity.affiliation a join identity.entity o on o.entity_id=identity.canonical_entity_id(a.org_entity)
        where identity.canonical_entity_id(a.person_entity)=any($1::uuid[]) and a.ended_on is null
          and o.entity_type<>'person' and o.retired_at is null
        order by 1, a.is_primary desc, a.as_of desc nulls last`, [personIds]),
  ]);
  const lpRow = new Map(pursuits.map(p => [`${p.entityId}:${p.vehicleId}`, p.pursuitId]));
  const peopleFor = (p: Pursuit): PipelineRow['people'] => {
    const out = new Map<string, PipelineRow['people'][number]>();
    for (const c of contacts) if (c.pursuit_id === p.pursuitId && !out.has(c.id)) out.set(c.id, { id: c.id, name: c.name, role: c.role, contact: true, individual: lpRow.get(`${c.id}:${p.vehicleId}`) ?? null });
    for (const a of people) if (a.org_id === p.entityId && !out.has(a.id)) out.set(a.id, { id: a.id, name: a.name, role: a.role, contact: false, individual: lpRow.get(`${a.id}:${p.vehicleId}`) ?? null });
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
  const touchesBy = await touchpointsByPair(pairs);
  const [sums, closes, restricted, readings] = await Promise.all([
    touchpointSummaries(pairs, new Date(), touchesBy), closeStates(pairs), blanketRestricted(entityIds), readingsFor(entityIds),
  ]);
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
    return {
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
