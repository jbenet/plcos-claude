import { coalescePage } from '@/lib/page-render';
import { Page } from '@/components/shell/Page';
import { PipelineTable } from '@/components/strategy/PipelineTable';
import { vehicleSelection } from '@/lib/session';
import { pipelineData } from '@/lib/pipeline-data';
import { RUNGS, RUNG_LABEL, STATUSES } from '@/modules/strategy';
export const dynamic = 'force-dynamic';

async function Selection({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [selection, sp] = await Promise.all([vehicleSelection(), searchParams]);
  const { rows, asOf } = await pipelineData(selection.current?.id ?? '');
  const filters = Object.fromEntries(Object.entries(sp).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
  return <Page crumbs={[{ label: selection.current?.name ?? 'All vehicles', href: '/overview' }, { label: 'Selection' }]}>
    <div className="lbl">Module 03 · Discover &amp; qualify</div>
    <h1>Selection</h1>
    <p className="sublede">Choose where to focus next. New and Sourcing start selected; include any other status to compare the full pipeline. Scores describe the evidence on file, not a probability of commitment.</p>
    <PipelineTable key={selection.current?.id ?? 'all'} rows={rows} asOf={asOf} mode="selection" statuses={STATUSES} rungNames={RUNGS.map(r => RUNG_LABEL[r])}
      initialStatus={null} initialFilters={filters} showVehicle={!selection.current} />
  </Page>;
}
export default coalescePage('/selection', Selection);
