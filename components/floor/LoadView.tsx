'use client';

import type { FloorItem, FloorState } from '@/lib/floor-client';
import { STATUSES } from '@/modules/strategy/client';
import { useFloor } from './FloorContext';
import { byAttention, headOf, n, toList } from './scale';
import { compactUsd, EVIDENCE_GLYPH, shortName, standingWords, stateOf, STATE_GLYPH, TEMP_ALPHA } from './shared';
import s from './floor.module.css';

/**
 * View 2 — the load.
 *
 * Not "where is the work" but "who is carrying it". One column per person, and inside a
 * column the two tracks stand side by side rather than stacked: **a stack of soft on top
 * of hard is a blended total drawn instead of written**, and it is the same lie either way.
 *
 * Block height is the money at stake in that track. The header counts what is in flight and
 * how much of it has not moved in three weeks, because a person holding eleven things that
 * are all stalled is not busy — they are stuck, and the two look identical on a list.
 *
 * At volume (issue 0066) one person holds a thousand pursuits, most with no number. So each
 * track names its four largest and draws the rest as one block of their total; the unsized
 * are a count with the exceptions named, and the header says which statuses the load sits
 * in, because a thousand names in Sourcing is a different job from forty in Discussing.
 */

const COL_H = 300;
/** GUESS, as in config: a working number for what one person can carry, not a measured limit. */
const WIP_LINE = 6;
const NAMED_BLOCKS = 4;
const NAMED_UNSIZED = 3;
/** People drawn as their own column; everyone lighter shares one. A presentation limit. */
const MAX_COLUMNS = 4;

