'use client';

import Link from '@/components/ui/AppLink';
import { RUNG_LABEL, RUNG_REQUIRES, STATUSES, STATUS_LABEL } from '@/modules/strategy/client';
import type { BoardState } from '@/lib/board-client';
import { EXPLORED_LABEL, HOLDING_LABEL } from '@/lib/board-client';
import { TEMP_LABEL, type FloorState } from '@/lib/floor-client';
import { useFloor } from './FloorContext';
import { claimWords, compactUsd, itemHref, ladderWords, shownRung, standingWords, stateOf, STATE_LABEL } from './shared';

/**
 * The context console.
 *
 * Every mark on every view is a real record, so pointing at one should be able to answer
 * "what is this, and what do I do about it" without leaving the page. It shows what is
 * recorded, the basis for each reading, and links to the screens where the thing can
 * actually be changed — because a panel that explains but cannot hand off is a dead end.
 *
 * An item reads the way an LP page does (N62): the status first, with where it came from,
 * then the ladder under it, and "Needs evidence" when the status claims more than the ladder
 * shows. Neither is inferred from the other, and neither is changed here.
 */
export function Console({ state, board }: { state: FloorState; board: BoardState }) {
  const { selected, select } = useFloor();
  if (!selected) return null;

  const close = () => select(null);

  if (selected.kind === 'note') {
    return (
      <aside className="console">
        <Head title={selected.title} onClose={close} />
        <dl className="cdl">
          {selected.lines.map((l) => (
            <div key={l.label}><dt>{l.label}</dt><dd>{l.value}</dd></div>
          ))}
        </dl>
      </aside>
    );
  }

  if (selected.kind === 'person') {
    const theirs = state.items.filter((i) => i.ownerName === selected.name);
    // What they carry: not wired, not passed — the same count as the load.
    const open = theirs.filter((i) => !i.cashReceived && i.status !== 'passed');
    const runs = state.agents.queue.filter((q) => q.who === selected.name);
    return (
      <aside className="console">
        <Head title={selected.name} onClose={close} />
        <p className="csub">
          {open.length} in flight · {theirs.filter((i) => i.stalled).length} stalled ·{' '}
          {theirs.filter((i) => stateOf(i) === 'blocked').length} blocked
        </p>
        <div className="lbl">Carrying</div>
        <div className="clist">
          {open.sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0)).map((i) => (
            <button key={i.key} className="crow" onClick={() => select({ kind: 'item', key: i.key })}>
              <b>{i.entityName}</b>
              <span className="mono">{compactUsd(i.amount)}</span>
              <span className="csmall">{i.vehicleName} · {standingWords(i)}</span>
            </button>
          ))}
          {open.length === 0 && <p className="csmall">Nothing open.</p>}
        </div>
        {runs.length > 0 && (
          <>
            <div className="lbl" style={{ marginTop: 12 }}>Agent runs escalating to them</div>
            <div className="clist">
              {runs.map((r, i) => (
                <div className="crow flat" key={i}>
                  <b>{r.label}</b>
                  <span className={`flag ${r.state === 'refused' ? 'f-block' : r.state === 'running' ? 'f-ok' : 'f-ev'}`}>
                    {r.state}
                  </span>
                </div>
              ))}
            </div>
          </>
        )}
        <div className="cacts">
          <Link className="btn" href="/asks">Ask log</Link>
          <Link className="btn" href="/approvals">Approvals</Link>
        </div>
      </aside>
    );
  }

  if (selected.kind === 'entity') {
    const t = board.territories.find((x) => x.entityId === selected.entityId);
    const mine = state.items.filter((i) => i.entityId === selected.entityId);
    return (
      <aside className="console">
        <Head title={selected.name} onClose={close} />
        {t && (
          <>
            <p className="csub">{t.segment} · {HOLDING_LABEL[t.holding]}</p>
            <dl className="cdl">
              <div><dt>Rubric</dt><dd>{t.band}. {t.scoreBasis}</dd></div>
              <div><dt>Known</dt><dd>{EXPLORED_LABEL[t.explored]}</dd></div>
              <div><dt>Cheque</dt><dd>{compactUsd(t.cheque)} — {t.chequeBasis}</dd></div>
              <div><dt>Edges</dt><dd>{t.edges} recorded relationship edge{t.edges === 1 ? '' : 's'} touch them</dd></div>
            </dl>
          </>
        )}
        {mine.length > 0 && (
          <>
            <div className="lbl" style={{ marginTop: 12 }}>In flight</div>
            <div className="clist">
              {mine.map((i) => (
                <button key={i.key} className="crow" onClick={() => select({ kind: 'item', key: i.key })}>
                  <b>{i.vehicleName}</b>
                  <span className="mono">{compactUsd(i.amount)}</span>
                  <span className="csmall">{standingWords(i)} · {i.ownerName}</span>
                </button>
              ))}
            </div>
          </>
        )}
        <div className="cacts">
          <Link className="btn p" href={`/orgs/${selected.entityId}`}>Open their page</Link>
          <Link className="btn" href="/routes">Routes</Link>
        </div>
      </aside>
    );
  }

  const item = state.items.find((i) => i.key === selected.key);
  if (!item) return null;
  const st = stateOf(item);
  const claim = claimWords(item);
  const shown = shownRung(item);
  return (
    <aside className="console">
      <Head title={item.entityName} onClose={close} />
      <p className="csub">{item.vehicleName} · {item.ownerName}</p>
      <span className={`flag ${st === 'blocked' ? 'f-block' : st === 'urgent' ? 'f-ev' : st === 'cash' ? 'f-ok' : 'f-mute'}`}>
        {STATE_LABEL[st]}
      </span>
      {claim && <span className="stat evidence" title={claim}><i />Needs evidence</span>}
      {item.headline && <p className="csub" style={{ marginTop: 8 }}>{item.headline}</p>}
      <dl className="cdl">
        <div>
          <dt>Status</dt>
          <dd>
            <b>{STATUS_LABEL[item.status]}</b>
            <span className="csmall"> — {item.statusBasis}</span>
            <span className="csmall cline">{STATUSES.find((s) => s.id === item.status)?.means}</span>
          </dd>
        </div>
        <div>
          <dt>Ladder</dt>
          <dd>
            {ladderWords(item)}
            {shown && <span className="csmall"> — {RUNG_REQUIRES[shown]}</span>}
            {claim && <span className="cclaim">{claim}</span>}
            {!claim && shown === 'connector_willing' && (
              <span className="csmall cline">
                The first rung and nothing more: not interest from the LP, not a meeting, not a commitment.
              </span>
            )}
          </dd>
        </div>
        <div>
          <dt>Next rung</dt>
          <dd>
            {item.nextRung
              ? <>{RUNG_LABEL[item.nextRung]}<span className="csmall"> — {RUNG_REQUIRES[item.nextRung]}</span></>
              : 'Nothing above this one.'}
          </dd>
        </div>
        <div><dt>At stake</dt><dd>{compactUsd(item.amount)} {item.track ?? ''} — {item.sizeBasis}</dd></div>
        <div><dt>Last record</dt><dd>{TEMP_LABEL[item.temp]} · {item.tempBasis}</dd></div>
        {item.blocked && <div><dt>Blocked</dt><dd className="cbad">{item.blocked}</dd></div>}
        {item.restricted && <div><dt>Restriction</dt><dd className="cbad">A do-not-approach instruction is on file for them.</dd></div>}
        {item.conflict && <div><dt>Contested</dt><dd className="cbad">Another vehicle has an open ask on the same actor.</dd></div>}
        {item.urgent && <div><dt>Dated</dt><dd>{item.urgent}</dd></div>}
        {item.openTicket && <div><dt>Ticket</dt><dd>{item.openTicket} open on this pursuit</dd></div>}
      </dl>
      <div className="cacts">
        <Link className="btn p" href={itemHref(item)}>{item.pursuitId ? 'Open the LP page' : 'Open their page'}</Link>
        <button className="btn" onClick={() => select({ kind: 'person', name: item.ownerName })}>
          {item.ownerName}&rsquo;s load
        </button>
      </div>
      <p className="cnote">
        Every line here is a record with a date and an author, or says where it came from.
        Nothing on this panel is inferred from the shape of the drawing you clicked, and the
        status and the ladder are set in different places: the status on the LP page, a rung
        only through a STAGE ticket.
      </p>
    </aside>
  );
}

function Head({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div className="chead2">
      <div>
        <div className="lbl">Context console</div>
        <h3>{title}</h3>
      </div>
      <button className="cx" onClick={onClose} aria-label="Close the console">×</button>
    </div>
  );
}
