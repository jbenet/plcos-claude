import { auth } from '@/lib/auth';
import { can } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { traceFor, type LpTrace } from '@/lib/comms/read';
import { SOURCE_LABEL, traceState, type TraceFlag, type TraceState } from '@/lib/comms/trace';
import { outreachQueue, type Check } from '@/lib/outreach/reads';
import { shortDate } from '@/lib/time';
import { restrictionsFor, type Restriction } from '@/modules/coordination';
import { CHANNEL_LABEL, aboutThisRaise, raiseWindows } from '@/modules/meetings';
import { listVehicles } from '@/modules/platform';
import { STATUS_LABEL, type PursuitStatus } from '@/modules/strategy';
import s from './context.module.css';

/**
 * What a person sees before they draft or send (Juan, 5 Oct 2026): "be super clear on what outreach has happened
 * and equip senders with clear visual info so they can make the best decision there", in place of approval tickets,
 * which only an autonomous agent needs now. The LP page's Email card and the routes page's intro-ask box show it;
 * juanmail reads the same from the queue (lib/outreach/reads.ts, `trace` and `checks`).
 *
 *   - the last touches, dated, with direction and source — from the comms trace, not the app's log;
 *   - who owes the next word;
 *   - the other vehicles in play, with their status;
 *   - who on the team is in the latest thread, and who holds it;
 *   - restrictions, in red, always — never skipped, whatever else the panel leaves out;
 *   - the material's compliance: the wrap rule, 506(c) accreditation, and which materials may go.
 *
 * It decides nothing and blocks nothing: the sender decides, and the guards that refuse (a restriction on a
 * draft's move is a stop warning; the wrap check on a material) still do.
 */

type Row = {
  checks: Check[]; materials: Array<{ title: string; allowed: boolean; permittedUse: string }>;
  otherVehicles: Array<{ name: string; status: { value: PursuitStatus; label: string } | null }>;
};

