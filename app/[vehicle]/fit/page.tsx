import { coalescePage } from '@/lib/page-render';
import Link from '@/components/ui/AppLink';
import { notFound } from 'next/navigation';
import { Page } from '@/components/shell/Page';
import { EntitySummary } from '@/components/entity/EntitySummary';
import { vehicleSelection } from '@/lib/session';
import { shortDate } from '@/lib/time';
import { capacityBandLabel } from '@/lib/capacity-bands';
import { lpHeadings } from '@/lib/lp-heading';
import { listEntities } from '@/modules/identity';
import { vehicleReadings } from '@/lib/vehicle-readings';
import { listAssessments, type Assessment } from '@/modules/fit';
import { FitBoard, FitInspector } from './FitBoard';
import { isPseudoOrg } from '@/modules/strategy/client';
import { spvMarks } from '@/modules/strategy';
import { getDb } from '@/lib/db';
import { GROUP_LABEL, ORDER, groupFitRows, fitGroupCategory, type FitRow, type FitSection, type Group } from './fit-model';
import s from './fit.module.css';

export const dynamic = 'force-dynamic';

/** Presentation limit: every row stays reachable by paging and search. */
const SIZE = 30;

const BAND_GROUP: Record<Assessment['band'], Group> = { strong: 'strong', workable: 'good', weak: 'weak', blocked: 'gate' };
const LEVEL: Record<string, string> = { high: 'high', medium: 'medium', low: 'low' };

