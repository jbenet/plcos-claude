'use client';

import { Fragment, memo, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BulkLpActions } from './BulkLpActions';
import { EMPTY, groupRows, lead, orgSummary, second, type OrgSummary, type PipelineRow, type SortKey, type Status } from './pipeline-model';
import { cx, Flags, fmtShort, FilterLine, Icon, InPane, Ladder, n, ScoreMark, scoreTone, useLpView, usdM, type StatusInfo } from './lp-view';
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
            <table className={cx(s.table, s.pipe)}>
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
                {visible.map((g) => {
                  const cols = { all, byVehicle, rungNames, now, onPick: pick, onOpen: open };
                  if (g.people.length === 1) {
                    const r = g.people[0]!;
                    return <Row key={g.id} r={r} picked={picked.has(r.id)} statusLabel={statusLabel(r.status)} {...cols} />;
                  }
                  // An organisation with several people pursued leads as a row of its own (issue
                  // 0092): its own pursuit when it has one, otherwise a reading of its people's.
                  const own = g.people[0]!.isOrg ? g.people[0]! : null;
                  const members = own ? g.people.slice(1) : g.people;
                  const ids = g.people.map((r) => r.id);
                  const sum = own ? null : orgSummary(members);
                  return (
                    <Fragment key={g.id}>
                      {own
                        ? <Row r={own} picked={picked.has(own.id)} statusLabel={statusLabel(own.status)} people={members.length} listed={members.map((m) => m.entityId).join(',')} {...cols} />
                        : <OrgRow sum={sum!} picked={ids.every((id) => picked.has(id))} statusLabel={statusLabel(sum!.status)} ids={ids} {...cols} />}
                      {members.map((r, i) => (
                        <MemberRow key={r.id} r={r} last={i === members.length - 1} picked={picked.has(r.id)} statusLabel={statusLabel(r.status)} {...cols} />
                      ))}
                    </Fragment>
                  );
                })}
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

interface Cols {
  all: boolean; byVehicle: boolean; rungNames: string[]; now: number;
  onPick: (ids: string[], on: boolean) => void;
  onOpen: (r: PipelineRow, e?: { metaKey?: boolean; ctrlKey?: boolean }) => void;
}
/** A row opens its LP; the controls inside it keep their own clicks. */
const rowClick = (open: () => void) => (e: React.MouseEvent) => {
  if ((e.target as HTMLElement).closest('a,button,input,label')) return;
  open();
};
const known = (c: string | null) => (c && !/unknown/i.test(c) ? c : null);

