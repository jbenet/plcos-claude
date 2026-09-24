'use client';

import type { BoardState } from '@/lib/board-client';
import type { FloorState } from '@/lib/floor-client';

/**
 * View 7 — the plant.
 *
 * The whole machine end to end, with a gauge at every station: what is sitting in it, what
 * arrived in the last month, what left, how long the median thing takes to get out, and
 * what is jammed. Between the stations are the valves — the approval kinds that gate the
 * step, which is where work stops when it stops for a reason we chose.
 *
 * **Dwell is the honest half of a cycle time.** It measures the gap between two evidence
 * records, so it says how long this system took to learn the next thing about a pursuit —
 * not how long the LP took to decide. Those differ, and only one of them is observable here.
 *
 * The stations are the ladder's rungs, not the statuses, and the drawing says so: in, out and
 * dwell need dated steps that only go up, which the ladder's records are and a status is not
 * (N50). Where each LP stands by status is on the line; a passed LP sits at no station.
 */

const FEEDERS: Array<{ into: string; label: string; detail: string }> = [
  { into: 'sourced', label: 'Enrichment', detail: 'Methods that turn a name into a scored one.' },
  { into: 'target_opted_in', label: 'Materials', detail: 'Assets the wrap matrix permits for this vehicle.' },
  { into: 'meeting_held', label: 'Answer library', detail: 'Objections answered from something already written.' },
  { into: 'commitment_accepted', label: 'Counsel', detail: 'Side letters, structure, the conserved-pool check.' },
];

export function PlantView({ board, floor }: { board: BoardState; floor: FloorState }) {
  const total = floor.items.length;

  return (
    <div className="plantview">
      <div className="lbl plantcap">The consent ladder, rung by rung · evidence records, not statuses</div>
      <div className="plantline">
        {board.stations.map((s, i) => {
          const feeder = FEEDERS.find((f) => f.into === s.key);
          const jam = s.blocked > 0;
          const idle = s.wip > 0 && s.in30 === 0 && s.out30 === 0;
          return (
            <div className="pstationwrap" key={s.key}>
              {i > 0 && (
                <div className={`pconn${s.gateOpen ? ' gated' : ''}`}>
                  <span className="pflow">{board.stations[i - 1]!.out30}</span>
                  <span className="parrow" aria-hidden>→</span>
                  {board.stations[i - 1]!.gate && (
                    <span className="pvalve" title={board.stations[i - 1]!.gateNote}>
                      {board.stations[i - 1]!.gate}
                      <i>{board.stations[i - 1]!.gateOpen}</i>
                    </span>
                  )}
                </div>
              )}
              <div className={`pstation${jam ? ' jam' : ''}${idle ? ' idle' : ''}`} title={s.requires}>
                <div className="plabel">{s.label}</div>
                <div className="pwip">{s.wip}</div>
                <div className="pwipl">{s.key === 'sourced' ? 'names, no pursuit' : 'at this rung now'}</div>
                <dl className="pgauges">
                  <div>
                    <dt>In · 30d</dt>
                    <dd>{s.in30}</dd>
                  </div>
                  <div>
                    <dt>Out · 30d</dt>
                    <dd>{s.out30}</dd>
                  </div>
                  <div>
                    <dt>Dwell</dt>
                    <dd>{s.dwell === null ? '—' : `${s.dwell}d`}</dd>
                  </div>
                  <div className={jam ? 'jamrow' : undefined}>
                    <dt>Jammed</dt>
                    <dd>{s.blocked}</dd>
                  </div>
                </dl>
                <div className="pbar" title={`${s.wip} of ${total} items are here`}>
                  <i style={{ width: `${total ? (s.wip / total) * 100 : 0}%` }} />
                </div>
                {idle && <div className="pidle">Nothing in or out for a month</div>}
                {feeder && (
                  <div className="pfeed" title={feeder.detail}>
                    ↑ {feeder.label}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="plantnotes">
        <div className="pnote">
          <div className="lbl">What a valve is</div>
          <p>
            The badge between two stations is the approval kind that gates that step, with the
            number of tickets currently open. Every mutating command in those families{' '}
            <b>fails closed</b> without an approved, unexpired ticket — so a valve with nothing
            in it is not a bottleneck, it is a closed valve nobody has asked to open.
          </p>
        </div>
        <div className="pnote">
          <div className="lbl">What dwell does not measure</div>
          <p>
            The gap between two evidence records on one pursuit. It is how long we took to
            learn the next thing, not how long they took to decide. A station with a long
            dwell and nothing jammed is usually a recording habit, not a slow counterparty.
          </p>
        </div>
        <div className="pnote">
          <div className="lbl">Why rungs, not statuses</div>
          <p>
            A status is our plan: it moves in any direction and records nothing, so it has no
            in, out or dwell. A rung is a dated evidence record, and the ladder only climbs, which
            is what a gauge needs. So the plant is the ladder; the line is the statuses. Passed
            LPs are at no station and jam none.
          </p>
        </div>
        <div className="pnote">
          <div className="lbl">Feeders</div>
          <p>
            Enrichment feeds the front of the line, materials feed the middle, the answer
            library feeds meetings and counsel feeds the close. None of them move an item a
            station on their own — they are what the station needs to do its work.
          </p>
        </div>
      </div>
    </div>
  );
}
