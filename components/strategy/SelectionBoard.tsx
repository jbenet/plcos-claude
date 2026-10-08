'use client';

import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { scoreDetailAction } from '@/app/selection/actions';
import { actionFailure } from '@/lib/client/action-failure';
import type { ScoreDetail } from '@/lib/pipeline-data';
import { BulkLpActions } from './BulkLpActions';
import { MoveButton, statusMix, statusWord, UndoToast, useMove } from './MoveToSelected';
import { rankRows, unitShown, unitsFrom, unitsOn, EMPTY, lead, second, spvFlagged, type PipelineRow, type SortKey, type Status } from './pipeline-model';
import { CapacityTag, LpWho, units } from './LpWho';
import { UnitIcon } from './UnitIcon';
import { useIsCursor, useRowCursor, type CursorStore } from './row-cursor';
import { cx, Disclose, fmt, fmtShort, FilterLine, Icon, Ladder, n, scoreTone, useLpView, usdM, type StatusInfo } from './lp-view';
import s from './lp-tables.module.css';
import m from './selection.module.css';
import u from './lp-units.module.css';
import { SpvMark, SpvReason, spvStyles as sp } from './SpvMark';
import { STRATEGIC_BASIS, StrategicMark } from './StrategicMark';
import { spvWords } from '@/modules/strategy/client';

/**
 * Selection (module 03; issues 0071 and 0089): who to work next. A ranked list beside the reasons
 * for the one in focus, after the M03 board — the score, what it rests on, and a way in. New and
 * Sourcing are shown to start; any other status can be toggled in, or all of them at once.
 *
 * Every row is an LP unit (issues 0111, 0112; docs/23): organisations first, each once, with their
 * people named inside the row; then individuals, people in their own capacity, with their firms as
 * context. The two lists are ranked apart and the keyboard runs through both.
 */