export function LoadView({ state }: { state: FloorState }) {
  const { select, filter, setFilter } = useFloor();
  /**
   * Wired money is not load. It was work once; it is now a fact, and leaving it in the
   * bars makes the person who closed the most look like the person with the most left
   * to do — which is the exact opposite of true. A passed LP is not load either: someone
   * decided, theirs or ours, and nothing is waiting on the owner (docs/17).
   */
  const open = state.items.filter((i) => !i.cashReceived && i.status !== 'passed');
  const byOwner = new Map<string, FloorItem[]>();
  for (const i of open) {
    const bucket = byOwner.get(i.ownerName);
    if (bucket) bucket.push(i); else byOwner.set(i.ownerName, [i]);
  }
  const everyone = [...byOwner.keys()].sort((a, b) => byOwner.get(b)!.length - byOwner.get(a)!.length || a.localeCompare(b));
  // The heaviest get a column; the rest share one, so the view fits without scrolling sideways.
  const owners = everyone.slice(0, everyone.length > MAX_COLUMNS ? MAX_COLUMNS - 1 : MAX_COLUMNS);
  const lighter = everyone.slice(owners.length);
  const sum = (items: FloorItem[]) => items.reduce((t, i) => t + (i.amount ?? 0), 0);
  /** Money in words, one figure per vehicle: never a total across vehicles (domain rule 1). */
  const perVehicle = (items: FloorItem[]) => {
    const slugs = [...new Set(items.map((i) => i.vehicleSlug))];
    if (slugs.length === 0) return 'none';
    return slugs.map((v) => {
      const mine = items.filter((i) => i.vehicleSlug === v);
      return slugs.length === 1 ? compactUsd(sum(mine)) : `${compactUsd(sum(mine))} ${mine[0]!.vehicleName}`;
    }).join(' · ');
  };

  /** Scale on the heaviest column, so the tallest stack fills the view and no more. */
  const heaviest = Math.max(1, ...owners.map((o) => Math.max(
    sum(byOwner.get(o)!.filter((i) => i.track === 'hard')),
    sum(byOwner.get(o)!.filter((i) => i.track === 'soft')),
  )));

  const showInList = (owner: string, signal: typeof filter.signal = 'all', vehicle = filter.vehicle) => {
    setFilter({ ...filter, owner, signal, vehicle });
    toList();
  };

  /**
   * One track of one person. Money never adds up across vehicles (domain rule 1), so when the
   * scope holds several, the track is stacked in one group per vehicle, each with its own
   * total, and there is no total for the column.
   */
  const column = (owner: string, items: FloorItem[], track: 'hard' | 'soft') => {
    const mine = items.filter((i) => i.track === track && i.amount !== null && i.amount > 0)
      .sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0));
    const groups = [...new Set(mine.map((i) => i.vehicleSlug))]
      .map((slug) => ({ slug, name: mine.find((i) => i.vehicleSlug === slug)!.vehicleName, items: mine.filter((i) => i.vehicleSlug === slug) }))
      .sort((a, b) => sum(b.items) - sum(a.items));
    const multi = groups.length > 1;
    return (
      <div className="lstack">
        <div className="lstrack">
          {track === 'hard' ? 'Hard' : 'Soft'}
          {!multi && <b>{mine.length ? compactUsd(sum(mine)) : '—'}</b>}
          {multi && groups.map((g) => <b key={g.slug} className={s.lsveh}>{compactUsd(sum(g.items))} <span>{shortName(g.name, 14)}</span></b>)}
        </div>
        <div className="lsbars">
          {groups.map((g) => {
            const { shown, rest } = headOf(g.items, (multi ? 2 : NAMED_BLOCKS) + 1);
            const restSum = sum(rest);
            return [
              ...blocks(shown, track),
              rest.length > 0 && (
                <button
                  key={`${g.slug}-rest`}
                  className={`lsbar t-${track} ${s.lsrest}`}
                  onClick={() => showInList(owner, 'all', g.slug)}
                  style={{ height: `${Math.max(26, (restSum / heaviest) * COL_H)}px` }}
                  title={`${n(rest.length)} more ${track} pursuits in ${g.name}, ${compactUsd(restSum)} together. Opens them in the list.`}
                >
                  <span className="lsn">+{n(rest.length)} more</span>
                  <span className="lsv">{compactUsd(restSum)}</span>
                </button>
              ),
              multi && <span key={`${g.slug}-label`} className={s.lsgroup}>{shortName(g.name, 18)}</span>,
            ];
          })}
          {mine.length === 0 && <div className="lsnone">nothing</div>}
        </div>
      </div>
    );
  };

  const blocks = (shown: FloorItem[], track: 'hard' | 'soft') => shown.map((i) => {
            const st = stateOf(i);
            return (
              <button
                key={i.key}
                className={`lsbar s-${st} t-${track}`}
                onClick={() => select({ kind: 'item', key: i.key })}
                style={{
                  height: `${Math.max(14, ((i.amount ?? 0) / heaviest) * COL_H)}px`,
                  opacity: TEMP_ALPHA[i.temp] * 0.75 + 0.25,
                }}
                title={`${i.entityName} · ${i.vehicleName}\n${standingWords(i)}\n`
                  + `${compactUsd(i.amount)} ${track} — ${i.sizeBasis}\n${i.tempBasis}`
                  + `${i.blocked ? `\nBlocked: ${i.blocked}` : ''}`}
              >
                <span className="lsn">{shortName(i.entityName, 20)}</span>
                <span className="lsv">{compactUsd(i.amount)} {i.needsEvidence ? EVIDENCE_GLYPH : ''}{STATE_GLYPH[st]}</span>
              </button>
            );
  });

  return (
    <div className={`loadview ${s.load}`}>
      <div className="lcols">
        {owners.map((owner) => {
          const mine = byOwner.get(owner)!;
          const wired = state.items.filter((i) => i.ownerName === owner && i.cashReceived);
          const passed = state.items.filter((i) => i.ownerName === owner && i.status === 'passed' && !i.cashReceived);
          const stalled = mine.filter((i) => i.stalled).length;
          const blocked = mine.filter((i) => stateOf(i) === 'blocked').length;
          const unsized = mine.filter((i) => i.amount === null);
          const over = mine.length > WIP_LINE;
          const statuses = STATUSES.filter((x) => x.id !== 'passed')
            .map((x, k) => ({ ...x, k, count: mine.filter((i) => i.status === x.id).length }))
            .filter((x) => x.count > 0);
          const words = [...statuses].sort((a, b) => b.count - a.count).slice(0, 2)
            .map((x) => `${n(x.count)} ${x.label.toLowerCase()}`).join(' · ');
          return (
            <div className={`lcol${over ? ' over' : ''}`} key={owner}>
              <div className="lhead">
                <button className={s.lname} onClick={() => select({ kind: 'person', name: owner })}>{owner}</button>
                <span className="lwip">
                  {n(mine.length)} in flight{over ? ` · over ${WIP_LINE}` : ''}
                </span>
                <span className="lsub">
                  {n(stalled)} stalled · {n(blocked)} blocked{unsized.length ? ` · ${n(unsized.length)} with no number` : ''}
                </span>
                {/* Where the load sits, by status: a thousand in Sourcing is not forty in Discussing. */}
                <span className={s.lmix} role="img" aria-label={`By status: ${statuses.map((x) => `${x.count} ${x.label}`).join(', ')}`}>
                  {statuses.map((x) => (
                    <i key={x.id} title={`${x.label}: ${n(x.count)}`}
                       style={{ flexGrow: x.count, opacity: 0.3 + (x.k / 5) * 0.7 }} />
                  ))}
                </span>
                <span className={s.lmixw}>{words}</span>
              </div>
              <div className="ltracks">
                {column(owner, mine, 'hard')}
                {column(owner, mine, 'soft')}
              </div>
              {wired.length > 0 && (
                <div className="lwired">
                  ✓ {n(wired.length)} wired and out of the queue ·{' '}
                  {perVehicle(wired)} hard
                </div>
              )}
              {passed.length > 0 && (
                <div className="lpassed">{n(passed.length)} passed and out of the queue</div>
              )}
              {unsized.length > 0 && (
                <div className="lunsized">
                  {headOf(unsized.filter((i) => stateOf(i) !== 'plain' || i.needsEvidence), NAMED_UNSIZED, byAttention).shown.map((i) => (
                    <button key={i.key} className={`lchip s-${stateOf(i)}`} title={`${standingWords(i)}\n${i.tempBasis}`}
                            onClick={() => select({ kind: 'item', key: i.key })}>
                      {shortName(i.entityName, 22)}{i.needsEvidence ? ` ${EVIDENCE_GLYPH}` : ''}{STATE_GLYPH[stateOf(i)] ? ` ${STATE_GLYPH[stateOf(i)]}` : ''}
                    </button>
                  ))}
                  <button className={s.lunsizedn} onClick={() => showInList(owner, 'unsized')}>
                    {n(unsized.length)} with no number from them →
                  </button>
                  <span className="lnote">not drawn to scale, because there is no scale</span>
                </div>
              )}
            </div>
          );
        })}

        {lighter.length > 0 && (
          <div className="lcol">
            <div className="lhead">
              <b>{lighter.length} lighter loads</b>
              <span className="lwip">{n(lighter.reduce((t, o) => t + byOwner.get(o)!.length, 0))} in flight together</span>
              <span className="lsub">One row each, heaviest first. A name opens their load.</span>
            </div>
            <div className={s.bars}>
              {lighter.map((o) => {
                const mine = byOwner.get(o)!;
                const stalled = mine.filter((i) => i.stalled).length;
                return (
                  <button key={o} className={s.lrow} onClick={() => select({ kind: 'person', name: o })}
                          title={`${o}: ${mine.length} in flight, ${stalled} stalled. Hard ${perVehicle(mine.filter((i) => i.track === 'hard'))}; soft ${perVehicle(mine.filter((i) => i.track === 'soft'))}.`}>
                    <span className={s.barname}>{o}</span>
                    <span className={s.barn}>{n(mine.length)}</span>
                    <span className={s.lrowsub}>{stalled ? `${n(stalled)} stalled · ` : ''}{mine.every((i) => i.amount === null) ? 'no numbers' : `${n(mine.filter((i) => i.amount !== null).length)} with a number`}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="lcol agents">
          <div className="lhead">
            <b>Agents</b>
            <span className="lwip">{state.agents.running} running</span>
            <span className="lsub">
              {state.agents.awaitingAcceptance} waiting on a human · {state.agents.refused} refused
            </span>
          </div>
          <div className="lqueue">
            {state.agents.queue.slice(0, 6).map((q, i) => (
              <div className={`lq q-${q.state}`} key={i}>
                <span className="lqs">{q.state}</span>
                <span className="lqt">{q.label}</span>
                <span className="lqw">{q.who}</span>
              </div>
            ))}
            {state.agents.queue.length > 6 && <div className="lsnone">+{n(state.agents.queue.length - 6)} more runs on the Agents page</div>}
            {state.agents.queue.length === 0 && <div className="lsnone">no runs on file</div>}
          </div>
          <div className="lunsized">
            <span className="lnote">
              Enrichment queue: {state.agents.humanQueued}/{state.agents.humanWip} human,{' '}
              {state.agents.agentQueued}/{state.agents.agentWip} agent.{' '}
              {state.agents.breaker.statement}
            </span>
          </div>
        </div>
      </div>

      {owners.length === 0 && <p className="muted">Nothing open matches these filters. Wired and passed pursuits are not load.</p>}

      <div className="fllegend light">
        <span>Column = one person, most in flight first · height = money at stake in that track</span>
        <span>The four largest are named · the rest are one block of their total</span>
        <span>Grey bar under a name = where their load sits, New to Committed, darker further on</span>
        <span>Wired money and passed LPs are not load — they are counted under each column, not in the bars</span>
        <span><i className="sw" style={{ background: 'var(--clay)' }} /> ✕ blocked</span>
        <span><i className="sw" style={{ background: 'var(--amber)' }} /> ! dated soon</span>
        <span><i className="sw" style={{ background: 'var(--green)' }} /> ✓ cash</span>
        <span>{EVIDENCE_GLYPH} = the status claims more than the ladder shows</span>
        <span>Faint = nothing recorded lately · hard and soft never share a bar</span>
      </div>
    </div>
  );
}
