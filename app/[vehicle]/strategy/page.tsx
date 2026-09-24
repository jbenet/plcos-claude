import Link from '@/components/ui/AppLink';
import { notFound } from 'next/navigation';
import { Page } from '@/components/shell/Page';
import { AssignPlay } from '@/components/plays/AssignPlay';
import { Propose } from '@/components/plays/Propose';
import { Markdown } from '@/components/ui/Markdown';
import { vehicleSelection } from '@/lib/session';
import { ago, shortDate } from '@/lib/time';
import { listAssessments } from '@/modules/fit';
import {
  assessVehicle, boardFor, commitmentsFor, handoffsFor, listUsers,
  LEVER_LABEL, LEVER_MEANS, VERDICT_LABEL,
  type Play, type Reading,
} from '@/modules/plays';

export const dynamic = 'force-dynamic';

const GROUP_ORDER = ['Pipeline', 'Targets', 'Conversion', 'Perception', 'Access', 'Materials'];

function ReadingCell({ r }: { r: Reading }) {
  return (
    <div className={`reading v-${r.verdict}`}>
      <div className="rt">
        <span className="rl">{r.label}</span>
        <span className="rv">{r.value}</span>
      </div>
      <div className="rd">
        <span className={`flag vflag ${
          r.verdict === 'strong' ? 'f-ok' : r.verdict === 'weak' ? 'f-block'
          : r.verdict === 'ok' ? 'f-ev' : 'f-mute'}`}>
          {VERDICT_LABEL[r.verdict]}
        </span>{' '}
        {r.detail}
      </div>
    </div>
  );
}

