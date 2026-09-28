'use client';

import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BulkLpActions } from './BulkLpActions';
import { EMPTY, rankRows, unitShown, unitsFrom, unitsOn, lead, type PipelineRow, type SortKey, type Status } from './pipeline-model';
import { CapacityTag, LpWho, units } from './LpWho';
import { UnitIcon } from './UnitIcon';
import { MoveButton, UndoToast, useMove } from './MoveToSelected';
import { cx, Flags, fmtShort, FilterLine, Icon, InPane, Ladder, n, ScoreMark, useLpView, usdM, type StatusInfo } from './lp-view';
import s from './lp-tables.module.css';
import u from './lp-units.module.css';

export type { PipelineRow, Status } from './pipeline-model';

/**
 * The pipeline, as one interactive table (N54; issues 0067 and 0083). The look is the one before
 * 27 Sep — status cards, one filter line, a quiet table — with the asks on top: a score, sorting
 * by any column (score first), All after Passed, and actions on the LPs ticked. Every pursuit in
 * scope arrives once; search, filters and order run here.
 *
 * The same LP units and keyboard as Selection (issue 0111; docs/23): organisations, each once with
 * its people named in the row, then individuals; ↑↓ or j/k move, x ticks, Enter opens, s moves a
 * New or Sourcing LP to Selected and u undoes it.
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
  // One list, organisations and individuals ranked together (issue 0113), each row marked with its type.
  const ranked = useMemo(() => rankRows(shown, sort.key, sort.dir), [shown, sort]);
  const visible = ranked.slice(0, limit);
  const orgCount = useMemo(() => ranked.filter((r) => r.isOrg).length, [ranked]);
  const visibleIds = visible.map((r) => r.id);
  const allTicked = visibleIds.length > 0 && visibleIds.every((id) => picked.has(id));
  const open = (r: PipelineRow, e?: { metaKey?: boolean; ctrlKey?: boolean }) => {
    const href = lpHref(r);
    if (e?.metaKey || e?.ctrlKey) window.open(href, '_blank'); else router.push(href);
  };

  // The keyboard (issue 0111), as on Selection: a focus that moves through the list.
  const [focusId, setFocusId] = useState<string | null>(null);
  const focus = focusId ? ranked.find((r) => r.id === focusId) ?? null : null;
  const reveal = (r: PipelineRow) => {
    const i = ranked.indexOf(r);
    if (i >= limit) setLimit(Math.ceil((i + 1) / PAGE) * PAGE);
    setFocusId(r.id);
    requestAnimationFrame(() => document.querySelector(`[data-lp="${r.id}"]`)?.scrollIntoView({ block: 'nearest' }));
  };
  // A link to the same person's or firm's other row: if the toggles or the status hide it, show it first.
  const [pending, setPending] = useState<string | null>(null);
  const jump = (id: string) => {
    const r = ranked.find((x) => x.id === id);
    if (r) { reveal(r); return; }
    const target = rows.find((x) => x.id === id);
    if (!target) return;
    setPending(id);
    if (!unitShown(target, view.f.units)) view.set('units', target.isOrg ? unitsFrom(true, unitsOn(view.f.units).individuals) : unitsFrom(unitsOn(view.f.units).firms, true));
    if (!enabled.includes(target.status)) setEnabled(statuses.map((x) => x.id));
  };
  useEffect(() => {
    if (!pending) return;
    const r = ranked.find((x) => x.id === pending);
    if (r) { setPending(null); reveal(r); }
    // reveal reads the current list; it runs once the list includes the row.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, ranked]);
  // Move to Selected applies to New and Sourcing: the ticked ones, else the one in focus.
  const mv = useMove('pipeline');
  const movable = (r: PipelineRow) => r.status === 'new' || r.status === 'sourcing';
  const moveNow = async () => {
    const targets = (pickedRows.length ? pickedRows : focus ? [focus] : []).filter(movable);
    if (!targets.length) return;
    const i = focus ? ranked.indexOf(focus) : -1, going = new Set(targets.map((r) => r.id));
    const next = pickedRows.length ? null : ranked.slice(i + 1).find((r) => !going.has(r.id)) ?? null;
    const done = await mv.move(targets);
    if (!done) return;
    if (pickedRows.length) view.clearPicked(); else if (next && one) reveal(next);
  };
  const keys = useRef({ ranked, focus, picked, moveNow, reveal, undo: mv.undo });
  keys.current = { ranked, focus, picked, moveNow, reveal, undo: mv.undo };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target instanceof HTMLElement ? e.target : null;
      if (el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) && !(el as HTMLInputElement).type?.match(/checkbox/) || el.closest('dialog, [role="dialog"]'))) return;
      const { ranked, focus, picked, moveNow, reveal, undo } = keys.current;
      if (e.key === 'u' && !e.shiftKey) { e.preventDefault(); void undo(); return; }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'j' || e.key === 'k') {
        const i = focus ? ranked.indexOf(focus) : -1;
        const down = e.key === 'ArrowDown' || e.key === 'j';
        const next = ranked[focus ? Math.max(0, Math.min(ranked.length - 1, i + (down ? 1 : -1))) : 0];
        if (!next) return;
        e.preventDefault();
        reveal(next);
        return;
      }
      if (!focus) return;
      if (e.key === 'x') { e.preventDefault(); pick([focus.id], !picked.has(focus.id)); }
      else if (e.key === 's' && !e.shiftKey) { e.preventDefault(); void moveNow(); }
      else if (e.key === 'Enter' && (!el || el === document.body || el.closest('[data-lp]')) && !el?.closest('a,button,input')) { e.preventDefault(); open(focus); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // pick and open are stable in effect; the rest is read through the ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const span = 2 + (all ? 1 : 0) + (byVehicle ? 1 : 0) + 9;
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

      <FilterLine view={view} rows={rows} showVehicle={showVehicle} keys={['meetings', 'touch', 'read', 'money', 'flag', 'strategic']}
        placeholder="Name, organisation, next step…  /" />

      {pickedRows.length > 0 && (
        <InPane slot="lp-pane-actions">
          <BulkLpActions key={pickedRows.length ? 'on' : 'off'} rows={pickedRows} statuses={statuses}
            initialStatus={nextStatus(one?.id)} onClear={view.clearPicked} hidden={pickedRows.filter((r) => !shownIds.has(r.id)).length}
            onStatusSaved={mv.remember}
            primary={pickedRows.some(movable) ? <MoveButton state={mv} rows={pickedRows.filter(movable)} ticked onMove={() => void moveNow()} /> : undefined} />
        </InPane>
      )}

      <div className="card">
        <div className={s.head}>
          <h2>{all ? 'All statuses' : one?.label ?? 'Pipeline'}</h2>
          <div className={s.headMeta}>
            {n(shown.length)}{active ? ` of ${n(all ? rows.length : counts.all.get(one?.id as Status) ?? 0)}` : ''} LPs
            {` · ${units(orgCount, ranked.length - orgCount)}`}
            {one && <span> · {one.means}</span>}
          </div>
          <div className={s.keysHint}><kbd>↑</kbd><kbd>↓</kbd> move · <kbd>x</kbd> tick · <kbd>s</kbd> to Selected · <kbd>↵</kbd> open</div>
          <div className={s.headTools}>
            {picked.size > 0 && <span className={s.small} style={{ margin: 0 }}>{n(picked.size)} selected</span>}
            <button type="button" className={s.linkBtn} disabled={!shown.length}
              onClick={() => (shown.every((r) => picked.has(r.id)) ? pick(shown.map((r) => r.id), false) : pick(shown.map((r) => r.id), true))}>
              {shown.length && shown.every((r) => picked.has(r.id)) ? 'Unselect all' : `Select all ${n(shown.length)}`}
            </button>
          </div>
        </div>

        {shown.length === 0 ? (
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
                {visible.map((r) => <Row key={r.id} r={r} picked={picked.has(r.id)} focused={r.id === focus?.id} statusLabel={statusLabel(r.status)}
                  all={all} byVehicle={byVehicle} rungNames={rungNames} now={now} onPick={pick} onOpen={open} onFocus={setFocusId} onJump={jump} />)}
                {ranked.length > visible.length && <tr className={u.moreRow}><td colSpan={span}>
                  <button type="button" className="btn" onClick={() => setLimit((x) => x + PAGE)}>Show {n(Math.min(PAGE, ranked.length - visible.length))} more</button>
                  {n(visible.length)} of {n(ranked.length)} shown. Search and filters cover all of them.
                </td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <UndoToast state={mv} onUndo={() => void mv.undo()} />
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
  onFocus: (id: string) => void;
  onJump: (id: string) => void;
}
/** A row opens its LP; the controls inside it keep their own clicks. */
const rowClick = (open: () => void) => (e: React.MouseEvent) => {
  if ((e.target as HTMLElement).closest('a,button,input,label')) return;
  open();
};
const known = (c: string | null) => (c && !/unknown/i.test(c) ? c : null);

