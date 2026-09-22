import Link from 'next/link';
import { config } from '@/config/deployment';
import { Page } from '@/components/shell/Page';
import { SECTION } from '@/lib/nav';

export const dynamic = 'force-dynamic';

/**
 * PL R&D is in the navigation because it is part of how the organisation is shaped. It is
 * not in the data model, and nothing here pretends otherwise: an empty room is easier to
 * reason about than a furnished one where none of the furniture takes weight.
 */
export default async function RnD() {
  return (
    <Page
      crumbs={[{ label: SECTION.rnd }, { label: 'Operations' }]}
      inspector={
        <>
          <div className="lbl">Not modelled</div>
          <div className="ihead">The nav is ahead of the schema</div>
          <div className="imeta">Deliberately, and visibly</div>
          <div className="scope">
            <div className="lbl">What it would take</div>
            <p>
              R&amp;D programmes are not vehicles: they consume capital rather than raise it, they
              run on grant cycles rather than closes, and their counterparties are funders and
              collaborators rather than LPs. Most of the domain is different.
            </p>
          </div>
          <div className="note">
            The pieces that would carry over are identity, research and the answer library. The
            pieces that would not are exposure, the consent ladder and the close rooms.
          </div>
        </>
      }
    >
      <div className="lbl">PL R&amp;D</div>
      <h1>Operations</h1>
      <p className="sublede">
        This section exists in the navigation because it exists in the organisation. It does not
        exist in the data model yet, and this page is not going to invent one.
      </p>

      <div className="empty">
        <span className="stat unavailable">
          <i />
          Not modelled
        </span>
        <h3>Nothing about PL R&amp;D is recorded in this system.</h3>
        <p>
          There is no schema, no seed, and no screen behind this beyond what you are reading.
          {config.product.name} models a raise: vehicles, LPs, commitments, closes. An R&amp;D programme is a
          different shape — it spends rather than raises, and its counterparties are funders and
          collaborators.
        </p>
        <dl>
          <dt>What is known</dt>
          <dd>Nothing. There is no R&amp;D data of any kind.</dd>
          <dt>Who can act</dt>
          <dd>Whoever decides what an R&amp;D programme needs to track.</dd>
          <dt>Safe next step</dt>
          <dd>
            Say what question this section should answer, and it becomes a module like any other.
            Until then this is an honest placeholder.
          </dd>
        </dl>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="chead">
          <h2>What already generalises</h2>
          <span className="lbl">if R&amp;D were modelled tomorrow</span>
        </div>
        <div className="cbody">
          <div className="fact">
            <span>Identity and research</span>
            <span>Reusable as-is — people and claims with provenance are domain-neutral.</span>
          </div>
          <div className="fact">
            <span>The answer library</span>
            <span>Reusable — approved answers with their own versioning apply anywhere.</span>
          </div>
          <div className="fact">
            <span>The grants rail</span>
            <span>
              <Link href="/grants">Already built</Link>, and the closest thing here to R&amp;D funding.
            </span>
          </div>
          <div className="fact">
            <span>Exposure, ladder, close rooms</span>
            <span>Would not carry over. They are about raising, not spending.</span>
          </div>
        </div>
      </div>
    </Page>
  );
}