const PAGE = 60;
const SORT_LABEL: Partial<Record<SortKey, string>> = {
  score: 'score', capacity: 'check size', route: 'routes', status: 'stage', meetings: 'meetings', touch: 'last touch', name: 'name', spv: 'SPV stance', strategic: 'strategic value',
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

export function SelectionBoard({ rows: given, statuses, rungNames, initialFilters, showVehicle, asOf }: Props) {
  const router = useRouter();
  // Move to Selected (issue 0104): the ticked LPs when some are ticked, otherwise the one in focus.
  // The list shows a move at once, ahead of the server (useMove).
  const mv = useMove('selection', given);
  const rows = mv.rows;
  const view = useLpView({ rows, statuses, asOf, initialFilters, mode: 'selection' });
  const { enabled, setEnabled, counts, active, shown, sort, picked, pick, pickedRows, now } = view;
  const [limit, setLimit] = useState(PAGE);
  const shownIds = useMemo(() => new Set(shown.map((r) => r.id)), [shown]);
  useEffect(() => setLimit(PAGE), [enabled, view.f, sort]);
  // One list, organisations and individuals ranked together (issue 0113).
  const ranked = useMemo(() => rankRows(shown, sort.key, sort.dir), [shown, sort]);
  const visible = useMemo(() => ranked.slice(0, limit), [ranked, limit]);
  const orgCount = useMemo(() => ranked.filter((r) => r.isOrg).length, [ranked]);
  const place = (r: PipelineRow) => ranked.indexOf(r) + 1;
  // The keyboard cursor (issue 0121): a click or tap moves it, it keeps its place when its row
  // leaves the list, and the page scrolls ahead of it. Shared with Pipeline.
  const resetKey = `${enabled.join()}|${JSON.stringify(view.f)}|${sort.key}${sort.dir}`;
  const cursor = useRowCursor({ ranked, initialId: initialFilters?.lp ?? null, defaultFirst: true, limit, setLimit, page: PAGE, resetKey });
  const { focusId, focus, reveal, setFocus: setFocusId } = cursor;
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

  // The panel beside the list follows the cursor at a lower priority, so a held arrow key moves the
  // highlight without waiting for the reasons to render. Not when narrow: there the reasons sit
  // inside the list, under the row in focus, and the scroll must see them where they end up.
  const deferredFocus = useDeferredValue(focus);
  const panelFocus = narrow ? focus : deferredFocus;
  const position = panelFocus ? place(panelFocus) : 0;
  const all = enabled.length === statuses.length;
  const byVehicle = showVehicle && new Set(rows.map((r) => r.vehicle)).size > 1;
  const scored = useMemo(() => shown.filter((r) => r.score !== null).length, [shown]);
  // A link to the same person's or firm's other row: if the toggles hide its type, show it first.
  const [pending, setPending] = useState<string | null>(null);
  const jump = (id: string) => {
    const r = ranked.find((x) => x.id === id);
    if (r) { reveal(r); return; }
    const target = rows.find((x) => x.id === id);
    if (!target) return;
    setPending(id);
    if (!unitShown(target, view.f.units)) view.set('units', target.isOrg ? unitsFrom(true, unitsOn(view.f.units).individuals) : unitsFrom(unitsOn(view.f.units).firms, true));
    if (!enabled.includes(target.status)) setEnabled([...enabled, target.status]);
  };
  // Stable for the memoised rows: one keyboard move re-renders two rows, not the whole list.
  const jumpNow = useRef(jump);
  jumpNow.current = jump;
  const onJump = useCallback((id: string) => jumpNow.current(id), []);
  useEffect(() => {
    if (!pending) return;
    const r = ranked.find((x) => x.id === pending);
    if (r) { setPending(null); reveal(r); }
    // reveal reads the current list; it runs once the list includes the row.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, ranked]);

  // Keep the focused LP in the address, so back and a shared link return to it. Once the cursor
  // rests: Next re-renders the router on each replaceState, too much for every key repeat (issue 0121).
  useEffect(() => {
    const t = setTimeout(() => {
      const u = new URL(window.location.href);
      if (focusId) u.searchParams.set('lp', focusId); else u.searchParams.delete('lp');
      if (u.toString() !== window.location.href) window.history.replaceState(window.history.state, '', u);
    }, 300);
    return () => clearTimeout(t);
  }, [focusId]);

  const visibleIds = visible.map((r) => r.id);
  const allTicked = visibleIds.length > 0 && visibleIds.every((id) => picked.has(id));

  // Moving the one in focus hands the focus to the next LP, so s, s, s works down the list.
  const ticked = pickedRows.length > 0;
  const targets = ticked ? pickedRows : focus ? [focus] : [];
  const moveNow = async () => {
    const i = focus ? ranked.indexOf(focus) : -1;
    const going = new Set(targets.filter((r) => r.status !== 'selected').map((r) => r.id));
    const next = ticked ? null : ranked.slice(i + 1).find((r) => !going.has(r.id)) ?? ranked.slice(0, Math.max(0, i)).reverse().find((r) => !going.has(r.id));
    if (!mv.move(targets)) return;
    if (ticked) view.clearPicked();
    else if (next) reveal(next);
  };
  const undoNow = async () => {
    const done = await mv.undo();
    if (done?.rows.length === 1) setFocusId(done.rows[0]!.id);
  };

  // The keyboard (issues 0091, 0104): up and down move the focus through the table, x ticks the LP
  // in focus, s moves to Selected, u undoes that, Enter opens it. Not while typing in a field or a dialog.
  const keys = useRef({ focus, picked, moveNow, undoNow, step: cursor.step });
  keys.current = { focus, picked, moveNow, undoNow, step: cursor.step };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target instanceof HTMLElement ? e.target : null;
      if (el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) && !(el as HTMLInputElement).type?.match(/checkbox/) || el.closest('dialog, [role="dialog"]'))) return;
      const { focus, picked, moveNow, undoNow, step } = keys.current;
      if (e.key === 'u' && !e.shiftKey) { e.preventDefault(); void undoNow(); return; }
      if (!focus) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'j' || e.key === 'k') {
        step(e.key === 'ArrowDown' || e.key === 'j' ? 1 : -1, e);
      } else if (e.key === 's' && !e.shiftKey) {
        e.preventDefault();
        void moveNow();
      } else if (e.key === 'x') {
        e.preventDefault();
        pick([focus.id], !picked.has(focus.id));
      } else if (e.key === 'Enter' && (!el || el === document.body || el.closest('[data-lp]')) && !el?.closest('a,button')) {
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

  // One panel for what to do (issues 0104, 0109): Move to Selected as the black primary, then the
  // ways in and the other actions, secondary. For the ticked LPs when some are ticked, else the one in focus.
  const single = !ticked && panelFocus ? panelFocus : null;
  const shownTargets = ticked ? pickedRows : panelFocus ? [panelFocus] : [];
  const todo = shownTargets.filter((r) => r.status !== 'selected');
  // On an SPV vehicle, an LP on record as not doing SPVs is flagged before it is moved (Juan, 27 Sep 2026).
  const noSpv = todo.filter(spvFlagged);
  const moveBar = shownTargets.length > 0 && (
    <BulkLpActions key={ticked ? 'ticked' : panelFocus?.id} rows={shownTargets} statuses={statuses} initialStatus={null} place="selection"
      onClear={ticked ? view.clearPicked : undefined} onStatusSaved={mv.remember} hidden={ticked ? pickedRows.filter((r) => !shownIds.has(r.id)).length : 0}
      heading={single ? lead(single) : `${n(targets.length)} ticked`}
      sub={single ? <>{second(single) && <>{second(single)} · </>}now <b>{statusWord(single.status)}</b><span className={m.owner}> · owner {single.owner}</span></>
        : undefined}
      primary={<>
        {noSpv.length > 0 && <div className={sp.warn} role="note">
          <b>{noSpv.length === 1 ? `${lead(noSpv[0]!)} doesn’t do SPVs` : `${n(noSpv.length)} of these don’t do SPVs`}</b>, and this is an SPV.
          {noSpv.length === 1 ? noSpv[0]!.spv.why && <> <small>{noSpv[0]!.spv.why}</small></>
            : <ul>{noSpv.slice(0, 4).map((r) => <li key={r.id}>{lead(r)}{r.spv.why && <small> · {r.spv.why}</small>}</li>)}{noSpv.length > 4 && <li><small>and {n(noSpv.length - 4)} more</small></li>}</ul>}
          {' '}Moving {noSpv.length === 1 ? 'it' : 'them'} to Selected is still yours to decide; the LP page can correct the stance.
        </div>}
        <MoveButton state={mv} rows={shownTargets} ticked={ticked} onMove={() => void moveNow()} />
        {ticked && <p className={m.mix}>{todo.length ? statusMix(todo) : 'all Selected already'}{todo.length < shownTargets.length && todo.length > 0 ? ` · ${n(shownTargets.length - todo.length)} already Selected` : ''}</p>}
      </>}
      links={single && (
        <div className={m.links} role="group" aria-label={`Open ${lead(single)}`}>
          <a className="btn" href={`/${single.vehicleSlug}/pipeline/${single.id}`}>LP page</a>
          <a className="btn" href={`/${single.vehicleSlug}/strategy/${single.entityId}`}>Strategy</a>
          <a className="btn" href={`/${single.vehicleSlug}/fit/${single.entityId}`}>Fit &amp; standing</a>
          <a className="btn" href={`/${single.vehicleSlug}/routes?target=${single.entityId}`}>Routes</a>
        </div>
      )} />
  );
  // The rendered rows, kept while the cursor moves: each row reads the cursor itself (issue 0121).
  const rowEls = useMemo(() => visible.map((r, i) => <RankRow key={r.id} r={r} position={i + 1} cursor={cursor.store} picked={picked.has(r.id)} byVehicle={byVehicle} now={now}
    onFocus={setFocusId} onPick={pick} onJump={onJump} />), [visible, cursor.store, picked, byVehicle, now, setFocusId, pick, onJump]);
  const detail = panelFocus && <Why key={panelFocus.id} r={panelFocus} position={position} sortLabel={SORT_LABEL[sort.key] ?? 'score'} rungNames={rungNames} now={now} onJump={onJump} />;

  // When narrow, the reasons sit under the row in focus.
  const inlineAt = narrow && detail && panelFocus ? visible.indexOf(panelFocus) : -1;

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

      <FilterLine view={view} rows={rows} showVehicle={showVehicle} keys={['flag', 'spv', 'strategic', 'touch', 'read']} placeholder="Search names, organisations, next steps…  /" />

      <div className={cx(s.selGrid, !focus && !pickedRows.length && s.alone)}>
        <div className={cx('card', s.rankCard)}>
          <div className={s.head}>
            <h2>Ranked</h2>
            <div className={s.headMeta}>
              {units(orgCount, ranked.length - orgCount)} · {n(scored)} scored
              {enabled.length > 0 && !all && <span> · {enabled.map((id) => statuses.find((x) => x.id === id)?.label).join(', ')}</span>}
            </div>
            <div className={s.keysHint}><kbd>↑</kbd><kbd>↓</kbd> move · <kbd>x</kbd> tick · <kbd>s</kbd> to Selected · <kbd>↵</kbd> open</div>
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
                    <Th k="strategic" className={sp.cStrategic} title="Strategic value: how useful they would be to this vehicle beyond the check (for an SPV, its company). Derived from research, sourcing and the strategy, or a person’s grade; not part of the score.">Strategic</Th>
                    <Th k="spv" className={sp.cSpv} title="Whether they do SPVs: a person’s setting, research, or what our records show. Unknown is likely open.">SPVs</Th>
                    <Th k="route" className={s.cRoutes}>Routes</Th>
                    <Th k="status" className={s.cStatus}>Stage</Th>
                    <Th k="meetings" className={s.cMeet}>Met</Th>
                    <Th k="touch" className={s.cTouch}>Last touch</Th>
                  </tr>
                </thead>
                <tbody>
                  {inlineAt < 0 ? rowEls : [...rowEls.slice(0, inlineAt + 1),
                    <tr key="inline-detail" className={s.inlineRow}><td colSpan={11}><div className={m.inline}>{moveBar}</div><div className="card" style={{ marginBottom: 0 }}>{detail}</div></td></tr>,
                    ...rowEls.slice(inlineAt + 1)]}
                  {ranked.length > visible.length && <tr className={u.moreRow}><td colSpan={11}>
                    <button type="button" className="btn" onClick={() => setLimit((x) => x + PAGE)}>Show {n(Math.min(PAGE, ranked.length - visible.length))} more</button>
                    {n(visible.length)} of {n(ranked.length)} shown. Search covers all of them.
                  </td></tr>}
                </tbody>
              </table>
            </div>
          )}
          <p className="cover">
            <b>What the score is:</b> the fit assessment where someone has made one; otherwise the proposed strategy&rsquo;s four
            readings — capacity, affinity, propensity, time to decision — weighted as the settings say. Unknown readings are left
            out, not guessed, and fewer than two known means unscored. It orders the work; it is not a probability of commitment.
          </p>
        </div>

        <aside className={s.side} aria-label="The LP in focus">
          {!narrow && moveBar}
          {detail && !narrow && <div className={cx('card', s.sideWhy)} style={{ marginBottom: 0 }}>{detail}</div>}
        </aside>
      </div>
      <UndoToast state={mv} onUndo={() => void undoNow()} />
    </section>
  );
}

