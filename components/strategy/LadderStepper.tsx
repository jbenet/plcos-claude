import { RUNGS, RUNG_LABEL, rungIndex, type Pursuit } from '@/modules/strategy/client';

const fmt = (d: Date) => d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });

/**
 * Six states, rendered so the gap between claimed and evidenced is visible rather than
 * inferred. A rung with no evidence record is not "in progress" — it is empty, and it
 * says so.
 */
export function LadderStepper({ pursuit }: { pursuit: Pursuit }) {
  const here = rungIndex(pursuit.rung);

  return (
    <div className="ladder">
      <div className="lbl">Where this actually stands</div>
      <div className="steps">
        {RUNGS.map((rung, i) => {
          const event = pursuit.events.find((e) => e.rung === rung);
          const na = event?.evidenceKind === 'not_applicable';
          const cls = event ? (na ? 'na' : 'done') : i === here + 1 ? 'here' : 'pend';
          return (
            <div className={`step ${cls}`} key={rung}>
              <div className="bul" />
              <div className="nm">{RUNG_LABEL[rung]}</div>
              {event ? (
                <>
                  <div className="ev">{event.evidenceNote}</div>
                  <div className="when">
                    {na ? 'not applicable' : `${fmt(event.occurredAt)} · ${event.evidenceKind} ${event.evidenceRef}`}
                  </div>
                </>
              ) : (
                <div className="ev">{i === here + 1 ? 'Not yet. Nothing on file.' : '—'}</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
