'use client';

import type { BoardState, Move } from '@/lib/board-client';

/**
 * View 8 — the moves.
 *
 * Every kind of move this system knows how to make, what each one needs before it can be
 * made, and how many things it is available on right now. A build menu, with the locked
 * entries left in and the reason printed under them.
 *
 * The ordering is the ladder's ordering, so the menu doubles as the prerequisite chain:
 * nothing in **Advance** is reachable until something in **Open** has happened, and the
 * only move with no prerequisite at all is the first one.
 */

const FAMILIES = ['Discover', 'Open', 'Advance', 'Close'] as const;

const FAMILY_MEANS: Record<string, string> = {
  Discover: 'Costs nothing but time, needs nobody’s permission, and is the only work available on a cold name.',
  Open: 'Spends something that does not come back — a connector’s goodwill, or a claim on their attention.',
  Advance: 'Moves an item one rung. Each needs its own evidence record, and none of them can be skipped.',
  Close: 'Two separate states and two separate tickets. Signed is not wired.',
};

export function MovesView({ board }: { board: BoardState }) {
  const card = (m: Move) => (
    <div className={`mv${m.available === 0 ? ' none' : ''}`} key={m.key}>
      <div className="mvhead">
        <b>{m.label}</b>
        <span className={`lever ${m.runner === 'agent' ? 'agent' : m.runner === 'human' ? 'human' : ''}`}>
          {m.runner === 'agent' ? 'agent runs it' : m.runner === 'human' ? 'a person runs it' : 'either'}
        </span>
      </div>
      <div className="mvcount">
        <b>{m.available}</b>
        <span>available now</span>
        {m.blocked > 0 && (
          <span className="mvblocked" title={m.blockedWhy ?? ''}>✕ {m.blocked} blocked</span>
        )}
      </div>
      <dl className="mvdl">
        <div><dt>Needs</dt><dd>{m.requires}</dd></div>
        <div><dt>Costs</dt><dd>{m.cost}</dd></div>
        <div><dt>Buys</dt><dd>{m.payoff}</dd></div>
        {m.blockedWhy && <div><dt>Blocked</dt><dd className="mvwhy">{m.blockedWhy}</dd></div>}
      </dl>
      {m.gate && (
        <div className="mvgate" title="This move is a mutation in a gated family. It fails closed without an approved, unexpired ticket.">
          gated · {m.gate}
        </div>
      )}
    </div>
  );

  return (
    <div className="movesview">
      <div className="mvcols">
        {FAMILIES.map((f) => (
          <div className="mvcol" key={f}>
            <div className="mvcolhead">
              <b>{f}</b>
              <span>{FAMILY_MEANS[f]}</span>
            </div>
            {board.moves.filter((m) => m.family === f).map(card)}
          </div>
        ))}
      </div>
      <div className="fllegend light">
        <span>Left to right is the prerequisite chain, not a preference order</span>
        <span>A move with zero available is not missing — it is waiting on the column to its left</span>
        <span>gated = fails closed without an approved ticket</span>
      </div>
    </div>
  );
}
