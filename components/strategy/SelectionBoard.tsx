'use client';

import { Fragment, memo, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { scoreDetailAction } from '@/app/selection/actions';
import type { ScoreDetail } from '@/lib/pipeline-data';
import { BulkLpActions } from './BulkLpActions';
import { groupRows, EMPTY, lead, second, type PipelineRow, type SortKey, type Status } from './pipeline-model';
import { cx, Disclose, fmt, fmtShort, FilterLine, Icon, Ladder, n, scoreTone, useLpView, usdM, type StatusInfo } from './lp-view';
import s from './lp-tables.module.css';

/**
 * Selection (module 03; issues 0071 and 0089): who to work next. A ranked list beside the reasons
 * for the one in focus, after the M03 board — the score, what it rests on, and a way in. New and
 * Sourcing are shown to start; any other status can be toggled in, or all of them at once.
 */

const PAGE = 60;
const SORT_LABEL: Partial<Record<SortKey, string>> = {
  score: 'score', capacity: 'check size', route: 'routes', status: 'stage', meetings: 'meetings', touch: 'last touch', name: 'name',
};
const DEFAULT: Status[] = ['new', 'sourcing'];

interface Props {
  rows: PipelineRow[];
  statuses: StatusInfo[];
  rungNames: string[];
  initialFilters?: Record<string, string>;
  showVehicle: boolean;
  asOf: string;
}

export function SelectionBoard({ rows, statuses, rungNames, initialFilters, showVehicle, asOf }: Props) {
  const router = useRouter();
  const view = useLpView({ rows, statuses, asOf, initialFilters, mode: 'selection' });
  const { enabled, setEnabled, counts, active, shown, sort, picked, pick, pickedRows, now } = view;
  const [limit, setLimit] = useState(PAGE);
  const shownIds = useMemo(() => new Set(shown.map((r) => r.id)), [shown]);
  useEffect(() => setLimit(PAGE), [enabled, view.f, sort]);
  const groups = useMemo(() => groupRows(shown, sort.key, sort.dir, rows), [shown, sort, rows]);
  const ranked = useMemo(() => groups.flatMap(g => g.people), [groups]);
  const visible = groups.slice(0, limit);
  const groupPosition = (id: string) => groups.findIndex(g => g.people.some(r => r.id === id)) + 1;
  const [focusId, setFocusId] = useState<string | null>(() => initialFilters?.lp ?? null);
  const focus = ranked.find((r) => r.id === focusId) ?? ranked[0] ?? null;
  const position = focus ? groupPosition(focus.id) : 0;
  const all = enabled.length === statuses.length;
  const byVehicle = showVehicle && new Set(rows.map((r) => r.vehicle)).size > 1;
  const scored = useMemo(() => shown.filter((r) => r.score !== null).length, [shown]);

  // Keep the focused LP in the address, so back and a shared link return to it.
  useEffect(() => {
    const u = new URL(window.location.href);
    if (focusId) u.searchParams.set('lp', focusId); else u.searchParams.delete('lp');
    if (u.toString() !== window.location.href) window.history.replaceState(window.history.state, '', u);
  }, [focusId]);

  // One copy of the reasons: beside the list when there is room, under the LP in focus when not.
  const wrap = useRef<HTMLElement>(null);
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const watch = new ResizeObserver(([entry]) => setNarrow((entry?.contentRect.width ?? 1000) <= 860));
    watch.observe(el);
    return () => watch.disconnect();
  }, []);

  const visibleIds = visible.flatMap(g => g.people.map(r => r.id));
  const allTicked = visibleIds.length > 0 && visibleIds.every((id) => picked.has(id));

  // The keyboard (issue 0091): up and down move the focus through the table, x ticks the LP in
  // focus, Enter opens it. Not while typing in a field or a dialog.
  const keys = useRef({ ranked, focus, limit, picked, groups });
  keys.current = { ranked, focus, limit, picked, groups };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target instanceof HTMLElement ? e.target : null;
      if (el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) && !(el as HTMLInputElement).type?.match(/checkbox/) || el.closest('dialog, [role="dialog"]'))) return;
      const { ranked, focus, limit, picked, groups } = keys.current;
      if (!focus) return;
      const i = ranked.indexOf(focus);
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'j' || e.key === 'k') {
        const next = ranked[Math.max(0, Math.min(ranked.length - 1, i + (e.key === 'ArrowDown' || e.key === 'j' ? 1 : -1)))];
        if (!next) return;
        e.preventDefault();
        if (groups.findIndex(g => g.people.some(r => r.id === next.id)) >= limit) setLimit((x) => x + PAGE);
        setFocusId(next.id);
        requestAnimationFrame(() => document.querySelector(`[data-lp="${next.id}"]`)?.scrollIntoView({ block: 'nearest' }));
      } else if (e.key === 'x') {
        e.preventDefault();
        pick([focus.id], !picked.has(focus.id));
      } else if (e.key === 'Enter' && (!el || el === document.body || el.closest('[data-lp]'))) {
        e.preventDefault();
        open(focus);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // open and pick are stable in effect; the rest is read through the ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const Th = ({ k, className, title, children }: { k: SortKey; className: string; title?: string; children: string }) => {
    const on = sort.key === k;
    return (
      <th className={className} aria-sort={on ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'} title={title}>
        <button type="button" className={cx(s.sortBtn, on && s.sorted)} onClick={() => view.sortBy(k)}>
          {children}{on ? (sort.dir === -1 ? ' ↓' : ' ↑') : ''}
        </button>
      </th>
    );
  };

  const toggle = (id: Status) => setEnabled(enabled.includes(id) ? enabled.filter((x) => x !== id) : statuses.map((x) => x.id).filter((x) => x === id || enabled.includes(x)));
  const open = (r: PipelineRow) => router.push(`/${r.vehicleSlug}/pipeline/${r.id}`);

  const detail = focus && <Why key={focus.id} r={focus} position={position} sortLabel={SORT_LABEL[sort.key] ?? 'score'} rungNames={rungNames} now={now}
    picked={picked.has(focus.id)} onPick={(on) => pick([focus.id], on)} />;

  return (
    <section ref={wrap} className={s.wrap} aria-label="LP selection">
      <div className={s.toggles} role="group" aria-label="Statuses shown">
        {statuses.map((x) => {
          const on = enabled.includes(x.id);
          const m = counts.all.get(x.id) ?? 0, k = counts.matching.get(x.id) ?? 0;
          return (
            <button key={x.id} type="button" className={cx(s.toggle, on && s.on)} aria-pressed={on} title={x.means} onClick={() => toggle(x.id)}>
              <i aria-hidden />{x.label} <b>{n(active ? k : m)}{active ? ` / ${n(m)}` : ''}</b>
            </button>
          );
        })}
        <span className={s.toggleSep} aria-hidden />
        <button type="button" className={cx(s.toggle, s.toggleAll, all && s.on)} aria-pressed={all}
          title={all ? 'Back to New and Sourcing' : 'Show every status'}
          onClick={() => setEnabled(all ? DEFAULT : statuses.map((x) => x.id))}>
          <i aria-hidden />All <b>{n(active ? view.filtered.length : rows.length)}</b>
        </button>
      </div>

      <FilterLine view={view} rows={rows} showVehicle={showVehicle} keys={['flag', 'touch', 'read']} placeholder="Search names, organisations, next steps…  /" />

      <div className={cx(s.selGrid, !focus && !pickedRows.length && s.alone)}>
        <div className={cx('card', s.rankCard)}>
          <div className={s.head}>
            <h2>Ranked</h2>
            <div className={s.headMeta}>
              {n(groups.length)} LP groups · {n(shown.length)} pursuits · {n(scored)} scored
              {enabled.length > 0 && !all && <span> · {enabled.map((id) => statuses.find((x) => x.id === id)?.label).join(', ')}</span>}
            </div>
            <div className={s.keysHint}><kbd>↑</kbd><kbd>↓</kbd> move · <kbd>x</kbd> tick · <kbd>↵</kbd> open</div>
          </div>

          {ranked.length === 0 ? (
            <div className={s.emptyWrap}>
              <div className="empty">
                <span className="stat unavailable"><i />Nobody here</span>
                <h3>{!rows.length ? 'No pursuits are recorded for this vehicle yet.' : !enabled.length ? 'No status is turned on.' : active ? 'No LP matches.' : `No LP is at ${enabled.map((id) => statuses.find((x) => x.id === id)?.label).join(' or ')}.`}</h3>
                <p>{!rows.length ? 'An empty list, not a failed read.' : !enabled.length ? 'Turn on a status above to list its LPs.' : active ? 'The search or the filters leave this empty; the counts above say what they do match.' : 'An empty status, not a failed read.'}</p>
                {active ? <button type="button" className="btn" onClick={() => view.setF(EMPTY)}>Clear the search and filters</button>
                  : rows.length > 0 && !all && <button type="button" className="btn" onClick={() => setEnabled(statuses.map((x) => x.id))}>Show every status ({n(rows.length)})</button>}
              </div>
            </div>
          ) : (
            <div className={s.scroll}>
              <table className={cx(s.table, s.ranked)} aria-label="Ranked LPs. Up and down move the focus; x ticks the LP in focus.">
                <thead>
                  <tr>
                    <th className={s.cCheck}><input type="checkbox" aria-label="Select the LPs on screen" checked={allTicked} onChange={(e) => pick(visibleIds, e.target.checked)} /></th>
                    <th className={s.cPos}>#</th>
                    <Th k="name" className={s.cLp}>LP</Th>
                    <Th k="score" className={s.cScore}>Score</Th>
                    <Th k="capacity" className={s.cCap} title="The estimated check size: the capacity band on file">Check size</Th>
                    <Th k="route" className={s.cRoutes}>Routes</Th>
                    <Th k="status" className={s.cStatus}>Stage</Th>
                    <Th k="meetings" className={s.cMeet}>Met</Th>
                    <Th k="touch" className={s.cTouch}>Last touch</Th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((g, i) => {
                    const own = g.people[0]!.isOrg ? g.people[0]! : null;
                    const grouped = Boolean(g.org) && (g.people.length > 1 || !own);
                    const ids = g.people.map(r => r.id);
                    return <Fragment key={g.id}>
                      {grouped && !own && <tr className={s.lead}>
                        <td className={s.cCheck}><input type="checkbox" aria-label={`Select people at ${g.org}`} checked={ids.every(id => picked.has(id))} onChange={e => pick(ids, e.target.checked)} /></td>
                        <td className={s.cPos}>{i + 1}</td>
                        <td className={s.cLp} colSpan={7}><div className={s.lpName}>{g.org}</div><div className={s.second}>{n(g.people.length)} people pursued, below</div></td>
                      </tr>}
                      {g.people.map((r, j) => <Fragment key={r.id}>
                        <RankRow r={r} position={grouped && !r.isOrg ? null : i + 1} member={grouped && !r.isOrg} last={j === g.people.length - 1}
                          focused={r.id === focus?.id} picked={picked.has(r.id)} byVehicle={byVehicle} now={now} onFocus={setFocusId} onPick={pick} />
                        {narrow && r.id === focus?.id && detail && <tr className={s.inlineRow}><td colSpan={9}><div className="card" style={{ marginBottom: 0 }}>{detail}</div></td></tr>}
                      </Fragment>)}
                    </Fragment>;
                  })}
                </tbody>
              </table>
            </div>
          )}
          {groups.length > limit && (
            <div className={s.more}>
              <button type="button" className="btn" onClick={() => setLimit((x) => x + PAGE)}>Show {n(Math.min(PAGE, groups.length - limit))} more</button>
              <span>{n(limit)} of {n(groups.length)} groups shown. Search covers all of them.</span>
            </div>
          )}
          <p className="cover">
            <b>What the score is:</b> the fit assessment where someone has made one; otherwise the proposed strategy&rsquo;s four
            readings — capacity, affinity, propensity, time to decision — weighted as the settings say. Unknown readings are left
            out, not guessed, and fewer than two known means unscored. It orders the work; it is not a probability of commitment.
          </p>
        </div>

        <aside className={s.side} aria-label="The LP in focus">
          {pickedRows.length > 0 && (
            <BulkLpActions rows={pickedRows} statuses={statuses} initialStatus="selected" onClear={view.clearPicked} hidden={pickedRows.filter((r) => !shownIds.has(r.id)).length} />
          )}
          {detail && !narrow && <div className={cx('card', s.sideWhy)} style={{ marginBottom: 0 }}>{detail}</div>}
        </aside>
      </div>
    </section>
  );
}

