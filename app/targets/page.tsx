import { coalescePage } from '@/lib/page-render';
import { Page } from '@/components/shell/Page';
import { PipelineTable } from '@/components/strategy/PipelineTable';
import { vehicleSelection } from '@/lib/session';
import { pipelineData } from '@/lib/pipeline-data';
import { RUNGS, RUNG_LABEL, STATUSES, type PursuitStatus } from '@/modules/strategy';

export const dynamic = 'force-dynamic';

async function Pipeline({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [sp, selection] = await Promise.all([searchParams, vehicleSelection()]);
  const one = (k: string) => (typeof sp[k] === 'string' ? (sp[k] as string) : undefined);
  const asked = one('status');
  // The filters in the address (N62): read here, so the page is drawn filtered from the start.
  const filters = Object.fromEntries(['q', 'owner', 'vehicle', 'meetings', 'touch', 'read', 'money', 'flag', 'sort', 'dir'].flatMap((k) => (one(k) ? [[k, one(k)!]] : [])));
  const current = selection.current;
  // All vehicles means the ones being raised: a vehicle kept for its history is shown when it
  // is the one selected, and counted, not mixed in.
  const { rows, onHistory, asOf } = await pipelineData(current?.id ?? '');
  const initial = asked === 'all' ? 'all' : STATUSES.some(s => s.id === asked) ? asked as PursuitStatus : null;
  const count = (status: PursuitStatus) => rows.filter(r => r.status === status).length;

  return (
    <Page
      crumbs={[
        { label: current?.name ?? 'All vehicles', href: '/overview' },
        { label: 'Pipeline' },
      ]}
      inspector={
        <>
          {/* The ticked LPs' actions appear here (components/strategy/PipelineTable.tsx). */}
          <div id="lp-pane-actions" />
          <div className="lbl">Seven statuses</div>
          <div className="ihead">Where our effort is</div>
          <div className="imeta">Our plan, set by a person, any direction</div>
          {STATUSES.map((s) => (
            <div className="kv" key={s.id} title={s.means}>
              <span>{s.label}</span>
              <span>{count(s.id).toLocaleString('en-US')}</span>
            </div>
          ))}
          <div className="scope">
            <div className="lbl">What a status is not</div>
            <p>
              Not evidence. The ladder beside each name is what the records support — a reply, a
              meeting, a number, a countersignature, a wire — and a status never moves it. What
              happened is in the log on each LP&rsquo;s page; how far the money has got is the close
              track.
            </p>
          </div>
          <div className="scope">
            <div className="lbl">Searching</div>
            <p>
              Press <kbd>/</kbd> to search. Filters narrow every status at once, and each count then
              reads &ldquo;N of M&rdquo;. The table starts in score order; tap any column heading to
              sort by it, and again to reverse. Tap a row to open the LP; tick rows to act on them
              together, and the actions appear here.
            </p>
          </div>
          <div className="note">
            Read from Affinity until someone sets one here; after that, Affinity&rsquo;s word is kept
            beside ours, never over it (docs/17).
          </div>
        </>
      }
    >
      <div className="lbl">Module 04 · Discover &amp; qualify</div>
      <h1>Pipeline</h1>
      <p className="sublede">
        Every LP for {current ? current.name : 'the vehicles being raised'}, by where our effort is.
        The ladder beside each is what the evidence supports, which is not the same thing.
      </p>

      <PipelineTable
        key={current?.id ?? 'all'}
        rows={rows}
        asOf={asOf}
        statuses={STATUSES.map((s) => ({ id: s.id, label: s.label, means: s.means }))}
        rungNames={RUNGS.map((r) => RUNG_LABEL[r])}
        initialStatus={initial}
        initialFilters={filters}
        showVehicle={!current}
      />


      <p className="cover" style={{ marginTop: -6 }}>
        {onHistory > 0 && <>{onHistory.toLocaleString('en-US')} pursuits on vehicles kept for their history are not counted here; select one in the rail to see them. </>}
        <b>What this covers:</b> pursuits recorded in this system, including those read from
        Affinity. Someone being worked without a pursuit does not appear, which is a gap in the
        record rather than an absence of activity.
      </p>
    </Page>
  );
}

export default coalescePage('/targets', Pipeline);
