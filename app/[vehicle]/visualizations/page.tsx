import { coalescePage } from '@/lib/page-render';
import { notFound } from 'next/navigation';
import { FloorTabs } from '@/components/floor/FloorTabs';
import { Page } from '@/components/shell/Page';
import { boardState } from '@/lib/board';
import { floorState } from '@/lib/floor';
import { lenses } from '@/lib/lenses';
import { moduleCrumbs } from '@/lib/nav';
import { vehicleSelection } from '@/lib/session';
import { shortDate } from '@/lib/time';

export const dynamic = 'force-dynamic';

/**
 * Three scopes, not two (issue 0013).
 *
 * `/everything/visualizations` is the whole organisation, the grants rail included.
 * `/all/visualizations` is PL Capital's vehicles. `/<vehicle>/visualizations` is one raise.
 * The rail used to point two different entries at the same URL, which meant one of the two
 * labels was wrong.
 */
async function Visualizations({ params }: { params: Promise<{ vehicle: string }> }) {
  const { vehicle: slug } = await params;
  const { all } = await vehicleSelection();
  const everything = slug === 'everything';
  const vehicle = slug === 'all' || everything ? null : all.find((v) => v.slug === slug);
  if (!vehicle && !everything && slug !== 'all') notFound();

  const state = await floorState(vehicle?.slug ?? null, { includeGrants: everything });
  const [board, lens] = await Promise.all([boardState(vehicle?.slug ?? null, state), lenses(vehicle?.slug ?? null, state)]);
  const scopeName = vehicle ? vehicle.name : everything ? 'PL Capital and PL R&D' : 'All of PL Capital';
  const passed = state.items.filter((i) => i.status === 'passed').length;
  const blocked = state.items.filter((i) => i.blocked || i.restricted || i.conflict).length;
  const stalled = state.items.filter((i) => i.stalled).length;
  const unbacked = state.items.filter((i) => i.needsEvidence).length;
  const unsized = state.items.filter((i) => i.amount === null).length;

  return (
    <Page
      crumbs={moduleCrumbs('visualizations', vehicle?.name ?? null)}
      inspector={
        <>
          <div className="lbl">How to read all fifteen</div>
          <div className="ihead">One vocabulary, fifteen layouts</div>
          <div className="imeta">Switching tabs should not mean relearning the colours</div>

          <div className="kv"><span>Counts</span><span>Pursuits or records, labelled in each view</span></div>
          <div className="kv"><span>Groups</span><span>Select a count or bin to inspect its members</span></div>
          <div className="kv"><span>◇</span><span>Needs evidence — status and ladder disagree</span></div>
          <div className="kv"><span>Money</span><span>Separate by vehicle, hard and soft never combined</span></div>
          <div className="kv"><span>Unknown</span><span>Missing records stay separate from zero</span></div>
          <div className="kv"><span>Lists</span><span>Page through every matching record</span></div>
          <div className="kv"><span>Scope</span><span>LP filters apply where shown; shared-resource views say full page scope</span></div>

          <div className="scope">
            <div className="lbl">Status first, the ladder under it</div>
            <p>
              Where a view lays LPs out by stage, the stages are the <b>status</b>: New,
              Sourcing, Selected, Connecting, Discussing, Committed or Passed. The status is our
              plan: set by a person on the LP page, or read from Affinity until someone does. It
              can move in any direction, and it claims nothing about the LP.
            </p>
            <p>
              The <b>ladder</b> is the evidence under the status. It has six rungs, and each
              needs its own record: a connector&rsquo;s yes, a reply from the LP, a meeting, a
              number from them, a countersignature, a wire. An LP is at the highest rung it has a
              record for. A connector saying they are happy to ask is the first rung and nothing
              more. Nothing on this page moves an LP up because it feels further along.
            </p>
            <p>
              Three statuses rest on a rung: Connecting on a connector&rsquo;s yes or direct
              contact, Discussing on a meeting, Committed on a countersignature. Until the ladder
              has that rung, the LP is marked <b>◇ Needs evidence</b>. The flow and the plant are
              the exceptions: they count dated steps, so they are drawn on the ladder, and say so.
            </p>
          </div>

          <div className="warn" style={{ marginTop: 14 }}>
            <div className="lbl" style={{ color: 'var(--clay)' }}>What is not on any of these</div>
            <p>
              Anything nobody wrote down. Only records available to this copy appear. A conversation that happened but was not recorded does not appear, and a calm picture is not evidence of a calm quarter.
            </p>
          </div>

          <div className="note">
            Nothing here is stored. Every mark is read from the module that owns it at request
            time, so this page cannot drift from the pages you act on.
          </div>
        </>
      }
    >
      <div className="lbl">{scopeName} · Visualizations</div>
      <h1>Everything trying to happen</h1>
      <p className="sublede">
        {everything
          ? 'Every vehicle on file, the grants rail included. '
          : vehicle ? 'One raise. ' : 'PL Capital’s vehicles. The grants rail is on the organisation-wide page. '}
        Fifteen drawings, one vocabulary. The first five read what is happening; the second five
        read the ground it happens on and the moves available; the third five read who can reach
        whom, what to unblock, and what is simply not on file. Click anything to open it.
        Start with counts and bins, then expand a group or page through its records. Each view states its scope; money stays separate by vehicle and by hard or soft track.
      </p>

      <div className="kpis six">
        <div className="kpi">
          <span className="tag t-plain">On the map</span>
          <div className="n">{board.fog.scored}<span className="of"> of {board.territories.length}</span></div>
          <div className="f">Names in the bounded discovery preview with rubric records. The map shows missing dimensions separately.</div>
        </div>
        <div className="kpi">
          <span className="tag t-plain">In flight</span>
          <div className="n">{state.items.length - passed}</div>
          <div className="f">
            Entity × vehicle pairs with a pursuit, an exposure, or both.
            {passed ? ` ${passed} passed are drawn but not counted.` : ''}
          </div>
        </div>
        <div className="kpi">
          <span className={`tag ${blocked ? 't-clay' : 't-plain'}`}>Blocked</span>
          <div className="n">{blocked}</div>
          <div className="f">Something stops these today. Each one names what.</div>
        </div>
        <div className="kpi">
          <span className={`tag ${stalled ? 't-clay' : 't-plain'}`}>Stalled</span>
          <div className="n">{stalled}</div>
          <div className="f">Nothing recorded for more than three weeks.</div>
        </div>
        <div className="kpi">
          <span className={`tag ${unbacked ? 't-clay' : 't-plain'}`}>Needs evidence</span>
          <div className="n">{unbacked}</div>
          <div className="f">The status claims a rung the ladder doesn&rsquo;t have yet. Marked ◇.</div>
        </div>
        <div className="kpi">
          <span className="tag t-plain">No number</span>
          <div className="n">{unsized}</div>
          <div className="f">Pursuits nobody has a figure for. Shown as unknown, never guessed.</div>
        </div>
      </div>

      <FloorTabs state={state} board={board} lenses={lens} />

      <p className="note">
        Read as of {shortDate(state.asOf)}. {state.coverage.corpus}.
      </p>
    </Page>
  );
}

export default coalescePage('/[vehicle]/visualizations', Visualizations);
