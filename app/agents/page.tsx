import { Page } from '@/components/shell/Page';
import { config } from '@/config/deployment';
import { shortDate, ago } from '@/lib/time';
import { agent } from '@/lib/agent';
import { circuitBreaker, listEnvelopes, listEvalCases, listRuns } from '@/modules/agents';

export const dynamic = 'force-dynamic';

const RUN_FLAG: Record<string, string> = {
  proposed: 'f-ev', refused: 'f-block', unavailable: 'f-mute',
  accepted: 'f-ok', rejected: 'f-mute',
};

export default async function Agents() {
  const [breaker, envelopes, runs, cases, ag] = await Promise.all([
    circuitBreaker(), listEnvelopes(), listRuns(), listEvalCases(), agent(),
  ]);
  const refusedCalls = runs.flatMap((r) => r.toolCalls).filter((c) => !c.allowed);

  return (
    <Page
      crumbs={[{ label: 'Learning & agent quality' }]}
      inspector={
        <>
          <div className="lbl">Circuit breaker</div>
          <div className="ihead">{breaker.frozen ? 'Autonomy frozen' : 'Autonomy not frozen'}</div>
          <div className="imeta">Measured from recorded corrections, not from a feeling</div>
          <div
            style={{
              fontFamily: 'var(--display)', fontSize: 34, fontWeight: 600, margin: '10px 0 2px',
              color: breaker.frozen ? 'var(--clay)' : 'var(--ink)',
            }}
          >
            {breaker.hoursThisWeek.toFixed(1)} h
          </div>
          <p className="muted" style={{ fontSize: 12.5, lineHeight: 1.55 }}>
            {breaker.statement}
          </p>
          <div className="kv">
            <span>Budget</span>
            <span>{breaker.budgetHours} h/week · GUESS</span>
          </div>
          <div className="kv">
            <span>Runtime</span>
            <span>
              {ag.kind} · {ag.available ? 'available' : 'refuses'}
            </span>
          </div>
          <div className="scope">
            <div className="lbl">What freezing does</div>
            <p>
              No new top-level envelope may be created. Existing runs still work and a child
              envelope narrowing an existing one is still allowed — the freeze stops new
              autonomy, not all work.
            </p>
          </div>
          <div className="note">
            Correction time has to be recorded by the people doing the correcting. A breaker that
            infers its own input measures nothing.
          </div>
        </>
      }
    >
      <div className="lbl">Settings · Learning &amp; agent quality</div>
      <h1>Agent runtime</h1>
      <p className="sublede">
        The authorization unit is the run, not the agent. Every run is bounded by a work envelope,
        every tool call is checked against it, and the run record pins the config, the input and
        the prompt by hash — so editing a prompt cannot retroactively change what a finished run
        meant.
      </p>

      <div className="kpis">
        <div className="kpi">
          <div className="lbl">Runs</div>
          <div className="n">{runs.length}</div>
          <div className="f">
            {runs.filter((r) => r.status === 'unavailable' || r.status === 'refused').length} of them
            refused to run at all.
          </div>
        </div>
        <div className="kpi">
          <div className="lbl">Tool calls refused</div>
          <div className="n">{refusedCalls.length}</div>
          <div className="f">Outside the envelope. Recorded, because a log of only what was permitted answers nothing.</div>
        </div>
        <div className="kpi">
          <div className="lbl">Protected eval cases</div>
          <div className="n">{cases.length}</div>
          <div className="f">
            {cases.filter((c) => c.fromFailure).length} added from real failures found while building.
          </div>
        </div>
        <div className="kpi">
          <div className="lbl">Correction budget</div>
          <div className="n">
            {breaker.hoursThisWeek.toFixed(1)}/{breaker.budgetHours}
          </div>
          <div className="f">Hours this week. {breaker.frozen ? 'Over.' : 'Under.'}</div>
        </div>
      </div>

      <div className="card">
        <div className="chead">
          <h2>Work envelopes</h2>
          <span className="lbl">delegation cannot increase permission</span>
        </div>
        {envelopes.map((en) => (
          <div className="row" key={en.envelopeId} style={{ alignItems: 'flex-start' }}>
            <div className="t">
              <b>{en.task}</b>
              <span style={{ display: 'block', lineHeight: 1.5 }}>{en.scope}</span>
              <div style={{ marginTop: 7, display: 'grid', gap: 4, fontSize: 11.5 }}>
                <div>
                  <span className="lbl" style={{ marginRight: 8 }}>
                    Commands
                  </span>
                  {en.allowedCommands.map((c) => (
                    <span key={c} className="flag f-mute" style={{ marginRight: 4 }}>
                      {c}
                    </span>
                  ))}
                </div>
                <div>
                  <span className="lbl" style={{ marginRight: 8 }}>
                    Evidence
                  </span>
                  {en.allowedEvidence.map((c) => (
                    <span key={c} className="flag f-mute" style={{ marginRight: 4 }}>
                      {c}
                    </span>
                  ))}
                </div>
                <div>
                  <span className="lbl" style={{ marginRight: 8 }}>
                    Acceptance
                  </span>
                  <span className="muted">{en.acceptanceCriteria.join(' · ')}</span>
                </div>
              </div>
            </div>
            <div className="state" style={{ width: 150 }}>
              <b>{en.budget.tokens ?? '—'} tokens</b>
              escalates to {en.escalationOwnerName}
            </div>
          </div>
        ))}
        <p className="cover">
          A child envelope may narrow its parent and may never widen it. That is checked in{' '}
          <code>createEnvelope</code> rather than documented, because &ldquo;the child inherits the
          parent&rsquo;s scope&rdquo; stays true until someone adds one convenient exception.
        </p>
      </div>

      <div className="card">
        <div className="chead">
          <h2>Runs</h2>
          <span className="lbl">config, input and prompt pinned by hash</span>
        </div>
        {runs.map((r) => (
          <div className="row" key={r.runId} style={{ alignItems: 'flex-start' }}>
            <span className={`flag ${RUN_FLAG[r.status]}`} style={{ width: 92, textAlign: 'center' }}>
              {r.status}
            </span>
            <div className="t">
              <b>{r.envelope?.task ?? 'unknown envelope'}</b>
              <span style={{ display: 'block', lineHeight: 1.5 }}>{r.rationale}</span>
              <div className="mono muted" style={{ fontSize: 10, marginTop: 6 }}>
                config {r.configHash} · input {r.inputHash} · prompt {r.promptHash} · {r.agentKind}
              </div>
              {r.toolCalls.length > 0 && (
                <div style={{ marginTop: 7 }}>
                  {r.toolCalls.map((c) => (
                    <div key={c.callId} style={{ fontSize: 11.5, marginBottom: 3 }}>
                      <span className={`flag ${c.allowed ? 'f-ok' : 'f-block'}`} style={{ marginRight: 6 }}>
                        {c.allowed ? 'allowed' : 'refused'}
                      </span>
                      <span className="mono">{c.tool}</span>
                      {c.refusal && <span className="muted"> — {c.refusal}</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="state">
              <b>{ago(r.startedAt)}</b>
              {r.acceptedByName ? `accepted by ${r.acceptedByName}` : 'not accepted'}
            </div>
          </div>
        ))}
        <p className="cover">
          <b>No tool sends anything, and no tool accepts its own proposed task.</b> Acceptance
          takes an <code>app_user</code> id and carries an idempotency key, so a double click
          cannot create two of anything — the unique index is what enforces it, not the button
          state.
        </p>
      </div>

      <div className="card">
        <div className="chead">
          <h2>The protected set</h2>
          <span className="lbl">the agent cannot move its own pass criteria</span>
        </div>
        {cases.map((c) => (
          <div className="row" key={c.caseId} style={{ alignItems: 'flex-start' }}>
            <span className="kind k-chore" style={{ width: 80 }}>
              {c.protected ? 'protected' : 'open'}
            </span>
            <div className="t">
              <b>{c.name}</b>
              <span style={{ display: 'block', lineHeight: 1.5 }}>{c.expectation}</span>
              {c.fromFailure && (
                <span style={{ display: 'block', marginTop: 4, color: 'var(--muted)', fontSize: 11.5 }}>
                  Added from: {c.fromFailure}
                </span>
              )}
            </div>
            <div className="state" style={{ width: 130 }}>
              {c.lastResult ? (
                <>
                  <b>{c.lastResult.passed ? 'passed' : 'not run'}</b>
                  {shortDate(c.lastResult.at)}
                </>
              ) : (
                <>
                  <b>never run</b>
                  no runtime
                </>
              )}
            </div>
          </div>
        ))}
        <p className="cover">
          <b>A fixed set overfits</b>, so cases are added from real failures rather than invented —
          every one of these came from something that actually went wrong while building L1 to L12,
          and the entry names which stage. With no runtime attached the harness reports{' '}
          <i>not run</i> rather than green: a harness that passes because it could not execute is
          worse than no harness.
        </p>
      </div>

      <div className="card">
        <div className="chead">
          <h2>Config pinned into every run</h2>
          <span className="lbl">so a finished run keeps its meaning</span>
        </div>
        <div className="cbody">
          <div className="fact">
            <span>Correction budget</span>
            <span>{config.agents.correctionBudgetHoursPerWeek} h/week · GUESS</span>
          </div>
          <div className="fact">
            <span>Conflict window</span>
            <span>{config.guard.conflictWindowDays} days · GUESS</span>
          </div>
          <div className="fact">
            <span>Connector cap</span>
            <span>{config.guard.asksPerConnectorPerQuarter} per quarter · GUESS</span>
          </div>
          <p className="note" style={{ marginTop: 12 }}>
            The whole config object is snapshotted into the run row and hashed. Changing a guess
            later changes what new runs do, and changes nothing about what old ones meant.
          </p>
        </div>
      </div>
    </Page>
  );
}
