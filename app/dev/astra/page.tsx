import { coalescePage } from '@/lib/page-render';
import { Page } from '@/components/shell/Page';
import { SECTION } from '@/lib/nav';
import { ago } from '@/lib/time';
import { getDb } from '@/lib/db';
import { readRunner, recentJobs, runnerUp, WORKFLOW_LABEL, type AstraJob, type AstraRunner } from '@/lib/astra/jobs';
import { cancelAstraAction } from './actions';
import { AutoForm, PauseButton, QueueForm } from './AstraForms';
import s from './astra.module.css';

export const dynamic = 'force-dynamic';

const hour = (h: number) => `${String(h).padStart(2, '0')}:00`;
const STATUS: Record<AstraJob['status'], string> = {
  queued: 'Queued', claimed: 'Starting', running: 'Agent working', done: 'Done', failed: 'Failed', cancelled: 'Cancelled',
};
const FLAG: Record<AstraJob['status'], string> = { queued: 'f-mute', claimed: 'f-mute', running: 'f-ev', done: 'f-ok', failed: 'f-block', cancelled: 'f-mute' };

function waiting(job: AstraJob, r: AstraRunner): string | null {
  if (job.status !== 'queued') return null;
  if (r.paused) return 'Paused';
  if (!runnerUp(r)) return 'Runner is off';
  if (!job.runNow && r.inWindow === false) return `Waits for ${hour(r.windowStart)}`;
  return 'Next poll';
}

function elapsed(job: AstraJob): string {
  if (!job.startedAt) return '';
  const end = job.finishedAt ? Date.parse(job.finishedAt) : Date.now();
  const m = Math.max(0, Math.round((end - Date.parse(job.startedAt)) / 60_000));
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
}