const RankRow = memo(function RankRow({ r, position, member = false, last = false, focused, picked, byVehicle, now, onFocus, onPick }: {
  r: PipelineRow; position: number | null; member?: boolean; last?: boolean; focused: boolean; picked: boolean; byVehicle: boolean; now: number;
  onFocus: (id: string) => void; onPick: (ids: string[], on: boolean) => void;
}) {
  const other = member ? null : second(r);
  const touch = fmtShort(r.lastTouch, now);
  const stale = /stale/i.test(r.scoreKind);
  const cap = r.capacity && !/unknown/i.test(r.capacity) ? r.capacity : null;
  return (
    <tr data-lp={r.id} className={cx(s.row, member && s.member, member && last && s.last, focused && s.focus, picked && s.picked)} aria-selected={focused}
      onClick={(e) => { if ((e.target as HTMLElement).closest('a,button,input,label')) return; onFocus(r.id); }}>
      <td className={s.cCheck}><input type="checkbox" aria-label={`Select ${member ? r.name : lead(r)}`} checked={picked} onChange={(e) => onPick([r.id], e.target.checked)} /></td>
      <td className={s.cPos}>{position}</td>
      <td className={s.cLp}>
        <div className={s.lpName}><span className={s.lpText}>{member ? r.name : lead(r)}</span></div>
        {(other || byVehicle || r.money || r.doNotContact || r.riskCount > 0) && (
          <div className={s.whoLine}>
            {other && <span>{other}</span>}
            {byVehicle && <span>{r.vehicle}</span>}
            {r.money && <span>{r.money.state} {usdM(r.money.amount)}</span>}
            {r.doNotContact && <span style={{ color: 'var(--clay)' }}>do not contact</span>}
            {r.riskCount > 0 && <span>{r.riskCount} {r.riskCount === 1 ? 'flag' : 'flags'}</span>}
          </div>
        )}
      </td>
      <td className={s.cScore}>
        {r.score === null ? <><div className={cx(s.scoreNum, s.none)}>—</div><span className={s.scoreKind}>unscored</span></>
          : <div className={s.score}><span className={s.scoreNum}>{r.score}</span><span className={s.bar} aria-hidden><i className={scoreTone(r.score)} style={{ width: `${r.score}%` }} /></span>
            <span className={cx(s.scoreKind, stale && s.stale)}>{r.scoreKind.startsWith('Fit') ? 'fit' : stale ? 'stale' : 'provisional'}</span></div>}
      </td>
      <td className={s.cCap}>{cap ?? <span className={s.none}>—</span>}</td>
      <td className={s.cRoutes}><span className={cx(s.fig, !r.route && s.zero)}><Icon name="link" title="Routes" />{r.route ?? '—'}</span></td>
      <td className={s.cStatus}>{STATUS_WORD[r.status]}</td>
      <td className={s.cMeet}><span className={cx(s.fig, !r.meetings && s.zero)}>{r.meetings ? <><Icon name="calendar" title="Meetings" />{r.meetings}</> : '—'}</span></td>
      <td className={s.cTouch}>{touch ? <span className={s.date}>{touch}</span> : <span className={s.none}>—</span>}</td>
    </tr>
  );
});

