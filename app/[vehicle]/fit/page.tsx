import { coalescePage } from '@/lib/page-render';
import Link from '@/components/ui/AppLink';
import { notFound } from 'next/navigation';
import { Page } from '@/components/shell/Page';
import { EntityLink } from '@/components/entity/EntityLink';
import { EntitySummary } from '@/components/entity/EntitySummary';
import { vehicleSelection } from '@/lib/session';
import { shortDate } from '@/lib/time';
import { capacityBandLabel } from '@/lib/capacity-bands';
import { vehicleReadings } from '@/lib/vehicle-readings';
import { listAssessments, type Assessment } from '@/modules/fit';
import { STATUS_LABEL } from '@/modules/strategy';
import s from './fit.module.css';

export const dynamic = 'force-dynamic';

/** Presentation limit: every row stays reachable by paging and search. */
const SIZE = 30;

type Group = 'strong' | 'good' | 'possible' | 'weak' | 'unknown' | 'gate' | 'missing';
const ORDER: Group[] = ['strong', 'good', 'possible', 'weak', 'unknown', 'gate', 'missing'];
const GROUP_LABEL: Record<Group, string> = {
  strong: 'Strong fit', good: 'Good fit', possible: 'Possible fit', weak: 'Weak fit',
  unknown: 'Fit not known', gate: 'Fails a gate', missing: 'No reading yet',
};
const GROUP_FLAG: Record<Group, string> = {
  strong: 'f-ok', good: 'f-ok', possible: 'f-ev', weak: 'f-mute', unknown: 'f-mute', gate: 'f-block', missing: 'f-mute',
};
/**
 * What each group means for the week, in the language of work rather than of state. Five
 * strong fits and five unknowns are the same count and completely different jobs.
 */