async function AstraPage() {
  const db = await getDb();
  const [runner, jobs] = await Promise.all([readRunner(db), recentJobs(db)]);
  const up = runnerUp(runner);
  const active = jobs.filter((j) => j.status === 'running' || j.status === 'claimed');
  const queued = jobs.filter((j) => j.status === 'queued');
  const since = Date.now() - 864e5;
  const day = jobs.filter((j) => j.finishedAt && Date.parse(j.finishedAt) > since);
  const sum = (k: string) => day.reduce((n, j) => n + (j.counts[k] ?? 0), 0);
  const free = runner.slots.filter((x) => !x.job).length;

  return (
    <Page
      crumbs={[{ label: SECTION.developer }, { label: 'Astra' }]}
      inspector={
        <>
          <div className="lbl">No Claude in the loop</div>
          <div className="ihead">The runner on the Mac does the work</div>
          <div className="imeta">docs/30-astra-runner.md</div>
          <div className="kv"><span>Runner</span><span>{up ? 'Running' : 'Off'}</span></div>
          <div className="kv"><span>Last poll</span><span>{runner.heartbeatAt ? ago(new Date(runner.heartbeatAt)) : 'Never'}</span></div>
          <div className="kv"><span>Night window</span><span>{hour(runner.windowStart)}–{hour(runner.windowEnd)}</span></div>
          <div className="scope">
            <div className="lbl">How it works</div>
            <p>
              You start the runner once on the Mac with <code>npm run astra</code> in the live checkout (or install it as a login
              item with <code>npm run astra:install</code>). It polls this page every minute, cuts each batch on the Mac, runs
              ChatGPT&apos;s codex with a fixed brief, records the run in the ledger, checks and pushes the results here.
            </p>
            <p>The server stores only workflows and counts, never a name. Pausing stops new starts; a running batch finishes.</p>
          </div>
        </>
      }
    >
      <div className="lbl">Developer</div>
      <h1>Astra</h1>
      <p className="sublede">Queue research and strategy runs for Astra, the ChatGPT workers on the Mac, and watch them. Nothing here goes through Claude.</p>

      <div className="card">
        <div className="chead">
          <span className="lbl">Runner</span>
          <PauseButton paused={runner.paused} />
        </div>
        <div className={s.strip}>
          <div className={s.stat}><span className={s.k}>State</span>
            <span className={`${s.v} ${up && !runner.paused ? s.up : s.down}`}>{!up ? 'Off' : runner.paused ? 'Paused' : runner.inWindow === false ? 'Waiting for night' : 'Running'}</span></div>
          <div className={s.stat}><span className={s.k}>Slots free</span><span className={s.v}>{up ? `${free} of ${runner.slots.length}` : '—'}</span></div>
          <div className={s.stat}><span className={s.k}>Working</span><span className={s.v}>{active.length}</span></div>
          <div className={s.stat}><span className={s.k}>Queued</span><span className={s.v}>{queued.length}</span></div>
          <div className={s.stat}><span className={s.k}>Last 24 h</span><span className={s.v}>{sum('valid')} valid of {sum('selected')}</span></div>
        </div>
        {!up && (
          <p className={s.hint} style={{ paddingTop: 10 }}>
            {runner.heartbeatAt ? `The runner last polled ${ago(new Date(runner.heartbeatAt))}.` : 'The runner has never polled.'} Queued runs wait until it is
            back. Start it on the Mac with <code>npm run astra</code> in the live checkout.
          </p>
        )}
        {runner.capacityUntil && Date.parse(runner.capacityUntil) > Date.now() && (
          <p className={s.hint} style={{ paddingTop: 10 }}>Both models were at capacity; the runner tries again {ago(new Date(runner.capacityUntil)).replace(' ago', '')} from now.</p>
        )}
        {runner.note && <p className={s.hint} style={{ paddingTop: 10 }}>Runner: {runner.note}</p>}
      </div>

      <div className="card">
        <div className="chead"><span className="lbl">New runs</span></div>
        <QueueForm batchSize={runner.batchSize} />
        <p className={s.hint}>
          Each run takes the next LPs the batch cutter picks, firms kept whole. Tonight&apos;s runs start at {hour(runner.windowStart)} and none
          start after {hour(runner.windowEnd)}; Now starts them on the runner&apos;s next poll.
        </p>
      </div>

      <div className="card">
        <div className="chead"><span className="lbl">Every night</span></div>
        <AutoForm autoOn={runner.autoOn} autoWorkflow={runner.autoWorkflow} autoBatches={runner.autoBatches} batchSize={runner.batchSize}
          windowStart={runner.windowStart} windowEnd={runner.windowEnd} />
        <p className={s.hint}>When on, the runner queues this many runs itself when the window opens, once a night, and stops early when nobody is left to research.</p>
      </div>

      <div className="card">
        <div className="chead">
          <span className="lbl">Runs</span>
          {queued.length > 0 && (
            <form action={cancelAstraAction} className={s.inline}>
              <input type="hidden" name="id" value="queued" />
              <button className={s.link}>Cancel all queued</button>
            </form>
          )}
        </div>
        {jobs.length === 0 ? (
          <div className="cbody"><div className="empty">No runs yet. Queue some above, or turn on Every night.</div></div>
        ) : (
          <div className={s.scroll}>
            <table className={`list ${s.table}`}>
              <thead>
                <tr><th>Run</th><th>Status</th><th className={s.num}>LPs</th><th className={s.num}>Valid</th><th className={s.num}>Pushed</th><th>Where</th><th /></tr>
              </thead>
              <tbody>
                {jobs.map((j) => (
                  <tr key={j.id}>
                    <td>
                      {WORKFLOW_LABEL[j.workflow]}
                      <span className={s.sub}>{j.source === 'auto' ? `Every night, ${j.night}` : j.runNow ? 'Now' : 'Tonight'} · queued {ago(new Date(j.createdAt))}</span>
                    </td>
                    <td>
                      <span className={`flag ${FLAG[j.status]}`}>{STATUS[j.status]}</span>
                      <span className={s.sub}>{waiting(j, runner) ?? elapsed(j)}{j.message ? ` · ${j.message}` : ''}</span>
                    </td>
                    <td className={s.num}>{j.counts.selected ?? j.size}</td>
                    <td className={s.num}>{j.counts.valid ?? '—'}</td>
                    <td className={s.num}>{j.counts.pushed ?? '—'}</td>
                    <td><span className={s.key}>{[j.batch, j.slot, j.model].filter(Boolean).join(' · ')}</span></td>
                    <td>
                      {(j.status === 'queued' || j.status === 'claimed' || j.status === 'running') && (
                        <form action={cancelAstraAction} className={s.inline}>
                          <input type="hidden" name="id" value={j.id} />
                          <button className={s.link}>{j.status === 'queued' ? 'Cancel' : 'Stop'}</button>
                        </form>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Page>
  );
}

export default coalescePage('/dev/astra', AstraPage);
