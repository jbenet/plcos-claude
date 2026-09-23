import Link from 'next/link';
import { Fragment } from 'react';
import { Page } from '@/components/shell/Page';
import { SECTION } from '@/lib/nav';
import { config } from '@/config/deployment';
import { inventory } from '@/lib/connectors/affinity/inventory';
import { readMapping, type ValueMap } from '@/lib/connectors/affinity/mapping';
import { normName } from '@/lib/connectors/affinity/match';
import {
  OUTCOME_LABEL, RUNG_LABEL, STAGES, STAGE_GROUP_LABEL, type PursuitStage,
} from '@/modules/strategy';
import { writeMappingAction } from '../actions';

export const dynamic = 'force-dynamic';

const n = (x: number) => x.toLocaleString('en-US');
const stageOf = (id: PursuitStage | null | undefined) => (id ? STAGES.find((s) => s.id === id) ?? null : null);

function Meaning({ m }: { m: ValueMap | null }) {
  if (!m) return <span className="flag f-block">needs a meaning</span>;
  if (m.skip) return <span className="muted">not an LP — not translated</span>;
  const s = stageOf(m.stage);
  return (
    <span>
      {s ? <b>{s.label}</b> : <span className="muted">stage unknown</span>}
      {m.outcome && m.outcome !== 'open' && <span className="flag f-mute" style={{ marginLeft: 6 }}>{OUTCOME_LABEL[m.outcome]}</span>}
      {m.reason && <span className="muted"> · {m.reason.replace('_', ' ')}</span>}
    </span>
  );
}