async function FitRollup({ params, searchParams }: {
  params: Promise<{ vehicle: string }>;
  searchParams: Promise<{ e?: string; q?: string; g?: string; sort?: string; page?: string }>;
}) {
  const { vehicle: slug } = await params;
  const sp = await searchParams;
  const { all } = await vehicleSelection();
  const vehicle = slug === 'all' ? null : all.find((v) => v.slug === slug);
  if (slug !== 'all' && !vehicle) notFound();

  // Tonight's data fix (issue 0073) is kept: each pursuit's latest applicable strategy for this
  // vehicle, never a better score borrowed from another; a formal assessment wins where one exists.
  const [readings, assessments] = await Promise.all([vehicleReadings(vehicle?.id ?? null), listAssessments(vehicle?.id ?? null)]);
  const formal = new Map(assessments.map((a) => [`${a.entityId}:${a.vehicleId}`, a]));
  const LEVEL_WORD = (l: string | undefined) => LEVEL[l ?? ''] ?? null;
  const rows: FitRow[] = readings.map((r) => {
    const a = formal.get(`${r.entity_id}:${r.vehicle_id}`);
    const sc = r.data?.scores;
    const g = r.fit?.gates ?? [];
    const failing = a ? a.band === 'blocked' || a.gateStatus === 'failed' : g.some((x) => x.answer === 'no');
    const group: Group = failing ? 'gate' : a ? BAND_GROUP[a.band] : !r.suggestion_id ? 'missing'
      : (['strong', 'good', 'possible', 'weak'].includes(r.fit?.verdict ?? '') ? r.fit!.verdict as Group : 'unknown');
    const capacity = sc?.capacity?.band && sc.capacity.band !== 'unknown' ? capacityBandLabel(sc.capacity.band) : null;
    const decide = sc?.timeToDecision?.band && sc.timeToDecision.band !== 'unknown' ? sc.timeToDecision.band : null;
    return {
      key: `${r.entity_id}:${r.vehicle_id}`, entityId: r.entity_id, name: r.entity_name, vehicleId: r.vehicle_id, vehicleName: r.vehicle_name,
      vehicleSlug: r.vehicle_slug, pursuitId: r.pursuit_id, status: r.status, owner: r.owner_name,
      score: a ? Math.round(a.weightedFit * 100) : r.score, rank: null, group, kind: a ? 'assessed' : r.suggestion_id ? 'provisional' : 'missing',
      why: a?.diagnosis.statement ?? r.fit?.why ?? r.data?.angle ?? null,
      capacity, affinity: LEVEL_WORD(sc?.affinity?.level), propensity: LEVEL_WORD(sc?.propensity?.level), decide,
      gates: a ? { pass: a.gates.filter((x) => x.passed === true).length, open: a.unknownGates.length, fail: a.failedGates.length, total: a.gates.length }
        : g.length ? { pass: g.filter((x) => x.answer === 'yes').length, open: g.filter((x) => x.answer === 'unknown').length, fail: g.filter((x) => x.answer === 'no').length, total: g.length } : null,
      date: (a?.updatedAt ?? r.made_at)?.toISOString() ?? null,
      known: a ? a.evidenceCover : null, dims: a ? `${a.strongCount}/${a.gradedCount}` : null,
      detail: {
        bases: sc ? [
          { label: 'Capacity', value: capacity, basis: sc.capacity?.basis ?? null },
          { label: 'Affinity', value: LEVEL_WORD(sc.affinity?.level), basis: sc.affinity?.basis ?? null },
          { label: 'Propensity', value: LEVEL_WORD(sc.propensity?.level), basis: sc.propensity?.basis ?? null },
          { label: 'Decides in', value: decide, basis: sc.timeToDecision?.basis ?? null },
        ] : [],
        gateList: a ? a.gates.map((x) => ({ gate: x.label, answer: x.passed === true ? 'yes' as const : x.passed === false ? 'no' as const : 'unknown' as const, basis: x.detail || null }))
          : g.map((x) => ({ gate: x.gate, answer: x.answer, basis: x.basis || null })),
        angle: a ? null : r.data?.angle ?? null,
        next: r.data?.next?.what ?? null, nextStep: r.next_step ?? null,
        toFind: (r.data?.openQuestions ?? []).slice(0, 3),
        by: a ? (a.ownerName ?? null) : r.made_by, confidence: a ? null : r.data?.confidence ?? null,
      },
    };
  });
  // A formal assessment can precede a pursuit; it stays visible.
  for (const a of assessments) {
    if (rows.some((r) => r.key === `${a.entityId}:${a.vehicleId}`)) continue;
    rows.push({
      key: `${a.entityId}:${a.vehicleId}`, entityId: a.entityId, name: a.entityName, vehicleId: a.vehicleId, vehicleName: a.vehicleName, vehicleSlug: a.vehicleSlug,
      pursuitId: null, status: null, owner: a.ownerName ?? 'unassigned', score: Math.round(a.weightedFit * 100), rank: null,
      group: a.band === 'blocked' || a.gateStatus === 'failed' ? 'gate' : BAND_GROUP[a.band], kind: 'assessed', why: a.diagnosis.statement,
      capacity: null, affinity: null, propensity: null, decide: null,
      gates: { pass: a.gates.filter((x) => x.passed === true).length, open: a.unknownGates.length, fail: a.failedGates.length, total: a.gates.length },
      date: a.updatedAt.toISOString(), known: a.evidenceCover, dims: `${a.strongCount}/${a.gradedCount}`,
      detail: {
        bases: [], gateList: a.gates.map((x) => ({ gate: x.label, answer: x.passed === true ? 'yes' as const : x.passed === false ? 'no' as const : 'unknown' as const, basis: x.detail || null })),
        angle: null, next: null, nextStep: null, toFind: [], by: a.ownerName ?? null, confidence: null,
      },
    });
  }

  const [headings, entities, spv] = await Promise.all([
    lpHeadings(rows.map(r => ({ pursuitId: r.pursuitId ?? r.entityId, entityId: r.entityId }))),
    listEntities([...new Set(rows.map(r => r.entityId))]),
    spvMarks(await getDb(), [...new Set(rows.map(r => r.entityId))]),
  ]);
  const spvKind = new Set(all.filter(v => v.kind === 'spv').map(v => v.id));
  const organisations = new Set(entities.filter(e => e.entityType !== 'person').map(e => e.entityId));
  for (const r of rows) {
    const h = headings.get(r.pursuitId ?? r.entityId);
    r.isOrg = organisations.has(r.entityId);
    r.orgId = r.isOrg ? r.entityId : h?.orgId ?? null;
    r.org = r.isOrg ? r.name : h?.org && !isPseudoOrg(h.org) ? h.org : null;
    // The row is the LP unit's own (docs/23): a person's firm is context, never the heading.
    r.orgFirst = r.isOrg;
    r.spv = spv.get(r.entityId);
    r.spvVehicle = spvKind.has(r.vehicleId);
  }
  // One row per LP unit (docs/23): each keeps its own fit, gates and actions.
  const byFit = (a: FitRow, b: FitRow) => ORDER.indexOf(a.group) - ORDER.indexOf(b.group)
    || (b.score ?? -1) - (a.score ?? -1) || a.name.localeCompare(b.name);
  const ranked = [...rows].sort(byFit);
  ranked.filter(r => r.kind !== 'missing').forEach((r, i) => { r.rank = i + 1; });
  const words = (sp.q ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  const group = ORDER.includes(sp.g as Group) ? (sp.g as Group) : null;
  const compare = sp.sort === 'name' ? (a: FitRow, b: FitRow) => a.name.localeCompare(b.name)
    : sp.sort === 'recent' ? (a: FitRow, b: FitRow) => (b.date ?? '').localeCompare(a.date ?? '') : byFit;
  const lpGroups = groupFitRows(rows, compare);
  if (!sp.sort || sp.sort === 'fit') lpGroups.sort((a, b) =>
    ORDER.indexOf(fitGroupCategory(a, group)) - ORDER.indexOf(fitGroupCategory(b, group)));
  const filtered = lpGroups.filter(g => g.people.some(r => (!group || r.group === group)
    && words.every(w => `${r.name} ${r.org ?? ''} ${r.owner} ${r.vehicleName} ${r.why ?? ''}`.toLowerCase().includes(w))));
  const pages = Math.max(1, Math.ceil(filtered.length / SIZE));
  const page = Math.min(Math.max(0, (Number.parseInt(sp.page ?? '1', 10) || 1) - 1), pages - 1);
  const shown = filtered.slice(page * SIZE, (page + 1) * SIZE);
  const grouped = !sp.sort || sp.sort === 'fit';

  const href = (changes: Record<string, string | null>) => {
    const p = new URLSearchParams();
    const merged: Record<string, string | null | undefined> = { q: sp.q, g: sp.g, sort: sp.sort, page: null, ...changes };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    const q = p.toString();
    return `/${slug}/fit${q ? `?${q}` : ''}`;
  };

  const count = (g: Group) => rows.filter((r) => r.group === g).length;
  const read = rows.filter((r) => r.kind !== 'missing');
  const scores = read.map((r) => r.score).filter((n): n is number => n !== null).sort((a, b) => a - b);
  const median = scores.length ? (scores.length % 2 ? scores[(scores.length - 1) / 2]! : Math.round((scores[scores.length / 2 - 1]! + scores[scores.length / 2]!) / 2)) : null;
  const dates = rows.flatMap((r) => (r.date ? [new Date(r.date)] : [])).sort((a, b) => a.getTime() - b.getTime());
  const sections: FitSection[] = grouped
    ? ORDER.filter(g => shown.some(lp => fitGroupCategory(lp, group) === g)).map(g => {
      const groups = shown.filter(lp => fitGroupCategory(lp, group) === g);
      return { group: g, count: filtered.filter(lp => fitGroupCategory(lp, group) === g).length,
        rows: groups.flatMap(lp => lp.people), lpGroups: groups };
    })
    : [{ group: null, count: shown.length, rows: shown.flatMap(lp => lp.people), lpGroups: shown }];

  return (
    <Page
      crumbs={[{ label: vehicle ? vehicle.name : 'All vehicles', href: '/overview' }, { label: 'Funder–vehicle fit' }]}
      inspector={
        sp.e ? <EntitySummary entityId={sp.e} /> : (
          <FitInspector>
            <div className="lbl">The shape of it</div>
            <div className="ihead">{lpGroups.length.toLocaleString('en-US')} LPs · {rows.length.toLocaleString('en-US')} pursuits/readings</div>
            <div className="imeta">{vehicle ? vehicle.name : 'every vehicle, listed separately'}</div>
            {ORDER.filter((g) => count(g)).map((g) => (
              <Link key={g} className={`kv ${s.kvlink}${group === g ? ` ${s.on}` : ''}`} href={href({ g: group === g ? null : g })} aria-pressed={group === g}>
                <span>{GROUP_LABEL[g]}</span><span>{count(g)}</span>
              </Link>
            ))}
            <div className="scope">
              <div className="lbl">Read this as a work queue</div>
              <p>
                The groups are not a funnel. Each is a different job: a strong fit needs a date, a possible one needs a fact,
                a failing gate needs somebody to pick up the phone. Counting them together makes a fundraise feel busy and go
                nowhere.
              </p>
            </div>
            <div className="note">
              Readings are per LP <i>and</i> per vehicle. The same LP appears once per vehicle with its own reading, and
              nothing here is summed or borrowed across vehicles.
            </div>
            <p className={s.keys}>Select a row, or move with ↑ ↓, for its reading here. Enter opens the LP.</p>
          </FitInspector>
        )
      }
    >
      <div className="lbl">Funder–vehicle fit · {vehicle ? vehicle.name : 'all vehicles'}</div>
      <h1>Where we stand with each funder</h1>
      <p className="sublede">
        Each LP against this vehicle: whether they can take part at all, whether they should want to, and the four readings
        behind the score. A formal assessment where one exists; otherwise the latest strategy’s reading, marked provisional.
      </p>

      <div className="kpis five">
        <div className="kpi"><div className="n">{lpGroups.length.toLocaleString('en-US')}</div><div className="f">LPs in this view</div></div>
        <div className="kpi"><div className="n">{read.length.toLocaleString('en-US')}</div><div className="f">individual readings · {rows.filter((r) => r.kind === 'assessed').length} assessed, {rows.filter((r) => r.kind === 'provisional').length} provisional</div></div>
        <div className="kpi"><div className={`n${count('strong') + count('good') ? ' g' : ''}`}>{(count('strong') + count('good')).toLocaleString('en-US')}</div><div className="f">readings with strong or good fit</div></div>
        <div className="kpi"><div className="n">{median ?? '—'}</div><div className="f">median score{scores.length > 1 ? `, range ${scores[0]}–${scores.at(-1)}` : ''}</div></div>
        <div className="kpi soft"><div className="n q">{count('missing').toLocaleString('en-US')}</div><div className="f">awaiting a reading: our gap, not theirs</div></div>
      </div>

      <form className={s.filters} action={`/${slug}/fit`} role="search">
        <input type="search" name="q" defaultValue={sp.q} placeholder="Search LP, owner or the reason…" aria-label="Search the fit list" />
        {group && <input type="hidden" name="g" value={group} />}
        <select name="sort" defaultValue={sp.sort ?? 'fit'} aria-label="Order">
          <option value="fit">By fit, then score</option>
          <option value="name">By name</option>
          <option value="recent">Most recently read</option>
        </select>
        <button className="btn" type="submit">Apply</button>
        {(sp.q || group || (sp.sort && sp.sort !== 'fit')) && <Link className={s.clear} href={`/${slug}/fit`}>Clear</Link>}
        <span className={s.count}>{filtered.length === lpGroups.length ? `${lpGroups.length.toLocaleString('en-US')} LPs` : `${filtered.length.toLocaleString('en-US')} of ${lpGroups.length.toLocaleString('en-US')} LPs`}{group ? ` · ${GROUP_LABEL[group]}` : ''}</span>
      </form>

      {rows.length === 0 ? (
        <div className="card">
          <div className="cbody">
            <div className="empty">
              <span className="stat unavailable"><i />Nothing to read</span>
              <h3>No LP is in this vehicle’s pipeline yet.</h3>
              <p>An empty list here means nobody has added the work. It is not a finding about the LP universe.</p>
            </div>
          </div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="card"><div className="cbody"><p className="muted">Nothing matches the search and filter. <Link href={`/${slug}/fit`}>Clear them</Link> to see all {rows.length}.</p></div></div>
      ) : (
        <FitBoard sections={sections} showVehicle={!vehicle} showGroup={!grouped} />
      )}

      {pages > 1 && (
        <nav className={s.pager} aria-label="Fit pages">
          {page > 0 ? <Link className="btn" href={href({ page: String(page) })}>← Previous</Link> : <span />}
          <span className="mono">{page * SIZE + 1}–{Math.min((page + 1) * SIZE, filtered.length)} of {filtered.length.toLocaleString('en-US')}</span>
          {page + 1 < pages ? <Link className="btn" href={href({ page: String(page + 2) })}>Next →</Link> : <span />}
        </nav>
      )}

      <p className="cover">
        <b>What the rank is:</b> position among the {read.length.toLocaleString('en-US')} individual readings, by fit group and then
        score, with anything failing a gate placed last however well it scores. A provisional score weighs the strategy’s four
        readings; with fewer than two known there is none. <b>What this covers:</b> the pursuits on
        {vehicle ? ` ${vehicle.name}` : ' every vehicle'}, formal assessments, and each pursuit’s latest proposed or accepted
        strategy{dates.length ? `, read ${shortDate(dates[0]!)}–${shortDate(dates.at(-1)!)}` : ''}. No score clears a gate or
        authorizes outreach.
      </p>
    </Page>
  );
}

export default coalescePage('/[vehicle]/fit', FitRollup);
