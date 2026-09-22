import { listRuns } from '@/modules/agents';
import { listAsks, listConflicts, listRestrictions, connectorLoad } from '@/modules/coordination';
import { listAssets } from '@/modules/content';
import { listOpenTickets } from '@/modules/governance';
import { coverageGaps } from '@/modules/library';
import { listMeetings, listObjections, listQuestions } from '@/modules/meetings';
import { listEdges } from '@/modules/network';
import { poolChecks } from '@/modules/pipeline';
import { listUsers, listVehicles } from '@/modules/platform';
import { listPursuits } from '@/modules/strategy';
import type {
  CellMark, Coverage, CoverageRow, Dependent, Lenses, Leverage, NetLink, NetNode, NetPath,
  Network, Prerequisite, Radar, RadarDot, Strip, StripCell, StripLane, Track,
} from './lenses-client';
import { COVERAGE_FIELDS } from './lenses-client';
import type { FloorState } from './floor-client';

export * from './lenses-client';

const DAY = 86_400_000;
const days = (from: Date, to: Date) => Math.round((to.getTime() - from.getTime()) / DAY);

/**
 * Five more lenses over one projection.
 *
 * Like the board, this takes the floor as an input rather than rebuilding it. What it adds
 * is relational: who can reach whom, which piece of work several pursuits are waiting behind,
 * which fields are simply not recorded, when anybody last spoke to them, and what has a date
 * on it in the fortnight either side of today.
 */
