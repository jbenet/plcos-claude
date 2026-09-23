import Link from 'next/link';
import { Fragment } from 'react';
import { Page } from '@/components/shell/Page';
import { SECTION } from '@/lib/nav';
import { config } from '@/config/deployment';
import { inventory } from '@/lib/connectors/affinity/inventory';
import { readMapping, type ValueMap } from '@/lib/connectors/affinity/mapping';
import { normName } from '@/lib/connectors/affinity/match';
import {
  IMPLIED, IMPLIED_LABEL, PASSED_BY_LABEL, RUNG_LABEL, STATUSES, STATUS_LABEL, impliedRung,
} from '@/modules/strategy';
import { latestRun } from '@/modules/sources';
import { translateAction, writeMappingAction } from '../actions';

export const dynamic = 'force-dynamic';

const n = (x: number) => x.toLocaleString('en-US');
function Meaning({ m }: { m: ValueMap | null }) {
  if (!m) return <span className="flag f-block">needs a meaning</span>;
  if (m.skip) return <span className="muted">not an LP — not translated</span>;
  return (
    <span>
      {m.status ? <b>{STATUS_LABEL[m.status]}</b> : <span className="flag f-block">status unknown</span>}
      {m.status === 'passed' && (
        <span className="muted"> · {[m.passedBy ? PASSED_BY_LABEL[m.passedBy].toLowerCase() : null, m.reason?.replace('_', ' ')].filter(Boolean).join(', ')}</span>
      )}
      {m.next && <span className="flag f-mute" style={{ marginLeft: 6 }}>next step: {m.next}</span>}
      {!!m.implies?.length && <div className="muted" style={{ fontSize: 11.5 }}>says {m.implies.map((i) => IMPLIED_LABEL[i]).join(', ')}</div>}
    </span>
  );
}

