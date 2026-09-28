import { coalescePage } from '@/lib/page-render';
import Link from '@/components/ui/AppLink';
import { Page } from '@/components/shell/Page';
import { CloseSteps } from '@/components/status/CloseSteps';
import { moduleCrumbs } from '@/lib/nav';
import { vehicleSelection } from '@/lib/session';
import { shortDate } from '@/lib/time';
import { usdM } from '@/lib/money';
import { capacityBandLabel } from '@/lib/capacity-bands';
import { vehicleReadings } from '@/lib/vehicle-readings';
import { pursuitFor, RUNG_LABEL, RUNG_REQUIRES, STATUSES, STATUS_LABEL } from '@/lib/authz/read/strategy';
import { closeTracksFor, CLOSE_STATE_LABEL } from '@/modules/pipeline';
import { claimLabel } from '@/lib/authz/read/research';
import {
  CHANNEL_LABEL, listMeetings, MEETING_LABEL, OBJECTION_LABEL, prepBrief, summarize, touchpointsFor, type Meeting,
} from '@/modules/meetings';
import s from './meetings.module.css';

export const dynamic = 'force-dynamic';

/** Presentation limits, not limits on history: the rest is one click away. */
const HELD_STEP = 25;
const BRIEF_CLAIMS = 3;
const TOUCHES = 5;

const LEVEL: Record<string, string> = { high: 'High', medium: 'Medium', low: 'Low', unknown: 'Not known' };
const VERDICT: Record<string, string> = { strong: 'Strong fit', good: 'Good fit', possible: 'Possible fit', weak: 'Weak fit', unknown: 'Fit not known' };
/** The claims a meeting most needs first: who they are, what they can do, what they back. */
const CLAIM_ORDER = ['role', 'investor_type', 'check_size', 'capacity', 'aum', 'aum_usd', 'typical_check_usd', 'fund_lp', 'interest', 'investment', 'fund_gp', 'board', 'prior_role'];
const claimRank = (field: string) => {
  const i = CLAIM_ORDER.indexOf(field.replace(/^public\./, ''));
  return i === -1 ? CLAIM_ORDER.length : i;
};
const shortLabel = (field: string) => claimLabel(field).replace(/ \(public source\)$/, '').replace(/ — their claim, not verified$/, '');
const when = (m: Meeting) => m.heldOn ?? m.scheduledFor;
const kindOf = (m: Meeting) => (m.kind ? MEETING_LABEL[m.kind] : 'Meeting');

/**
 * Meetings (module 11, issue 0074). The queue on the left is the meetings — coming up, then held,
 * newest first — and the pane is what the next conversation needs: a short brief, where the LP
 * stands on the way to closing, the four readings and the latest contact. It points at the LP
 * workspace for everything else rather than copying it. A generated brief is not built yet (0078).
 */
