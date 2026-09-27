import type { PipelineRow } from '@/components/strategy/PipelineTable';
import { getDb } from '@/lib/db';
import { listEntities } from '@/modules/identity';
import { buildCache } from '@/lib/build-cache';
import { listVehicles } from '@/modules/platform';
import { listAssessments } from '@/modules/fit';
import { capacityEstimate, vehicleStrategy } from '@/modules/strategy';
import { provisionalScore } from '@/lib/strategy-score';
import { shortDate } from '@/lib/time';
import {
  IMPLIED_LABEL, PASSED_BY_LABEL, RUNGS, RUNG_LABEL,
  impliedRung, listPursuits, rungIndex, type Pursuit,
} from '@/modules/strategy';
import { READ_LABEL, touchpointSummaries, touchpointsByPair, type TouchpointSummary } from '@/modules/meetings';
import { CLOSE_STATE_LABEL, closeStates } from '@/modules/pipeline';
import { blanketRestricted } from '@/modules/coordination';
import { readingsFor, type NoteReading } from '@/lib/connectors/affinity/readings';
import { laterFacts, shownRead } from '@/lib/reads';
import { onFile } from '@/lib/reconcile';
import { lpHeadings } from '@/lib/lp-heading';

/**
 * The log has got ahead of the status: a meeting on record for an LP still at Selected or
 * earlier. Shown as a question — the status is a person's call, and it is never moved for them.
 */
function aheadOfStatus(p: Pursuit, s: TouchpointSummary): boolean {
  return (p.status === 'new' || p.status === 'sourcing' || p.status === 'selected' || p.status === 'connecting') && s.meetingDates.length > 0;
}

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);


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
  const people = await (await getDb()).query<{ org_id: string; id: string; name: string; role: string }>(
    `select distinct identity.canonical_entity_id(a.org_entity)::text as org_id,
      e.entity_id::text as id, e.display_name as name, a.role
      from identity.affiliation a join identity.entity e on e.entity_id=identity.canonical_entity_id(a.person_entity)
      where identity.canonical_entity_id(a.org_entity)=any($1::uuid[]) and a.ended_on is null
      order by name`, [[...organisations]]);
  const peopleByOrg = new Map<string, Array<{ id: string; name: string; role: string }>>();
  for (const person of people) peopleByOrg.set(person.org_id, [...(peopleByOrg.get(person.org_id) ?? []), person]);
  const touchesBy = await touchpointsByPair(pairs);
  const [sums, closes, restricted, readings] = await Promise.all([
    touchpointSummaries(pairs, new Date(), touchesBy), closeStates(pairs), blanketRestricted(entityIds), readingsFor(entityIds),
  ]);
  // Whose name leads each row: the organisation's when it is the LP we're targeting (issue 0013).
  const headings = await lpHeadings(pursuits.map((p) => ({ pursuitId: p.pursuitId, entityId: p.entityId })));
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
      people: peopleByOrg.get(p.entityId) ?? [],
      capacitySort: capacityEstimate(plan?.capacityBand),
      vehicleId: p.vehicleId,
      vehicleSlug: vehicles.find(v => v.id === p.vehicleId)!.slug,
      orgId: organisations.has(p.entityId) ? p.entityId : headings.get(p.pursuitId)?.orgId ?? null,
      score: reading.score,
      scoreKind: reading.kind,
      scoreAt: reading.at,
      priority: strategies.get(p.pursuitId)?.score?.priority ?? null,
      capacity: strategies.get(p.pursuitId)?.capacityBand ?? null,
      route: strategies.get(p.pursuitId)?.route?.count ?? null,
      risks: [...(plan?.risks ?? []), ...(assessment && assessment.gateStatus !== 'clear' ? [assessment.diagnosis.statement] : [])],
      nextKind: plan?.group ?? null,
      name: p.entityName,
      org: organisations.has(p.entityId) ? p.entityName : headings.get(p.pursuitId)?.org ?? null,
      orgFirst: organisations.has(p.entityId) || (headings.get(p.pursuitId)?.orgFirst ?? false),
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
