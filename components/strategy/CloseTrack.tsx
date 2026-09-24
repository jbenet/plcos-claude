import Link from '@/components/ui/AppLink';
import { shortDate } from '@/lib/time';
import { usdM } from '@/lib/money';
import { CLOSE_STATES, CLOSE_STATE_LABEL, STEP_LABEL, type CloseTrack as Track } from '@/modules/pipeline';
import { CloseTrackForm } from './CloseTrackForm';

/**
 * How far the money has got (N52, docs/17 §3): soft → signed → hard → closed, with wires
 * beside it. Read from the events; hard is the exposure's track, which only a MONEY ticket
 * moves (rule 1). A source's claim — "signed", per Affinity — is shown as that source's, undated.
 */
export function CloseTrack({ track: t, pursuitId }: { track: Track; pursuitId: string }) {
  const x = t.exposure;
  const reached = (s: (typeof CLOSE_STATES)[number]) => CLOSE_STATES.indexOf(s) <= CLOSE_STATES.indexOf(t.state === 'withdrawn' ? 'soft' : t.state);
  // When they said it: the first soft event recorded here; for an amount read from a source, that
  // source's claim, undated — the day it was translated is not the day they committed.
  const firstSoft = t.events.find((e) => e.step === 'soft' && e.on);
  const dateOf: Record<string, string> = {
    soft: firstSoft?.on ? shortDate(firstSoft.on) : x.source !== 'us' ? `per ${x.source === 'affinity' ? 'Affinity' : x.source}` : shortDate(x.openedAt),
    signed: t.signature ? (t.signature.on ? shortDate(t.signature.on) : `per ${t.signature.bySource === 'affinity' ? 'Affinity' : t.signature.bySource}, undated`) : '—',
    hard: x.hardenedAt ? shortDate(x.hardenedAt) : '—',
    closed: t.closedOn ? shortDate(t.closedOn) : '—',
  };
  return (
    <div className="card">
      <div className="chead">
        <h2>Close track</h2>
        <span className="lbl">{CLOSE_STATE_LABEL[t.state]} · {usdM(x.amount)} · {x.vehicleName}</span>
      </div>
      <div className="cbody">
        <div className="closesteps" aria-label="Close track">
          {CLOSE_STATES.map((s) => (
            <div key={s} className={`cs${reached(s) ? ' on' : ''}${s === t.state ? ' now' : ''}`}>
              <i />
              <b>{CLOSE_STATE_LABEL[s]}</b>
              <span>{reached(s) ? dateOf[s] : '—'}</span>
            </div>
          ))}
        </div>
        {t.state === 'withdrawn' && <div className="warn" style={{ fontSize: 12.5 }}><b>Withdrawn.</b> Out of every total; the reason is below.</div>}
        {x.track === 'hard' && (
          <div className="fact">
            <span>Wired</span>
            <span>{usdM(t.wired, 2)} of {usdM(x.amount, 2)}{t.outstanding ? ` · ${usdM(t.outstanding, 2)} outstanding` : ' · all of it'}</span>
          </div>
        )}
        {t.wiredPerSource && <div className="fact"><span>Wired, per Affinity</span><span className="muted">a claim, not a wire recorded here — no amount, no date</span></div>}
        {t.resigned > 0 && <div className="fact"><span>Signed again</span><span>{t.resigned} {t.resigned === 1 ? 'time' : 'times'} — the reasons are below</span></div>}
        <div style={{ marginTop: 8 }}>
          {t.events.map((e) => (
            <div className="anote" key={e.eventId}>
              <div className="p2">
                {e.on ? shortDate(e.on) : 'undated'} · {STEP_LABEL[e.step]}
                {e.source === 'us' ? ` · recorded by ${e.recordedByName ?? 'unattributed'}` : ` · ${e.source === 'affinity' ? 'Affinity' : e.source}'s claim`}
              </div>
              <div className="t">
                {[e.amount !== null ? usdM(e.amount, 2) : null, e.document, e.reason, e.reference ? `ref ${e.reference}` : null].filter(Boolean).join(' · ') || <span className="muted">—</span>}
              </div>
            </div>
          ))}
        </div>
        {t.state !== 'withdrawn' && (
          <details className="more" style={{ marginTop: 8 }}>
            <summary>Record what happened</summary>
            <CloseTrackForm exposureId={x.exposureId} pursuitId={pursuitId} state={t.state} signedBefore={t.events.some((e) => (e.step === 'signed' || e.step === 'resigned') && e.source === 'us')} />
          </details>
        )}
      </div>
      <p className="cover">
        <b>Hard means countersigned</b>, through a MONEY ticket on <Link href="/soft-hard">Soft → Hard</Link> —
        the only step that moves a number into a headline (rule 1). A signature, a closing and a
        wire are events; the state is read from them, and cash is never the same check mark as
        the countersignature.
      </p>
    </div>
  );
}