export default async function Mapping() {
  const demo = config.data.profile === 'demo';
  const inv = await inventory();
  const map = await readMapping(inv);
  const lists = inv.lists.filter((l) => l.why === 'init' && l.entries > 0);

  return (
    <Page
      crumbs={[{ label: SECTION.developer }, { label: 'Affinity', href: '/dev/affinity' }, { label: 'Mapping' }]}
      inspector={
        <>
          <div className="lbl">Stage, outcome, reason</div>
          <div className="ihead">Three things one field was holding</div>
          <div className="imeta">Affinity&rsquo;s status, taken apart</div>
          <div className="scope">
            <div className="lbl">Why apart</div>
            <p>
              The team used one status to slice a board, so it carries where the work is, whether
              it ended, and why — &ldquo;Passed – Timing&rdquo; is an outcome and a reason. Here
              those are three columns, so a board can still group them however it likes.
            </p>
          </div>
          <div className="scope">
            <div className="lbl">A stage claims; it does not prove</div>
            <p>
              Each stage claims a rung of the consent ladder. The ladder moves only on evidence,
              and the stepper shows the claim beside it. A &ldquo;Signed&rdquo; stage marks money
              as ready to harden; only the close room&rsquo;s countersignature hardens it.
            </p>
          </div>
          <div className="note">
            Affinity stays as it is. Once this model has settled, changing Affinity&rsquo;s fields
            to match is an option — a write, and so a later decision.
          </div>
        </>
      }
    >
      <div className="lbl">
        <Link href="/dev/affinity">Affinity</Link> · <Link href="/dev/affinity/inventory">Inventory</Link>
      </div>
      <h1>How Affinity is read</h1>
      <p className="sublede">
        Our pipeline stages, and what each of Affinity&rsquo;s status words means in them. The
        mapping is a file you can edit; every translation re-reads it, so a correction is an
        edit and a re-run, never another request to Affinity.
      </p>

      {demo && (
        <div className="scope" style={{ marginBottom: 14 }}>
          <div className="lbl">Demo</div>
          <p>The fake Affinity&rsquo;s status words, mapped the same way the real ones are.</p>
        </div>
      )}

      <div className="card">
        <div className="chead">
          <h2>Our stages</h2>
          <span className="lbl">{STAGES.length} stages in 5 groups · outcome and reason kept apart</span>
        </div>
        <table className="list">
          <thead><tr><th>Group</th><th>Stage</th><th>What it means</th><th>Claims</th></tr></thead>
          <tbody>
            {STAGES.map((s, i) => (
              <tr key={s.id}>
                <td className="muted">{i === 0 || STAGES[i - 1]!.group !== s.group ? STAGE_GROUP_LABEL[s.group] : ''}</td>
                <td><b>{s.label}</b> <span className="muted mono" style={{ fontSize: 11 }}>{s.id}</span></td>
                <td style={{ fontSize: 12.5 }}>{s.means}</td>
                <td className="muted" style={{ fontSize: 12 }}>{s.claims ? RUNG_LABEL[s.claims] : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="cover">
          <b>Outcomes:</b> open, on hold, passed, lost — at any stage. <b>Reasons</b> for an ending:
          thesis, timing, valuation, structure, concentration, diligence, mandate, no response, other.
        </p>
      </div>

      {!map.exists ? (
        <div className="card">
          <div className="chead"><h2>The mapping</h2><span className="lbl mono">{map.path}</span></div>
          <div className="cbody">
            <p style={{ margin: '0 0 10px', fontSize: 13 }}>
              Not written yet. Writing it proposes a meaning for every status word from the words
              themselves, and marks each list unreviewed.
            </p>
            <form action={writeMappingAction}>
              <button className="btn p" type="submit" disabled={lists.length === 0}>Write the proposed mapping</button>
            </form>
          </div>
        </div>
      ) : (
        lists.map((l) => {
          const m = Object.entries(map.lists).find(([k]) => normName(k) === normName(l.list.name))?.[1];
          if (!m) return null;
          const count = (field: string, value: string) => l.fields.find((f) => f.name === field)?.values?.find((v) => v.text === value)?.n ?? 0;
          const filled = (field: string | null) => (field ? l.fields.find((f) => f.name === field)?.filled ?? 0 : 0);
          return (
            <div className="card" key={l.list.id}>
              <div className="chead">
                <h2>{l.list.name}</h2>
                <span className="lbl">
                  {l.vehicleName} · {m.role === 'history' ? 'history — not translated' : 'pipeline'} ·{' '}
                  {m.reviewed ? 'reviewed' : 'not reviewed yet'}
                </span>
              </div>
              {m.stage.length === 0 ? (
                <div className="cbody">No stage or status field found on this list.</div>
              ) : (
                <table className="list">
                  <thead><tr><th>Affinity says</th><th>Entries</th><th>Means here</th><th>Claims</th></tr></thead>
                  <tbody>
                    {m.stage.map((src, si) => (
                      <Fragment key={src.field}>
                        <tr>
                          <td colSpan={4} className="lbl" style={{ paddingTop: 12 }}>
                            {si === 0 ? 'Read first' : 'Then, where that is empty'}: {src.field}
                          </td>
                        </tr>
                        {Object.entries(src.values).map(([value, vm]) => {
                          const st = stageOf(vm?.stage);
                          return (
                            <tr key={`${src.field}:${value}`}>
                              <td>{value}</td>
                              <td className="mono">{n(count(src.field, value))}</td>
                              <td><Meaning m={vm} /></td>
                              <td className="muted" style={{ fontSize: 12 }}>{st?.claims ? RUNG_LABEL[st.claims] : '—'}</td>
                            </tr>
                          );
                        })}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              )}
              <div className="cbody" style={{ borderTop: '1px solid var(--hair)' }}>
                {([
                  ['Commitment — soft until countersigned', m.commitment],
                  ['Soft circle, as a range', m.softRange ? `${m.softRange[0]} – ${m.softRange[1]}` : null],
                  ['Their typical check', m.checkSize],
                  ['Their AUM — a claim to verify', m.aum],
                  ['Owner', m.owner],
                  ['Introduced by — tier C until reviewed', m.introducer],
                  ['Do not contact', m.doNotContact],
                  ['Why they passed', m.passReason],
                ] as Array<[string, string | null]>).map(([label, f]) => (
                  <div className="fact" key={label}>
                    <span>{label}</span>
                    <span>{f ? <>{f} <span className="muted">· filled on {n(m.softRange && label.startsWith('Soft') ? filled(m.softRange[1]) : filled(f))}</span></> : <span className="muted">not on this list</span>}</span>
                  </div>
                ))}
              </div>
            </div>
          );
        })
      )}

      {map.exists && (
        <div className="card">
          <div className="chead"><h2>The file</h2><span className="lbl mono">{map.path}</span></div>
          <div className="cbody">
            <div className="fact"><span>Status words with a meaning</span><span>{n(map.mapped)} of {n(map.values)}</span></div>
            {map.problems.length > 0 && (
              <div className="warn" style={{ margin: '10px 0', fontSize: 12.5 }}>
                <b>{map.problems.length === 1 ? 'A problem' : `${map.problems.length} problems`} in the file:</b>
                <ul style={{ margin: '6px 0 0' }}>{map.problems.slice(0, 10).map((p) => <li key={p}>{p}</li>)}</ul>
              </div>
            )}
            <form action={writeMappingAction} style={{ marginTop: 10 }}>
              <button className="btn" type="submit">Regenerate, keeping your edits</button>
              <span className="muted" style={{ fontSize: 12, marginLeft: 10 }}>New words are proposed; every word already there keeps its meaning.</span>
            </form>
            {map.text && (
              <details className="sheet">
                <summary>Show the file</summary>
                <pre>{map.text}</pre>
              </details>
            )}
          </div>
        </div>
      )}
    </Page>
  );
}
