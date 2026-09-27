'use client';

import { Fragment, memo, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BulkLpActions } from './BulkLpActions';
import { EMPTY, groupRows, lead, second, type PipelineRow, type SortKey, type Status } from './pipeline-model';
import { cx, fmtShort, FilterLine, Icon, InPane, Ladder, n, ScoreMark, useLpView, usdM, type StatusInfo } from './lp-view';
import s from './lp-tables.module.css';

export type { PipelineRow, Status } from './pipeline-model';

/**
 * The pipeline, as one interactive table (N54; issues 0067 and 0083). The look is the one before
 * 27 Sep — status cards, one filter line, a quiet table — with the asks on top: a score, sorting
 * by any column (score first), All after Passed, an organisation leading its people, and actions
 * on the LPs ticked. Every pursuit in scope arrives once; search, filters and order run here.
 */

const PAGE = 100;

interface Props {
  rows: PipelineRow[];
  statuses: StatusInfo[];
  rungNames: string[];
  initialStatus: Status | 'all' | null;
  initialFilters?: Record<string, string>;
  showVehicle: boolean;
  asOf: string;
}

export function PipelineTable({ rows, statuses, rungNames, initialStatus, initialFilters, showVehicle, asOf }: Props) {
  const router = useRouter();
  const view = useLpView({ rows, statuses, asOf, initialFilters, mode: 'pipeline', initialStatus });
  const { enabled, setEnabled, counts, active, shown, sort, sortBy, picked, pick, pickedRows, now } = view;
  const [limit, setLimit] = useState(PAGE);
  const shownIds = useMemo(() => new Set(shown.map((r) => r.id)), [shown]);
  useEffect(() => setLimit(PAGE), [enabled, view.f, sort]);

  const all = enabled.length === statuses.length;
  const one = enabled.length === 1 ? statuses.find((x) => x.id === enabled[0]) ?? null : null;
  const vehicles = useMemo(() => new Set(rows.map((r) => r.vehicle)).size, [rows]);
  const byVehicle = showVehicle && vehicles > 1;
  const groups = useMemo(() => groupRows(shown, sort.key, sort.dir), [shown, sort]);
  const visible = groups.slice(0, limit);
  const visibleIds = visible.flatMap((g) => g.people.map((r) => r.id));
  const allTicked = visibleIds.length > 0 && visibleIds.every((id) => picked.has(id));
  const open = (r: PipelineRow, e?: { metaKey?: boolean; ctrlKey?: boolean }) => {
    const href = lpHref(r);
    if (e?.metaKey || e?.ctrlKey) window.open(href, '_blank'); else router.push(href);
  };
  const statusLabel = (id: Status) => statuses.find((x) => x.id === id)?.label ?? id;

  const Th = ({ k, className, children }: { k: SortKey; className: string; children: string }) => {
    const on = sort.key === k;
    return (
      <th className={className} aria-sort={on ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
        <button type="button" className={cx(s.sortBtn, on && s.sorted)} onClick={() => sortBy(k)}>
          {children}{on ? (sort.dir === -1 ? ' ↓' : ' ↑') : ''}
        </button>
      </th>
    );
  };

  return (
    <section className={s.wrap} aria-label="LP pipeline">
      <div className={s.board} role="tablist" aria-label="Status">
        {statuses.map((x) => {
          const m = counts.all.get(x.id) ?? 0, k = counts.matching.get(x.id) ?? 0;
          const on = enabled.length === 1 && enabled[0] === x.id;
          return (
            <button key={x.id} type="button" role="tab" aria-selected={on} title={x.means}
              className={cx(s.tab, on && s.on, x.id === 'passed' && s.ended)} onClick={() => setEnabled([x.id])}>
              <span className={s.tabLabel}>{x.label}</span>
              <span className={s.tabNum}>{n(active ? k : m)}{active && <span className={s.tabOf}> of {n(m)}</span>}</span>
            </button>
          );
        })}
        <button type="button" role="tab" aria-selected={all} title="Every LP, across all seven statuses."
          className={cx(s.tab, s.all, all && s.on)} onClick={() => setEnabled(statuses.map((x) => x.id))}>
          <span className={s.tabLabel}>All</span>
          <span className={s.tabNum}>{n(active ? view.filtered.length : rows.length)}{active && <span className={s.tabOf}> of {n(rows.length)}</span>}</span>
        </button>
      </div>

      <FilterLine view={view} rows={rows} showVehicle={showVehicle} keys={['meetings', 'touch', 'read', 'money', 'flag']}
        placeholder="Name, organisation, next step…  /" />

      {pickedRows.length > 0 && (
        <InPane slot="lp-pane-actions">
          <BulkLpActions key={pickedRows.length ? 'on' : 'off'} rows={pickedRows} statuses={statuses}
            initialStatus={nextStatus(one?.id)} onClear={view.clearPicked} hidden={pickedRows.filter((r) => !shownIds.has(r.id)).length} />
        </InPane>
      )}

      <div className="card">
        <div className={s.head}>
          <h2>{all ? 'All statuses' : one?.label ?? 'Pipeline'}</h2>
          <div className={s.headMeta}>
            {n(shown.length)}{active ? ` of ${n(all ? rows.length : counts.all.get(one?.id as Status) ?? 0)}` : ''} LPs
            {groups.length !== shown.length && ` in ${n(groups.length)} rows`}
            {one && <span> · {one.means}</span>}
          </div>
          <div className={s.headTools}>
            {picked.size > 0 && <span className={s.small} style={{ margin: 0 }}>{n(picked.size)} selected</span>}
            <button type="button" className={s.linkBtn} disabled={!shown.length}
              onClick={() => (shown.every((r) => picked.has(r.id)) ? pick(shown.map((r) => r.id), false) : pick(shown.map((r) => r.id), true))}>
              {shown.length && shown.every((r) => picked.has(r.id)) ? 'Unselect all' : `Select all ${n(shown.length)}`}
            </button>
          </div>
        </div>

        {groups.length === 0 ? (
          <div className={s.emptyWrap}>
            <div className="empty">
              <span className="stat unavailable"><i />Nobody here</span>
              <h3>{!rows.length ? 'No pursuits are recorded for this vehicle yet.' : active ? `No LP ${all ? '' : `at ${one?.label} `}matches.` : `No LP is at ${one?.label ?? 'these statuses'}.`}</h3>
              <p>{!rows.length ? 'An empty table, not a failed read.' : active ? 'The search or the filters leave this empty; the cards above count what they do match.' : 'An empty status, not a failed read. The cards above show where everyone is.'}</p>
              {active && <button type="button" className="btn" onClick={() => view.setF(EMPTY)}>Clear the search and filters</button>}
            </div>
          </div>
        ) : (
          <div className={s.scroll}>
            <table className={s.table}>
              <thead>
                <tr>
                  <th className={s.cCheck}><input type="checkbox" aria-label="Select the LPs on screen" checked={allTicked} onChange={(e) => pick(visibleIds, e.target.checked)} /></th>
                  <Th k="name" className={s.cLp}>LP</Th>
                  <Th k="score" className={s.cScore}>Score</Th>
                  {all && <Th k="status" className={s.cStatus}>Status</Th>}
                  {byVehicle && <Th k="vehicle" className={s.cVehicle}>Vehicle</Th>}
                  <Th k="owner" className={s.cOwner}>Owner</Th>
                  <Th k="capacity" className={s.cCap}>Capacity</Th>
                  <Th k="where" className={s.cWhere}>Where</Th>
                  <Th k="route" className={s.cRoutes}>Routes</Th>
                  <Th k="meetings" className={s.cMeet}>Met</Th>
                  <Th k="touch" className={s.cTouch}>Last touch</Th>
                  <Th k="read" className={s.cRead}>Their read</Th>
                  <Th k="ladder" className={s.cEv}>Evidence</Th>
                </tr>
              </thead>
              <tbody>
                {visible.map((g) => (
                  <Fragment key={g.id}>
                    {g.org && (
                      <tr className={s.orgRow}>
                        <td className={s.cCheck}>
                          <input type="checkbox" aria-label={`Select everyone at ${g.org}`} checked={g.people.every((r) => picked.has(r.id))}
                            onChange={(e) => pick(g.people.map((r) => r.id), e.target.checked)} />
                        </td>
                        <td colSpan={11 + (all ? 1 : 0) + (byVehicle ? 1 : 0)}>
                          <span className={s.orgName}><Icon name="folder" title="Organisation" />{g.org}<small>{n(g.people.length)} {g.people[0]!.isOrg ? 'pursuits' : 'people'} here, each with their own status and evidence</small></span>
                        </td>
                      </tr>
                    )}
                    {g.people.map((r, i) => (
                      <Row key={r.id} r={r} member={Boolean(g.org)} last={i === g.people.length - 1} picked={picked.has(r.id)} onPick={pick} onOpen={open}
                        all={all} byVehicle={byVehicle} statusLabel={statusLabel(r.status)} rungNames={rungNames} now={now} />
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {groups.length > limit && (
          <div className={s.more}>
            <button type="button" className="btn" onClick={() => setLimit((x) => x + PAGE)}>Show {n(Math.min(PAGE, groups.length - limit))} more</button>
            <span>{n(limit)} of {n(groups.length)} shown. Search and filters cover all of them.</span>
          </div>
        )}
      </div>
    </section>
  );
}

/** A sensible first choice in the status action: the next status along. */
function nextStatus(from: Status | undefined): Status {
  const order: Status[] = ['new', 'sourcing', 'selected', 'connecting', 'discussing', 'committed'];
  const i = from ? order.indexOf(from) : -1;
  return i >= 0 && i < order.length - 1 ? order[i + 1]! : 'selected';
}

const lpHref = (r: PipelineRow) => `/${r.vehicleSlug}/pipeline/${r.id}`;

const Row = memo(function Row({ r, member, last, picked, onPick, onOpen, all, byVehicle, statusLabel, rungNames, now }: {
  r: PipelineRow; member: boolean; last: boolean; picked: boolean; onPick: (ids: string[], on: boolean) => void;
  onOpen: (r: PipelineRow, e?: { metaKey?: boolean; ctrlKey?: boolean }) => void;
  all: boolean; byVehicle: boolean; statusLabel: string; rungNames: string[]; now: number;
}) {
  const other = member ? (r.orgFirst ? r.name : null) : second(r);
  const read = r.readSuperseded ? null : r.read;
  const touch = fmtShort(r.lastTouch, now);
  return (
    <tr className={cx(s.row, member && s.member, last && s.last, picked && s.picked)} tabIndex={0}
      onClick={(e) => { if ((e.target as HTMLElement).closest('a,button,input,label,summary,details')) return; onOpen(r, e); }}
      onKeyDown={(e) => { if (e.key === 'Enter' && e.target === e.currentTarget) onOpen(r, e); }}>
      <td className={s.cCheck}><input type="checkbox" aria-label={`Select ${lead(r)}`} checked={picked} onChange={(e) => onPick([r.id], e.target.checked)} /></td>
      <td className={s.cLp}>
        <div className={s.lpName}>
          <span className={s.kind}><Icon name={r.isOrg || (r.orgFirst && !member) ? 'folder' : 'person'} title={r.isOrg || (r.orgFirst && !member) ? 'Organisation' : 'Person'} /></span>
          <a href={lpHref(r)}>{member ? r.name : lead(r)}</a>
        </div>
        {other && other !== (member ? r.name : lead(r)) && <div className={s.second}>{other}</div>}
        {r.headline && <div className={s.headline} title={r.headline}>{r.headline}</div>}
        {r.people.length > 0 && (
          <div className={s.people}>
            <span><Icon name="person" title="People at this organisation" /></span><span>
            {r.people.slice(0, 3).map((p, i) => <span key={`${p.id}:${p.role}`}>{i > 0 && ', '}<a href={`/orgs/${p.id}`}>{p.name}</a></span>)}
            {r.people.length > 3 && <> and {n(r.people.length - 3)} more</>}
            </span>
          </div>
        )}
        {r.doNotContact && <span className={s.dnc}>Do not contact</span>}
        <div className={s.meta}>
          {all && <span className={s.mStatus}>{statusLabel}</span>}
          {byVehicle && <span className={s.mVehicle}>{r.vehicle}</span>}
          <span className={s.mOwner}>Owner: {r.owner}</span>
          {r.capacity && !/unknown/i.test(r.capacity) && <span className={s.mCap}>{r.capacity}</span>}
          {r.route !== null && r.route > 0 && <span className={s.mRoutes}>{n(r.route)} {r.route === 1 ? 'route' : 'routes'}</span>}
          {r.meetings > 0 && <span className={s.mMeet}>met {r.meetings}×</span>}
          {touch && <span className={s.mTouch}>touched {touch}</span>}
          {read && <span className={s.mRead}>{read}</span>}
        </div>
      </td>
      <td className={s.cScore}><ScoreMark r={r} href={`/${r.vehicleSlug}/fit/${r.entityId}`} /></td>
      {all && <td className={s.cStatus}>{statusLabel}</td>}
      {byVehicle && <td className={cx(s.cVehicle, s.none)}>{r.vehicle}</td>}
      <td className={cx(s.cOwner, s.none)}>{r.owner}</td>
      <td className={s.cCap}>{r.capacity && !/unknown/i.test(r.capacity) ? r.capacity : <span className={s.none}>—</span>}</td>
      <td className={s.cWhere}>
        {r.money && (
          <div className={s.money}><Icon name="coin" title="Money" />{r.money.state} {usdM(r.money.amount)}
            {r.money.signedPer && <span className={s.none} style={{ fontWeight: 400 }}> · signed {r.money.signedPer}</span>}
            {r.money.hard && <span className={s.none} style={{ fontWeight: 400 }}> · {usdM(r.money.wired)} wired</span>}
          </div>
        )}
        {r.ended && <div>{r.ended}</div>}
        {r.next && <div className={s.next} title={r.next}>{r.next}</div>}
        {r.nextOn && <span className={s.small}>Due {fmtShort(r.nextOn, now)}</span>}
        {r.ahead && <span className={s.ahead}>A meeting is on record: Discussing?</span>}
        {r.said && <span className={s.small}>Affinity: &ldquo;{r.said}&rdquo;{r.implied.length ? ` — ${r.implied.join(', ')}` : ''}</span>}
        {r.riskCount > 0 && (
          <details className={s.flags}>
            <summary>{n(r.riskCount)} {r.riskCount === 1 ? 'flag' : 'flags'}</summary>
            <ul>
              {r.risks.map((x, i) => <li key={i}>{x}</li>)}
              {r.riskCount > r.risks.length && <li>and {n(r.riskCount - r.risks.length)} more on the <a href={lpHref(r)}>LP&rsquo;s page</a></li>}
            </ul>
          </details>
        )}
      </td>
      <td className={s.cRoutes}>
        <a className={cx(s.fig, !r.route && s.zero)} href={`/${r.vehicleSlug}/routes?target=${r.entityId}`} title="Recorded warm intro routes">
          <Icon name="link" title="Routes" />{r.route ?? '—'}
        </a>
      </td>
      <td className={s.cMeet}>
        <span className={cx(s.fig, !r.meetings && s.zero)} title={r.lastMeeting ? `Last met ${fmtShort(r.lastMeeting, now)}` : 'No meeting on record'}>
          {r.meetings ? <><Icon name="calendar" title="Meetings" />{r.meetings}</> : '—'}
        </span>
        {r.lastMeeting && <span className={s.small}>{fmtShort(r.lastMeeting, now)}</span>}
      </td>
      <td className={s.cTouch}>
        {touch ? <span className={s.date}>{touch}</span> : <span className={s.none}>—</span>}
        {r.waitingSince && <span className={s.small}>waiting on them</span>}
      </td>
      <td className={s.cRead}>
        {r.read && r.readSuperseded ? <s className={s.none} title={`Superseded: since then, ${r.readSuperseded}`}>{r.read}</s>
          : r.read ? <span className={cx(s.read, r.readSuggested && s.suggested)}>{r.read}</span> : <span className={s.none}>—</span>}
        {r.readOn && <span className={s.small}>{fmtShort(r.readOn, now)}{r.readSuperseded ? ' · superseded' : r.readSuggested ? ' · suggested' : ''}{r.readOld && !r.readSuperseded ? ' · old' : ''}</span>}
      </td>
      <td className={s.cEv}><Ladder r={r} names={rungNames} /></td>
    </tr>
  );
});
