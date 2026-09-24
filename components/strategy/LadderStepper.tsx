import Link from 'next/link';
import { RUNGS, RUNG_LABEL, rungIndex, type LadderRung, type Pursuit } from '@/modules/strategy/client';
import type { OnFile } from '@/lib/reconcile';

const fmt = (d: Date) => d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });

/**
 * Six states, rendered so the gap between claimed and evidenced is visible rather than
 * inferred. A rung with no evidence record is not "in progress" — it is empty, and it
 * says so.
 *
 * Three layers since N57 (docs/18), each drawn differently: what the ladder has accepted (solid),
 * what records on file support but nobody has accepted yet (a dashed ring, with the record and
 * its proposal), and what Affinity's word claims (named, never filled in).
 */
export function LadderStepper({ pursuit, onFile, proposalId, claimed }: {
  pursuit: Pursuit;
  onFile?: OnFile | null;
  /** The open STAGE ticket that would record the climb, if one is open. */
  proposalId?: string | null;
  /** The rung Affinity's word would be evidence for, and the word. */
  claimed?: { rung: LadderRung; word: string } | null;
}) {
  const here = rungIndex(pursuit.rung);
  const climb = new Map((onFile?.climb ?? []).map((r) => [r.rung, r]));
  const next = here + 1 + climb.size;
  const top = Math.max(here, here + climb.size);

  return (
    <div className="ladder">
      <div className="lbl">Where this actually stands</div>
      <div className="steps">
        {RUNGS.map((rung, i) => {
          const event = pursuit.events.find((e) => e.rung === rung);
          const na = event?.evidenceKind === 'not_applicable';
          const file = event ? null : climb.get(rung) ?? null;
          // On file, but above a rung that has nothing: it waits for the rungs below it.
          const stranded = event || file ? null : onFile?.byRung[rung] ?? null;
          const claim = claimed && claimed.rung === rung && i > top ? claimed : null;
          const cls = event ? (na ? 'na' : 'done')
            : file ? (file.kind === 'not_applicable' ? 'file na' : 'file')
            : i === next ? 'here' : 'pend';
          return (
            <div className={`step ${cls}`} key={rung}>
              <div className="bul" />
              <div className="nm">{RUNG_LABEL[rung]}</div>
              {event ? (
                <>
                  <div className="ev">{event.evidenceNote}</div>
                  <div className="when" title={event.evidenceRef}>
                    {na ? 'not applicable' : `${fmt(event.occurredAt)} · ${event.evidenceKind}${event.evidenceRef.length <= 24 ? ` ${event.evidenceRef}` : ''}`}
                  </div>
                </>
              ) : file ? (
                <>
                  <div className="ev">{file.note}</div>
                  <div className="when">
                    On file, not accepted ·{' '}
                    {proposalId ? <Link href={`/approvals?t=${proposalId}`}>waiting for approval</Link> : 'not proposed yet'}
                  </div>
                </>
              ) : stranded ? (
                <>
                  <div className="ev">{stranded.note}</div>
                  <div className="when">On file, but the rungs below need a record first</div>
                </>
              ) : (
                <div className="ev">{i === next ? 'Not yet. Nothing on file.' : '—'}</div>
              )}
              {claim && <div className="claim">Affinity says “{claim.word}”: a claim, with no record from them yet</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
