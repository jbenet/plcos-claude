import { shortDate } from '@/lib/time';
import { usdM } from '@/lib/money';
import { INSTRUMENT_LABEL, STEP_LABEL, type CloseTrack } from '@/modules/pipeline';

type Milestone = { label: string; date: Date | null; detail: string; recorded: boolean; claim: boolean };

export function CloseProgress({ track }: { track: CloseTrack }) {
  const x = track.exposure;
  const soft = track.events.find(e => e.step === 'soft');
  const closed = track.events.filter(e => e.step === 'closed').at(-1);
  const sig = track.signature;
  const milestones: Milestone[] = [
    { label: 'Soft', date: soft?.on ?? null, recorded: Boolean(soft) || x.track === 'soft',
      claim: (soft?.source ?? x.source) !== 'us', detail: soft ? `Source: ${soft.source}` : x.track === 'soft' ? `Source: ${x.source}` : 'No separate soft record' },
    { label: 'Signed', date: sig?.on ?? null, recorded: Boolean(sig),
      claim: Boolean(sig && !['us', 'close room'].includes(sig.bySource)), detail: sig ? `Source: ${sig.bySource}` : 'No signature recorded' },
    { label: 'Hard', date: x.hardenedAt, recorded: x.track === 'hard', claim: false,
      detail: x.track === 'hard' ? 'Signed and countersigned' : 'Not hard' },
    { label: 'Closed', date: closed?.on ?? null, recorded: Boolean(closed), claim: Boolean(closed && closed.source !== 'us'),
      detail: closed ? `Source: ${closed.source}` : 'No legal close recorded' },
    { label: 'Cash received', date: track.wires.at(-1)?.on ?? null, recorded: track.wired > 0, claim: false,
      detail: track.wired > 0 ? `${usdM(track.wired)} received${track.outstanding ? ` · ${usdM(track.outstanding)} outstanding` : ''}` : 'No cash receipt recorded' },
  ];
  const dated = milestones.filter(m => m.recorded && m.date);
  const min = Math.min(...dated.map(m => m.date!.getTime()));
  const max = Math.max(...dated.map(m => m.date!.getTime()));
  const position = (d: Date) => max === min ? 50 : 3 + 94 * (d.getTime() - min) / (max - min);
  return <div className="status-track">
    <p><b>{x.track === 'hard' ? 'Hard commitment' : 'Soft · must convert'} · {usdM(x.amount)}</b>
      {' · '}{INSTRUMENT_LABEL[x.instrument]}{track.state === 'withdrawn' && ' · Withdrawn'}</p>
    <p className="muted">Source: {x.source} · as of {x.sourceAsOf ? shortDate(x.sourceAsOf) : 'not recorded'}
      {' · '}Evidence: {x.evidenceRef ?? 'not recorded'}{x.claim && ` · Source says: ${x.claim}`}</p>
    <ol className="status-progress" aria-label="Close milestones">
      {milestones.map(m => <li key={m.label} className={m.recorded && !m.claim ? 'recorded' : ''}>
        <b>{m.label}</b><span>{m.recorded ? m.claim ? 'Source claim' : 'Recorded' : 'Not recorded'}</span>
        <span>{m.date ? shortDate(m.date) : 'Date not modelled yet'}</span><small>{m.detail}</small>
      </li>)}
    </ol>
    {dated.length > 0 ? <details className="status-timeline">
      <summary>Close timeline · {dated.length} dated milestones</summary>
      <p className="muted">Recorded dates only. Planned stage dates and durations are not modelled yet. Source claims remain unconfirmed.</p>
      <div className="status-timeline-axis"><span>{shortDate(new Date(min))}</span><span>{shortDate(new Date(max))}</span></div>
      {dated.map(m => <div className="status-timeline-row" key={m.label}>
        <span>{m.label}{m.claim ? ' · claim' : ''} · {shortDate(m.date!)}</span>
        <div className="status-timeline-line" aria-hidden="true"><i style={{ left: `${position(m.date!)}%` }} /></div>
      </div>)}
    </details> : <p className="muted">Close timeline: dates are not modelled yet. Record milestone dates in the LP workspace.</p>}
    {track.events.length > 0 && <details className="status-event-log"><summary>Close records ({track.events.length})</summary>
      <ul>{track.events.map(e => <li key={e.eventId}>{STEP_LABEL[e.step]} · {e.on ? shortDate(e.on) : 'date not recorded'}
        {' · '}Source: {e.source}{e.source !== 'us' && ' (claim)'}{e.reference && ` · ${e.reference}`}{e.reason && ` · ${e.reason}`}</li>)}</ul>
    </details>}
    {track.wiredPerSource && <p className="muted">A source reports a wire. That claim is separate from cash recorded here.</p>}
  </div>;
}
