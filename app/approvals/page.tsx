import { Page } from '@/components/shell/Page';
import { config } from '@/config/deployment';

export const dynamic = 'force-dynamic';

const KINDS = [
  {
    kind: 'SEND',
    cls: 'k-send',
    gates: 'Any material leaving the building.',
    detail:
      'Checked against the wrong-wrap matrix (Vehicle × Instrument → allowed material scopes) at send time. wrong-wrap sends = 0 is a hard KPI, which means the check runs before the send, not in a report afterwards.',
    stage: 'L3 as a gate · L12 with the matrix',
  },
  {
    kind: 'INTRO_ASK',
    cls: 'k-intro',
    gates: 'Asking a connector to make an introduction.',
    detail:
      'Carries the connector, the target and the specific material. It does not authorize contacting the target and it does not move anyone to a pipeline stage — that is a separate ticket, on purpose.',
    stage: 'L3',
  },
  {
    kind: 'MONEY',
    cls: 'k-money',
    gates: 'Recording a commitment or a receipt.',
    detail:
      'The only path by which a number moves from soft to hard. Soft and hard never blend, and no blended figure across Neurotech, Rails, the SPVs and grants appears anywhere in this system.',
    stage: 'L3 as a gate · L6 with the cockpit',
  },
  {
    kind: 'STAGE',
    cls: 'k-stage',
    gates: 'Advancing a target along the consent ladder.',
    detail:
      'Every step up requires a specific evidence record. A connector saying "happy to ask" is the first rung and nothing more.',
    stage: 'L3 as a gate · L5 with the ladder',
  },
  {
    kind: 'ALLOCATION_EXCEPTION',
    cls: 'k-alloc',
    gates: 'Breaking an allocation rule on purpose.',
    detail:
      'Rare and always deliberate. The scope states the exception, the size and who absorbs it; an approval never authorizes an opaque bundle.',
    stage: 'L3 as a gate · L8 in the SPV war room',
  },
];

export default async function Approvals() {
  return (
    <Page crumbs={[{ label: 'Approvals' }]}>
      <div className="lbl">Module 24 · Approvals &amp; compliance</div>
      <h1>The queue is empty because nothing can request approval yet.</h1>
      <p className="sublede">
        Approval tickets are a gate in front of the mutation, not a record taken after it. Every
        mutating command in these five families takes a <code>ticketId</code> and fails closed
        without an approved, unexpired one. That machinery lands at L3; this page describes exactly
        what it will refuse, so the shape is agreed before anything depends on it.
      </p>

      <div className="card">
        <div className="chead">
          <h2>The five kinds</h2>
          <span className="lbl">closed set · one open ticket per subject per kind</span>
        </div>
        {KINDS.map((k) => (
          <div key={k.kind} className="row" style={{ alignItems: 'flex-start' }}>
            <span className={`kind ${k.cls}`} style={{ width: 150, marginTop: 2 }}>
              {k.kind}
            </span>
            <div className="t">
              <b>{k.gates}</b>
              <span style={{ lineHeight: 1.5, display: 'block' }}>{k.detail}</span>
            </div>
            <div className="state" style={{ width: 130 }}>
              <b>Not built</b>
              {k.stage}
            </div>
          </div>
        ))}
      </div>

      <div className="grid-even">
        <div className="card">
          <div className="chead">
            <h2>Five states, five check marks</h2>
          </div>
          <div className="cbody">
            <p>
              An agent finishing its run, a teammate accepting a task, an investor approving terms,
              counsel closing, and cash landing are five different things. They never share one
              affordance in this system, because the moment they do, the headline number stops
              meaning what it says.
            </p>
            <div className="fact">
              <span>Agent run succeeded</span>
              <span>
                <span className="stat working">
                  <i />
                  Agent working
                </span>
              </span>
            </div>
            <div className="fact">
              <span>Task accepted by a person</span>
              <span>
                <span className="stat ready">
                  <i />
                  Ready for review
                </span>
              </span>
            </div>
            <div className="fact">
              <span>Investor approved</span>
              <span>
                <span className="stat waiting">
                  <i />
                  Waiting on counterpart
                </span>
              </span>
            </div>
            <div className="fact">
              <span>Legal close</span>
              <span>
                <span className="stat verified">
                  <i />
                  Verified by administrator
                </span>
              </span>
            </div>
            <div className="fact">
              <span>Cash received</span>
              <span>
                <span className="stat evidence">
                  <i />
                  Needs evidence
                </span>
              </span>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="chead">
            <h2>Conflict window</h2>
            <span className="lbl">config.guard</span>
          </div>
          <div className="cbody">
            <p>
              When an actor has another open opportunity in a different vehicle inside the window,
              L3 opens a <code>ConflictCase</code> rather than blocking. Adjudication writes a
              winner, a loser, a reason code <b>and a dated follow-up for the loser</b> — blocking
              without that follow-up loses the opportunity silently, which is the bug.
            </p>
            <div className="fact">
              <span>Conflict window</span>
              <span>{config.guard.conflictWindowDays} days · GUESS</span>
            </div>
            <div className="fact">
              <span>Asks per relationship / quarter</span>
              <span>{config.guard.asksPerRelationshipPerQuarter}</span>
            </div>
            <div className="fact">
              <span>Asks per connector / quarter</span>
              <span>{config.guard.asksPerConnectorPerQuarter} · GUESS</span>
            </div>
            <p className="note" style={{ marginTop: 12 }}>
              Two of those three came from an unverified source and are labelled as guesses in{' '}
              <code>config/deployment.ts</code>. None should survive two weeks of real data.
            </p>
          </div>
        </div>
      </div>
    </Page>
  );
}