function Board({
  plays, users, path, empty,
}: {
  plays: Play[];
  users: Array<{ id: string; name: string; role: string }>;
  path: string;
  empty: string;
}) {
  if (plays.length === 0) {
    return (
      <div className="cbody">
        <div className="empty">
          <span className="stat unavailable"><i />Nothing listed</span>
          <h3>{empty}</h3>
          <p>
            An empty board is a statement about our thinking, not about the option space. There
            is always something to do; nobody has written it down.
          </p>
        </div>
      </div>
    );
  }
  return (
    <table className="list board">
      <thead>
        <tr>
          <th style={{ width: 250 }}>Play</th>
          <th>Why it is on the list</th>
          <th style={{ width: 92 }}>Lever</th>
          <th style={{ width: 88 }} className="right">Leverage</th>
          <th style={{ width: 146 }}>Assign</th>
        </tr>
      </thead>
      <tbody>
        {plays.map((p) => (
          <tr key={p.playId} className={p.answersWeakness ? 'hot' : undefined}>
            <td>
              <b>{p.title}</b>
              <div className="muted" style={{ fontSize: 11.5, marginTop: 3, lineHeight: 1.5 }}>
                {p.detail}
              </div>
              <div style={{ marginTop: 5, display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                {p.entityName && p.entityId && (
                <Link className="flag f-mute" href={`${path}/${p.entityId}`}>{p.entityName}</Link>
              )}
                {p.gate && <span className="flag f-ev">needs {p.gate}</span>}
                <span className={`cert c-${p.certainty}`}>{p.certainty}</span>
              </div>
            </td>
            <td className="muted">
              {p.because}
              <div style={{ marginTop: 6, color: 'var(--ink)' }}>
                <b style={{ fontWeight: 500 }}>What it buys.</b> {p.payoff}
              </div>
            </td>
            <td>
              <span className={`lever${p.answersWeakness ? ' hot' : ''}`} title={LEVER_MEANS[p.lever]}>
                {LEVER_LABEL[p.lever]}
              </span>
              {p.answersWeakness && (
                <div className="muted" style={{ fontSize: 9.5, marginTop: 4 }}>
                  answers a weak reading
                </div>
              )}
            </td>
            <td className="right">
              <div className="lev">{p.leverage.toFixed(2)}</div>
              <div className="levsub">{p.likelihood}/5 · {p.effortDays}d · ×{p.reach}</div>
            </td>
            <td>
              <AssignPlay
                playId={p.playId}
                suggestedId={p.suggestedOwnerId}
                suggested={p.suggestedOwner}
                assignedTo={p.assignedTo}
                users={users}
                path={path}
              />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ChooseVehicle({ vehicles }: { vehicles: Array<{ slug: string; name: string; exemption: string }> }) {
  return (
    <Page crumbs={[{ label: 'All vehicles' }, { label: 'Strategy' }]}>
      <div className="lbl">All vehicles</div>
      <h1>Strategy is read one raise at a time</h1>
      <p className="sublede">
        Each vehicle has its own readings, levers and plays, and adding them up across vehicles
        would blend raises that must stay separate. Choose one.
      </p>
      <div className="card">
        <table className="list">
          <tbody>
            {vehicles.map((v) => (
              <tr key={v.slug}>
                <td><Link href={`/${v.slug}/strategy`}><b>{v.name}</b></Link></td>
                <td className="muted mono" style={{ fontSize: 11.5 }}>{v.exemption}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Page>
  );
}

export default async function VehicleStrategy({
  params,
}: {
  params: Promise<{ vehicle: string }>;
}) {
  const { vehicle: slug } = await params;
  const { all } = await vehicleSelection();
  // A strategy is a reading of one raise. With every vehicle selected the rail still links
  // here, and a 404 is the wrong answer to a reasonable click.
  if (slug === 'all') return <ChooseVehicle vehicles={all} />;
  const vehicle = all.find((v) => v.slug === slug);
  if (!vehicle) notFound();

  const path = `/${slug}/strategy`;
  const [a, plays, users, commitments, handoffs, fit] = await Promise.all([
    assessVehicle(vehicle.id),
    boardFor(vehicle.id),
    listUsers(),
    commitmentsFor(vehicle.id),
    handoffsFor(vehicle.id),
    listAssessments(vehicle.id),
  ]);
  if (!a) notFound();

  const weak = new Set(a.weakLevers);
  const marked = plays.map((p) => ({ ...p, answersWeakness: weak.has(p.lever) }))
    .sort((x, y) => Number(y.answersWeakness) - Number(x.answersWeakness) || y.leverage - x.leverage);

  const now = marked.filter((p) => p.horizon === 'now' && p.entityId === null);
  const targeted = marked.filter((p) => p.horizon === 'now' && p.entityId !== null);
  const later = marked.filter((p) => p.horizon === 'compounding');
  const shortWindow = a.daysToClose !== null && a.daysToClose < 45;

  const groups = GROUP_ORDER
    .map((g) => ({ group: g, rows: a.readings.filter((r) => r.group === g) }))
    .filter((g) => g.rows.length > 0);

  const weakCount = a.readings.filter((r) => r.verdict === 'weak').length;
  const pending = handoffs.filter((h) => h.state === 'pending').length;

  return (
    <Page
      crumbs={[
        { label: vehicle.name, href: '/overview' },
        { label: 'Strategy' },
      ]}
      inspector={
        <>
          <div className="lbl">This raise</div>
          <div className="ihead">{vehicle.name}</div>
          <div className="imeta">{vehicle.exemption} · {a.readings.length} readings</div>

          <div className="kv"><span>Weak readings</span><span>{weakCount}</span></div>
          <div className="kv"><span>Plays on the board</span><span>{plays.length}</span></div>
          <div className="kv"><span>Assigned</span><span>{plays.filter((p) => p.status !== 'proposed').length}</span></div>
          <div className="kv"><span>Commitments</span><span>{commitments.length}</span></div>
          <div className="kv">
            <span>Days to close</span>
            <span>{a.daysToClose === null ? 'no target' : a.daysToClose}</span>
          </div>

          <div className="scope">
            <div className="lbl">How the board is ordered</div>
            <p>
              Leverage is <b>(likelihood ÷ 5) × targets touched ÷ person-days</b> — expected
              movement per day of somebody&rsquo;s life. Plays whose lever answers a weak reading
              float to the top. All three inputs sit beside the number, because a score nobody can
              decompose is a score nobody can argue with, and arguing with it is the point.
            </p>
          </div>

          <div className="note">
            Nothing here is generated. Every play was written by a person against a finding in
            this database, and the numbers are their judgement.
          </div>

          <div className="acts" style={{ marginTop: 14 }}>
            <Link className="btn" href={`/${slug}/fit`}>Funder–vehicle fit</Link>
          </div>
        </>
      }
    >
      <div className="lbl">Strategy · {vehicle.name}</div>
      <h1>What to do with the next week</h1>
      <p className="sublede">
        Where this raise stands, the option space against it, and a place to commit. The
        assessment is read from the modules that own each fact; the plays are written by people
        and ranked by a rule you can see.
      </p>

      {/* ---------- 1. where we stand ---------- */}
      <div className="diagbox">
        {a.diagnosis.map((line, i) => <p key={i}>{line}</p>)}
      </div>

      {groups.map((g) => (
        <div className="card" key={g.group}>
          <div className="chead">
            <h2>{g.group}</h2>
            <span className="lbl">
              {g.rows.filter((r) => r.verdict === 'weak').length} of {g.rows.length} weak
            </span>
          </div>
          <div className="readgrid">
            {g.rows.map((r) => <ReadingCell key={r.key} r={r} />)}
          </div>
        </div>
      ))}

      {/* ---------- 2. what to do next ---------- */}
      <div className="card">
        <div className="chead">
          <h2>What to do next</h2>
          <span className="lbl">
            {now.length} whole-vehicle play{now.length === 1 ? '' : 's'} · ranked by leverage
          </span>
        </div>
        <div className="worknote">
          {weakCount > 0
            ? `Marked plays pull a lever that answers one of the ${weakCount} weak readings above.`
            : 'No reading came back weak, so nothing is marked — order is by leverage alone.'}
        </div>
        <Board plays={now} users={users} path={path} empty="No whole-vehicle plays are on the board." />
        <p className="cover">
          <b>Suggesting an owner is not assigning one.</b> The name in the dropdown is a
          suggestion; assignment is a second, deliberate press, and that press is what opens a
          ticket. Where a play would need an approval before it could happen, the ticket kind is
          on the row — the board cannot propose something that would fail closed at the command.
        </p>
      </div>

      {/* ---------- 3. per-target ---------- */}
      {targeted.length > 0 && (
        <div className="card">
          <div className="chead">
            <h2>Aimed at one funder</h2>
            <span className="lbl">{targeted.length} plays · {fit.length} assessed</span>
          </div>
          <div className="worknote">
            Each of these belongs to a single target. The per-target board has the full option
            space, including what that funder needs before they can say yes.
          </div>
          <Board plays={targeted.slice(0, 6)} users={users} path={path} empty="" />
          <p className="cover">
            Showing the six with the highest leverage.{' '}
            <Link href={`/${slug}/fit`}>Funder–vehicle fit</Link> lists every assessed funder, and
            each one has its own strategy page with the rest.
          </p>
        </div>
      )}

      {/* ---------- 4. what compounds ---------- */}
      <div className="card">
        <div className="chead">
          <h2>What compounds</h2>
          <span className="lbl">
            {later.length} play{later.length === 1 ? '' : 's'} · long horizon
          </span>
        </div>
        {shortWindow ? (
          <div className="worknote">
            The close target is {a.daysToClose} days out. These are listed because they should not
            disappear — but ranked against this week&rsquo;s work they will always lose, and
            starting one now would be a hobby rather than a plan. Read them as next-vehicle planning.
          </div>
        ) : (
          <div className="worknote">
            Separated from the list above on purpose. Ranked together, long-horizon work always
            loses — which is exactly how compounding effort starves.
          </div>
        )}
        <Board plays={later} users={users} path={path} empty="Nothing long-horizon is written down." />
        <p className="cover">
          <b>Why this is a separate horizon and not a low priority.</b> Every play here pays off
          after the close and makes the next one cheaper: reach that works while nobody is
          working, a reference bench that exists before somebody asks, records that do not rest on
          a 2021 spreadsheet. None of it moves a number this quarter, and a board that ranked it
          against this week would never surface any of it.
        </p>
      </div>

      {/* ---------- 5. commit ---------- */}
      <div className="card">
        <div className="chead">
          <h2>Propose and commit</h2>
          <span className="lbl">your words, kept as written</span>
        </div>
        <Propose
          vehicleId={vehicle.id}
          entityId={null}
          path={path}
          placeholder={
            'What are we actually going to do?\n\n'
            + '- one line per thing\n'
            + '- @handle to name somebody\n'
            + '- a date if there is one (2026-10-03)\n'
          }
        />
        <p className="cover">
          <b>The text is stored exactly as you write it.</b> Lines, @handles and dates are pulled
          out and kept <i>beside</i> it rather than replacing it — a commitment rewritten by a
          parser is a commitment nobody can be held to. Each one queues a Linear ticket.
        </p>
      </div>

      {commitments.length > 0 && (
        <div className="card">
          <div className="chead">
            <h2>Committed</h2>
            <span className="lbl">{commitments.length} · {pending} ticket{pending === 1 ? '' : 's'} queued</span>
          </div>
          {commitments.map((c) => (
            <div className="row" key={c.commitmentId} style={{ alignItems: 'flex-start' }}>
              <div style={{ width: 118, flex: 'none' }}>
                <div className="mono" style={{ fontSize: 11 }}>{shortDate(c.writtenAt)}</div>
                <div className="muted" style={{ fontSize: 11 }}>{c.writtenByName}</div>
                <div className="muted" style={{ fontSize: 10 }}>{ago(c.writtenAt)}</div>
              </div>
              <div className="t">
                <Markdown source={c.body} />
                {c.parsed && (c.parsed.owners.length > 0 || c.parsed.dates.length > 0) && (
                  <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
                    parsed out:{' '}
                    {c.parsed.owners.map((o) => `@${o}`).join(', ')}
                    {c.parsed.owners.length > 0 && c.parsed.dates.length > 0 ? ' · ' : ''}
                    {c.parsed.dates.join(', ')}
                  </div>
                )}
                {c.handoff && (
                  <details>
                    <summary className="lbl" style={{ cursor: 'pointer', marginTop: 6 }}>
                      Linear ticket · {c.handoff.state}
                    </summary>
                    <pre className="handoff">{JSON.stringify(c.handoff.payload, null, 2)}</pre>
                    <p className="muted" style={{ fontSize: 11 }}>{c.handoff.note}</p>
                  </details>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="cover">
        <b>What this page covers:</b> {a.readings.length} readings across {groups.length} groups,{' '}
        {plays.length} plays and {commitments.length} commitments recorded against {vehicle.name}.
        Every reading is read from the module that owns the fact; nothing is stored here twice.{' '}
        <b>No connector is attached</b>, so a queued ticket is a payload written down rather than
        an issue that exists — see <code>docs/14-linear-integration-points.md</code>.
      </p>
    </Page>
  );
}
