import { coalescePage } from '@/lib/page-render';
import Link from '@/components/ui/AppLink';
import { Page } from '@/components/shell/Page';
import { CloseSteps, closeSteps } from '@/components/status/CloseSteps';
import { moduleCrumbs } from '@/lib/nav';
import { vehicleSelection } from '@/lib/session';
import { usdM, multiple } from '@/lib/money';
import { shortDate, formatDate } from '@/lib/time';
import { CLOSE_PAGE_SIZE, INSTRUMENT_LABEL, vehicleCloseStatus, vehicleStatusCounts, vehicleTotals } from '@/modules/pipeline';
import { conditionsFor, listCycles } from '@/modules/close';
import { listMeetings } from '@/modules/meetings';
import { STATUSES } from '@/lib/authz/read/strategy';
import s from './status.module.css';

export const dynamic = 'force-dynamic';

const KIND_LABEL: Record<string, string> = { fund: 'Fund', spv: 'SPV', grant_rail: 'Grants rail' };
const DAY = 86_400_000;
const d = (v: Date | string | null | undefined) => (v ? new Date(v) : null);

/**
 * Vehicle status (module 09, issue 0075). The money headline, hard only, then the pipeline as
 * counts by status, then every LP in a close state with how far each commitment has got and
 * what is next, then the close conditions. The LP list itself is the pipeline page's; this page
 * does not repeat it (Juan: the old pursuits list duplicated Soft → Hard).
 */