export async function lenses(scopeSlug: string | null, floor: FloorState): Promise<Lenses> {
  const now = new Date();
  const [
    users, vehicles, edges, asks, restrictions, conflicts, tickets, meetings,
    objections, questions, assets, gaps, pools, loads, runs, pursuits,
  ] = await Promise.all([
    listUsers(), listVehicles(), listEdges(), listAsks(null), listRestrictions(),
    listConflicts('open'), listOpenTickets(), listMeetings(), listObjections(), listQuestions(),
    listAssets(), coverageGaps(), poolChecks(), connectorLoad(), listRuns(60), listPursuits(null),
  ]);

  const inScope = (name: string | null) => scopeSlug === null
    || vehicles.find((v) => v.slug === scopeSlug)?.name === name;
  const items = floor.items;
  const byEntity = new Map(items.map((i) => [i.entityId, i]));
  const restrictedIds = new Set(restrictions.map((r) => r.entityId));
  const teamNames = new Set(users.map((u) => u.name));

  // ── 1 · who can move whom ────────────────────────────────────────────────────
  /**
   * Three columns: us, the people who could carry an ask, and the money.
   *
   * An advocate is somebody a route actually runs through — a recorded relationship edge that
   * touches one of us, or a connector on an ask. Being in the address book is not being an
   * advocate, and the drawing would be unreadable and dishonest if it were.
   */
  const ourEntities = new Map<string, string>(); // entityId → our name
  for (const e of edges) {
    if (teamNames.has(e.fromName)) ourEntities.set(e.fromEntity, e.fromName);
    if (teamNames.has(e.toName)) ourEntities.set(e.toEntity, e.toName);
  }
  const advocateIds = new Set<string>();
  for (const e of edges) {
    const oursIsFrom = ourEntities.has(e.fromEntity);
    const oursIsTo = ourEntities.has(e.toEntity);
    if (oursIsFrom && !oursIsTo) advocateIds.add(e.toEntity);
    if (oursIsTo && !oursIsFrom) advocateIds.add(e.fromEntity);
  }
  for (const a of asks) if (a.connectorId) advocateIds.add(a.connectorId);
  // A target is never also drawn as an advocate: the column it sits in is what it is *for*.
  for (const i of items) advocateIds.delete(i.entityId);

  const advocateName = (id: string) => edges.find((e) => e.fromEntity === id)?.fromName
    ?? edges.find((e) => e.toEntity === id)?.toName
    ?? asks.find((a) => a.connectorId === id)?.connectorName
    ?? 'Unnamed';

  const nodes: NetNode[] = [
    ...users.map((u): NetNode => ({
      id: `u:${u.handle}`,
      name: u.name,
      role: 'owner',
      note: u.role,
      vehicleName: null,
      amount: null,
      actions: items.filter((i) => i.ownerName === u.name).length,
    })),
    ...[...advocateIds].map((id): NetNode => ({
      id: `a:${id}`,
      name: advocateName(id),
      role: 'advocate',
      note: restrictedIds.has(id) ? 'A restriction names them' : 'Could carry an ask',
      vehicleName: null,
      amount: null,
      actions: asks.filter((a) => a.connectorId === id).length,
    })),
    ...items.map((i): NetNode => ({
      id: `t:${i.key}`,
      name: i.entityName,
      role: 'target',
      note: i.rung ?? 'no rung',
      vehicleName: i.vehicleName,
      amount: i.amount,
      actions: i.blocked ? 1 : 0,
    })),
  ];

  const links: NetLink[] = [];
  const stateFor = (tier: string, reviewed: boolean, targetId: string | null) => {
    if (targetId && restrictedIds.has(targetId)) return 'restricted' as const;
    if (tier === 'A' || tier === 'B') return 'confirmed' as const;
    return reviewed ? ('confirmed' as const) : ('unconfirmed' as const);
  };
  for (const e of edges) {
    const oursFrom = ourEntities.get(e.fromEntity);
    const oursTo = ourEntities.get(e.toEntity);
    const other = oursFrom ? e.toEntity : e.fromEntity;
    const ourName = oursFrom ?? oursTo;
    if (ourName && advocateIds.has(other)) {
      const u = users.find((x) => x.name === ourName);
      if (u) {
        links.push({
          from: `u:${u.handle}`, to: `a:${other}`,
          state: stateFor(e.tier, e.reviewedByName !== null, null),
          tier: e.tier,
          why: `${e.kind.replace(/_/g, ' ')}, tier ${e.tier}${e.reviewedByName ? `, confirmed by ${e.reviewedByName}` : ', unconfirmed'}.`,
          weight: e.strength ?? 0.5,
        });
      }
    }
    // advocate → target
    for (const [aId, tId] of [[e.fromEntity, e.toEntity], [e.toEntity, e.fromEntity]] as const) {
      if (!advocateIds.has(aId)) continue;
      const hits = items.filter((i) => i.entityId === tId);
      for (const t of hits) {
        links.push({
          from: `a:${aId}`, to: `t:${t.key}`,
          state: stateFor(e.tier, e.reviewedByName !== null, tId),
          tier: e.tier,
          why: restrictedIds.has(tId)
            ? 'A do-not-approach instruction covers this target; no substitution is a route.'
            : `${e.kind.replace(/_/g, ' ')}, tier ${e.tier}${e.reviewedByName ? `, confirmed by ${e.reviewedByName}` : ', unconfirmed'}.`,
          weight: e.strength ?? 0.5,
        });
      }
    }
  }
  for (const a of asks) {
    if (!a.connectorId) continue;
    const t = items.find((i) => i.entityId === a.entityId && i.vehicleName === a.vehicleName);
    const u = users.find((x) => x.name === a.ownerName);
    if (u && advocateIds.has(a.connectorId)) {
      links.push({
        from: `u:${u.handle}`, to: `a:${a.connectorId}`, state: 'confirmed', tier: null,
        why: `${a.ownerName} has carried an ask through them (${a.status}).`, weight: 0.8,
      });
    }
    if (t) {
      links.push({
        from: `a:${a.connectorId}`, to: `t:${t.key}`,
        state: a.status === 'blocked' ? 'restricted' : 'confirmed', tier: null,
        why: `Ask ${a.status}: ${a.purpose}`, weight: 0.8,
      });
    }
  }

  const paths: NetPath[] = [];
  for (const ol of links.filter((l) => l.from.startsWith('u:'))) {
    for (const al of links.filter((l) => l.from === ol.to)) {
      const owner = nodes.find((n) => n.id === ol.from)?.name ?? '';
      const advocate = nodes.find((n) => n.id === ol.to)?.name ?? '';
      const target = nodes.find((n) => n.id === al.to);
      if (!target) continue;
      const state = al.state === 'restricted' || ol.state === 'restricted' ? 'restricted'
        : al.state === 'unconfirmed' || ol.state === 'unconfirmed' ? 'unconfirmed' : 'confirmed';
      const label = `${owner} → ${advocate} → ${target.name}`;
      if (paths.some((p) => p.label === label)) continue;
      paths.push({ label, owner, advocate, target: target.name, state, why: al.why });
    }
  }

  const network: Network = {
    nodes, links, paths,
    note: 'A line is a recorded edge or a carried ask, never an assumption that two people who '
      + 'were in the same room can introduce each other. Tier A and B count as confirmed; C and '
      + 'D need a person to sign off before they carry anything.',
  };

  // ── 2 · what would release several moves ─────────────────────────────────────
  const dep = (key: string, label: string, vehicleName: string, amount: number | null,
    urgent: boolean, blocked: boolean): Dependent => ({ key, label, vehicleName, amount, urgent, blocked });

  const prerequisites: Prerequisite[] = [];

  for (const g of gaps.filter((x) => x.nearest === null && x.occurrences > 0)) {
    const hits = items.filter((i) => g.entities.includes(i.entityName));
    if (hits.length === 0) continue;
    prerequisites.push({
      key: `answer:${g.question.slice(0, 24)}`,
      label: `Write the answer: “${g.question.length > 64 ? `${g.question.slice(0, 63)}…` : g.question}”`,
      family: 'answer',
      owner: null,
      state: 'waiting',
      dependents: hits.map((i) => dep(i.key, i.entityName, i.vehicleName, i.amount, Boolean(i.urgent), Boolean(i.blocked))),
      because: `Asked ${g.occurrences} time${g.occurrences === 1 ? '' : 's'} and the library has nothing approved behind it. Answered once, it is reusable.`,
      href: '/library',
    });
  }

  for (const a of assets.filter((x) => x.flags.length > 0)) {
    const hits = items.filter((i) => inScope(i.vehicleName)
      && (a.vehicleName === null || a.vehicleName === i.vehicleName)
      && ['target_opted_in', 'meeting_held', 'indication_given'].includes(i.rung ?? ''));
    if (hits.length === 0) continue;
    prerequisites.push({
      key: `material:${a.assetId}`,
      label: `Refresh ${a.title}`,
      family: 'material',
      owner: a.ownerName,
      state: 'review',
      dependents: hits.map((i) => dep(i.key, i.entityName, i.vehicleName, i.amount, Boolean(i.urgent), Boolean(i.blocked))),
      because: `${a.flags.length} refresh flag${a.flags.length === 1 ? '' : 's'}: a claim underneath it moved. Nothing can be sent from it until somebody looks.`,
      href: '/materials',
    });
  }

  for (const t of tickets) {
    const hits = items.filter((i) => t.subjectLabel.includes(i.entityName));
    prerequisites.push({
      key: `ticket:${t.id}`,
      label: `Decide the ${t.kind} ticket · ${t.subjectLabel}`,
      family: 'approval',
      owner: t.requestedByName,
      state: 'review',
      dependents: hits.map((i) => dep(i.key, i.entityName, i.vehicleName, i.amount, Boolean(i.urgent), Boolean(i.blocked))),
      because: t.scope.authorizes,
      href: `/approvals?t=${t.id}`,
    });
  }

  for (const c of conflicts) {
    const hits = items.filter((i) => i.entityId === c.entityId);
    prerequisites.push({
      key: `conflict:${c.caseId}`,
      label: `Adjudicate the collision on ${c.entityName}`,
      family: 'conflict',
      owner: null,
      state: 'blocked',
      dependents: hits.map((i) => dep(i.key, i.entityName, i.vehicleName, i.amount, Boolean(i.urgent), true)),
      because: `${c.claimantA.vehicleName} and ${c.claimantB.vehicleName} both have an open ask inside the window. One proceeds; the loser gets a dated follow-up.`,
      href: '/approvals',
    });
  }

  for (const r of restrictions) {
    const hits = items.filter((i) => i.entityId === r.entityId);
    if (hits.length === 0) continue;
    prerequisites.push({
      key: `restriction:${r.restrictionId}`,
      label: `Restriction on ${r.entityName}`,
      family: 'restriction',
      owner: r.recordedByName,
      state: 'blocked',
      dependents: hits.map((i) => dep(i.key, i.entityName, i.vehicleName, i.amount, Boolean(i.urgent), true)),
      because: `${r.instruction} This is not a routing problem to work around.`,
      href: '/asks',
    });
  }

  for (const p of pools.filter((x) => x.status === 'over')) {
    const hits = items.filter((i) => i.entityName === p.entityName);
    prerequisites.push({
      key: `budget:${p.entityId}`,
      label: `Reconcile ${p.entityName}'s budget`,
      family: 'budget',
      owner: null,
      state: 'blocked',
      dependents: hits.map((i) => dep(i.key, i.entityName, i.vehicleName, i.amount, Boolean(i.urgent), Boolean(i.blocked))),
      because: `Their commitments across our vehicles exceed the ${(p.budget ?? 0) / 1_000_000}M they told us they have. Somebody has to decide which vehicle gives way.`,
      href: '/forecast',
    });
  }

  const quarterCap = 3;
  for (const l of loads.filter((x) => x.used >= quarterCap)) {
    const viaThem = asks.filter((a) => a.connectorName === l.name).map((a) => a.entityId);
    const hits = items.filter((i) => viaThem.includes(i.entityId));
    if (hits.length === 0) continue;
    prerequisites.push({
      key: `goodwill:${l.connectorId}`,
      label: `${l.name} is at their quarterly cap`,
      family: 'goodwill',
      owner: null,
      state: 'blocked',
      dependents: hits.map((i) => dep(i.key, i.entityName, i.vehicleName, i.amount, Boolean(i.urgent), true)),
      because: `${l.used} asks carried this quarter against a cap of ${quarterCap}. Asking again spends a relationship that took years on an introduction worth weeks.`,
      href: '/routes',
    });
  }

  prerequisites.sort((a, b) => b.dependents.length - a.dependents.length);
  const leverage: Leverage = {
    prerequisites: prerequisites.filter((p) => p.dependents.length > 0),
    totals: {
      prerequisites: prerequisites.filter((p) => p.dependents.length > 0).length,
      dependents: new Set(prerequisites.flatMap((p) => p.dependents.map((d) => d.key))).size,
      inReview: prerequisites.filter((p) => p.state === 'review').length,
    },
    note: 'Each row is one recorded thing standing in front of several pursuits. Releasing it does '
      + 'not advance them — it lets somebody try. Ordered by how many are waiting, which is not '
      + 'the same as by how much money is behind them.',
  };

  // ── 3 · what we know, and where we are blind ─────────────────────────────────
  const confirmedEdgeFor = (entityId: string) => edges.find((e) =>
    (e.toEntity === entityId || e.fromEntity === entityId)
    && (e.tier === 'A' || e.tier === 'B' || e.reviewedByName !== null));
  const anyEdgeFor = (entityId: string) => edges.find((e) => e.toEntity === entityId || e.fromEntity === entityId);
  /**
   * An exchange is something that passed between us and them: a meeting that happened, an
   * ask that was made, or a rung above "connector willing" — which by definition needs a
   * reply from their side. A note we wrote to ourselves is not one.
   */
  const exchangeFor = (entityId: string): Date | null => {
    const dates = [
      ...meetings.filter((m) => m.entityId === entityId && m.heldOn).map((m) => m.heldOn!),
      ...asks.filter((a) => a.entityId === entityId && a.madeAt).map((a) => a.madeAt!),
      ...pursuits.filter((p) => p.entityId === entityId)
        .flatMap((p) => p.events.filter((e) => e.rung !== 'connector_willing').map((e) => e.occurredAt)),
    ].sort((x, y) => y.getTime() - x.getTime());
    return dates[0] ?? null;
  };
  const entryFor = (entityId: string, vehicleName: string): Date | null => {
    const p = pursuits.find((x) => x.entityId === entityId && x.vehicleName === vehicleName);
    if (!p || !p.rung) return null;
    const ev = p.events.filter((e) => e.rung === p.rung).sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());
    return ev[0]?.occurredAt ?? null;
  };

  const rows: CoverageRow[] = items.map((i) => {
    const cells: CoverageRow['cells'] = {};
    const put = (key: string, mark: CellMark, note: string) => { cells[key] = { mark, note }; };

    put('check', i.amount === null ? 'missing' : 'recorded',
      i.amount === null ? 'No figure of any kind on file.' : i.sizeBasis);

    // Interest is an explicit assessment. A rung is a process fact, not an opinion.
    const assessed = i.headline !== null;
    put('interest', assessed ? 'recorded' : 'missing',
      assessed ? 'An assessment is on file for this pursuit.'
        : 'No explicit assessment. Being at a rung is not an opinion about them.');

    const confirmed = confirmedEdgeFor(i.entityId);
    const anyEdge = anyEdgeFor(i.entityId);
    put('access', i.restricted ? 'restricted' : confirmed ? 'recorded' : anyEdge ? 'unconfirmed' : 'missing',
      i.restricted ? 'A do-not-approach instruction is on file.'
        : confirmed ? `Confirmed ${confirmed.kind.replace(/_/g, ' ')}, tier ${confirmed.tier}.`
        : anyEdge ? `Only ${anyEdge.tier}-tier, unconfirmed — a clue, not a route.`
        : 'No recorded edge touches them.');

    const ex = exchangeFor(i.entityId);
    put('exchange', ex ? 'recorded' : 'missing',
      ex ? `Last dated exchange ${days(ex, now)}d ago.`
        : 'No dated conversation with them. Our own notes are not an exchange.');

    const open = Boolean(i.urgent) || Boolean(i.nextRung) || Boolean(i.blocked);
    put('action', open ? 'recorded' : 'missing',
      open ? (i.blocked ?? i.urgent ?? `Next: ${i.nextRung}`) : 'Nothing open with a name on it.');

    const entry = entryFor(i.entityId, i.vehicleName);
    put('entry', entry ? 'recorded' : 'missing',
      entry ? `Arrived at this rung ${days(entry, now)}d ago.`
        : 'No dated record of arriving where it sits.');

    const recorded = COVERAGE_FIELDS.filter((f) => cells[f.key]!.mark === 'recorded').length;
    return {
      key: i.key, entityId: i.entityId, name: i.entityName, vehicleName: i.vehicleName,
      ownerName: i.ownerName, amount: i.amount, cells, recorded,
    };
  }).sort((a, b) => a.recorded - b.recorded || (b.amount ?? 0) - (a.amount ?? 0));

  const coverage: Coverage = {
    rows,
    totals: COVERAGE_FIELDS.map((f) => ({
      key: f.key,
      recorded: rows.filter((r) => r.cells[f.key]!.mark === 'recorded').length,
      of: rows.length,
    })),
    note: 'Presence, not quality. A recorded field can still be wrong, and a missing one can be '
      + 'legitimate — what it cannot be is invisible. Rows with the least recorded come first, '
      + 'because that is where a confident-sounding brief would be most dangerous.',
  };

  // ── 4 · when anybody last actually spoke to them ─────────────────────────────
  const dots: RadarDot[] = items.map((i) => {
    const ex = exchangeFor(i.entityId);
    return {
      key: i.key, entityId: i.entityId, name: i.entityName, vehicleName: i.vehicleName,
      ownerName: i.ownerName, amount: i.amount,
      days: ex ? days(ex, now) : null,
      temp: i.temp, blocked: Boolean(i.blocked) || i.restricted || i.conflict,
      urgent: Boolean(i.urgent),
    };
  });
  const band = (d: number | null, lo: number, hi: number) => d !== null && d >= lo && d <= hi;
  const radar: Radar = {
    dots: dots.filter((d) => d.days !== null),
    offRadar: dots.filter((d) => d.days === null).sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0)),
    bands: [
      { label: '0–2 days', count: dots.filter((d) => band(d.days, 0, 2)).length },
      { label: '3–7 days', count: dots.filter((d) => band(d.days, 3, 7)).length },
      { label: '8–14 days', count: dots.filter((d) => band(d.days, 8, 14)).length },
      { label: '15+ days', count: dots.filter((d) => d.days !== null && d.days > 14).length },
      { label: 'No dated exchange', count: dots.filter((d) => d.days === null).length },
    ],
    asOf: now,
    note: 'Distance from the centre is time since a dated exchange — a meeting that happened or an '
      + 'ask that was made. Silence is not disinterest: the outer ring and the off-radar list '
      + 'are statements about our records, and colour stays the recorded assessment.',
  };

  // ── 5 · the fortnight either side of today ───────────────────────────────────
  const BACK = 14;
  const FORWARD = 14;
  const span = BACK + 1 + FORWARD;
  const offsetOf = (d: Date) => days(now, d);
  const emptyTrack = (): StripCell[] => Array.from({ length: span }, (_, k) => ({
    offset: k - BACK, count: 0, tone: 'plain' as const, labels: [],
  }));

  const lanes: StripLane[] = vehicles
    .filter((v) => floor.items.some((i) => i.vehicleSlug === v.slug))
    .map((v) => {
      const mine = items.filter((i) => i.vehicleSlug === v.slug);
      const tracks: Record<Track, StripCell[]> = {
        exchange: emptyTrack(), due: emptyTrack(), run: emptyTrack(),
      };
      const overflow: StripLane['overflow'] = {
        exchange: { earlier: 0, later: 0, undated: 0 },
        due: { earlier: 0, later: 0, undated: 0 },
        run: { earlier: 0, later: 0, undated: 0 },
      };
      const place = (track: Track, at: Date | null, label: string, tone: StripCell['tone']) => {
        if (!at) { overflow[track].undated += 1; return; }
        const o = offsetOf(at);
        if (o < -BACK) { overflow[track].earlier += 1; return; }
        if (o > FORWARD) { overflow[track].later += 1; return; }
        const cell = tracks[track][o + BACK]!;
        cell.count += 1;
        if (cell.labels.length < 6) cell.labels.push(label);
        if (tone === 'urgent' || (tone === 'blocked' && cell.tone !== 'urgent')) cell.tone = tone;
        else if (cell.tone === 'plain' && tone === 'done') cell.tone = 'done';
      };

      for (const m of meetings.filter((x) => x.vehicleName === v.name)) {
        if (m.heldOn) place('exchange', m.heldOn, `${m.kind.replace('_', ' ')} held · ${m.entityName}`, 'done');
        else if (m.scheduledFor) place('due', m.scheduledFor, `${m.kind.replace('_', ' ')} · ${m.entityName}`, 'plain');
      }
      for (const a of asks.filter((x) => x.vehicleName === v.name)) {
        if (a.madeAt) place('exchange', a.madeAt, `Ask made · ${a.entityName}`, 'done');
        if (a.scheduledFor && !a.madeAt) place('due', a.scheduledFor, `Ask due · ${a.entityName}`, a.status === 'blocked' ? 'blocked' : 'plain');
      }
      for (const p of pursuits.filter((x) => x.vehicleName === v.name)) {
        for (const e of p.events) {
          if (e.rung !== 'connector_willing') {
            place('exchange', e.occurredAt, `${e.rung.replace(/_/g, ' ')} · ${p.entityName}`, 'done');
          }
        }
      }
      for (const t of tickets.filter((x) => x.vehicleName === v.name)) {
        place('due', t.expiresAt, `${t.kind} expires · ${t.subjectLabel}`, 'urgent');
      }
      for (const q of questions.filter((x) => x.vehicleName === v.name && x.status === 'open')) {
        place('due', q.dueOn, `Answer due · ${q.entityName}`, q.overdue ? 'urgent' : 'plain');
      }
      for (const r of runs) {
        const touches = mine.some((i) => r.envelope.task.includes(i.entityName));
        if (!touches) continue;
        place('run', r.finishedAt ?? r.startedAt, `${r.status} · ${r.envelope.task}`,
          r.status === 'refused' ? 'blocked' : r.finishedAt ? 'plain' : 'done');
      }

      return {
        vehicleName: v.name,
        pursuits: mine.length,
        open: mine.filter((i) => !i.cashReceived).length,
        tracks,
        overflow,
      };
    });

  /**
   * A run that names no target belongs to no vehicle lane. It still happened, so it gets a
   * lane of its own rather than disappearing — an agent floor that only shows the runs it
   * can file neatly is under-reporting.
   */
  {
    const tracks: Record<Track, StripCell[]> = { exchange: emptyTrack(), due: emptyTrack(), run: emptyTrack() };
    const overflow: StripLane['overflow'] = {
      exchange: { earlier: 0, later: 0, undated: 0 },
      due: { earlier: 0, later: 0, undated: 0 },
      run: { earlier: 0, later: 0, undated: 0 },
    };
    let n = 0;
    for (const r of runs) {
      const attributed = items.some((i) => r.envelope.task.includes(i.entityName));
      if (attributed) continue;
      n += 1;
      const at = r.finishedAt ?? r.startedAt;
      const o = offsetOf(at);
      if (o < -BACK) overflow.run.earlier += 1;
      else if (o > FORWARD) overflow.run.later += 1;
      else {
        const cell = tracks.run[o + BACK]!;
        cell.count += 1;
        if (cell.labels.length < 6) cell.labels.push(`${r.status} · ${r.envelope.task}`);
        if (r.status === 'refused') cell.tone = 'blocked';
        else if (!r.finishedAt && cell.tone === 'plain') cell.tone = 'done';
      }
    }
    if (n > 0) lanes.push({ vehicleName: 'Agent runs not tied to one target', pursuits: 0, open: n, tracks, overflow });
  }

  const strip: Strip = {
    lanes, days: span, back: BACK, asOf: now,
    note: 'Every mark is a record with a date on it, counted on the day it carries. The columns on '
      + 'the right hold what falls outside the window and, more usefully, what has no date at '
      + 'all — which is where work goes to be forgotten rather than to be late.',
  };

  return { network, leverage, coverage, radar, strip };
}
