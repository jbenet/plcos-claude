import { shortDate } from '@/lib/time';
import { suggestionsFor } from '@/modules/strategy';
import type { Strategy } from '@/lib/enrich/strategy';
import { decideSuggestionAction } from '@/app/targets/actions';

/**
 * A strategy proposed for this LP (N64, docs/19, W5): the angle, the way in, the next action and
 * the ask, each resting on what the research and our records show. Ready for review until a person
 * decides; accepting makes the next action the pursuit's next step, and nothing else. Nothing is
 * sent, and the status, the ladder and the money are untouched.
 */
const LEVEL: Record<string, string> = { high: 'High', medium: 'Medium', low: 'Low', unknown: 'Not known' };
const VERDICT: Record<string, string> = { strong: 'Strong fit', good: 'Good fit', possible: 'Possible', weak: 'Weak fit', unknown: 'Not known' };

export async function SuggestedStrategy({ pursuitId, context = [] }: {
  pursuitId: string;
  /** The team's context on this LP (issue 0016), newest first: what is newer than the strategy is shown. */
  context?: Array<{ by: string | null; at: Date; body: string }>;
}) {
  const all = await suggestionsFor(pursuitId);
  const s = all[0];
  if (!s) return null;
  const st = s.data as unknown as Strategy;
  return (
    <div className="card sugstrat">
      <div className="chead">
        <h2>Suggested strategy</h2>
        <span className="lbl">
          {s.status === 'proposed' ? 'ready for review' : s.status === 'accepted' ? `accepted${s.decidedByName ? ` by ${s.decidedByName}` : ''}` : `dismissed${s.decidedByName ? ` by ${s.decidedByName}` : ''}`}
          {' · '}{s.madeBy}, {shortDate(s.madeAt)}
        </span>
      </div>
      <div className="cbody">
        {(() => {
          // Written before the team's newest context (issue 0016): say so, with the words, and that
          // it is due a re-think — the strategy workflow's next pass reads the context first.
          const newer = context.filter((c) => c.at.getTime() > s.madeAt.getTime());
          if (!newer.length) return null;
          return (
            <div className="ss-newctx">
              <b>New context since this was written.</b> {newer.length === 1 ? 'One entry' : `${newer.length} entries`} from the team, the latest {shortDate(newer[0].at)}{newer[0].by ? ` by ${newer[0].by}` : ''}: &ldquo;{newer[0].body.length > 180 ? `${newer[0].body.slice(0, 180)}…` : newer[0].body}&rdquo; This strategy is due a re-think; the next pass reads the context first.
            </div>
          );
        })()}
        <p className="ss-angle"><b>Why they&rsquo;d care.</b> {st.angle}</p>
        <div className="fact"><span>Next</span><span><b>{st.next.what}</b> — {st.next.who}{st.next.when ? `, ${st.next.when}` : ''}{st.next.material ? <span className="muted"> · with {st.next.material}</span> : null}{st.next.lookAgain ? <span className="muted"> · parked: look again {st.next.lookAgain}</span> : null}</span></div>
        <div className="fact"><span>Way in</span><span>{st.route ? <><span className={`tier t${st.route.tier}`}>{st.route.tier}</span> {st.route.via} <span className="muted">— {st.route.why}</span></> : <span className="muted">No path found in what was read: a direct approach, or find a connector first.</span>}</span></div>
        <div className="fact"><span>The ask</span><span>{st.ask.shape} · {st.ask.vehicle}{st.ask.range ? ` · ${st.ask.range}` : ''}</span></div>
        <div className="fact"><span>Which list</span><span>{st.list === 'this year' ? 'This year’s close' : st.list === '2027' ? 'The 2027 pipeline' : 'Not now'} <span className="muted">· confidence {st.confidence}</span></span></div>
        <div className="ss-scores">
          <div><span className="lbl">Capacity</span><b>{st.scores.capacity.band}</b><small>{st.scores.capacity.basis}</small></div>
          <div><span className="lbl">Affinity</span><b>{LEVEL[st.scores.affinity.level]}</b><small>{st.scores.affinity.basis}</small></div>
          <div><span className="lbl">Propensity</span><b>{LEVEL[st.scores.propensity.level]}</b><small>{st.scores.propensity.basis}</small></div>
          <div><span className="lbl">Time to decide</span><b>{st.scores.timeToDecision.band}</b><small>{st.scores.timeToDecision.basis}</small></div>
        </div>
        {Object.entries(st.fit).map(([v, f]) => (
          <div className="fact" key={v}><span>{v}</span><span>{VERDICT[f.verdict] ?? f.verdict} <span className="muted">— {f.why}</span></span></div>
        ))}
        {st.openQuestions.length > 0 && <div className="fact"><span>To find out</span><span>{st.openQuestions.join(' · ')}</span></div>}
        {st.risks.map((r, i) => <p className="warnline" style={{ margin: '6px 0 0', fontSize: 12 }} key={i}>{r}</p>)}
        {s.status === 'proposed' ? (
          <form action={decideSuggestionAction} className="ss-decide">
            <input type="hidden" name="suggestionId" value={s.suggestionId} />
            <input type="hidden" name="pursuitId" value={pursuitId} />
            <input name="note" placeholder="A line about it (optional)" aria-label="A note on the decision" />
            <button className="btn p" name="decision" value="accept" type="submit">Accept the next step</button>
            <button className="btn" name="decision" value="dismiss" type="submit">Dismiss</button>
          </form>
        ) : s.decisionNote ? <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>&ldquo;{s.decisionNote}&rdquo;{s.decidedAt ? ` — ${shortDate(s.decidedAt)}` : ''}</p> : null}
      </div>
      <p className="cover">
        <b>Proposed, not decided.</b> Written from public sources and our records. Accepting makes
        the next action this LP&rsquo;s next step; the status, the ladder and the money don&rsquo;t move, and
        nothing is sent.
      </p>
    </div>
  );
}
