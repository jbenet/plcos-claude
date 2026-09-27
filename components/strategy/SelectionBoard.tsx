'use client';

import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { scoreDetailAction } from '@/app/selection/actions';
import type { ScoreDetail } from '@/lib/pipeline-data';
import { BulkLpActions } from './BulkLpActions';
import { compareRows, EMPTY, lead, second, type PipelineRow, type SortKey, type Status } from './pipeline-model';
import { cx, fmt, fmtShort, FilterLine, Icon, Ladder, n, scoreTone, useLpView, usdM, type StatusInfo } from './lp-view';
import s from './lp-tables.module.css';

/**
 * Selection (module 03; issues 0071 and 0089): who to work next. A ranked list beside the reasons
 * for the one in focus, after the M03 board — the score, what it rests on, and a way in. New and
 * Sourcing are shown to start; any other status can be toggled in, or all of them at once.
 */

const PAGE = 60;
const SORTS: Array<{ key: SortKey; label: string }> = [
  { key: 'score', label: 'Score' },
  { key: 'capacity', label: 'Capacity' },
  { key: 'route', label: 'Routes' },
  { key: 'touch', label: 'Last touch' },
  { key: 'name', label: 'Name' },
];
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
  const { enabled, setEnabled, counts, active, shown, sort, setSort, picked, pick, pickedRows, now } = view;
  const [limit, setLimit] = useState(PAGE);
  const shownIds = useMemo(() => new Set(shown.map((r) => r.id)), [shown]);
  useEffect(() => setLimit(PAGE), [enabled, view.f, sort]);
  const ranked = useMemo(() => [...shown].sort((a, b) => compareRows(a, b, sort.key, sort.dir)), [shown, sort]);
  const [focusId, setFocusId] = useState<string | null>(() => initialFilters?.lp ?? null);
  const focus = ranked.find((r) => r.id === focusId) ?? ranked[0] ?? null;
  const position = focus ? ranked.indexOf(focus) + 1 : 0;
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

  const toggle = (id: Status) => setEnabled(enabled.includes(id) ? enabled.filter((x) => x !== id) : statuses.map((x) => x.id).filter((x) => x === id || enabled.includes(x)));
  const open = (r: PipelineRow) => router.push(`/${r.vehicleSlug}/pipeline/${r.id}`);

  const detail = focus && <Why key={focus.id} r={focus} position={position} sortLabel={SORTS.find((x) => x.key === sort.key)?.label ?? 'Score'} rungNames={rungNames} now={now}
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
        <div className="card" style={{ marginBottom: 0 }}>
          <div className={s.head}>
            <h2>Ranked</h2>
            <div className={s.headMeta}>
              {n(shown.length)} LPs · {n(scored)} scored
              {enabled.length > 0 && !all && <span> · {enabled.map((id) => statuses.find((x) => x.id === id)?.label).join(', ')}</span>}
            </div>
            <div className={s.sortBar} role="group" aria-label="Order">
              <span>Order</span>
              {SORTS.map((x) => {
                const on = sort.key === x.key;
                return (
                  <button key={x.key} type="button" className={cx(s.seg, on && s.on)} aria-pressed={on}
                    title={on ? 'Reverse the order' : undefined} onClick={() => view.sortBy(x.key)}>
                    {x.label}{on ? (sort.dir === -1 ? ' ↓' : ' ↑') : ''}
                  </button>
                );
              })}
            </div>
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
            <ol className={s.rank}>
              {ranked.slice(0, limit).map((r, i) => (
                <Item key={r.id} r={r} position={i + 1} focused={r.id === focus?.id} picked={picked.has(r.id)} byVehicle={byVehicle} now={now}
                  showStatus={enabled.length > 1} onFocus={setFocusId} onPick={pick} onOpen={open} inline={narrow && r.id === focus?.id ? detail : null} />
              ))}
            </ol>
          )}
          {ranked.length > limit && (
            <div className={s.more}>
              <button type="button" className="btn" onClick={() => setLimit((x) => x + PAGE)}>Show {n(Math.min(PAGE, ranked.length - limit))} more</button>
              <span>{n(limit)} of {n(ranked.length)} shown. Search covers all of them.</span>
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

const Item = memo(function Item({ r, position, focused, picked, byVehicle, now, showStatus, onFocus, onPick, onOpen, inline }: {
  r: PipelineRow; position: number; focused: boolean; picked: boolean; byVehicle: boolean; now: number; showStatus: boolean;
  onFocus: (id: string) => void; onPick: (ids: string[], on: boolean) => void; onOpen: (r: PipelineRow) => void; inline: React.ReactNode;
}) {
  const other = second(r);
  const touch = fmtShort(r.lastTouch, now);
  const ref = useRef<HTMLLIElement>(null);
  const stale = /stale/i.test(r.scoreKind);
  return (
    <li ref={ref} className={cx(s.item, focused && s.focus, picked && s.picked)} tabIndex={0} aria-current={focused || undefined}
      onClick={(e) => { if ((e.target as HTMLElement).closest('a,button,input,label,summary,details')) return; if (focused && (e.target as HTMLElement).closest(`.${s.inline}`)) return; onFocus(r.id); }}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter') { if (focused) onOpen(r); else onFocus(r.id); }
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          const next = (e.key === 'ArrowDown' ? ref.current?.nextElementSibling : ref.current?.previousElementSibling) as HTMLElement | null;
          next?.focus(); next?.click();
        }
        if (e.key === ' ') { e.preventDefault(); onPick([r.id], !picked); }
      }}>
      <input type="checkbox" aria-label={`Select ${lead(r)}`} checked={picked} onChange={(e) => onPick([r.id], e.target.checked)} />
      <span className={s.pos}>{position}</span>
      <div className={s.who}>
        <div className={s.whoName}>
          <span className={s.kind}><Icon name={r.isOrg || r.orgFirst ? 'folder' : 'person'} title={r.isOrg || r.orgFirst ? 'Organisation' : 'Person'} /></span>
          <span>{lead(r)}</span>
          {r.list === 'this year' && <span className={cx(s.pill, s.year)} title="The proposed strategy puts them on this year’s close">This year</span>}
          {r.list === '2027' && <span className={s.pill} title="The proposed strategy puts them on the 2027 list">2027</span>}
        </div>
        <div className={s.whoLine}>
          {other && <span>{other}</span>}
          {showStatus && <span>{STATUS_WORD[r.status]}</span>}
          {byVehicle && <span>{r.vehicle}</span>}
          {r.capacity && !/unknown/i.test(r.capacity) && <span>{r.capacity}</span>}
          {r.route ? <span>{n(r.route)} {r.route === 1 ? 'route' : 'routes'}</span> : null}
          {r.meetings > 0 && <span>met {r.meetings}×</span>}
          {touch && <span>last touch {touch}</span>}
          {r.money && <span>{r.money.state} {usdM(r.money.amount)}</span>}
          {r.doNotContact && <span style={{ color: 'var(--clay)' }}>do not contact</span>}
          {r.riskCount > 0 && <span>{r.riskCount} {r.riskCount === 1 ? 'flag' : 'flags'}</span>}
        </div>
      </div>
      <div className={s.right}>
        {r.score === null ? <><div className={cx(s.big, s.none)}>—</div><span className={s.scoreKind}>unscored</span></>
          : <><div className={s.big}>{r.score}</div><span className={s.bar} aria-hidden><i className={scoreTone(r.score)} style={{ width: `${r.score}%` }} /></span>
            <span className={cx(s.scoreKind, stale && s.stale)}>{r.scoreKind.startsWith('Fit') ? 'fit' : stale ? 'stale' : 'provisional'}</span></>}
      </div>
      {focused && inline && <div className={cx('card', s.inline)} style={{ marginBottom: 0 }}>{inline}</div>}
    </li>
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
          <div className="lbl">#{n(position)} by {sortLabel.toLowerCase()}</div>
          <h3>{lead(r)}</h3>
          {other && <div className={s.second}>{other}</div>}
        </div>
        <div className={s.whyScore}>
          <div className={cx(s.big, r.score === null && s.none)}>{r.score ?? '—'}</div>
          <span className={cx(s.scoreKind, stale && s.stale)}>{r.score === null ? 'unscored' : r.scoreKind}</span>
          {r.scoreAt && <span className={s.scoreKind} style={{ display: 'block' }}>{fmt(r.scoreAt)}</span>}
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

      <div className={s.go}>
        <a className="btn p" href={`/${r.vehicleSlug}/pipeline/${r.id}`}>Open {lead(r)}&rsquo;s strategy</a>
        <div className={s.goRow}>
          <button type="button" className="btn" aria-pressed={picked} onClick={() => onPick(!picked)}>{picked ? 'Unselect' : 'Select for an action'}</button>
          <a className="btn" href={`/${r.vehicleSlug}/fit/${r.entityId}`}>Fit &amp; standing</a>
        </div>
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
        <details className={s.flags}>
          <summary>{n(list.length - FIRST)} more</summary>
          <ul className={s.whyFlags}>{list.slice(FIRST).map((x, i) => <li key={i}>{x}</li>)}</ul>
        </details>
      )}
    </>
  );
}
