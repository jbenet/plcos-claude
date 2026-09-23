import Link from 'next/link';
import { Page } from '@/components/shell/Page';
import { AutoRefresh } from '@/components/ui/AutoRefresh';
import { SECTION } from '@/lib/nav';
import { config } from '@/config/deployment';
import { ago } from '@/lib/time';
import { affinityReady } from '@/lib/connectors/affinity';
import { sliceRunning, sliceTargets } from '@/lib/connectors/affinity/slice';
import { latestRun, rawCounts } from '@/modules/sources';
import { runSliceAction } from '../actions';

export const dynamic = 'force-dynamic';

const TYPE: Record<string, string> = { company: 'Organizations', opportunity: 'Opportunities', person: 'People' };

const KIND: Record<string, string> = {
  list_entry: 'Entries on a list, with their field values',
  note: 'Notes',
  note_link: 'Which entry each note was read for',
  relationship: 'Relationship sets — one per person, the strongest hundred',
  list: 'Lists (discovery)',
  list_field: 'Fields on a list (discovery)',
  user: 'Affinity users (discovery)',
};

const n = (x: number) => x.toLocaleString('en-US');

export default async function Slice() {
  const demo = config.data.profile === 'demo';
  const ready = affinityReady();
  const [targets, run, counts] = await Promise.all([sliceTargets(), latestRun('affinity', 'slice'), rawCounts('affinity')]);
  const running = sliceRunning();
  // A run the database calls running that this process is not running was cut off by a
  // restart. Saying "running" about it would be staleness rendered as progress.
  const interrupted = run?.status === 'running' && !running;
  const d = (run?.detail ?? {}) as { estimate?: number; notesFor?: number; relationshipsFor?: number; entries?: Record<string, number>; gapCount?: number; gaps?: string[]; ceiling?: number };

  return (
    <Page
      crumbs={[{ label: SECTION.developer }, { label: 'Affinity', href: '/dev/affinity' }, { label: 'First slice' }]}
      inspector={
        <>
          <div className="lbl">What the slice reads</div>
          <div className="ihead">Entries, then notes and relationships</div>
          <div className="imeta">Landed raw; nothing translated yet</div>
          <div className="scope">
            <div className="lbl">Notes, for Neurotech only</div>
            <p>
              Note text is read only for lists whose vehicle says <code>importNotes</code> in the
              init file, and never for an SPV list. A note that mentions a person&rsquo;s or a
              family&rsquo;s health is flagged when the notes are inventoried, and that detail is
              never copied into anything derived from it.
            </p>
          </div>
          <div className="scope">
            <div className="lbl">Estimated before it is spent</div>
            <p>
              Entries come a hundred to a request. Notes and relationships are a request per entry,
              so that part is counted first, and a run over {n(config.affinity.sliceCeiling)} requests
              holds until somebody approves the number.
            </p>
          </div>
          <div className="note">
            Nothing on this page names anybody: it counts. The records themselves stay in{' '}
            <code>sources.raw_record</code>.
          </div>
        </>
      }
    >
      {running && <AutoRefresh seconds={3} />}
      <div className="lbl"><Link href="/dev/affinity">Affinity</Link> · <Link href="/dev/affinity/inventory">Inventory →</Link></div>
      <h1>The first slice</h1>
      <p className="sublede">
        What is on the lists we care about, read once and landed raw. A stage here is still a word
        in a payload and an amount still a number nobody has said the meaning of — translating them
        is the next step, and it needs your answers.
      </p>

      {demo && (
        <div className="scope" style={{ marginBottom: 14 }}>
          <div className="lbl">Demo</div>
          <p>Read from the fake Affinity in <code>fixtures/affinity/</code>: invented people and invented notes.</p>
        </div>
      )}

      <div className="card">
        <div className="chead">
          <h2>What it reads</h2>
          <span className="lbl">{targets.length} lists</span>
        </div>
        {targets.length === 0 ? (
          <div className="cbody">
            Nothing yet. <Link href="/dev/affinity/lists">Discover the lists</Link> and name them in the init file first.
          </div>
        ) : (
          <table className="list">
            <thead><tr><th>List</th><th>Holds</th><th>Why</th><th>Entries</th><th>Notes</th><th>Relationships</th></tr></thead>
            <tbody>
              {targets.map((t) => (
                <tr key={t.list.id}>
                  <td><b>{t.list.name}</b></td>
                  <td className="muted">{TYPE[t.list.type]}</td>
                  <td>{t.why === 'init' ? t.vehicleName : <span className="muted">says SPV — no vehicle yet</span>}</td>
                  <td>yes</td>
                  <td>{t.notes ? 'text' : <span className="muted">no</span>}</td>
                  <td>{t.relationships ? 'yes' : <span className="muted">no</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <div className="chead">
          <h2>Run</h2>
          <span className="lbl">
            {running ? 'reading now' : run ? `${interrupted ? 'interrupted' : run.status} · ${ago(run.startedAt)}${run.runByName ? ` · ${run.runByName}` : ''}` : 'never run'}
          </span>
        </div>
        <div className="cbody">
          {!running && (
            <form action={runSliceAction}>
              <button className="btn p" type="submit" disabled={!ready.ready || targets.length === 0}>
                {run ? 'Read the slice again' : 'Read the first slice'}
              </button>
              <span className="muted" style={{ fontSize: 12, marginLeft: 10 }}>
                {ready.ready ? `Entries first; the rest only if it comes in under ${n(config.affinity.sliceCeiling)} requests.` : ready.why}
              </span>
            </form>
          )}
          {run && (
            <div style={{ marginTop: 14 }}>
              <div className="fact"><span>{running ? 'So far' : 'Result'}</span><span>{run.note ?? '—'}</span></div>
              <div className="fact"><span>Requests</span><span>{n(run.requests)}</span></div>
              <div className="fact"><span>Records</span><span>{n(run.records)} seen · {n(run.newRecords)} new or changed</span></div>
              {d.estimate !== undefined && (
                <div className="fact">
                  <span>Per-entry reads</span>
                  <span>about {n(d.estimate)} requests: notes for {n(d.notesFor ?? 0)}, relationships for {n(d.relationshipsFor ?? 0)}</span>
                </div>
              )}
              {!!d.gapCount && (
                <div className="warn" style={{ marginTop: 10, fontSize: 12.5 }}>
                  <b>{d.gapCount} {d.gapCount === 1 ? 'gap' : 'gaps'}</b> — Affinity refused these, usually for a permission the key&rsquo;s owner lacks:
                  <ul style={{ margin: '6px 0 0' }}>{(d.gaps ?? []).slice(0, 8).map((x) => <li key={x}>{x}</li>)}</ul>
                </div>
              )}
              {interrupted && (
                <div className="warn" style={{ marginTop: 10, fontSize: 12.5 }}>
                  <b>Cut off.</b> The server restarted while this run was reading. What it landed before
                  that is kept; reading again stores only what is new.
                </div>
              )}
              {run.status === 'held' && !running && (
                <div style={{ marginTop: 12 }}>
                  <div className="acts" style={{ marginTop: 0 }}>
                    {!!d.relationshipsFor && (
                      <form action={runSliceAction} style={{ flex: 1 }}>
                        <input type="hidden" name="approvedEstimate" value={d.notesFor ?? 0} />
                        <input type="hidden" name="scope" value="notes" />
                        <button className="btn" type="submit" style={{ width: '100%' }}>
                          Notes only: about {n(d.notesFor ?? 0)} requests
                        </button>
                      </form>
                    )}
                    <form action={runSliceAction} style={{ flex: 1 }}>
                      <input type="hidden" name="approvedEstimate" value={d.estimate ?? 0} />
                      <button className="btn c" type="submit" style={{ width: '100%' }}>
                        {d.relationshipsFor ? 'Notes and relationships' : 'Go ahead'}: about {n(d.estimate ?? 0)} requests
                      </button>
                    </form>
                  </div>
                  <p className="muted" style={{ fontSize: 12, margin: '8px 0 0' }}>
                    Each approves its number and a quarter more, not whatever the run turns out to
                    cost.{' '}
                    {typeof (run.detail as { orgRemaining?: number }).orgRemaining === 'number'
                      ? `The account had ${n((run.detail as { orgRemaining: number }).orgRemaining)} requests left this month when this run held; `
                      : 'The account’s month is on the Affinity page; '}
                    this tool&rsquo;s share is {Math.round(config.affinity.monthlyShare * 100)}%.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="card">
        <div className="chead">
          <h2>Landed</h2>
          <span className="lbl">sources.raw_record · Affinity</span>
        </div>
        {counts.length === 0 ? (
          <div className="cbody">Nothing yet.</div>
        ) : (
          <table className="list">
            <thead><tr><th>What</th><th>Records</th><th>Versions kept</th><th>Last landed</th></tr></thead>
            <tbody>
              {counts.map((c) => (
                <tr key={c.kind}>
                  <td>{KIND[c.kind] ?? c.kind}</td>
                  <td className="mono">{n(c.records)}</td>
                  <td className="mono">{n(c.versions)}</td>
                  <td className="muted">{ago(c.lastAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="cover">
          <b>Coverage:</b> the lists above, as far as the key&rsquo;s owner can see them. A record
          changed since it landed is stored again beside the old one, so what a list said on a
          given day can be answered later.
        </p>
      </div>
    </Page>
  );
}
