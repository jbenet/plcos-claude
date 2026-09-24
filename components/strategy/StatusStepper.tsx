import Link from '@/components/ui/AppLink';
import { shortDate } from '@/lib/time';
import { usdM } from '@/lib/money';
import { PASSED_BY_LABEL, RUNG_LABEL, STATUSES, type LadderRung, type Pursuit } from '@/modules/strategy';
import type { CloseTrack } from '@/modules/pipeline';
import type { OnFile } from '@/lib/reconcile';

/**
 * Where this stands (N60): the seven statuses, and, once an LP has committed, the close track —
 * soft, signed, hard, closed — with what the records say under each step.
 *
 * Juan, 24 Sep, on the stepper this replaces: "'Connector willing' — i think these are not the
 * states we discussed yesterday. proper statuses should be one of: new, sourcing, selected,
 * discussing, committed, passed… maybe let's add 'connecting'… once we reach committed, we can
 * start the closing sub-pipeline". The six rungs of the consent ladder (rule 2) are still here,
 * as the evidence under the steps they belong to: confirmed on the ladder in green, on record
 * but not yet confirmed in grey, nothing where nothing is known. So the gap between what our
 * status claims and what the records show is still visible, which is what the ladder is for.
 */

type Evidence = { rung: LadderRung; text: string; confirmed: boolean; title?: string };

const MAIN = STATUSES.filter((s) => s.id !== 'passed');
/** Which rungs are the evidence for which status. */
const RUNGS_FOR: Partial<Record<string, LadderRung[]>> = {
  connecting: ['connector_willing'],
  discussing: ['target_opted_in', 'meeting_held'],
  committed: ['indication_given', 'commitment_accepted'],
};
const SHORT: Record<LadderRung, string> = {
  connector_willing: 'Connector', target_opted_in: 'Replied', meeting_held: 'Met',
  indication_given: 'Gave a number', commitment_accepted: 'Countersigned', cash_received: 'Wired',
};

function evidenceFor(p: Pursuit, onFile: OnFile | null | undefined, rung: LadderRung): Evidence | null {
  const accepted = p.events.find((e) => e.rung === rung);
  if (accepted) {
    if (accepted.evidenceKind === 'not_applicable') return { rung, text: 'direct — no connector', confirmed: true, title: accepted.evidenceNote };
    return { rung, text: `${SHORT[rung]} ${shortDate(accepted.occurredAt)}`, confirmed: true, title: accepted.evidenceNote };
  }
  const rec = onFile?.byRung[rung];
  if (!rec) return null;
  if (rec.kind === 'not_applicable') return { rung, text: 'direct — no connector', confirmed: false, title: rec.note };
  return { rung, text: `${SHORT[rung]} ${shortDate(rec.on)}`, confirmed: false, title: rec.note };
}

export function StatusStepper({ pursuit: p, onFile, proposalId, track }: {
  pursuit: Pursuit;
  onFile?: OnFile | null;
  proposalId?: string | null;
  track?: CloseTrack | null;
}) {
  const passed = p.status === 'passed';
  const here = MAIN.findIndex((s) => s.id === p.status);
  const unconfirmed = Object.values(RUNGS_FOR).flat().some((r) => r && !p.events.some((e) => e.rung === r) && onFile?.byRung[r]);

  return (
    <div className="ladder stepper">
      <div className="lbl">Where this stands</div>
      <div className="steps">
        {MAIN.map((s, i) => {
          const ev = (RUNGS_FOR[s.id] ?? []).map((r) => evidenceFor(p, onFile, r)).filter((x): x is Evidence => Boolean(x));
          const cls = passed ? (ev.length ? 'seen' : 'pend') : i < here ? 'past' : i === here ? 'now' : 'pend';
          return (
            <div className={`step ${cls}`} key={s.id} title={s.means}>
              <div className="bul" />
              <div className="nm">{s.label}</div>
              {i === here && !passed && <div className="ev">Now{p.statusSource === 'us' && p.statusSetAt ? ` · set ${shortDate(p.statusSetAt)}${p.statusSetByName ? ` by ${p.statusSetByName}` : ''}` : p.stageSaid ? ` · Affinity: “${p.stageSaid}”` : ''}</div>}
              {ev.map((e) => (
                <div className={`proof ${e.confirmed ? 'ok' : 'seen'}`} key={e.rung} title={`${RUNG_LABEL[e.rung]}${e.confirmed ? ', confirmed' : ', on record, not yet confirmed'}: ${e.title ?? ''}`}>
                  {e.confirmed ? '✓ ' : ''}{e.text}
                </div>
              ))}
            </div>
          );
        })}
        {passed && (
          <div className="step off">
            <div className="bul" />
            <div className="nm">Passed</div>
            <div className="ev">
              {[p.passedBy ? PASSED_BY_LABEL[p.passedBy] : null, p.statusReason?.replace(/_/g, ' ')].filter(Boolean).join(' · ') || 'no reason recorded'}
            </div>
          </div>
        )}
      </div>

      {(p.status === 'committed' || (track && track.state !== 'soft')) && track && (
        <div className="closeline">
          <span className="lbl">Close</span>
          {(['soft', 'signed', 'hard', 'closed'] as const).map((st, i) => {
            const at = ['soft', 'signed', 'hard', 'closed'].indexOf(track.state);
            return (
              <span className={`cstep ${i <= at ? 'reached' : ''}`} key={st}>
                <i />{st === 'soft' ? `Soft ${usdM(track.exposure.amount)}` : st === 'signed' ? `Signed${track.signature?.on ? ` ${shortDate(track.signature.on)}` : track.signature ? ' (per source)' : ''}` : st === 'hard' ? 'Hard' : 'Closed'}
              </span>
            );
          })}
          {track.wired > 0 && <span className="cstep reached"><i />Wired {usdM(track.wired)}</span>}
        </div>
      )}

      <p className="stepkey">
        <span className="proof ok">✓ confirmed</span> on the ladder ·{' '}
        <span className="proof seen">on record</span> but not yet confirmed{unconfirmed && proposalId ? <> — <Link href={`/approvals?t=${proposalId}`}>confirm it</Link></> : ''}
        {' '}· the status is our plan; the evidence is what the records show.
      </p>
    </div>
  );
}