/** One LP: a person, an organisation, or an organisation's person where it leads (issue 0013). */
const Row = memo(function Row({ r, picked, statusLabel, people = 0, listed, all, byVehicle, rungNames, now, onPick, onOpen }: Cols & {
  r: PipelineRow; picked: boolean; statusLabel: string;
  /** Its people pursued in this vehicle, listed under it (issue 0092), and so not named again here. */
  people?: number; listed?: string;
}) {
  const affiliated = listed ? r.people.filter((p) => !listed.split(',').includes(p.id)) : r.people;
  const other = second(r);
  const read = r.readSuperseded ? null : r.read;
  const touch = fmtShort(r.lastTouch, now);
  return (
    <tr className={cx(s.row, picked && s.picked, people > 0 && s.lead)} tabIndex={0}
      onClick={rowClick(() => onOpen(r))}
      onKeyDown={(e) => { if (e.key === 'Enter' && e.target === e.currentTarget) onOpen(r, e); }}>
      <td className={s.cCheck}><input type="checkbox" aria-label={`Select ${lead(r)}`} checked={picked} onChange={(e) => onPick([r.id], e.target.checked)} /></td>
      <td className={s.cLp}>
        <div className={s.lpName}><a href={lpHref(r)}>{lead(r)}</a></div>
        {other && <div className={s.second}>{other}</div>}
        {people > 0 && <div className={s.second}>{n(people)} of its people pursued, below</div>}
        {r.headline && <div className={s.headline} title={r.headline}>{r.headline}</div>}
        {affiliated.length > 0 && (
          <div className={s.people}>
            <span><Icon name="person" title="People at this organisation" /></span><span>
            {affiliated.slice(0, 3).map((p, i) => <span key={`${p.id}:${p.role}`}>{i > 0 && ', '}<a href={`/orgs/${p.id}`}>{p.name}</a></span>)}
            {affiliated.length > 3 && <> and {n(affiliated.length - 3)} more</>}
            </span>
          </div>
        )}
        {r.doNotContact && <span className={s.dnc}>Do not contact</span>}
        <div className={s.meta}>
          {all && <span className={s.mStatus}>{statusLabel}</span>}
          {byVehicle && <span className={s.mVehicle}>{r.vehicle}</span>}
          <span className={s.mOwner}>Owner: {r.owner}</span>
          {known(r.capacity) && <span className={s.mCap}>{r.capacity}</span>}
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
      <td className={s.cCap}>{known(r.capacity) ?? <span className={s.none}>—</span>}</td>
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
        <Flags r={r} href={lpHref(r)} />
      </td>
      <td className={s.cRoutes}><Routes r={r} /></td>
      <td className={s.cMeet}><Met meetings={r.meetings} last={r.lastMeeting} now={now} /></td>
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

function Routes({ r }: { r: PipelineRow }) {
  return (
    <a className={cx(s.fig, !r.route && s.zero)} href={`/${r.vehicleSlug}/routes?target=${r.entityId}`} title="Recorded warm intro routes">
      <Icon name="link" title="Routes" />{r.route ?? '—'}
    </a>
  );
}
function Met({ meetings, last, now, compact }: { meetings: number; last: string | null; now: number; compact?: boolean }) {
  return (
    <>
      <span className={cx(s.fig, !meetings && s.zero)} title={last ? `Last met ${fmtShort(last, now)}` : 'No meeting on record'}>
        {meetings ? <><Icon name="calendar" title="Meetings" />{meetings}</> : '—'}
      </span>
      {last && !compact && <span className={s.small}>{fmtShort(last, now)}</span>}
    </>
  );
}

/**
 * An organisation none of whose own pursuit is recorded, ranked from its people (issue 0092). It
 * opens its best-scored person's page, which leads with the organisation and lists its people.
 */
const OrgRow = memo(function OrgRow({ sum, ids, picked, statusLabel, all, byVehicle, now, onPick, onOpen }: Cols & {
  sum: OrgSummary; ids: string[]; picked: boolean; statusLabel: string;
}) {
  const r = sum.lead;
  const touch = fmtShort(sum.lastTouch, now);
  return (
    <tr className={cx(s.row, s.lead, picked && s.picked)} tabIndex={0}
      onClick={rowClick(() => onOpen(r))}
      onKeyDown={(e) => { if (e.key === 'Enter' && e.target === e.currentTarget) onOpen(r, e); }}>
      <td className={s.cCheck}><input type="checkbox" aria-label={`Select everyone at ${sum.org}`} checked={picked} onChange={(e) => onPick(ids, e.target.checked)} /></td>
      <td className={s.cLp}>
        <div className={s.lpName}><a href={lpHref(r)}>{sum.org}</a></div>
        <div className={s.second}>{n(sum.count)} people pursued, below</div>
        {sum.doNotContact && <span className={s.dnc}>Do not contact</span>}
        <div className={s.meta}>
          {all && <span className={s.mStatus}>{statusLabel}</span>}
          {byVehicle && <span className={s.mVehicle}>{r.vehicle}</span>}
          <span className={s.mOwner}>Owner: {sum.owners.length === 1 ? sum.owners[0] : `${sum.owners.length} owners`}</span>
          {known(sum.capacity) && <span className={s.mCap}>{sum.capacity}</span>}
          {sum.route ? <span className={s.mRoutes}>{n(sum.route)} routes</span> : null}
          {sum.meetings > 0 && <span className={s.mMeet}>met {sum.meetings}×</span>}
          {touch && <span className={s.mTouch}>touched {touch}</span>}
          {sum.read && <span className={s.mRead}>{sum.read}</span>}
        </div>
      </td>
      <td className={s.cScore}>
        {sum.score === null ? <div className={s.score}><span className={cx(s.scoreNum, s.none)}>—</span><span className={s.scoreKind}>Unscored</span></div> : (
          <div className={s.score} title={`The best score among its ${sum.count} people: ${sum.scoreFrom}'s.`}>
            <span className={s.scoreNum}>{sum.score}</span>
            <span className={s.bar} aria-hidden><i className={scoreTone(sum.score)} style={{ width: `${sum.score}%` }} /></span>
            <span className={s.scoreKind}>Best of {sum.count}</span>
          </div>
        )}
      </td>
      {all && <td className={s.cStatus}>{statusLabel}</td>}
      {byVehicle && <td className={cx(s.cVehicle, s.none)}>{r.vehicle}</td>}
      <td className={cx(s.cOwner, s.none)}>{sum.owners.length === 1 ? sum.owners[0] : sum.owners.join(', ')}</td>
      <td className={s.cCap}>{known(sum.capacity) ?? <span className={s.none}>—</span>}</td>
      <td className={s.cWhere}>
        {sum.money && <div className={s.money}><Icon name="coin" title="Money" />{sum.money.state} {usdM(sum.money.amount)}</div>}
        {sum.money && <span className={s.small}>from {sum.money.from === 1 ? 'one of them' : `${sum.money.from} of them`}</span>}
        {r.next && <div className={s.next} title={r.next}>{r.next}</div>}
        {r.next && <span className={s.small}>for {r.name}</span>}
      </td>
      <td className={s.cRoutes}><span className={cx(s.fig, !sum.route && s.zero)} title="Recorded routes to any of its people"><Icon name="link" title="Routes" />{sum.route ?? '—'}</span></td>
      <td className={s.cMeet}><Met meetings={sum.meetings} last={sum.lastMeeting} now={now} /></td>
      <td className={s.cTouch}>{touch ? <span className={s.date}>{touch}</span> : <span className={s.none}>—</span>}</td>
      <td className={s.cRead}>{sum.read ? <span className={s.read}>{sum.read}</span> : <span className={s.none}>—</span>}</td>
      <td className={s.cEv}>
        <div className={s.ladder} role="img" aria-label={`Furthest evidence: ${sum.furthest.rungLabel}, ${sum.furthest.name}`}>
          {sum.furthest.rungs.map((x, i) => <span key={i} className={cx(x !== 'off' && s[x], i === sum.furthest.needs && s.needs)} />)}
        </div>
        <div className={s.ladderLabel}>{sum.furthest.rungLabel}{sum.furthest.rung > 0 ? `, ${sum.furthest.name}` : ''}</div>
      </td>
    </tr>
  );
});

/**
 * A person under their organisation (issue 0092): indented, smaller, and without what the row above
 * already says — the organisation, its capacity, Affinity's word. The row opens their LP page.
 */
const MemberRow = memo(function MemberRow({ r, last, picked, statusLabel, all, byVehicle, now, onPick, onOpen }: Cols & {
  r: PipelineRow; last: boolean; picked: boolean; statusLabel: string;
}) {
  const read = r.readSuperseded ? null : r.read;
  const touch = fmtShort(r.lastTouch, now);
  return (
    <tr className={cx(s.row, s.member, last && s.last, picked && s.picked)} tabIndex={0}
      onClick={rowClick(() => onOpen(r))}
      onKeyDown={(e) => { if (e.key === 'Enter' && e.target === e.currentTarget) onOpen(r, e); }}>
      <td className={s.cCheck}><input type="checkbox" aria-label={`Select ${r.name}`} checked={picked} onChange={(e) => onPick([r.id], e.target.checked)} /></td>
      <td className={s.cLp}>
        <a href={lpHref(r)}>{r.name}</a>
        {r.doNotContact && <span className={s.dnc} style={{ marginLeft: 6 }}>Do not contact</span>}
        <div className={s.meta}>
          {all && <span className={s.mStatus}>{statusLabel}</span>}
          <span className={s.mOwner}>Owner: {r.owner}</span>
          {r.meetings > 0 && <span className={s.mMeet}>met {r.meetings}×</span>}
          {touch && <span className={s.mTouch}>touched {touch}</span>}
        </div>
      </td>
      <td className={s.cScore}>{r.score === null ? <span className={s.none}>—</span> : <span className={s.scoreNum} title={r.scoreKind}>{r.score}</span>}</td>
      {all && <td className={s.cStatus}>{statusLabel}</td>}
      {byVehicle && <td className={s.cVehicle} />}
      <td className={cx(s.cOwner, s.none)}>{r.owner}</td>
      <td className={s.cCap} />
      <td className={s.cWhere}>
        {r.money && <div className={s.money}>{r.money.state} {usdM(r.money.amount)}</div>}
        {r.ended && <div className={s.one}>{r.ended}</div>}
        {r.next && <div className={s.one} title={r.next}>{r.next}</div>}
        {r.ahead && <span className={s.ahead}>A meeting is on record: Discussing?</span>}
      </td>
      <td className={s.cRoutes}><Routes r={r} /></td>
      <td className={s.cMeet}><Met meetings={r.meetings} last={r.lastMeeting} now={now} compact /></td>
      <td className={s.cTouch}>{touch ? <span className={s.date}>{touch}</span> : <span className={s.none}>—</span>}</td>
      <td className={s.cRead}>{read ? <span className={cx(s.read, r.readSuggested && s.suggested)}>{read}</span> : <span className={s.none}>—</span>}</td>
      <td className={s.cEv}>
        <div className={s.ladder} role="img" aria-label={`Evidence: ${r.rungLabel}`} title={r.rungLabel}>
          {r.rungs.map((x, i) => <span key={i} className={cx(x !== 'off' && s[x], i === r.needs && s.needs)} />)}
        </div>
      </td>
    </tr>
  );
});
