'use client';

import { Fragment, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import Link from '@/components/ui/AppLink';
import { GROUP_FLAG, GROUP_LABEL, WORK, type FitRow, type FitSection } from './fit-model';
import { StatusPicker } from './StatusPicker';
import s from './fit.module.css';
import { SpvMark } from '@/components/strategy/SpvMark';
import { spvWords } from '@/modules/strategy/client';

/**
 * The fit list and its side pane (issue 0096). Select a row, or move with ↑ ↓ (Home, End), and
 * the side pane shows that LP's reading; Enter opens the LP workspace, Escape goes back to the
 * shape of the list. The list and the pane are separate parts of the page frame, so they share
 * the selected row through this small store rather than a round trip to the server.
 */
let picked: FitRow | null = null;
const listeners = new Set<() => void>();
const store = {
  get: () => picked,
  set: (row: FitRow | null) => { picked = row; for (const l of listeners) l(); },
  subscribe: (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; },
};

const day = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
const lpHref = (r: FitRow) => (r.pursuitId ? `/${r.vehicleSlug}/pipeline/${r.pursuitId}` : `/orgs/${r.entityId}`);

export function FitBoard({ sections, showVehicle, showGroup }: { sections: FitSection[]; showVehicle: boolean; showGroup: boolean }) {
  const router = useRouter();
  const flat = sections.flatMap((x) => x.rows);
  const [sel, setSel] = useState<string | null>(null);
  const refs = useRef(new Map<string, HTMLDivElement>());

  // The pane follows the selected row, and its fresh data after a status change.
  useEffect(() => { store.set(flat.find((r) => r.key === sel) ?? null); }, [sel, sections]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => store.set(null), []);

  const go = (i: number) => {
    const r = flat[Math.max(0, Math.min(flat.length - 1, i))];
    if (!r) return;
    setSel(r.key);
    const el = refs.current.get(r.key);
    el?.focus({ preventScroll: true });
    el?.scrollIntoView({ block: 'nearest' });
  };
  const onKey = (e: React.KeyboardEvent<HTMLDivElement>, r: FitRow) => {
    if (e.target !== e.currentTarget) return;
    const i = flat.findIndex((x) => x.key === r.key);
    if (e.key === 'ArrowDown') { e.preventDefault(); go(i + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); go(i - 1); }
    else if (e.key === 'Home') { e.preventDefault(); go(0); }
    else if (e.key === 'End') { e.preventDefault(); go(flat.length - 1); }
    else if (e.key === 'Enter') { e.preventDefault(); router.push(lpHref(r)); }
    else if (e.key === 'Escape') { setSel(null); }
  };

  return (
    <div role="list" aria-label="LPs by fit">
      {sections.map(({ group, count, rows, lpGroups }) => (
        <div className="card" key={group ?? 'all'} role="presentation">
          {group && (
            <>
              <div className="chead">
                <h2><span className={`flag ${GROUP_FLAG[group]}`} style={{ marginRight: 8 }}>{count}</span>{GROUP_LABEL[group]}</h2>
                {(lpGroups?.length ?? rows.length) < count && <span className="lbl">{lpGroups?.length ?? rows.length} on this page</span>}
              </div>
              <div className="worknote">{WORK[group]}</div>
            </>
          )}
          {(lpGroups ?? rows.map(r => ({ id: r.key, people: [r] }))).map(lp => <Fragment key={lp.id}>
            {lp.people.map((r) => {
            const on = sel === r.key;
            const first = !sel && r.key === flat[0]?.key;
            return (
              <div
                key={r.key}
                ref={(el) => { if (el) refs.current.set(r.key, el); else refs.current.delete(r.key); }}
                role="listitem"
                aria-current={on || undefined}
                aria-label={`${r.name}, ${r.score ?? 'no'} score, ${GROUP_LABEL[r.group]}`}
                tabIndex={on || first ? 0 : -1}
                className={`row ${s.row}${on ? ` sel ${s.on}` : ''}`}
                onClick={(e) => { if ((e.target as HTMLElement).closest('a,button,select,input,label')) return; setSel(r.key); }}
                onFocus={(e) => { if (e.target === e.currentTarget) setSel(r.key); }}
                onKeyDown={(e) => onKey(e, r)}
              >
                <div className="scorecell">
                  <div className="rk mono">{r.rank ? `#${r.rank}` : '—'}</div>
                  <div className={`sc mono ${s.sc} ${s[`g_${r.group}`]}`}>{r.score ?? '—'}</div>
                  <span className={`flag ${r.kind === 'assessed' ? 'f-ok' : 'f-mute'}`}>{r.kind === 'assessed' ? 'assessed' : r.kind === 'provisional' ? 'provisional' : 'no reading'}</span>
                </div>
                <div className="t">
                  <div className={s.head}>
                    <Link className={s.name} href={lpHref(r)}>{r.name}</Link>
                    {/* The LP is the committing unit (docs/23): a person here is one in their own capacity. */}
                    {!r.isOrg && <span className="flag f-mute" title="An individual LP: a person in their own capacity">individual{r.org ? ` · ${r.org}` : ''}</span>}
                    {showVehicle && <span className="flag f-mute">{r.vehicleName}</span>}
                    {(showGroup || r.group !== group) && <span className={`flag ${GROUP_FLAG[r.group]}`}>{GROUP_LABEL[r.group]}</span>}
                    <span className={s.actions}>
                      {/* SPV stance (Juan, 27 Sep 2026): the same place on every row, a column read down the list. */}
                      {r.spv && <span className={s.spvCell}><SpvMark mark={r.spv} tag /></span>}
                      {r.pursuitId && r.status ? (
                        <StatusPicker name={r.name} pursuitId={r.pursuitId} vehicleId={r.vehicleId} status={r.status} />
                      ) : <span className={s.noPursuit}>no pursuit</span>}
                    </span>
                  </div>
                  <span className={s.why}>{r.why ?? (r.kind === 'missing' ? 'No strategy or assessment on file for this vehicle.' : 'The reading gives no reason.')}</span>
                  <div className="rowmeta">
                    {r.kind !== 'missing' && (r.capacity || r.affinity || r.propensity || r.decide || r.kind === 'provisional') && (
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
                    <span>{r.owner}{r.date ? ` · ${day(r.date)}` : ''}</span>
                  </div>
                </div>
              </div>
            );
          })}</Fragment>)}
        </div>
      ))}
    </div>
  );
}

const ANSWER: Record<string, { label: string; flag: string }> = {
  yes: { label: 'Passes', flag: 'f-ok' }, no: { label: 'Fails', flag: 'f-block' }, unknown: { label: 'Open', flag: 'f-ev' },
};

/** The side pane: the selected LP's reading, or — with nothing selected — the shape of the list. */
export function FitInspector({ children }: { children: ReactNode }) {
  const r = useSyncExternalStore(store.subscribe, store.get, () => null);
  if (!r) return <>{children}</>;
  const d = r.detail;
  return (
    <div className={s.pane} aria-live="polite">
      <div className="lbl">{GROUP_LABEL[r.group]} · {r.kind === 'assessed' ? 'assessed' : r.kind === 'provisional' ? 'provisional' : 'no reading'}</div>
      <div className="ihead">{r.name}</div>
      <div className="imeta">{r.vehicleName} · {r.owner}</div>

      <div className={s.paneScore}>
        <b className="mono">{r.score ?? '—'}</b>
        <span>{r.rank ? `#${r.rank} in this vehicle` : 'not ranked'}{r.date ? ` · ${day(r.date)}` : ''}</span>
      </div>

      <div className={s.paneActions}>
        <Link className="btn p" href={lpHref(r)}>{r.pursuitId ? 'LP workspace →' : 'Their page →'}</Link>
        {r.kind !== 'missing' && <Link className="btn" href={`/${r.vehicleSlug}/fit/${r.entityId}`}>The reading</Link>}
      </div>
      {r.pursuitId && r.status ? (
        <div className={s.paneStatus}>
          <span className="lbl">Status</span>
          <StatusPicker key={`${r.key}:${r.status}`} name={r.name} pursuitId={r.pursuitId} vehicleId={r.vehicleId} status={r.status} />
          {d.nextStep && <p><span className="muted">Next step:</span> {d.nextStep}</p>}
        </div>
      ) : <p className="muted" style={{ fontSize: 12 }}>A formal assessment with no pursuit on this vehicle, so there is no status to set.</p>}

      {r.why && <p className={s.paneWhy}>{r.why}</p>}

      {r.spv && (
        <div className={s.paneBlock}>
          <div className="lbl">SPVs</div>
          <div className={s.paneReading}>
            <span>Stance</span><b>{spvWords(r.spv)}</b>
            <p>{r.spv.why ?? 'Nothing on file either way: unknown is likely open.'}{r.spv.conflict ? ' Other evidence disagrees; the LP page lists both.' : ''}
              {r.spvVehicle && r.spv.stance === 'does-not' ? ' This is an SPV: check before any approach.' : ''}</p>
          </div>
        </div>
      )}

      {d.bases.length > 0 && (
        <div className={s.paneBlock}>
          <div className="lbl">The four readings</div>
          {d.bases.map((b) => (
            <div className={s.paneReading} key={b.label}>
              <span>{b.label}</span><b>{b.value ?? 'not known'}</b>
              {b.basis && <p>{b.basis}</p>}
            </div>
          ))}
        </div>
      )}

      {d.gateList.length > 0 && (
        <div className={s.paneBlock}>
          <div className="lbl">Gates</div>
          {d.gateList.map((g, i) => (
            <div className={s.paneGate} key={i}>
              <span>{g.gate}</span><span className={`flag ${ANSWER[g.answer]?.flag ?? 'f-ev'}`}>{ANSWER[g.answer]?.label ?? g.answer}</span>
              {g.basis && <p>{g.basis}</p>}
            </div>
          ))}
        </div>
      )}

      {(d.next || d.angle || d.toFind.length > 0) && (
        <div className={s.paneBlock}>
          <div className="lbl">The strategy proposes</div>
          {d.next && <p><b>{d.next}</b></p>}
          {d.angle && d.angle !== r.why && <p className="muted">{d.angle}</p>}
          {d.toFind.length > 0 && <ul>{d.toFind.map((q, i) => <li key={i}>{q}</li>)}</ul>}
        </div>
      )}
      <p className="note">
        {r.kind === 'provisional' ? `A proposal by ${d.by ?? 'the strategy workflow'}${d.confidence ? `, ${d.confidence} confidence` : ''}, not an assessment. ` : ''}
        No score clears a gate or authorizes outreach. ↑ ↓ move, Enter opens the LP, Esc returns to the summary.
      </p>
    </div>
  );
}
