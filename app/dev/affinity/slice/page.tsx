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
  note: 'Notes — every note in the account, with what each is attached to',
  note_link: 'Which entry a note was read for (the per-entry read, before N49)',
  relationship: 'Relationship sets — one per person, the strongest hundred',
  list: 'Lists (discovery)',
  list_field: 'Fields on a list (discovery)',
  user: 'Affinity users (discovery)',
};

const n = (x: number) => x.toLocaleString('en-US');

export default async function Slice() {
  const demo = config.data.profile === 'demo';
  const ready = affinityReady();
  const [targets, run, counts] = await Promise.all([
    sliceTargets(), latestRun('affinity', 'slice'), rawCounts('affinity'),
  ]);
  const running = sliceRunning();
  // A run the database calls running that this process is not running was cut off by a
  // restart. Saying "running" about it would be staleness rendered as progress.
  const interrupted = run?.status === 'running' && !running;
  const d = (run?.detail ?? {}) as { estimate?: number; notesFor?: number; relationshipsFor?: number; entries?: Record<string, number>; gapCount?: number; gaps?: string[]; ceiling?: number };
  // A run from before N49 priced notes and relationships together; only relationships are left.
  const relationshipsFor = d.relationshipsFor ?? d.estimate ?? 0;

  return (
    <Page
      crumbs={[{ label: SECTION.developer }, { label: 'Affinity', href: '/dev/affinity' }, { label: 'First slice' }]}
      inspector={
        <>
          <div className="lbl">What the slice reads</div>
          <div className="ihead">Entries, then relationships</div>
          <div className="imeta">Landed raw; nothing translated yet</div>
          <div className="scope">
            <div className="lbl">Notes come separately</div>
            <p>
              Every note in the account is read in bulk, a hundred to a request, on{' '}
              <Link href="/dev/affinity/notes">Notes</Link>. This page used to read them one entry
              at a time, which cost a request per entry.
            </p>
          </div>
          <div className="scope">
            <div className="lbl">Estimated before it is spent</div>
            <p>
              Entries come a hundred to a request. Relationships are a request per person, so that
              part is counted first, and a run over {n(config.affinity.sliceCeiling)} requests holds
              until somebody approves the number.
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
            <thead><tr><th>List</th><th>Holds</th><th>Why</th><th>Entries</th><th>Relationships</th></tr></thead>
            <tbody>
              {targets.map((t) => (
                <tr key={t.list.id}>
                  <td><b>{t.list.name}</b></td>
                  <td className="muted">{TYPE[t.list.type]}</td>
                  <td>{t.why === 'init' ? t.vehicleName : <span className="muted">says SPV — no vehicle yet</span>}</td>
                  <td>yes</td>
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
                  <span>Per-person reads</span>
                  <span>
                    relationships for {n(relationshipsFor)} people, about {n(relationshipsFor)} requests
                    {d.notesFor ? <span className="muted"> · this run also priced notes for {n(d.notesFor)} entries, which the bulk read now covers</span> : null}
                  </span>
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
                    <form action={runSliceAction} style={{ flex: 1 }}>
                      <input type="hidden" name="approvedEstimate" value={relationshipsFor} />
                      <button className="btn c" type="submit" style={{ width: '100%' }}>
                        Relationships: about {n(relationshipsFor)} requests
                      </button>
                    </form>
                  </div>
                  <p className="muted" style={{ fontSize: 12, margin: '8px 0 0' }}>
                    It approves that number and a quarter more, not whatever the run turns out to
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
          <h2>Notes</h2>
          <span className="lbl">read in bulk since N49</span>
        </div>
        <div className="cbody">
          <p style={{ margin: 0, fontSize: 13 }}>
            Every note in the account, a hundred to a request, each with who and what it is attached
            to — on <Link href="/dev/affinity/notes">Notes</Link>.
          </p>
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