export async function OutreachContext({ entityId, vehicleId, pursuitId, connectorId, connectorName, trace: given }: {
  entityId: string; vehicleId: string; pursuitId?: string | null; connectorId?: string | null; connectorName?: string | null;
  /** The page's own trace, when it has read it already. */
  trace?: LpTrace;
}) {
  const user = await (await auth()).currentUser();
  const vehicle = (await listVehicles()).find((v) => v.id === vehicleId);
  if (!vehicle) return null;
  const db = await getDb();
  // The routes page knows the target and the vehicle, not the pursuit: find it, if they are on this vehicle.
  if (pursuitId === undefined) {
    pursuitId = (await db.one<{ id: string }>(`select pursuit_id::text id from strategy.active_pursuit
      where identity.canonical_entity_id(entity_id) = identity.canonical_entity_id($1::uuid) and vehicle_id = $2 limit 1`, [entityId, vehicleId]))?.id ?? null;
  }
  const [restrictions, connectorRestrictions, trace, windows, row, others] = await Promise.all([
    restrictionsFor(entityId),
    connectorId ? restrictionsFor(connectorId) : Promise.resolve([] as Restriction[]),
    given ? Promise.resolve(given) : traceFor(entityId),
    raiseWindows(),
    pursuitId && (vehicle.kind === 'fund' || vehicle.kind === 'spv')
      ? outreachQueue(user, { vehicle: vehicle.slug, pursuitId }).then((q) => (q.data.rows[0] as Row | undefined) ?? null).catch(() => null)
      : Promise.resolve(null),
    db.query<{ name: string; vehicle_id: string; status: PursuitStatus; owner: string }>(`select v.name, p.vehicle_id::text, p.status::text status, u.name owner
      from strategy.active_pursuit p join platform.vehicle v on v.id = p.vehicle_id join platform.app_user u on u.id = p.owner_id
      where identity.canonical_entity_id(p.entity_id) = identity.canonical_entity_id($1::uuid) and p.vehicle_id <> $2 and v.phase <> 'historical'
      order by v.sort_order`, [entityId, vehicleId]),
  ]);
  const w = windows.get(vehicleId);
  const here: TraceState = traceState({ ...trace, touches: trace.touches.filter((t) => (w ? aboutThisRaise(t, w) : !t.vehicleId || t.vehicleId === vehicleId)) });
  const thread = traceState(trace).thread;
  const reasons = can(user, 'read', { vehicle: vehicleId, fieldClass: 'R4' });
  const words = can(user, 'read', { vehicle: vehicleId, fieldClass: 'R2' });
  const barred = [...restrictions, ...connectorRestrictions.filter((r) => r.scope !== 'connector')];
  const check = (rule: Check['rule']) => row?.checks.find((c) => c.rule === rule) ?? null;
  const accreditation = check('accreditation'), wrap = check('wrap'), fundFirst = check('fund_first');
  const mismatches: TraceFlag[] = trace.flags;

  return (
    <div className={`card ${s.ctx}`} id="outreach-context" data-outreach-context>
      <div className="chead">
        <h2>Before you send</h2>
        <span className="lbl">from the comms trace · no approval needed</span>
      </div>

      {barred.length > 0 && (
        <div className={s.stop} role="alert" data-restriction>
          <b>Restriction on file</b>
          {barred.map((r) => (
            <p key={r.restrictionId}>
              {r.entityId === connectorId ? `${connectorName ?? 'The connector'}: ` : ''}
              {r.scope === 'blanket' ? 'Do not approach, by any channel.' : r.scope === 'channel' ? `Not by ${r.channel ?? 'this channel'}.` : `Not through ${r.connectorName ?? 'a connector'}.`}
              {' '}{reasons ? <>&ldquo;{r.instruction}&rdquo;</> : <span className="muted">The reason is withheld at your access: ask {r.recordedByName ?? 'the owner'}.</span>}
              <span className="muted"> · {r.recordedByName ?? 'unattributed'}, {shortDate(r.recordedAt)}</span>
            </p>
          ))}
          <p className="muted">It attaches to them, not to a channel or a connector: another route to the same approach gets round it (rule 8).</p>
        </div>
      )}

      <div className={s.grid}>
        <div>
          <div className="lbl">Who owes a reply</div>
          <p className={s.big} data-owes={here.owes?.by ?? 'none'}>
            {here.owes?.by === 'us' ? <>We do — they wrote last, {shortDate(here.owes.since)}</>
              : here.owes?.by === 'them' ? <>They do — we wrote last, {shortDate(here.owes.since)}</>
                : <>Nobody yet — no exchange on record for {vehicle.name}</>}
          </p>
          <div className="lbl" style={{ marginTop: 10 }}>Last touches</div>
          {here.last.length === 0 ? <p className="muted">None on record for {vehicle.name}.</p> : (
            <ul className={s.list}>
              {here.last.map((t, i) => (
                <li key={i}>
                  <span className={s.when}>{shortDate(t.on)}</span>{' '}
                  {CHANNEL_LABEL[t.channel]}{t.direction === 'ours' ? ', from us' : t.direction === 'theirs' ? ', from them' : t.direction === 'both' ? ', both sides' : ''}
                  {words && t.subject ? <> · &ldquo;{t.subject}&rdquo;</> : ''}
                  <span className="muted"> · {SOURCE_LABEL[t.source]}{t.sameAs.length ? `, also ${t.sameAs.map((m) => `${SOURCE_LABEL[m.source]} (${m.confidence})`).join(', ')}` : ''}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <div className="lbl">The thread</div>
          {thread ? (
            <p data-thread>
              {words && thread.subject ? <>&ldquo;{thread.subject}&rdquo; · </> : ''}{thread.messages} message{thread.messages === 1 ? '' : 's'}, last {shortDate(thread.last)}.
              {' '}On it from the team: <b>{thread.team.join(', ') || 'nobody on the team'}</b>{thread.holder ? <> · held by <b>{thread.holder}</b></> : ''}.
            </p>
          ) : <p className="muted">No Gmail thread reported for them yet. juanmail reports the messages it sees; until then the trace is Affinity&rsquo;s.</p>}
          <div className="lbl" style={{ marginTop: 10 }}>Other vehicles in play</div>
          {others.length === 0 ? <p className="muted">Only {vehicle.name}.</p> : (
            <ul className={s.list}>
              {others.map((o) => (
                <li key={o.vehicle_id}>
                  {o.name}: {can(user, 'read', { vehicle: o.vehicle_id }) ? <b>{STATUS_LABEL[o.status]}</b> : <span className="muted">status not yours to see</span>}
                  <span className="muted"> · {o.owner}</span>
                </li>
              ))}
            </ul>
          )}
          {fundFirst && !fundFirst.ok && <p className={s.note}>{fundFirst.detail}</p>}
        </div>
      </div>

      <div className={s.compliance}>
        <div className="lbl">Compliance for materials · {vehicle.name}, {vehicle.exemption}</div>
        <ul className={s.list}>
          {wrap && <li><span className={wrap.ok ? 'flag f-ok' : 'flag f-block'}>{wrap.ok ? 'Wrap rule' : 'No wrap rule'}</span> {wrap.detail}</li>}
          {accreditation && <li><span className={accreditation.ok ? 'flag f-ok' : 'flag f-block'}>{accreditation.ok ? 'Accredited' : 'Not verified'}</span> {accreditation.detail}</li>}
          {row?.materials.length ? (
            <li>
              Materials: {row.materials.map((m, i) => <span key={i}>{i ? ' · ' : ''}{m.title} <span className={m.allowed ? s.ok : s.no}>{m.allowed ? 'may go' : 'may not'}</span></span>)}
              <span className="muted"> — checked again when a send is marked (rule 11).</span>
            </li>
          ) : !row ? <li className="muted">The send gate on Materials checks each material against {vehicle.exemption} before it goes.</li> : null}
        </ul>
      </div>

      {mismatches.length > 0 && (
        <div className={s.mismatch} data-mismatch>
          <b>The app&rsquo;s log and the mail trace disagree</b> — the trace is what is shown:
          <ul className={s.list}>{mismatches.slice(0, 4).map((f, i) => <li key={i}>{f.text}</li>)}</ul>
        </div>
      )}
      <p className="cover">
        <b>What this reads:</b> the comms trace — Affinity&rsquo;s emails, meetings and calls, and the Gmail messages
        juanmail reported ({trace.messages.length}), one row per message — not the app&rsquo;s own log. A person needs no
        approval to send (Juan, 5 Oct 2026); an autonomous agent does.
      </p>
    </div>
  );
}