const STATUS_WORD: Record<Status, string> = {
  new: 'New', sourcing: 'Sourcing', selected: 'Selected', connecting: 'Connecting', discussing: 'Discussing', committed: 'Committed', passed: 'Passed',
};

/** Why the LP in focus ranks where it does, read from the server when it comes into focus. */
function Why({ r, position, sortLabel, rungNames, now, picked, onPick }: {
  r: PipelineRow; position: number; sortLabel: string; rungNames: string[]; now: number; picked: boolean; onPick: (on: boolean) => void;
}) {
  const [detail, setDetail] = useState<ScoreDetail | null | 'loading' | 'failed'>('loading');
  useEffect(() => {
    let live = true;
    scoreDetailAction(r.vehicleId, r.id).then((d) => { if (live) setDetail(d); }, () => { if (live) setDetail('failed'); });
    return () => { live = false; };
  }, [r.vehicleId, r.id]);
  const d = typeof detail === 'object' ? detail : null;
  const other = second(r);
  const stale = /stale/i.test(r.scoreKind);
  return (
    <div className={s.why}>
      <div className={s.whyHead}>
        <div style={{ minWidth: 0 }}>
          <div className="lbl">#{n(position)} by {sortLabel}</div>
          <h3>{lead(r)}</h3>
          {other && <div className={s.second}>{other}</div>}
        </div>
        <div className={s.whyScore}>
          <div className={cx(s.big, r.score === null && s.none)}>{r.score ?? '—'}</div>
          <span className={cx(s.scoreKind, stale && s.stale)}>{r.score === null ? 'unscored' : r.scoreKind}</span>
          {r.scoreAt && <span className={s.scoreKind} style={{ display: 'block' }}>{fmt(r.scoreAt)}</span>}
        </div>
      </div>

      <div className={s.go}>
        <a className="btn p" href={`/${r.vehicleSlug}/pipeline/${r.id}`}>Open {lead(r)}&rsquo;s strategy</a>
        <div className={s.goRow}>
          <button type="button" className="btn" aria-pressed={picked} onClick={() => onPick(!picked)}>{picked ? 'Unselect' : 'Select for an action'}</button>
          <a className="btn" href={`/${r.vehicleSlug}/fit/${r.entityId}`}>Fit &amp; standing</a>
        </div>
      </div>

      {detail === 'loading' && <p className={s.loading}>Reading what the score rests on…</p>}
      {detail === 'failed' && <p className={cx(s.receipt, s.bad)} style={{ marginTop: 12 }}>The reasons could not be read. The score above stands; open the LP to see its record.</p>}
      {detail === null && <p className={s.loading}>No strategy or fit assessment is on file for this LP in this vehicle.</p>}
      {d && d.parts.length > 0 && (
        <div className={s.parts}>
          {d.parts.map((p) => (
            <div key={p.label}>
              <div className={s.partTop}>
                <span><b>{p.label}</b> <small>×{Math.round(p.weight * 100)}%</small></span>
                <span>{p.value === null ? <span className={s.none}>unknown</span> : <>{p.level} <small>{Math.round(p.value * 100)}</small></>}</span>
              </div>
              <span className={s.partBar} aria-hidden>{p.value !== null && <i className={scoreTone(p.value * 100)} style={{ width: `${p.value * 100}%` }} />}</span>
              {p.basis && <div className={s.partBasis}>{p.basis}</div>}
              {p.value === null && !p.basis && <div className={s.partBasis}>Not known, so not counted.</div>}
            </div>
          ))}
        </div>
      )}
      {d && d.kind === 'none' && d.parts.every((p) => p.value === null) && (
        <p className={s.loading}>No readings on file yet: research would give this LP a score.</p>
      )}

      <div className={s.facts}>
        {d?.angle && <div className={s.fact}><span>Angle</span><span>{d.angle}</span></div>}
        {d?.route && <div className={s.fact}><span>Best path</span><span>{d.route.via} <span className={s.none}>· tier {d.route.tier}</span>{d.route.why && <span className={s.small}>{d.route.why}</span>}</span></div>}
        {d?.ask && <div className={s.fact}><span>Ask</span><span>{d.ask}{d.list && <span className={s.small}>List: {d.list}{d.confidence ? ` · ${d.confidence} confidence` : ''}</span>}</span></div>}
        <div className={s.fact}><span>Next</span><span>{d?.next ?? r.next ?? <span className={s.none}>Nothing recorded</span>}{r.nextOn && <span className={s.small}>Due {fmtShort(r.nextOn, now)}</span>}</span></div>
        <div className={s.fact}><span>Routes</span><span><a className={s.fig} href={`/${r.vehicleSlug}/routes?target=${r.entityId}`}><Icon name="link" title="Routes" />{r.route ? `${n(r.route)} recorded` : 'None recorded yet'}</a></span></div>
        <div className={s.fact}><span>Contact</span><span>
          {r.meetings > 0 ? `Met ${r.meetings}×, last ${fmtShort(r.lastMeeting, now)}` : 'Never met'}
          {r.lastTouch && <span className={s.small}>Last touch {fmtShort(r.lastTouch, now)}{r.waitingSince ? ', waiting on them' : ''}</span>}
          {r.read && !r.readSuperseded && <span className={s.small}>Their read: {r.read}</span>}
        </span></div>
        <div className={s.fact}><span>Evidence</span><span><Ladder r={r} names={rungNames} /></span></div>
        {(d?.risks.length ?? r.riskCount) > 0 && (
          <div className={s.fact}><span>Flags</span><span><Flags list={d?.risks ?? r.risks} /></span></div>
        )}
        {r.doNotContact && <div className={s.fact}><span>Restricted</span><span style={{ color: 'var(--clay)' }}>Do not contact. Review the target&rsquo;s instructions first.</span></div>}
      </div>

    </div>
  );
}

/** The first few flags, and the rest a tap away. */
function Flags({ list }: { list: string[] }) {
  const FIRST = 4;
  return (
    <>
      <ul className={s.whyFlags}>{list.slice(0, FIRST).map((x, i) => <li key={i}>{x}</li>)}</ul>
      {list.length > FIRST && (
        <Disclose label={`${n(list.length - FIRST)} more`}>
          <ul className={s.whyFlags}>{list.slice(FIRST).map((x, i) => <li key={i}>{x}</li>)}</ul>
        </Disclose>
      )}
    </>
  );
}