/** One LP unit (docs/23): an organisation with its people named, or an individual with their firms. */
const Row = memo(function Row({ r, picked, focused, statusLabel, all, byVehicle, rungNames, now, onPick, onOpen, onFocus, onJump }: Cols & {
  r: PipelineRow; picked: boolean; focused: boolean; statusLabel: string;
}) {
  const read = r.readSuperseded ? null : r.read;
  const touch = fmtShort(r.lastTouch, now);
  return (
    <tr data-lp={r.id} className={cx(s.row, picked && s.picked, focused && u.focus)} tabIndex={0} aria-selected={focused}
      onClick={rowClick(() => onOpen(r))} onFocus={(e) => { if (e.target === e.currentTarget) onFocus(r.id); }}
      onKeyDown={(e) => { if (e.key === 'Enter' && e.target === e.currentTarget) { e.stopPropagation(); onOpen(r, e); } }}>
      <td className={s.cCheck}><input type="checkbox" aria-label={`Select ${lead(r)}`} checked={picked} onChange={(e) => onPick([r.id], e.target.checked)} /></td>
      <td className={s.cLp}>
        <div className={u.nameLine}><UnitIcon org={r.isOrg} /><div>
        <div className={s.lpName}><a href={lpHref(r)}>{lead(r)}</a><CapacityTag r={r} /></div>
        <LpWho r={r} onJump={onJump} />
        {r.headline && <div className={s.headline} title={r.headline}>{r.headline}</div>}
        {r.doNotContact && <span className={s.dnc}>Do not contact</span>}
        </div></div>
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