async function Meetings({ searchParams }: { searchParams: Promise<{ e?: string; m?: string; q?: string; held?: string }> }) {
  const selection = await vehicleSelection();
  const vehicle = selection.current;
  const slug = vehicle?.slug ?? 'all';
  const sp = await searchParams;
  const now = new Date();

  const all = await listMeetings(vehicle?.id ?? null);
  const words = (sp.q ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  const matches = (m: Meeting) => words.every((w) => `${m.entityName} ${m.ownerName} ${m.attendees.join(' ')} ${m.vehicleName ?? ''}`.toLowerCase().includes(w));
  const pool = all.filter(matches);
  const upcoming = pool.filter((m) => !m.heldOn && m.scheduledFor && m.scheduledFor >= now)
    .sort((a, b) => a.scheduledFor!.getTime() - b.scheduledFor!.getTime());
  const unconfirmed = pool.filter((m) => !m.heldOn && (!m.scheduledFor || m.scheduledFor < now));
  const held = pool.filter((m) => m.heldOn);
  const heldShown = Math.max(HELD_STEP, Number.parseInt(sp.held ?? '', 10) || HELD_STEP);

  // A meeting id picks one meeting even when two share an LP; scope is already applied.
  const selected = (sp.m && all.find((m) => m.meetingId === sp.m))
    || (sp.e && (all.find((m) => m.entityId === sp.e && !m.heldOn && m.scheduledFor && m.scheduledFor >= now) ?? all.find((m) => m.entityId === sp.e)))
    || upcoming[0] || held[0] || unconfirmed[0] || null;
  const focusVehicle = vehicle ?? selection.all.find((v) => v.name === selected?.vehicleName) ?? null;
  const entityId = selected?.entityId ?? null;

  const [pursuit, brief, touches, tracks, readings] = entityId && focusVehicle
    ? await Promise.all([
      pursuitFor(entityId, focusVehicle.id), prepBrief(entityId, focusVehicle.id), touchpointsFor(entityId, focusVehicle.id),
      closeTracksFor(entityId, focusVehicle.id), vehicleReadings(focusVehicle.id, entityId),
    ])
    : [null, null, [], [], []] as const;
  const reading = readings.find((r) => r.pursuit_id === pursuit?.pursuitId) ?? readings[0] ?? null;
  const st = reading?.data ?? null;
  const past = touches.filter((t) => t.on && t.on <= now);
  const summary = touches.length ? summarize([...touches], now) : null;
  const lpHref = entityId && focusVehicle ? (pursuit ? `/${focusVehicle.slug}/pipeline/${pursuit.pursuitId}` : `/orgs/${entityId}`) : null;

  // The brief: a few lines, each one the record can carry.
  const claims = [...(brief?.supported ?? [])].sort((a, b) => claimRank(a.field) - claimRank(b.field) || b.asOf.getTime() - a.asOf.getTime());
  const headline: typeof claims = [];
  for (const c of claims) {
    if (headline.length >= BRIEF_CLAIMS) break;
    if (!headline.some((h) => h.field === c.field)) headline.push(c);
  }
  // Before a held meeting, the contact before it; before an upcoming one, the latest contact.
  const lastBefore = selected?.heldOn
    ? past.find((t) => t.on! < selected.heldOn! && t.touchpointId !== selected.meetingId) ?? null
    : past[0] ?? null;
  const fit = st?.fit ? Object.entries(st.fit).find(([k]) => [focusVehicle?.name, focusVehicle?.slug].some((v) => v?.toLowerCase() === k.trim().toLowerCase()))?.[1] : undefined;
  const statusIdx = pursuit ? STATUSES.findIndex((x) => x.id === pursuit.status) : -1;
  const openItems = (brief?.openObjections.length ?? 0) + (brief?.openQuestions.length ?? 0);

  const qs = (changes: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const merged = { q: sp.q, held: sp.held, m: selected?.meetingId, ...changes };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    const out = p.toString();
    return `/${slug}/meetings${out ? `?${out}` : ''}`;
  };

  const item = (m: Meeting, tone: 'k-intro' | 'k-chore' | 'k-stage') => (
    <Link key={m.meetingId} href={qs({ m: m.meetingId })} className={`tix${selected?.meetingId === m.meetingId ? ' on' : ''}`}
      aria-current={selected?.meetingId === m.meetingId ? 'true' : undefined}>
      <div className="tixtop">
        <span className={`kind ${tone}`}>{kindOf(m)}</span>
        <span className="age">{when(m) ? shortDate(when(m)!) : 'undated'}</span>
      </div>
      <b>{m.entityName}</b>
      <p>{m.attendees.length ? m.attendees.join(', ') : m.ownerName}{!vehicle && m.vehicleName ? ` · ${m.vehicleName}` : ''}</p>
    </Link>
  );

  const queue = (
    <>
      <div className="qhead">
        <div className="lbl">Module 11 · meetings</div>
        <h2>{upcoming.length} coming up</h2>
        <p>{held.length.toLocaleString('en-US')} held{unconfirmed.length ? ` · ${unconfirmed.length} not confirmed` : ''}{words.length ? ' matching the search' : ''}.</p>
        <form action={`/${slug}/meetings`} className={s.search} role="search">
          <input type="search" name="q" defaultValue={sp.q} placeholder="LP or person…" aria-label="Search meetings by LP or person" />
        </form>
      </div>
      {upcoming.length > 0 && <div className={s.group}>Coming up</div>}
      {upcoming.map((m) => item(m, 'k-intro'))}
      {unconfirmed.length > 0 && <div className={s.group}>Date passed · not confirmed held</div>}
      {unconfirmed.map((m) => item(m, 'k-stage'))}
      {held.length > 0 && <div className={s.group}>Held · newest first</div>}
      {held.slice(0, heldShown).map((m) => item(m, 'k-chore'))}
      {held.length > heldShown && (
        <Link className={s.more} href={qs({ held: String(heldShown + HELD_STEP) })}>
          Show {Math.min(HELD_STEP, held.length - heldShown)} older · {held.length - heldShown} more
        </Link>
      )}
      {pool.length === 0 && (
        <p className={s.none}>{words.length ? 'No meeting matches the search.' : 'No meetings or calls recorded for this raise.'}</p>
      )}
    </>
  );

  return (
    <Page crumbs={moduleCrumbs('meetings', vehicle?.name ?? null)}>
      <div className={s.split}>
        <aside className={s.queue} aria-label="Meetings"><div className={s.queueIn}>{queue}</div></aside>
        <div className={s.pane}>
          {!selected ? (
            <>
              <div className="lbl">Meetings · {vehicle?.name ?? 'all vehicles'}</div>
              <h1>{sp.m || sp.e ? 'That meeting is not in this vehicle’s record.' : 'Nothing is scheduled.'}</h1>
              <p className="sublede">
                A brief exists for a meeting. Meetings appear here once one is logged in an LP workspace or read from Affinity
                and tied to this raise.
              </p>
            </>
          ) : (
            <>
              <div className="lbl">
                {selected.heldOn ? 'Held' : selected.scheduledFor && selected.scheduledFor >= now ? 'Prep brief' : 'Not confirmed held'}
                {' · '}{focusVehicle?.name ?? 'no vehicle recorded'}
                {when(selected) ? ` · ${shortDate(when(selected)!)}` : ''}
              </div>
              <div className={s.titleRow}>
                <h1>{selected.entityName}</h1>
                {lpHref && <Link className="btn" href={lpHref}>LP workspace →</Link>}
              </div>
              <p className="sublede">
                {kindOf(selected)}{selected.attendees.length ? ` with ${selected.attendees.join(', ')}` : ''}. Owner {selected.ownerName}.
                {selected.scheduledFor && !selected.heldOn && selected.scheduledFor < now && ' The date has passed and nobody has recorded it as held.'}
              </p>

              {brief?.restriction && (
                <div className="warn" style={{ marginBottom: 14 }}>
                  <div className="lbl" style={{ color: 'var(--clay)' }}>Restriction on file</div>
                  <p>{brief.restriction}</p>
                </div>
              )}

              {/* At a glance: four cells, each a pointer to where the full story lives. */}
              <div className={s.glance}>
                <div>
                  <span className="lbl">Status</span>
                  <b>{pursuit ? STATUS_LABEL[pursuit.status] : 'No pursuit'}</b>
                  <small>{pursuit?.rung ? `Ladder: ${RUNG_LABEL[pursuit.rung]}` : 'Nothing on the ladder'}</small>
                </div>
                <div>
                  <span className="lbl">Close</span>
                  <b>{tracks[0] ? `${CLOSE_STATE_LABEL[tracks[0].state]} · ${usdM(tracks[0].exposure.amount)}` : 'No commitment'}</b>
                  <small>{tracks[0] ? (tracks[0].exposure.track === 'hard' ? 'hard' : 'soft — must convert') : 'nothing soft or hard on file'}</small>
                </div>
                <div>
                  <span className="lbl">Contact</span>
                  <b>{summary?.meetingDates.length ? `${summary.meetingDates.length} meeting${summary.meetingDates.length === 1 ? '' : 's'} held` : 'No meeting held'}</b>
                  <small>
                    {summary?.lastTouch ? `last ${shortDate(summary.lastTouch)}` : 'no dated contact'}
                    {summary?.awaitingSince ? ` · awaiting reply since ${shortDate(summary.awaitingSince)}` : summary?.lastFromThem ? ` · from them ${shortDate(summary.lastFromThem)}` : ''}
                  </small>
                </div>
                <div>
                  <span className="lbl">Score</span>
                  <b>{reading?.score != null ? <>{reading.score}<span className={s.of}> / 100</span></> : 'No score'}</b>
                  <small>{reading?.score != null ? 'provisional · from the strategy' : st ? 'fewer than two readings known' : 'no strategy on file'}</small>
                </div>
              </div>

              <div className={s.cols}>
                <div className={s.main}>
                  {selected.heldOn && (selected.summary || selected.justification) && (
                    <div className="card">
                      <div className="chead">
                        <h2>What happened</h2>
                        <span className="lbl">{shortDate(selected.heldOn)}</span>
                      </div>
                      <div className="cbody">
                        {selected.summary && <p>{selected.summary}</p>}
                        {selected.justification && <p className="muted">{selected.justification}</p>}
                      </div>
                    </div>
                  )}

                  <div className="card">
                    <div className="chead">
                      <h2>{selected.heldOn ? 'Brief for the next one' : 'Brief'}</h2>
                      <span className="lbl">from the record · {claims.length} sourced claim{claims.length === 1 ? '' : 's'}</span>
                    </div>
                    <dl className={s.brief}>
                      {(lastBefore || !selected.heldOn) && <div>
                        <dt>{selected.heldOn ? 'Before this' : 'Where we left it'}</dt>
                        <dd>
                          {lastBefore ? (
                            <>
                              <span className="mono muted">{shortDate(lastBefore.on!)} · {CHANNEL_LABEL[lastBefore.channel]}</span>{' '}
                              <span className={s.clamp}>{lastBefore.summary ?? 'No summary recorded.'}</span>
                            </>
                          ) : <span className="muted">No earlier contact on file for this raise.</span>}
                        </dd>
                      </div>}
                      <div>
                        <dt>Next step</dt>
                        <dd>
                          {pursuit?.nextStep
                            ? <>{pursuit.nextStep}{pursuit.nextStepOn && <span className="muted"> · due {shortDate(pursuit.nextStepOn)}</span>}</>
                            : st?.next?.what
                              ? <>{st.next.what}<span className="muted"> · proposed by the strategy, not yet accepted</span></>
                              : <span className="muted">None recorded.</span>}
                        </dd>
                      </div>
                      {st?.angle && (
                        <div>
                          <dt>Why they’d care</dt>
                          <dd><span className={s.clamp}>{st.angle}</span></dd>
                        </div>
                      )}
                      <div>
                        <dt>What we know</dt>
                        <dd>
                          {headline.length ? (
                            <ul className={s.claims}>
                              {headline.map((c, i) => (
                                <li key={i}>
                                  <b>{shortLabel(c.field)}.</b> <span className={s.clamp}>{c.value}</span>
                                  <small>{c.source} · {shortDate(c.asOf)} · {c.verifiedBy ? `verified by ${c.verifiedBy}` : 'unverified'}</small>
                                </li>
                              ))}
                            </ul>
                          ) : <span className="muted">Nothing with a source, a date and a confidence. The brief says nothing rather than guess.</span>}
                        </dd>
                      </div>
                      {(brief?.refused.length ?? 0) > 0 && (
                        <div>
                          <dt className={s.warnDt}>Do not assert</dt>
                          <dd>{brief!.refused.length} claim{brief!.refused.length === 1 ? '' : 's'} on file without full provenance: ask, don’t state.</dd>
                        </div>
                      )}
                    </dl>
                    {(claims.length > headline.length || (brief?.refused.length ?? 0) > 0) && (
                      <details className={s.more2}>
                        <summary>All {claims.length} sourced claims{brief?.refused.length ? ` and ${brief.refused.length} withheld` : ''}</summary>
                        <div className={s.allClaims}>
                          {claims.map((c, i) => (
                            <div key={i}>
                              <span>{shortLabel(c.field)}</span>
                              <p>{c.value}<small>{c.source} · {shortDate(c.asOf)} · {c.confidence} confidence · {c.verifiedBy ? `verified by ${c.verifiedBy}` : 'unverified'}</small></p>
                            </div>
                          ))}
                          {brief?.refused.map((r, i) => (
                            <div key={`r${i}`} className={s.refused}>
                              <span>{shortLabel(r.field)}</span>
                              <p>{r.why}</p>
                            </div>
                          ))}
                        </div>
                      </details>
                    )}
                    <p className="cover">
                      A short brief from what the record can support; every line carries its source or says it has none.
                      Generated briefs that read the history and earlier notes are not built yet (issue 0078).
                    </p>
                  </div>

                  <div className="card">
                    <div className="chead">
                      <h2>Path to closing</h2>
                      {lpHref && <Link className="xref" href={lpHref}>full record →</Link>}
                    </div>
                    <div className="cbody">
                      <ol className={s.path} aria-label="Pipeline status">
                        {STATUSES.filter((x) => x.id !== 'passed').map((x, i) => (
                          <li key={x.id} className={pursuit?.status === x.id ? s.now : i < statusIdx && pursuit?.status !== 'passed' ? s.past : ''}>
                            {x.label}
                          </li>
                        ))}
                      </ol>
                      {pursuit?.status === 'passed' && <p className={s.passed}>Passed{pursuit.statusReason ? ` — ${pursuit.statusReason}` : ''}.</p>}
                      {pursuit?.headline && <p className={s.headline}>{pursuit.headline}</p>}
                      {pursuit?.plan.length ? (
                        <ol className={s.plan}>
                          {pursuit.plan.slice(0, 3).map((p, i) => (
                            <li key={i}>{p.move}{p.blockedBy && <span className="muted"> — blocked by {p.blockedBy}</span>}</li>
                          ))}
                        </ol>
                      ) : null}
                      {tracks.map((t) => (
                        <div className={s.track} key={t.exposure.exposureId}>
                          <div className={s.trackHead}>
                            <b>{usdM(t.exposure.amount)}</b>
                            <span className="muted">{t.exposure.track === 'hard' ? 'hard' : 'soft'} · {t.exposure.source === 'us' ? 'recorded here' : `per ${t.exposure.source}`}</span>
                          </div>
                          <CloseSteps track={t} />
                        </div>
                      ))}
                      <div className={s.ladder}>
                        <div>
                          <span className="lbl">On the ladder</span>
                          <b>{pursuit?.rung ? RUNG_LABEL[pursuit.rung] : 'Nothing yet'}</b>
                        </div>
                        {pursuit?.nextRung && (
                          <div>
                            <span className="lbl">This meeting could justify</span>
                            <b>{RUNG_LABEL[pursuit.nextRung]}</b>
                            <small>{RUNG_REQUIRES[pursuit.nextRung]}</small>
                          </div>
                        )}
                      </div>
                    </div>
                    <p className="cover">
                      The status is our plan; the ladder is what the evidence shows; the close track is where the money is. They are
                      kept apart, and none of them fills in another.
                    </p>
                  </div>
                </div>

                <div className={s.side}>
                  <div className="card">
                    <div className="chead">
                      <h2>Readings</h2>
                      <span className="lbl">{st ? 'provisional' : 'none'}</span>
                    </div>
                    <div className="cbody">
                      {st?.scores ? (
                        <>
                          {fit && (
                            <div className={s.fit}>
                              <b>{VERDICT[fit.verdict] ?? fit.verdict}</b>
                              <span className={s.clamp}>{fit.why}</span>
                            </div>
                          )}
                          {([
                            ['Capacity', st.scores.capacity?.band ? capacityBandLabel(st.scores.capacity.band) : null, st.scores.capacity?.basis],
                            ['Affinity', st.scores.affinity?.level ? LEVEL[st.scores.affinity.level] : null, st.scores.affinity?.basis],
                            ['Propensity', st.scores.propensity?.level ? LEVEL[st.scores.propensity.level] : null, st.scores.propensity?.basis],
                            ['Time to decide', st.scores.timeToDecision?.band ?? null, st.scores.timeToDecision?.basis],
                          ] as Array<[string, string | null, string | undefined]>).map(([label, value, basis]) => (
                            <details className={s.reading} key={label}>
                              <summary><span>{label}</span><b>{value && value !== 'unknown' ? value : 'Not known'}</b></summary>
                              <p>{basis || 'No basis given.'}</p>
                            </details>
                          ))}
                          <p className={s.readNote}>
                            {reading?.made_by} · {reading?.made_at ? shortDate(reading.made_at) : 'undated'} · {st.confidence ?? 'unknown'} confidence. A proposal, not an assessment.
                          </p>
                        </>
                      ) : (
                        <p className="muted">
                          No strategy has been written for this LP on {focusVehicle?.name ?? 'this vehicle'}, so there are no readings. That is
                          a gap in our work, not a low score.
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="card">
                    <div className="chead">
                      <h2>Open questions</h2>
                      <span className="lbl">{openItems}</span>
                    </div>
                    <div className="cbody">
                      {openItems === 0 && <p className="muted">None outstanding.</p>}
                      {brief?.openObjections.map((o) => (
                        <div className={s.q} key={o.objectionId}>
                          <p>{o.statement}</p>
                          <span className="flag f-block">{OBJECTION_LABEL[o.class]} objection · {o.status}</span>
                        </div>
                      ))}
                      {brief?.openQuestions.map((q) => (
                        <div className={s.q} key={q.questionId}>
                          <p>{q.question}</p>
                          <span className={`flag ${q.overdue ? 'f-block' : 'f-mute'}`}>{q.status}{q.dueOn ? ` · ${shortDate(q.dueOn)}` : ''}</span>
                          <span className="muted"> {q.ownerName ?? 'unowned'}</span>
                        </div>
                      ))}
                      {st?.openQuestions?.length ? (
                        <div className={s.q}>
                          <span className="lbl">To find out, per the strategy</span>
                          <ul>{st.openQuestions.slice(0, 3).map((q, i) => <li key={i}>{q}</li>)}</ul>
                        </div>
                      ) : null}
                    </div>
                  </div>

                  <div className="card">
                    <div className="chead">
                      <h2>Latest contact</h2>
                      <span className="lbl">{past.length}</span>
                    </div>
                    {past.slice(0, TOUCHES).map((t) => (
                      <div className={s.touch} key={t.touchpointId}>
                        <span className="mono">{shortDate(t.on!)} · {CHANNEL_LABEL[t.channel]}</span>
                        <p className={s.clamp}>{t.summary ?? 'No summary recorded.'}</p>
                        <small>{t.ownerName}{t.viaOrganization ? ` · with ${t.viaOrganization}` : ''}{t.source !== 'us' ? ` · ${t.source === 'affinity' ? 'Affinity' : t.source}` : ''}</small>
                      </div>
                    ))}
                    {past.length === 0 && <div className="cbody"><p className="muted">No dated contact on file.</p></div>}
                    {past.length > TOUCHES && lpHref && <p className="cover"><Link href={lpHref}>The full timeline is in the LP workspace →</Link></p>}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </Page>
  );
}

export default coalescePage('/meetings', Meetings);
