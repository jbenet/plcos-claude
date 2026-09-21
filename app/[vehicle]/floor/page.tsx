import { notFound } from 'next/navigation';
import { FloorTabs } from '@/components/floor/FloorTabs';
import { Page } from '@/components/shell/Page';
import { floorState } from '@/lib/floor';
import { moduleCrumbs } from '@/lib/nav';
import { vehicleSelection } from '@/lib/session';
import { shortDate } from '@/lib/time';

export const dynamic = 'force-dynamic';

export default async function Floor({ params }: { params: Promise<{ vehicle: string }> }) {
  const { vehicle: slug } = await params;
  const { all } = await vehicleSelection();
  const vehicle = slug === 'all' ? null : all.find((v) => v.slug === slug);
  if (slug !== 'all' && !vehicle) notFound();

  const state = await floorState(vehicle?.slug ?? null);
  const blocked = state.items.filter((i) => i.blocked || i.restricted || i.conflict).length;
  const stalled = state.items.filter((i) => i.stalled).length;
  const unsized = state.items.filter((i) => i.amount === null).length;

  return (
    <Page
      crumbs={moduleCrumbs('floor', vehicle?.name ?? null)}
      inspector={
        <>
          <div className="lbl">How to read all five</div>
          <div className="ihead">One vocabulary, five layouts</div>
          <div className="imeta">Switching tabs should not mean relearning the colours</div>

          <div className="kv"><span>Size</span><span>Money at stake, square-root scale</span></div>
          <div className="kv"><span>No size</span><span>Nobody has a number from them yet</span></div>
          <div className="kv"><span>Fill</span><span>How recently anything was recorded</span></div>
          <div className="kv"><span>Clay ✕</span><span>Blocked, restricted or in a collision</span></div>
          <div className="kv"><span>Amber !</span><span>Something dated in the next fortnight</span></div>
          <div className="kv"><span>Green ✓</span><span>Cash actually received</span></div>
          <div className="kv"><span>Dashed</span><span>Soft — their words, never added to hard</span></div>

          <div className="scope">
            <div className="lbl">What a rung means here</div>
            <p>
              An item sits at the highest rung it has an <b>evidence record</b> for. A connector
              saying they are happy to ask is rung one and nothing more. Nothing on this page
              promotes an item because it feels further along.
            </p>
          </div>

          <div className="warn" style={{ marginTop: 14 }}>
            <div className="lbl" style={{ color: 'var(--clay)' }}>What is not on the floor</div>
            <p>
              Anything nobody wrote down. No connector is attached, so no mailbox, CRM or
              calendar feeds this — a conversation that happened and was not recorded does not
              appear, and the floor looking calm is not evidence that it is.
            </p>
          </div>

          <div className="note">
            Nothing here is stored. Every mark is read from the module that owns it at request
            time, so this page cannot drift from the pages you act on.
          </div>
        </>
      }
    >
      <div className="lbl">{vehicle ? vehicle.name : 'All of PL Capital'} · Factory floor</div>
      <h1>Everything trying to happen</h1>
      <p className="sublede">
        Five drawings of the same projection, each answering a different question. Size is money
        at stake, fill is how recently anything was recorded, and colour is reserved for the
        exceptions — so a floor with nothing wrong on it has almost no colour on it.
      </p>

      <div className="kpis">
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

      <FloorTabs state={state} />

      <p className="note">
        Read as of {shortDate(state.asOf)}. {state.coverage.corpus}.
      </p>
    </Page>
  );
}
