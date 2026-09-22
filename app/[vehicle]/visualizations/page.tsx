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
export default async function Visualizations({ params }: { params: Promise<{ vehicle: string }> }) {
  const { vehicle: slug } = await params;
  const { all } = await vehicleSelection();
  const everything = slug === 'everything';
  const vehicle = slug === 'all' || everything ? null : all.find((v) => v.slug === slug);
  if (!vehicle && !everything && slug !== 'all') notFound();

  const state = await floorState(vehicle?.slug ?? null, { includeGrants: everything });
  const board = await boardState(vehicle?.slug ?? null, state);
  const lens = await lenses(vehicle?.slug ?? null, state);
  const scopeName = vehicle ? vehicle.name : everything ? 'PL Capital and PL R&D' : 'All of PL Capital';
  const blocked = state.items.filter((i) => i.blocked || i.restricted || i.conflict).length;
  const stalled = state.items.filter((i) => i.stalled).length;
  const unsized = state.items.filter((i) => i.amount === null).length;

  return (
    <Page
      crumbs={moduleCrumbs('visualizations', vehicle?.name ?? null)}
      inspector={
        <>
          <div className="lbl">How to read all fifteen</div>
          <div className="ihead">One vocabulary, fifteen layouts</div>
          <div className="imeta">Switching tabs should not mean relearning the colours</div>

          <div className="kv"><span>Size</span><span>Money at stake, square-root scale</span></div>
          <div className="kv"><span>No size</span><span>Nobody has a number from them yet</span></div>
          <div className="kv"><span>Fill</span><span>How recently anything was recorded</span></div>
          <div className="kv"><span>Clay ✕</span><span>Blocked, restricted or in a collision</span></div>
          <div className="kv"><span>Amber !</span><span>Something dated in the next fortnight</span></div>
          <div className="kv"><span>Green ✓</span><span>Cash actually received</span></div>
          <div className="kv"><span>Dashed</span><span>Soft — their words, never added to hard</span></div>
          <div className="kv"><span>Fogged</span><span>Nobody has scored them. Not weak — unopened</span></div>
          <div className="kv"><span>Valve</span><span>An approval gate, with tickets open on it</span></div>

          <div className="scope">
            <div className="lbl">What a rung means here</div>
            <p>
              An item sits at the highest rung it has an <b>evidence record</b> for. A connector
              saying they are happy to ask is rung one and nothing more. Nothing on this page
              promotes an item because it feels further along.
            </p>
          </div>

          <div className="warn" style={{ marginTop: 14 }}>
            <div className="lbl" style={{ color: 'var(--clay)' }}>What is not on any of these</div>
            <p>
              Anything nobody wrote down. No connector is attached, so no mailbox, CRM or
              calendar feeds this — a conversation that happened and was not recorded does not
              appear, and a calm picture is not evidence of a calm quarter.
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
        Size is money at stake, fill is how recently anything was recorded, and colour is
        reserved for the exceptions — so a floor with nothing wrong has almost no colour on it.
      </p>

      <div className="kpis">
        <div className="kpi">
          <span className="tag t-plain">On the map</span>
          <div className="n">{board.fog.scored}<span className="of"> of {board.territories.length}</span></div>
          <div className="f">Names scored on all four rubric dimensions. The rest are in the fog.</div>
        </div>
        <div className="kpi">
          <span className="tag t-plain">In flight</span>
          <div className="n">{state.items.length}</div>
          <div className="f">Entity × vehicle pairs with a pursuit, an exposure, or both.</div>
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
          <span className="tag t-plain">No number</span>
          <div className="n">{unsized}</div>
          <div className="f">Real pursuits nobody has a figure for. Drawn at minimum size, never guessed.</div>
        </div>
      </div>

      <FloorTabs state={state} board={board} lenses={lens} />

      <p className="note">
        Read as of {shortDate(state.asOf)}. {state.coverage.corpus}.
      </p>
    </Page>
  );
}