const WORK: Record<Group, string> = {
  strong: 'Ask. The constraint is calendar, not qualification.',
  good: 'Worth the next step: close the one gap the reading names.',
  possible: 'Find the one fact that would settle it before spending an ask.',
  weak: 'Park it. Time here is time not spent on a firm that could say yes.',
  unknown: 'The reading could not tell. Research before planning an ask.',
  gate: 'Correct the record or drop them. No relationship work moves a gate.',
  missing: 'Nobody has read them against this vehicle yet: a gap in our work, not a judgement.',
};
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
  type Row = {
    key: string; entityId: string; name: string; vehicleName: string; vehicleSlug: string; pursuitId: string | null;
    status: string | null; owner: string; score: number | null; group: Group; kind: 'assessed' | 'provisional' | 'missing';
    why: string | null; capacity: string | null; affinity: string | null; propensity: string | null; decide: string | null;
    gates: { pass: number; open: number; fail: number; total: number } | null; date: Date | null;
    /** A formal assessment's own measures: how much of it rests on things we know, and the dimensions in our favour. */
    known: number | null; dims: string | null;
  };
  const rows: Row[] = readings.map((r) => {
    const a = formal.get(`${r.entity_id}:${r.vehicle_id}`);
    const sc = r.data?.scores;
    const g = r.fit?.gates ?? [];
    const failing = a ? a.band === 'blocked' || a.gateStatus === 'failed' : g.some((x) => x.answer === 'no');
    const group: Group = failing ? 'gate' : a ? BAND_GROUP[a.band] : !r.suggestion_id ? 'missing'
      : (['strong', 'good', 'possible', 'weak'].includes(r.fit?.verdict ?? '') ? r.fit!.verdict as Group : 'unknown');
    return {
      key: `${r.entity_id}:${r.vehicle_id}`, entityId: r.entity_id, name: r.entity_name, vehicleName: r.vehicle_name,
      vehicleSlug: r.vehicle_slug, pursuitId: r.pursuit_id, status: STATUS_LABEL[r.status], owner: r.owner_name,
      score: a ? Math.round(a.weightedFit * 100) : r.score, group, kind: a ? 'assessed' : r.suggestion_id ? 'provisional' : 'missing',
      why: a?.diagnosis.statement ?? r.fit?.why ?? r.data?.angle ?? null,
      capacity: sc?.capacity?.band && sc.capacity.band !== 'unknown' ? capacityBandLabel(sc.capacity.band) : null,
      affinity: LEVEL[sc?.affinity?.level ?? ''] ?? null, propensity: LEVEL[sc?.propensity?.level ?? ''] ?? null,
      decide: sc?.timeToDecision?.band && sc.timeToDecision.band !== 'unknown' ? sc.timeToDecision.band : null,
      gates: a ? { pass: a.gates.filter((x) => x.passed === true).length, open: a.unknownGates.length, fail: a.failedGates.length, total: a.gates.length }
        : g.length ? { pass: g.filter((x) => x.answer === 'yes').length, open: g.filter((x) => x.answer === 'unknown').length, fail: g.filter((x) => x.answer === 'no').length, total: g.length } : null,
      date: a?.updatedAt ?? r.made_at ?? null,
      known: a ? a.evidenceCover : null, dims: a ? `${a.strongCount}/${a.gradedCount}` : null,
    };
  });
  // A formal assessment can precede a pursuit; it stays visible.
  for (const a of assessments) {
    if (rows.some((r) => r.key === `${a.entityId}:${a.vehicleId}`)) continue;
    rows.push({
      key: `${a.entityId}:${a.vehicleId}`, entityId: a.entityId, name: a.entityName, vehicleName: a.vehicleName, vehicleSlug: a.vehicleSlug,
      pursuitId: null, status: null, owner: a.ownerName ?? 'unassigned', score: Math.round(a.weightedFit * 100),
      group: a.band === 'blocked' || a.gateStatus === 'failed' ? 'gate' : BAND_GROUP[a.band], kind: 'assessed', why: a.diagnosis.statement,
      capacity: null, affinity: null, propensity: null, decide: null,
      gates: { pass: a.gates.filter((x) => x.passed === true).length, open: a.unknownGates.length, fail: a.failedGates.length, total: a.gates.length },
      date: a.updatedAt, known: a.evidenceCover, dims: `${a.strongCount}/${a.gradedCount}`,
    });
  }

  // Ranked by group, then score: a failing gate goes last however well it scores.
  const ranked = [...rows].sort((a, b) => ORDER.indexOf(a.group) - ORDER.indexOf(b.group) || (b.score ?? -1) - (a.score ?? -1) || a.name.localeCompare(b.name));
  const rankOf = new Map(ranked.filter((r) => r.kind !== 'missing').map((r, i) => [r.key, i + 1]));
  const words = (sp.q ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  const group = ORDER.includes(sp.g as Group) ? (sp.g as Group) : null;
  const filtered = ranked.filter((r) => (!group || r.group === group)
    && words.every((w) => `${r.name} ${r.owner} ${r.vehicleName} ${r.why ?? ''}`.toLowerCase().includes(w)));
  if (sp.sort === 'name') filtered.sort((a, b) => a.name.localeCompare(b.name));
  if (sp.sort === 'recent') filtered.sort((a, b) => (b.date?.getTime() ?? 0) - (a.date?.getTime() ?? 0));
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
  const dates = rows.flatMap((r) => (r.date ? [r.date] : [])).sort((a, b) => a.getTime() - b.getTime());

  return (
    <Page
      crumbs={[{ label: vehicle ? vehicle.name : 'All vehicles', href: '/overview' }, { label: 'Funder–vehicle fit' }]}
      inspector={
        sp.e ? <EntitySummary entityId={sp.e} /> : (
          <>
            <div className="lbl">The shape of it</div>
            <div className="ihead">{rows.length.toLocaleString('en-US')} LP{rows.length === 1 ? '' : 's'} · {read.length.toLocaleString('en-US')} read</div>
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
          </>
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
        <div className="kpi"><div className="n">{rows.length.toLocaleString('en-US')}</div><div className="f">LPs in this vehicle’s pipeline</div></div>
        <div className="kpi"><div className="n">{read.length.toLocaleString('en-US')}</div><div className="f">with a reading · {rows.filter((r) => r.kind === 'assessed').length} assessed, {rows.filter((r) => r.kind === 'provisional').length} provisional</div></div>
        <div className="kpi"><div className={`n${count('strong') + count('good') ? ' g' : ''}`}>{(count('strong') + count('good')).toLocaleString('en-US')}</div><div className="f">strong or good fit</div></div>
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
        <span className={s.count}>{filtered.length === rows.length ? `${rows.length.toLocaleString('en-US')} LPs` : `${filtered.length.toLocaleString('en-US')} of ${rows.length.toLocaleString('en-US')}`}{group ? ` · ${GROUP_LABEL[group]}` : ''}</span>
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
        (grouped ? ORDER.filter((g) => shown.some((r) => r.group === g)).map((g) => ({ g, list: shown.filter((r) => r.group === g) }))
          : [{ g: null as Group | null, list: shown }]).map(({ g, list }) => (
          <div className="card" key={g ?? 'all'}>
            {g && (
              <>
                <div className="chead">
                  <h2><span className={`flag ${GROUP_FLAG[g]}`} style={{ marginRight: 8 }}>{count(g)}</span>{GROUP_LABEL[g]}</h2>
                  {list.length < count(g) && <span className="lbl">{list.length} on this page</span>}
                </div>
                <div className="worknote">{WORK[g]}</div>
              </>
            )}
            {list.map((r) => (
              <div className={`row${sp.e === r.entityId ? ' sel' : ''} ${s.row}`} key={r.key}>
                <div className="scorecell">
                  <div className="rk mono">{rankOf.has(r.key) ? `#${rankOf.get(r.key)}` : '—'}</div>
                  <div className={`sc mono ${s.sc} ${s[`g_${r.group}`]}`}>{r.score ?? '—'}</div>
                  <span className={`flag ${r.kind === 'assessed' ? 'f-ok' : 'f-mute'}`}>{r.kind === 'assessed' ? 'assessed' : r.kind === 'provisional' ? 'provisional' : 'no reading'}</span>
                </div>
                <div className="t">
                  <EntityLink id={r.entityId} name={r.name} />
                  {r.kind !== 'missing' && <Link className="xref" href={`/${r.vehicleSlug}/fit/${r.entityId}`}>the reading →</Link>}
                  {r.pursuitId && <Link className="xref" href={`/${r.vehicleSlug}/pipeline/${r.pursuitId}`}>LP workspace →</Link>}
                  {!vehicle && <span className="flag f-mute" style={{ marginLeft: 8 }}>{r.vehicleName}</span>}
                  {!grouped && <span className={`flag ${GROUP_FLAG[r.group]}`} style={{ marginLeft: 8 }}>{GROUP_LABEL[r.group]}</span>}
                  <span className={s.why}>{r.why ?? (r.kind === 'missing' ? 'No strategy or assessment on file for this vehicle.' : 'The reading gives no reason.')}</span>
                  <div className="rowmeta">
                    {r.kind === 'missing' ? null : (
                      <>
                        {(r.capacity || r.affinity || r.propensity || r.decide || r.kind === 'provisional') && (
                          <>
                            <span>capacity <b>{r.capacity ?? 'not known'}</b></span>
                            <span>affinity <b>{r.affinity ?? 'not known'}</b></span>
                            <span>propensity <b>{r.propensity ?? 'not known'}</b></span>
                            <span>decides in <b>{r.decide ?? 'not known'}</b></span>
                          </>
                        )}
                        {r.known !== null && <span>known <b>{Math.round(r.known * 100)}%</b></span>}
                        {r.dims && <span><b>{r.dims}</b> dimensions in our favour</span>}
                        {r.gates && <span className={r.gates.fail ? s.bad : undefined}>gates {r.gates.pass}/{r.gates.total}{r.gates.open ? ` · ${r.gates.open} open` : ''}{r.gates.fail ? ` · ${r.gates.fail} failing` : ''}</span>}
                      </>
                    )}
                    <span>{r.status ?? 'no pursuit'} · {r.owner}{r.date ? ` · ${shortDate(r.date)}` : ''}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ))
      )}

      {pages > 1 && (
        <nav className={s.pager} aria-label="Fit pages">
          {page > 0 ? <Link className="btn" href={href({ page: String(page) })}>← Previous</Link> : <span />}
          <span className="mono">{page * SIZE + 1}–{Math.min((page + 1) * SIZE, filtered.length)} of {filtered.length.toLocaleString('en-US')}</span>
          {page + 1 < pages ? <Link className="btn" href={href({ page: String(page + 2) })}>Next →</Link> : <span />}
        </nav>
      )}

      <p className="cover">
        <b>What the rank is:</b> position among the {read.length.toLocaleString('en-US')} LPs with a reading, by fit group and then
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
