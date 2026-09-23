import Link from 'next/link';
import { Page } from '@/components/shell/Page';
import { AutoRefresh } from '@/components/ui/AutoRefresh';
import { SECTION } from '@/lib/nav';
import { config } from '@/config/deployment';
import { ago } from '@/lib/time';
import { affinityReady } from '@/lib/connectors/affinity';
import { notesInventory, notesRunning, type NotesRunDetail } from '@/lib/connectors/affinity/notes';
import { latestRun } from '@/modules/sources';
import { countNotesAction, readNotesAction } from '../actions';

export const dynamic = 'force-dynamic';

const n = (x: number) => x.toLocaleString('en-US');
const day = (s: string | null | undefined) => (s ? s.slice(0, 10) : '—');

export default async function Notes() {
  const demo = config.data.profile === 'demo';
  const ready = affinityReady();
  const [counted, run, lastGood, inv] = await Promise.all([
    latestRun('affinity', 'count-notes'),
    latestRun('affinity', 'notes'),
    latestRun('affinity', 'notes', 'ok'),
    notesInventory(),
  ]);
  const running = notesRunning();
  // A run the database calls running that this process is not running was cut off by a
  // restart; saying "running" would be staleness rendered as progress.
  const interrupted = run?.status === 'running' && !running;
  const total = (counted?.detail as { total?: number | null } | undefined)?.total ?? null;
  const fullEstimate = total === null ? null : 1 + Math.ceil(total / 100);
  const d = (run?.detail ?? {}) as NotesRunDetail;
  const good = (lastGood?.detail ?? {}) as NotesRunDetail;

  return (
    <Page
      crumbs={[{ label: SECTION.developer }, { label: 'Affinity', href: '/dev/affinity' }, { label: 'Notes' }]}
      inspector={
        <>
          <div className="lbl">Notes</div>
          <div className="ihead">Read once, then only what changed</div>
          <div className="imeta">A local copy, to query whenever we want</div>
          <div className="scope">
            <div className="lbl">Every list, not only Neurotech&rsquo;s</div>
            <p>
              Kept whichever list a note&rsquo;s people are on, or none — for later (Juan, 23 Sep).
              A note shows on an LP&rsquo;s page in this tool when it is attached to them.
            </p>
          </div>
          <div className="scope">
            <div className="lbl">A hundred to a request</div>
            <p>
              The count comes first, from one request that returns no notes, and the read is
              approved as that number. After the first read, the next asks only for notes created
              or changed since, less a day. A note deleted in Affinity stays here until a full read.
            </p>
          </div>
          <div className="scope">
            <div className="lbl">Health</div>
            <p>
              A note that mentions a person&rsquo;s or a family&rsquo;s health is kept as Affinity
              has it, flagged, shown only when someone opens it, and never copied into anything
              derived (Report 4 §6.2).
            </p>
          </div>
          <div className="note">
            This page counts. The notes themselves are in <code>sources.raw_record</code>, kind{' '}
            <code>note</code>, with every version kept.
          </div>
        </>
      }
    >
      {running && <AutoRefresh seconds={3} />}
      <div className="lbl">
        <Link href="/dev/affinity">Affinity</Link> · <Link href="/dev/affinity/slice">First slice</Link> ·{' '}
        <Link href="/dev/affinity/inventory">Inventory</Link>
      </div>
      <h1>Every note, once</h1>
      <p className="sublede">
        Every note in the account, read a hundred to a request, each with who and what it is
        attached to. After the first read, only what has changed.
      </p>

      {demo && (
        <div className="scope" style={{ marginBottom: 14 }}>
          <div className="lbl">Demo</div>
          <p>Read from the fake Affinity in <code>fixtures/affinity/notes.json</code>: sixteen invented notes.</p>
        </div>
      )}

      <div className="card">
        <div className="chead">
          <h2>Read</h2>
          <span className="lbl">
            {running
              ? 'reading now'
              : run
                ? `${interrupted ? 'interrupted' : run.status} · ${ago(run.startedAt)}${run.runByName ? ` · ${run.runByName}` : ''}`
                : 'never read'}
          </span>
        </div>
        <div className="cbody">
          {total !== null && (
            <div className="fact">
              <span>In the account</span>
              <span>{n(total)} notes, counted {ago(counted!.startedAt)} · reading them all is about {n(fullEstimate!)} requests</span>
            </div>
          )}
          {lastGood && (
            <div className="fact">
              <span>Last complete read</span>
              <span>
                {ago(lastGood.startedAt)} · {good.mode === 'since' ? `what changed since ${day(good.since)}` : 'everything'} ·{' '}
                {n(lastGood.records)} read, {n(lastGood.newRecords)} new or changed · {n(lastGood.requests)} requests
              </span>
            </div>
          )}
          {run && run.id !== lastGood?.id && (
            <div className="fact"><span>{running ? 'So far' : 'Latest'}</span><span>{run.note ?? '—'}</span></div>
          )}
          {interrupted && (
            <div className="warn" style={{ marginTop: 10, fontSize: 12.5 }}>
              <b>Cut off.</b> The server restarted while this read was going. Every note it landed is
              kept; reading again stores only what is new.
            </div>
          )}

          {!running && (
            <div className="acts" style={{ marginTop: 12 }}>
              {!lastGood && total === null && (
                <form action={countNotesAction} style={{ flex: 1 }}>
                  <button className="btn p" type="submit" disabled={!ready.ready} style={{ width: '100%' }}>
                    Count the notes: one request
                  </button>
                </form>
              )}
              {!lastGood && fullEstimate !== null && (
                <form action={readNotesAction} style={{ flex: 1 }}>
                  <input type="hidden" name="approvedEstimate" value={fullEstimate} />
                  <input type="hidden" name="mode" value="full" />
                  <button className="btn c" type="submit" disabled={!ready.ready} style={{ width: '100%' }}>
                    Read every note: about {n(fullEstimate)} requests
                  </button>
                </form>
              )}
              {lastGood && (
                <form action={readNotesAction} style={{ flex: 1 }}>
                  <button className="btn p" type="submit" disabled={!ready.ready} style={{ width: '100%' }}>
                    Read what changed since the last read
                  </button>
                </form>
              )}
              {lastGood && fullEstimate !== null && (
                <form action={readNotesAction} style={{ flex: 1 }}>
                  <input type="hidden" name="approvedEstimate" value={fullEstimate} />
                  <input type="hidden" name="mode" value="full" />
                  <button className="btn" type="submit" disabled={!ready.ready} style={{ width: '100%' }}>
                    Read everything again: about {n(fullEstimate)} requests
                  </button>
                </form>
              )}
              {total !== null && (
                <form action={countNotesAction}>
                  <button className="btn" type="submit" disabled={!ready.ready}>Count again</button>
                </form>
              )}
            </div>
          )}
          <p className="muted" style={{ fontSize: 12, margin: '8px 0 0' }}>
            {!ready.ready
              ? ready.why
              : lastGood
                ? `What changed is counted first and read only if it comes in under ${n(config.affinity.sliceCeiling)} requests. Reading everything again is how a note deleted in Affinity leaves this copy.`
                : 'The read approves its number and a quarter more, not whatever it turns out to cost. It stops there.'}
          </p>
          {run?.status === 'held' && d.estimate !== undefined && (
            <div className="warn" style={{ marginTop: 10, fontSize: 12.5 }}>
              <b>Held.</b> {run.note}
            </div>
          )}
        </div>
      </div>

      {!inv ? (
        <div className="card">
          <div className="chead"><h2>What landed</h2><span className="lbl">nothing yet</span></div>
          <div className="cbody">
            <div className="empty" style={{ padding: '6px 0' }}>
              <span className="stat unavailable"><i />No notes read</span>
              <h3>No note has been read from Affinity yet.</h3>
              <p>This is an empty copy, not a failed read.</p>
              <dl>
                <dt>What is known</dt>
                <dd>{total === null ? 'Not even how many there are.' : `${n(total)} notes are in the account.`}</dd>
                <dt>Who can act</dt>
                <dd>Whoever holds the Affinity key on this machine.</dd>
                <dt>Safe next step</dt>
                <dd>{total === null ? 'Count them — one request, and no note is read.' : 'Read them, at the price above.'}</dd>
              </dl>
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className="kpis">
            <div className="kpi">
              <div className="lbl">Notes kept</div>
              <div className="n">{n(inv.total)}</div>
              <div className="f">{day(inv.first)} to {day(inv.last)} · {n(inv.versions)} versions kept</div>
            </div>
            <div className="kpi">
              <div className="lbl">About someone on a list we read</div>
              <div className="n">{n(inv.total - inv.onNoListRead)}</div>
              <div className="f">
                {n(inv.total - inv.onNoListRead - inv.viaOrganization)} attached to them ·{' '}
                {n(inv.viaOrganization)} to their organization
              </div>
            </div>
            <div className="kpi">
              <div className="lbl">Kept for later</div>
              <div className="n">{n(inv.onNoListRead)}</div>
              <div className="f">about people and firms on none of those lists, or attached to nothing</div>
            </div>
            <div className="kpi">
              <div className="lbl">Replies not read</div>
              <div className="n">{n(inv.replies.replies)}</div>
              <div className="f">on {n(inv.replies.notes)} {inv.replies.notes === 1 ? 'note' : 'notes'} · a request per note, so they wait</div>
            </div>
          </div>

          <div className="grid-even">
            <div className="card">
              <div className="chead"><h2>What kind</h2><span className="lbl">by Affinity&rsquo;s note type</span></div>
              <table className="list">
                <tbody>
                  {inv.byKind.map((k) => (
                    <tr key={k.kind}><td>{k.label}</td><td className="right mono">{n(k.n)}</td></tr>
                  ))}
                </tbody>
              </table>
              <p className="cover">
                A meeting or call note is tied to the interaction in Affinity&rsquo;s calendar sync; its
                date here is when the note was written, which is usually the day of the meeting.
              </p>
            </div>
            <div className="card">
              <div className="chead"><h2>When</h2><span className="lbl">by the year each was written</span></div>
              <table className="list">
                <tbody>
                  {inv.byYear.map((y) => (
                    <tr key={y.year}><td className="mono">{y.year}</td><td className="right mono">{n(y.n)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="grid-even">
            <div className="card">
              <div className="chead"><h2>Who wrote them</h2><span className="lbl">the team by name; anyone else counted</span></div>
              <table className="list">
                <tbody>
                  {inv.byAuthor.map((a) => (
                    <tr key={a.name}><td>{a.name}</td><td className="right mono">{n(a.n)}</td></tr>
                  ))}
                  {inv.otherAuthors.notes > 0 && (
                    <tr><td className="muted">{n(inv.otherAuthors.people)} people outside the team</td><td className="right mono">{n(inv.otherAuthors.notes)}</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="card">
              <div className="chead"><h2>What they are attached to</h2><span className="lbl">a note can be attached to several</span></div>
              <table className="list">
                <tbody>
                  <tr><td>A person</td><td className="right mono">{n(inv.attached.persons)}</td></tr>
                  <tr><td>An organization</td><td className="right mono">{n(inv.attached.companies)}</td></tr>
                  <tr><td>An opportunity</td><td className="right mono">{n(inv.attached.opportunities)}</td></tr>
                  <tr><td className="muted">Nothing</td><td className="right mono">{n(inv.attached.nothing)}</td></tr>
                </tbody>
              </table>
              {inv.truncated > 0 && (
                <p className="cover">
                  <b>{n(inv.truncated)} {inv.truncated === 1 ? 'note is' : 'notes are'} attached to more than a hundred of something.</b>{' '}
                  Affinity sends the first hundred; the rest are counted, not listed.
                </p>
              )}
            </div>
          </div>

          <div className="card">
            <div className="chead"><h2>By list</h2><span className="lbl">notes about someone on each list the slice reads</span></div>
            <table className="list">
              <thead><tr><th>List</th><th>Vehicle</th><th className="right">Attached to them</th><th className="right">To their organization</th></tr></thead>
              <tbody>
                {inv.byList.map((l) => (
                  <tr key={l.list}>
                    <td>{l.list}</td>
                    <td className="muted">{l.vehicle ?? 'says SPV'}</td>
                    <td className="right mono">{n(l.n)}</td>
                    <td className="right mono">{n(l.viaOrganization)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="cover">
              A note on a person&rsquo;s organization counts for them when the list gives that
              organization as theirs. One note can count on more than one list.{' '}
              <b>Coverage:</b> every note the key&rsquo;s owner can see in Affinity, except replies
              {lastGood ? `, as of ${ago(lastGood.startedAt)}` : ''}. A note the owner cannot see is
              not here, and nothing on this page can say how many of those there are.{' '}
              {inv.health > 0 && `${n(inv.health)} mention someone’s health and are flagged.`}
            </p>
          </div>
        </>
      )}
    </Page>
  );
}