const RankRow = memo(function RankRow({ r, position, cursor, picked, byVehicle, now, onFocus, onPick, onJump }: {
  r: PipelineRow; position: number; cursor: CursorStore; picked: boolean; byVehicle: boolean; now: number;
  onFocus: (id: string) => void; onPick: (ids: string[], on: boolean) => void; onJump: (id: string) => void;
}) {
  const focused = useIsCursor(cursor, r.id);
  const touch = fmtShort(r.lastTouch, now);
  const stale = /stale/i.test(r.scoreKind);
  const cap = r.capacity && !/unknown/i.test(r.capacity) ? r.capacity : null;
  const dim = spvFlagged(r);
  return (
    <tr data-lp={r.id} className={cx(s.row, focused && s.focus, picked && s.picked, dim && sp.dim)} aria-selected={focused}
      onClick={(e) => { if ((e.target as HTMLElement).closest('a,button')) return; onFocus(r.id); }}>
      <td className={s.cCheck}><input type="checkbox" aria-label={`Select ${lead(r)}`} checked={picked} onChange={(e) => onPick([r.id], e.target.checked)} /></td>
      <td className={s.cPos}>{position}</td>
      <td className={s.cLp}>
        <div className={u.nameLine}><UnitIcon org={r.isOrg} /><div>
          <div className={s.lpName}><span className={s.lpText}>{lead(r)}<CapacityTag r={r} /></span></div>
          <LpWho r={r} onJump={onJump} />
        {dim && <SpvReason mark={r.spv} />}
        {(byVehicle || r.money || r.doNotContact || r.riskCount > 0) && (
          <div className={s.whoLine}>
            {byVehicle && <span>{r.vehicle}</span>}
            {r.money && <span>{r.money.state} {usdM(r.money.amount)}</span>}
            {r.doNotContact && <span style={{ color: 'var(--clay)' }}>do not contact</span>}
            {r.riskCount > 0 && <span>{r.riskCount} {r.riskCount === 1 ? 'flag' : 'flags'}</span>}
          </div>
        )}
        </div></div>
      </td>
      <td className={s.cScore}>
        {r.score === null ? <><div className={cx(s.scoreNum, s.none)}>—</div><span className={s.scoreKind}>unscored</span></>
          : <div className={s.score}><span className={s.scoreNum}>{r.score}</span><span className={s.bar} aria-hidden><i className={scoreTone(r.score)} style={{ width: `${r.score}%` }} /></span>
            <span className={cx(s.scoreKind, stale && s.stale)}>{r.scoreKind.startsWith('Fit') ? 'fit' : stale ? 'stale' : 'provisional'}</span></div>}
      </td>
      <td className={s.cCap}>{cap ?? <span className={s.none}>—</span>}</td>
      <td className={sp.cStrategic}><StrategicMark mark={r.strategic} /></td>
      <td className={sp.cSpv}><SpvMark mark={r.spv} /></td>
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

/** GUESS: how long the cursor rests on an LP before its reasons are read; longer than a key repeat. */
const READ_AFTER_MS = 150;

/** Why the LP in focus ranks where it does, read from the server when it comes into focus. */
const Why = memo(function Why({ r, position, sortLabel, rungNames, now, onJump }: {
  r: PipelineRow; position: number; sortLabel: string; rungNames: string[]; now: number; onJump: (id: string) => void;
}) {
  const [detail, setDetail] = useState<ScoreDetail | null | 'loading' | 'failed'>('loading');
  useEffect(() => {
    let live = true;
    // Read once the cursor rests: a held arrow key would otherwise queue a server read per row, and
    // Next runs server actions one at a time, so a Move after it would wait (issue 0121).
    const t = setTimeout(() => {
      scoreDetailAction(r.vehicleId, r.id).then((d) => { if (live) setDetail(d); }, (e) => { if (live) { actionFailure(e, ''); setDetail('failed'); } });
    }, READ_AFTER_MS);
    return () => { live = false; clearTimeout(t); };
  }, [r.vehicleId, r.id]);
  const d = typeof detail === 'object' ? detail : null;
  const other = second(r);
  const stale = /stale/i.test(r.scoreKind);
  return (
    <div className={s.why}>
      <div className={s.whyHead}>
        <div style={{ minWidth: 0 }}>
          <div className="lbl">#{n(position)} by {sortLabel} · {r.isOrg ? 'firm' : 'individual'}</div>
          <h3 className={u.nameLine}><UnitIcon org={r.isOrg} size={15} /><span>{lead(r)}<CapacityTag r={r} /></span></h3>
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
        {/* Whose row it is (docs/23): an organisation's people, or an individual's capacity and firms. */}
        {r.isOrg && r.people.length > 0 && <div className={s.fact}><span>People</span><span><ul className={u.detailPeople}>
          {r.people.slice(0, 8).map((p) => <li key={p.id}><span className={p.contact ? u.contact : undefined}>{p.name}</span>{p.role && <small> · {p.role}</small>}
            {p.contact && <small> · contact on this LP</small>}
            {p.individual && <button type="button" className={u.jump} onClick={() => onJump(p.individual!)}>also individual</button>}</li>)}
          {r.people.length > 8 && <li><small>and {n(r.people.length - 8)} more on the LP page</small></li>}
        </ul></span></div>}
        {!r.isOrg && <div className={s.fact}><span>Capacity</span><span>
          {r.lpReview ? <>Firm or personal? <span className={s.small}>{r.lpReview}</span></>
            : r.lpCapacity === 'personal' ? <>Their own account<span className={s.small}>Evidence on file that they invest personally.</span></>
            : <>An individual<span className={s.small}>Whether they invest personally is not established yet.</span></>}
        </span></div>}
        {!r.isOrg && r.firms.length > 0 && <div className={s.fact}><span>Firms</span><span><ul className={u.detailPeople}>
          {r.firms.map((f) => <li key={f.id}>{f.name}{f.role && <small> · {f.role}</small>}
            {f.lpRow && <button type="button" className={u.jump} onClick={() => onJump(f.lpRow!)}>firm’s row</button>}</li>)}
        </ul></span></div>}
        <div className={s.fact}><span>Strategic</span><span>
          <b className={r.strategic.level === 'high' ? sp.does : undefined}>{r.strategic.level}</b> <span className={s.none}>· {STRATEGIC_BASIS[r.strategic.basis]}, not part of the score</span>
          {r.strategic.reasons.length > 0 ? <ul className={s.whyFlags}>{r.strategic.reasons.map((x, i) => <li key={i}>{x}</li>)}</ul>
            : <span className={s.small}>Nothing on file ties them to this vehicle’s field or company, and nobody has graded it: unknown, not none.</span>}
        </span></div>
        <div className={s.fact}><span>SPVs</span><span className={r.spv.stance === 'does-not' && r.spvVehicle ? sp.not : undefined}>
          {spvWords(r.spv)}
          <span className={s.small}>{r.spv.why ?? 'Nothing on file either way: unknown is likely open.'}{r.spv.conflict ? ' Other evidence disagrees; the LP page lists both.' : ''}</span>
        </span></div>
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
});

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