export default async function Mapping() {
  const demo = config.data.profile === 'demo';
  const inv = await inventory();
  const map = await readMapping(inv);
  const translated = await latestRun('affinity', 'translate');
  const tc = (translated?.detail ?? {}) as { byVehicle?: Record<string, number>; byStatus?: Record<string, number>; keptOurs?: number; unreviewedLists?: string[]; ownersNotOnTeam?: number; readyToHarden?: number; affiliations?: number; people?: number; organizations?: number; skipped?: number };
  const lists = inv.lists.filter((l) => l.why === 'init' && l.entries > 0);

  return (
    <Page
      crumbs={[{ label: SECTION.developer }, { label: 'Affinity', href: '/dev/affinity' }, { label: 'Mapping' }]}
      inspector={
        <>
          <div className="lbl">Status, and what the word says happened</div>
          <div className="ihead">One field, taken apart</div>
          <div className="imeta">Affinity&rsquo;s status, read into ours (docs/17)</div>
          <div className="scope">
            <div className="lbl">Why apart</div>
            <p>
              The team used one status to slice a board, so it carries where the effort is, what
              has happened, whether it ended, and why. Here the effort is one of six statuses;
              what happened is kept as the word&rsquo;s claim, beside the dated log; an ending keeps
              who and why.
            </p>
          </div>
          <div className="scope">
            <div className="lbl">A word claims; it does not prove</div>
            <p>
              &ldquo;Two meetings held&rdquo; claims a meeting was held. The ladder moves only on
              evidence, and the LP&rsquo;s page shows the claim beside it. A word that says signed
              marks money ready to harden; only the close room&rsquo;s countersignature hardens it.
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
        Our six statuses, and what each of Affinity&rsquo;s status words means in them. The
        mapping is a file you can edit; every translation re-reads it, so a correction is an
        edit and a re-run, never another request to Affinity.
      </p>

      {demo && (
        <div className="scope" style={{ marginBottom: 14 }}>
          <div className="lbl">Demo</div>
          <p>The fake Affinity&rsquo;s status words, mapped the same way the real ones are.</p>
        </div>
      )}

      <div className="grid-even">
        <div className="card">
          <div className="chead">
            <h2>Our statuses</h2>
            <span className="lbl">six · where our effort is</span>
          </div>
          <table className="list">
            <tbody>
              {STATUSES.map((s) => (
                <tr key={s.id}>
                  <td style={{ width: 110 }}><b>{s.label}</b></td>
                  <td style={{ fontSize: 12.5 }}>{s.means}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="cover">
            <b>Passed</b> keeps who ended it — they declined, we stopped, it went quiet — and why:
            thesis, timing, valuation, structure, concentration, diligence, mandate, no response,
            other. <b>On hold</b> is not a status: it is a next step on one.
          </p>
        </div>
        <div className="card">
          <div className="chead">
            <h2>What a word can say happened</h2>
            <span className="lbl">undated · a claim</span>
          </div>
          <table className="list">
            <thead><tr><th>Says</th><th>Would be evidence for</th></tr></thead>
            <tbody>
              {IMPLIED.map((x) => (
                <tr key={x.id}>
                  <td>{x.label} <span className="muted mono" style={{ fontSize: 11 }}>{x.id}</span></td>
                  <td className="muted" style={{ fontSize: 12 }}>{x.claims ? RUNG_LABEL[x.claims] : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="cover">
            Shown beside the LP&rsquo;s dated log and the ladder, and written into neither.
          </p>
        </div>
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
              {m.status.length === 0 ? (
                <div className="cbody">No stage or status field found on this list.</div>
              ) : (
                <table className="list">
                  <thead><tr><th>Affinity says</th><th>Entries</th><th>Means here</th><th>Claims, at most</th></tr></thead>
                  <tbody>
                    {m.status.map((src, si) => (
                      <Fragment key={src.field}>
                        <tr>
                          <td colSpan={4} className="lbl" style={{ paddingTop: 12 }}>
                            {si === 0 ? 'Read first' : 'Then, where that is empty'}: {src.field}
                          </td>
                        </tr>
                        {Object.entries(src.values).map(([value, vm]) => {
                          const claims = impliedRung(vm?.implies ?? []);
                          return (
                            <tr key={`${src.field}:${value}`}>
                              <td>{value}</td>
                              <td className="mono">{n(count(src.field, value))}</td>
                              <td><Meaning m={vm} /></td>
                              <td className="muted" style={{ fontSize: 12 }}>{claims ? RUNG_LABEL[claims] : '—'}</td>
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
          <div className="chead">
            <h2>Translate into the tool</h2>
            <span className="lbl">{translated ? `${translated.status} · ${translated.startedAt.toISOString().slice(0, 16).replace('T', ' ')} UTC` : 'never run'}</span>
          </div>
          <div className="cbody">
            <p style={{ margin: '0 0 10px', fontSize: 13 }}>
              The landed copy, read through this mapping, into pursuits, soft commitments, claims and
              do-not-approach instructions. Local — not one request to Affinity — and safe to run
              again: a mapping edit takes effect the next time.
            </p>
            <form action={translateAction}>
              <button className="btn p" type="submit" disabled={map.problems.length > 0}>
                {translated ? 'Translate again' : 'Translate'}
              </button>
              {map.problems.length > 0 && <span className="muted" style={{ fontSize: 12, marginLeft: 10 }}>Fix the mapping&rsquo;s problems first.</span>}
            </form>
            {translated && (
              <div style={{ marginTop: 14 }}>
                <div className="fact"><span>Result</span><span>{translated.note}</span></div>
                {tc.byVehicle && (
                  <div className="fact">
                    <span>Pursuits by vehicle</span>
                    <span>{Object.entries(tc.byVehicle).map(([v, k]) => `${v} ${n(k)}`).join(' · ')}</span>
                  </div>
                )}
                {tc.byStatus && (
                  <div className="fact">
                    <span>By status</span>
                    <span>{[...STATUSES.map((s) => s.id), 'unplaced'].filter((k) => tc.byStatus![k]).map((k) => `${k === 'unplaced' ? 'no status yet' : STATUS_LABEL[k as keyof typeof STATUS_LABEL]} ${n(tc.byStatus![k]!)}`).join(' · ')}</span>
                  </div>
                )}
                {!!tc.keptOurs && <div className="fact"><span>Set here, kept</span><span>{n(tc.keptOurs)} pursuits whose status a person set here — Affinity&rsquo;s word is beside it, not over it</span></div>}
                <div className="fact"><span>New people and organizations</span><span>{n(tc.people ?? 0)} · {n(tc.organizations ?? 0)}{tc.affiliations ? ` · ${n(tc.affiliations)} affiliations` : ''}</span></div>
                {!!tc.readyToHarden && <div className="fact"><span>Signed, per Affinity</span><span>{n(tc.readyToHarden)} ready to harden once countersigned — still soft</span></div>}
                {!!tc.ownersNotOnTeam && <div className="fact"><span>Owner not on the team</span><span>{n(tc.ownersNotOnTeam)} pursuits, kept under their name</span></div>}
                {!!tc.skipped && <div className="fact"><span>Not translated</span><span>{n(tc.skipped)} — not an LP, or an opportunity row</span></div>}
                {!!tc.unreviewedLists?.length && (
                  <p className="cover"><b>Read through a mapping nobody has reviewed yet:</b> {tc.unreviewedLists.join(', ')}. The pursuits say so.</p>
                )}
              </div>
            )}
          </div>
        </div>
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
