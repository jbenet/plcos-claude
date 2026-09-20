import Link from 'next/link';
import { Page } from '@/components/shell/Page';

export const dynamic = 'force-dynamic';

export default async function PlNeuro() {
  return (
    <Page
      crumbs={[{ label: 'PL R&D' }, { label: 'PL Neuro' }]}
      inspector={
        <>
          <div className="lbl">Not modelled</div>
          <div className="ihead">PL Neuro</div>
          <div className="imeta">A programme, not a vehicle</div>
          <div className="note">
            The neuro thesis appears all over this system — it is what PLC Neurotech I invests
            behind. The research programme itself is a different entity and is not recorded.
          </div>
        </>
      }
    >
      <div className="lbl">PL R&amp;D</div>
      <h1>PL Neuro</h1>
      <p className="sublede">
        Not recorded in this system. The neuro <i>thesis</i> is everywhere — it is what the fund
        invests behind — but the research programme is a separate thing and has no schema.
      </p>

      <div className="empty">
        <span className="stat unavailable">
          <i />
          Not modelled
        </span>
        <h3>There is no PL Neuro data.</h3>
        <p>
          What exists is the fund that invests behind this thesis, and the claims that substantiate
          it. Those are not the programme.
        </p>
        <dl>
          <dt>What is known</dt>
          <dd>
            The thesis claims are in <Link href="/research">Research &amp; enrichment</Link>, with
            their sources.
          </dd>
          <dt>What is not</dt>
          <dd>Anything about the programme itself: people, projects, budgets, outputs.</dd>
          <dt>Safe next step</dt>
          <dd>Decide what it needs to track before anything is built for it.</dd>
        </dl>
      </div>
    </Page>
  );
}