async function Vehicles({ searchParams }: { searchParams: Promise<{ closePage?: string }> }) {
  const selection = await vehicleSelection();
  const vehicle = selection.current;
  const vehicleId = vehicle?.id ?? null;
  const sp = await searchParams;
  const now = new Date();
  const [totals, counts, close, cycles, meetings] = await Promise.all([
    vehicleTotals(), vehicleStatusCounts(vehicleId), vehicleCloseStatus(vehicleId, Number(sp.closePage ?? 1)),
    listCycles(), listMeetings(vehicleId),
  ]);
  const mine = vehicle ? totals.find((t) => t.vehicleId === vehicle.id) ?? null : null;
  const cycle = cycles.find((c) => c.status === 'open' && (!vehicleId || c.vehicleId === vehicleId)) ?? null;
  const conditions = cycle ? (await conditionsFor(cycle.cycleId)).filter((c) => c.status === 'open' || c.status === 'failed') : [];
  const base = `/${vehicle?.slug ?? 'all'}/status`;

  // Pipeline: open pursuits by status, archived apart.
  const byStatus = STATUSES.map((st) => {
    const rows = counts.filter((c) => c.status === st.id);
    const n = rows.reduce((a, c) => a + c.n, 0);
    const archived = rows.reduce((a, c) => a + c.archived, 0);
    return { ...st, open: n - archived, archived };
  });
  const openTotal = byStatus.reduce((a, x) => a + x.open, 0);
  const archivedTotal = byStatus.reduce((a, x) => a + x.archived, 0);
  const maxOpen = Math.max(1, ...byStatus.map((x) => x.open));
  const held30 = meetings.filter((m) => m.heldOn && now.getTime() - m.heldOn.getTime() <= 30 * DAY && m.heldOn <= now).length;
  const coming = meetings.filter((m) => !m.heldOn && m.scheduledFor && m.scheduledFor >= now).length;

  // The close timeline: recorded milestone dates only, on one axis with the cycle's target.
  const dated = close.rows.map((r) => ({
    r,
    marks: r.tracks.flatMap((t) => closeSteps(t).filter((m) => m.state !== 'none' && m.date).map((m) => ({ ...m, key: `${t.exposure.exposureId}:${m.label}` }))),
  })).filter((x) => x.marks.length > 0);
  const stamps = [...dated.flatMap((x) => x.marks.map((m) => m.date!.getTime())), ...(cycle ? [cycle.targetDate.getTime()] : [])];
  const t0 = stamps.length ? Math.min(...stamps) - 7 * DAY : 0;
  const t1 = stamps.length ? Math.max(...stamps, now.getTime()) + 7 * DAY : 1;
  const x = (t: number) => `${(100 * (t - t0)) / (t1 - t0)}%`;
  const months: Date[] = [];
  if (stamps.length) {
    const m = new Date(t0);
    m.setUTCDate(1); m.setUTCMonth(m.getUTCMonth() + 1);
    for (; m.getTime() < t1; m.setUTCMonth(m.getUTCMonth() + 1)) months.push(new Date(m));
  }

  const others = totals.filter((t) => t.vehicleId !== vehicleId);

  return (
    <Page
      crumbs={moduleCrumbs('vehicles', vehicle?.name ?? null)}
      inspector={
        <>
          <div className="lbl">Why there is no total</div>
          <div className="ihead">{totals.length} raises, {totals.length} numbers</div>
          <div className="imeta">{vehicle ? 'The others, hard only' : 'Each vehicle stands on its own'}</div>
          {vehicle && others.map((t) => (
            <div className="kv" key={t.vehicleId}>
              <span><Link href={`/${t.vehicleSlug}/status`}>{t.vehicleName}</Link></span>
              <span className="mono">{usdM(t.hard)}</span>
            </div>
          ))}
          <div className="scope">
            <p>
              No blended figure across these vehicles appears anywhere in this system. They have different targets,
              instruments and investors and — in one case — a different exemption. Soft sits beside hard and is never
              added to it.
            </p>
          </div>
          <div className="kv"><span>506(c) vehicles</span><span>{totals.filter((t) => t.exemption === '506(c)').length}</span></div>
          <div className="kv"><span>506(b) vehicles</span><span>{totals.filter((t) => t.exemption === '506(b)').length}</span></div>
          <div className="note">
            One 506(b) SPV among 506(c) vehicles is open question 4 — a conversation for counsel rather than a data model.
          </div>
        </>
      }
    >
      <div className="lbl">Module 09 · Convert &amp; coordinate</div>
      <h1>Status</h1>
      <p className="sublede">
        {vehicle ? vehicle.name : 'Every vehicle'}: hard-only headline, the pipeline by status, and every LP in a close
        state with how far their money has got and what comes next.
      </p>

      {mine ? (
        <div className={`kpis ${s.kpis}`}>
          <div className="kpi"><div className="lbl">Hard</div><div className="n g">{usdM(mine.hard)}</div><div className="f">signed and countersigned · {mine.hardCount} LP{mine.hardCount === 1 ? '' : 's'}</div></div>
          <div className="kpi"><div className="lbl">Soft</div><div className="n">{usdM(mine.soft)}</div><div className="f">beside hard, never in it · {mine.softCount} LP{mine.softCount === 1 ? '' : 's'}</div></div>
          <div className="kpi"><div className="lbl">Cash received</div><div className="n">{usdM(mine.cash)}</div><div className="f">wired, within hard</div></div>
          <div className="kpi"><div className="lbl">Gap to target</div><div className="n">{mine.gapToTarget === null ? '—' : usdM(mine.gapToTarget)}</div><div className="f">{mine.target ? `hard against ${usdM(mine.target, 0)}` : 'no target set'}</div></div>
          <div className="kpi soft"><div className="lbl">Coverage</div><div className="n q">{mine.coverage === null ? '—' : multiple(mine.coverage)}</div><div className="f">hard + soft over target: a pipeline measure, not money</div></div>
        </div>
      ) : (
        <div className="card">
          <div className="chead">
            <h2>All vehicles</h2>
            <span className="lbl">{totals.length} · no row sums the others</span>
          </div>
          <div className={s.scroll}>
            <table className="list">
              <thead>
                <tr>
                  <th>Vehicle</th><th style={{ width: 90 }}>Kind</th><th style={{ width: 80 }}>Exemption</th>
                  <th style={{ width: 90 }} className="right">Hard</th><th style={{ width: 90 }} className="right">Soft</th>
                  <th style={{ width: 90 }} className="right">Cash</th><th style={{ width: 90 }} className="right">Gap</th>
                  <th style={{ width: 90 }} className="right">Coverage</th>
                </tr>
              </thead>
              <tbody>
                {totals.map((t) => (
                  <tr key={t.vehicleId}>
                    <td><Link href={`/${t.vehicleSlug}/status`}><b>{t.vehicleName}</b></Link>
                      <div className="muted" style={{ fontSize: 11.5 }}>target {t.target ? usdM(t.target, 0) : 'none set'}{t.historical ? ' · history' : ''}</div></td>
                    <td className="muted">{KIND_LABEL[t.kind] ?? t.kind}</td>
                    <td className="mono muted">{t.exemption}</td>
                    <td className="right mono" style={{ color: 'var(--green)' }}>{usdM(t.hard)}</td>
                    <td className="right mono muted">{usdM(t.soft)}</td>
                    <td className="right mono muted">{usdM(t.cash)}</td>
                    <td className="right mono">{t.gapToTarget === null ? '—' : usdM(t.gapToTarget)}</td>
                    <td className="right mono muted">{t.coverage === null ? '—' : multiple(t.coverage)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="cover"><b>There is no total row.</b> Adding these together would produce a number that is not true of anything.</p>
        </div>
      )}

      <div className={s.two}>
        <div className="card">
          <div className="chead">
            <h2>Pipeline</h2>
            <span className="lbl">{openTotal.toLocaleString('en-US')} open{archivedTotal ? ` · ${archivedTotal.toLocaleString('en-US')} archived` : ''}</span>
          </div>
          <div className={s.bars}>
            {byStatus.map((st) => (
              <div key={st.id} className={s.bar} title={st.means}>
                <span className={s.barLabel}>{st.label}</span>
                <span className={s.barTrack}><i style={{ width: `${(100 * st.open) / maxOpen}%` }} className={st.id === 'committed' ? s.barGreen : st.id === 'passed' ? s.barMuted : ''} /></span>
                <b className="mono">{st.open.toLocaleString('en-US')}</b>
                <small className="mono">{st.archived ? `+${st.archived}` : ''}</small>
              </div>
            ))}
          </div>
          <div className={s.minis}>
            <div><b>{close.total}</b><span>in a close state</span></div>
            <div><b>{held30}</b><span>meetings held, 30 days</span></div>
            <div><b>{coming}</b><span>meetings coming up</span></div>
          </div>
          <p className="cover">
            Counts of pursuits by status; archived ones are the small figures. A status is our plan: it is not consent, a
            legal close or cash. <Link href={`/${vehicle?.slug ?? 'all'}/pipeline`}>The pipeline →</Link>
          </p>
        </div>

        <div className="card">
          <div className="chead">
            <h2>Close conditions</h2>
            <span className="lbl">{cycle ? `${cycle.label} · ${shortDate(cycle.targetDate)}` : 'no cycle open'}</span>
          </div>
          {cycle && (
            <div className={s.cycle}>
              <b>{cycle.workingDaysLeft ?? '—'}</b> working days to {cycle.label.toLowerCase()}
              {cycle.targetAmount ? <> · target {usdM(cycle.targetAmount, 0)}</> : null}
            </div>
          )}
          {conditions.length === 0 ? (
            <div className="cbody"><p className="muted">{cycle ? 'No open conditions on this cycle.' : 'A close cycle opens with a target date in the close room; nothing is open here yet.'}</p></div>
          ) : conditions.map((c) => (
            <div className={s.cond} key={c.conditionId}>
              <div>
                <b>{c.label}</b>
                <span>{c.entityName ?? 'Every LP'} · {c.ownerName ?? 'unowned'}</span>
              </div>
              <span className={`flag ${c.overdue || c.status === 'failed' ? 'f-block' : 'f-mute'}`}>
                {c.status === 'failed' ? 'Failed' : c.dueOn ? `${c.overdue ? 'Overdue · ' : ''}${shortDate(c.dueOn)}` : 'No date'}
              </span>
            </div>
          ))}
          <p className="cover"><Link href={`/${vehicle?.slug ?? 'all'}/close`}>The close room →</Link></p>
        </div>
      </div>

      <div className={`card ${s.inclose}`}>
        <div className="chead">
          <h2>In close</h2>
          <span className="lbl">{close.total} LP{vehicle ? '' : '–vehicle pair'}{close.total === 1 ? '' : 's'} · committed, or money on file</span>
        </div>
        {close.rows.length === 0 ? (
          <div className="cbody">
            <div className="empty">
              <span className="stat unavailable"><i />Nobody in close</span>
              <h3>No LP here is committed or has money on file.</h3>
              <p>An LP appears once their pursuit is Committed or a soft or hard amount is recorded for them.</p>
            </div>
          </div>
        ) : (
          <>
            <div className={`${s.lpRow} ${s.lpHead}`} aria-hidden="true">
              <span>LP</span><span>Amount</span><span>Soft → cash</span><span>Next</span>
            </div>
            {close.rows.map((lp) => {
              const href = lp.pursuit_id ? `/${lp.vehicle_slug}/pipeline/${lp.pursuit_id}` : `/orgs/${lp.entity_id}`;
              const own = lp.conditions.filter((c) => c.entity_id !== null);
              const extra = lp.questions.length + own.length + (lp.note || lp.headline || lp.status_reason ? 1 : 0);
              return (
                <div className={s.lp} key={`${lp.entity_id}:${lp.vehicle_id}`}>
                  <div className={s.lpRow}>
                    <div className={s.who}>
                      <Link href={href}><b>{lp.entity_name}</b></Link>
                      <span>{lp.owner_name ?? lp.tracks[0]?.exposure.ownerName ?? 'unowned'}{vehicle ? '' : ` · ${lp.vehicle_name}`}</span>
                    </div>
                    <div className={s.amt}>
                      {lp.tracks.length ? lp.tracks.map((t) => (
                        <div key={t.exposure.exposureId}>
                          <b className="mono">{usdM(t.exposure.amount)}</b>
                          <span>{t.exposure.track === 'hard' ? 'hard' : 'soft'} · {INSTRUMENT_LABEL[t.exposure.instrument]}</span>
                        </div>
                      )) : <span className="muted">no amount on file</span>}
                    </div>
                    <div className={s.prog}>
                      {lp.tracks.length ? lp.tracks.map((t) => <CloseSteps key={t.exposure.exposureId} track={t} compact />) : (
                        <p className={s.missing}>
                          Committed in the pipeline; no close record yet.
                          {lp.stage_said && <> Source says “{lp.stage_said}” — a claim, not close evidence.</>}
                        </p>
                      )}
                    </div>
                    <div className={s.next}>
                      {lp.next_step
                        ? <>{lp.next_step}{d(lp.next_step_on) && <span className={d(lp.next_step_on)! < now ? s.late : 'muted'}> · {shortDate(d(lp.next_step_on)!)}</span>}</>
                        : <span className="muted">No next step recorded.</span>}
                    </div>
                  </div>
                  {extra > 0 && (
                    <details className={s.detail}>
                      <summary>
                        {[lp.questions.length ? `${lp.questions.length} open question${lp.questions.length === 1 ? '' : 's'}` : null,
                          own.length ? `${own.length} condition${own.length === 1 ? '' : 's'}` : null,
                          lp.note || lp.headline || lp.status_reason ? 'notes' : null].filter(Boolean).join(' · ')}
                      </summary>
                      <div className={s.detailBody}>
                        {(lp.questions.length > 0 || own.length > 0) && (
                          <ul>
                            {lp.questions.map((q) => (
                              <li key={q.question_id}>{q.question} <span className="muted">· {q.status}{d(q.due_on) ? ` · due ${shortDate(d(q.due_on)!)}` : ''}</span></li>
                            ))}
                            {own.map((c, i) => (
                              <li key={`c${i}`}><b>{c.label}</b>{c.detail ? ` — ${c.detail}` : ''} <span className="muted">· {c.owner_name ?? 'unowned'}{d(c.due_on) ? ` · due ${shortDate(d(c.due_on)!)}` : ''}</span></li>
                            ))}
                          </ul>
                        )}
                        {(lp.headline || lp.status_reason) && <p>{[lp.headline, lp.status_reason].filter(Boolean).join(' ')}</p>}
                        {lp.note && <p className="muted">Context, {shortDate(new Date(lp.note.created_at))}: {lp.note.body}</p>}
                      </div>
                    </details>
                  )}
                </div>
              );
            })}
            {close.total > CLOSE_PAGE_SIZE && (
              <nav className={s.pager} aria-label="In close pages">
                {close.page > 1 ? <Link className="btn" href={`${base}?closePage=${close.page - 1}`}>← Previous</Link> : <span />}
                <span className="mono">{(close.page - 1) * CLOSE_PAGE_SIZE + 1}–{Math.min(close.page * CLOSE_PAGE_SIZE, close.total)} of {close.total}</span>
                {close.page * CLOSE_PAGE_SIZE < close.total ? <Link className="btn" href={`${base}?closePage=${close.page + 1}`}>Next →</Link> : <span />}
              </nav>
            )}
          </>
        )}
        <p className="cover">
          Five separate states: soft, signed, hard (countersigned), closed and cash. A filled dot is recorded here; a dashed
          one is only a source’s claim; an empty one is not on file, and a later step never fills in an earlier one.
        </p>
      </div>

      <div className={`card ${s.inclose}`}>
        <div className="chead">
          <h2>Close timeline</h2>
          <span className="lbl">recorded dates · this page’s LPs</span>
        </div>
        {dated.length === 0 ? (
          <div className="cbody"><p className="muted">No close milestone on this page carries a date yet.</p></div>
        ) : (
          <div className={s.gantt}>
            <div className={s.gRow}>
              <span />
              <div className={s.axis}>
                {months.map((m) => <span key={m.toISOString()} style={{ left: x(m.getTime()) }}>{formatDate(m, { month: 'short', timeZone: 'UTC' })}</span>)}
              </div>
            </div>
            {dated.map(({ r, marks }) => {
              const ts = marks.map((m) => m.date!.getTime());
              // A label only where it has room; the dot and the list above carry the rest.
              let lastLabelled = -Infinity;
              const labelled = new Set([...marks].sort((a, b) => a.date!.getTime() - b.date!.getTime()).filter((m) => {
                const room = (m.date!.getTime() - lastLabelled) / (t1 - t0) > 0.08;
                if (room) lastLabelled = m.date!.getTime();
                return room;
              }).map((m) => m.key));
              return (
                <div className={s.gRow} key={`${r.entity_id}:${r.vehicle_id}`}>
                  <span className={s.gName}>{r.entity_name}</span>
                  <div className={s.gTrack}>
                    <i className={s.gToday} style={{ left: x(now.getTime()) }} />
                    {cycle && <i className={s.gTarget} style={{ left: x(cycle.targetDate.getTime()) }} />}
                    <i className={s.gSpan} style={{ left: x(Math.min(...ts)), width: `calc(${x(Math.max(...ts))} - ${x(Math.min(...ts))})` }} />
                    {marks.map((m) => (
                      <b key={m.key} className={m.state === 'claim' ? s.gClaim : ''} style={{ left: x(m.date!.getTime()) }} title={`${m.label} · ${shortDate(m.date!)}`}>
                        {labelled.has(m.key) && <em>{m.label}</em>}
                      </b>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <p className="cover">
          Recorded dates only; the grey line is today{cycle ? `, the dashed one ${cycle.label.toLowerCase()} (${shortDate(cycle.targetDate)})` : ''}.
          Planned dates for each step are not modelled yet, so this shows what happened, not a plan. The same dates are in
          the list above.
        </p>
      </div>
    </Page>
  );
}

export default coalescePage('/vehicles', Vehicles);
