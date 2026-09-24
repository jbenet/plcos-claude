'use client';

import Link from '@/components/ui/AppLink';
import type { Leverage, Prerequisite } from '@/lib/lenses-client';
import { useFloor } from './FloorContext';
import { compactUsd, shortName } from './shared';

/**
 * View 12 — the leverage.
 *
 * One recorded thing on the left, everything waiting behind it on the right. It is the only
 * view here that ranks work by **how many other things it releases** rather than by size,
 * urgency or whose turn it is.
 *
 * The honest caveat is on the page: releasing a prerequisite does not advance anything. It
 * lets somebody try. An answer nobody has written, a material nobody has refreshed and a
 * ticket nobody has decided are all the same shape of problem, and none of them look urgent
 * from inside the pursuit that is stuck behind them.
 */

const FAMILY: Record<Prerequisite['family'], { label: string; means: string }> = {
  approval: { label: 'Approvals', means: 'A ticket somebody has to decide. Until then the command fails closed.' },
  answer: { label: 'Answers', means: 'A question asked more than once with nothing approved behind it.' },
  material: { label: 'Materials', means: 'An asset carrying a refresh flag — a claim underneath it moved.' },
  restriction: { label: 'Restrictions', means: 'A do-not-approach instruction. Not a routing problem to work around.' },
  conflict: { label: 'Collisions', means: 'Two vehicles reaching for the same actor inside the window.' },
  budget: { label: 'Budgets', means: 'An actor whose commitments across our vehicles exceed what they told us.' },
  goodwill: { label: 'Goodwill', means: 'A connector at their quarterly cap. Asking again spends years on weeks.' },
};

const ORDER: Array<Prerequisite['family']> = [
  'approval', 'answer', 'material', 'conflict', 'restriction', 'budget', 'goodwill',
];

export function LeverageView({ leverage }: { leverage: Leverage }) {
  const { select } = useFloor();

  return (
    <div className="levview">
      <div className="levhead">
        <div className="levstat">
          <b>{leverage.totals.prerequisites}</b>
          <span>recorded prerequisites</span>
        </div>
        <div className="levstat">
          <b>{leverage.totals.dependents}</b>
          <span>pursuits waiting behind one</span>
        </div>
        <div className="levstat">
          <b>{leverage.totals.inReview}</b>
          <span>sitting with a person</span>
        </div>
        <p className="levnote">{leverage.note}</p>
      </div>

      {ORDER.map((family) => {
        const mine = leverage.prerequisites.filter((p) => p.family === family);
        if (mine.length === 0) return null;
        return (
          <section className="levgroup" key={family}>
            <div className="levgh">
              <b>{FAMILY[family].label}</b>
              <span>{FAMILY[family].means}</span>
            </div>
            {mine.map((p) => (
              <div className={`levrow s-${p.state}`} key={p.key}>
                <div className="levleft">
                  <span className="levdiamond" aria-hidden>◇</span>
                  <div>
                    <b>{p.label}</b>
                    <div className="levmeta">
                      {p.owner ?? 'nobody assigned'} · {p.state}
                    </div>
                    <div className="levcount">
                      <b>{p.dependents.length}</b> waiting
                    </div>
                  </div>
                </div>
                <div className="levright">
                  <div className="levbecause">{p.because}</div>
                  <div className="levdeps">
                    {p.dependents.map((d) => (
                      <button
                        key={d.key}
                        className={`levdep${d.blocked ? ' blocked' : ''}${d.urgent ? ' urgent' : ''}`}
                        onClick={() => select({ kind: 'item', key: d.key })}
                      >
                        <span className="ldn">{shortName(d.label, 22)}</span>
                        <span className="ldv">{d.vehicleName}</span>
                        <span className="ldm mono">{compactUsd(d.amount)}</span>
                      </button>
                    ))}
                  </div>
                  <Link className="btn" href={p.href}>Go and unblock it →</Link>
                </div>
              </div>
            ))}
          </section>
        );
      })}

      {leverage.prerequisites.length === 0 && (
        <div className="cbody">
          <div className="empty">
            <span className="stat unavailable"><i />Nothing shared is blocking</span>
            <h3>No recorded prerequisite has more than one pursuit behind it.</h3>
            <p>
              That is a statement about what is recorded. Shared work that nobody wrote down as a
              dependency does not appear here.
            </p>
          </div>
        </div>
      )}

      <div className="fllegend light">
        <span>Ordered by how many pursuits are waiting, not by money</span>
        <span>Releasing one does not advance anything — it lets somebody try</span>
        <span>Click a waiting pursuit to open it</span>
      </div>
    </div>
  );
}
