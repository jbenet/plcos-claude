import { coalescePage } from '@/lib/page-render';
import { Page } from '@/components/shell/Page';
import { SelectionBoard } from '@/components/strategy/SelectionBoard';
import { moduleCrumbs } from '@/lib/nav';
import { vehicleSelection } from '@/lib/session';
import { pipelineData } from '@/lib/authz/read/pipeline';
import { RUNGS, RUNG_LABEL, STATUSES } from '@/lib/authz/read/strategy';
import { formatDate } from '@/lib/time';

export const dynamic = 'force-dynamic';

/**
 * Selection (module 03; issues 0071, 0089): who to work next, from every pursuit in the vehicle
 * — not only the few with manual rubric factors, which left the page empty (0071).
 */
async function Selection({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [selection, sp] = await Promise.all([vehicleSelection(), searchParams]);
  const current = selection.current;
  const { rows, asOf, onHistory } = await pipelineData(current?.id ?? '');
  const filters = Object.fromEntries(Object.entries(sp).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
  return (
    <Page crumbs={moduleCrumbs('selection', current?.name ?? null)}>
      <div className="lbl">Module 03 · Discover &amp; qualify</div>
      <h1>Selection</h1>
      <p className="sublede">
        Who to work next{current ? ` for ${current.name}` : ' across the vehicles being raised'}. Ranked by the score on file, with
        what it rests on beside the list. New and Sourcing are shown; turn on any other status to compare. Move to Selected (or
        press s) moves the LP in focus, or every ticked one, and Undo puts them back.
      </p>
      <SelectionBoard
        key={current?.id ?? 'all'}
        rows={rows}
        asOf={asOf}
        statuses={STATUSES.map((s) => ({ id: s.id, label: s.label, means: s.means }))}
        rungNames={RUNGS.map((r) => RUNG_LABEL[r])}
        initialFilters={filters}
        showVehicle={!current}
      />
      <p className="cover" style={{ marginTop: 14, background: 'none', borderTop: 0, padding: '4px 0' }}>
        {onHistory > 0 && <>{onHistory.toLocaleString('en-US')} pursuits on vehicles kept for their history are not listed; select one in the rail to see them. </>}
        <b>What this covers:</b> pursuits recorded in this system, including those read from Affinity, loaded{' '}
        {formatDate(new Date(asOf), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })} UTC.
        Someone without a pursuit does not appear, which is a gap in the record rather than a judgement.
      </p>
    </Page>
  );
}

export default coalescePage('/selection', Selection);
