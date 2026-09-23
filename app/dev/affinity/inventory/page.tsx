import Link from 'next/link';
import { Page } from '@/components/shell/Page';
import { SECTION } from '@/lib/nav';
import { config } from '@/config/deployment';
import { inventory, type FieldStat } from '@/lib/connectors/affinity/inventory';
import { readAnswers } from '@/lib/connectors/affinity/answers';
import { compareLists } from '@/lib/connectors/affinity/compare';
import { writeAnswerSheetAction, writeComparisonAction, writeInventoryReport } from '../actions';

export const dynamic = 'force-dynamic';

const n = (x: number) => x.toLocaleString('en-US');
const TYPE: Record<string, string> = { company: 'organizations', opportunity: 'opportunities', person: 'people' };

function What({ f }: { f: FieldStat }) {
  if (f.withheld) {
    return <span className="muted">{n(f.withheld.distinct)} distinct values that look like names — not shown here</span>;
  }
  if (f.values) {
    const shown = f.values.slice(0, 12);
    return (
      <span>
        {shown.map((v, i) => (
          <span key={v.text} className="valchip">{v.text} <i>{n(v.n)}</i>{i < shown.length - 1 ? '' : ''}</span>
        ))}
        {f.values.length > shown.length && <span className="muted"> +{f.values.length - shown.length} more</span>}
      </span>
    );
  }
  if (f.team) {
    return (
      <span>
        {f.team.slice(0, 8).map((t) => <span key={t.name} className="valchip">{t.name} <i>{n(t.n)}</i></span>)}
        {!!f.outside && <span className="muted"> · {n(f.outside)} outside people</span>}
      </span>
    );
  }
  if (f.range) return <span>{f.range.from} → {f.range.to}{f.range.future ? <span className="muted"> · {n(f.range.future)} still ahead</span> : null}</span>;
  if (f.numbers) {
    return (
      <span>
        median {n(f.numbers.median)} · {n(f.numbers.min)} to {n(f.numbers.max)}
        <span className="muted"> · not summed</span>
      </span>
    );
  }
  if (f.recency) {
    const r = f.recency;
    return <span>≤30 days {n(r.d30)} · ≤90 {n(r.d90)} · ≤1 year {n(r.d365)} · older {n(r.older)}</span>;
  }
  return <span className="muted">{f.filled ? 'filled; contents not shown' : ''}</span>;
}

export default async function Inventory() {
  const demo = config.data.profile === 'demo';
  const inv = await inventory();
  const [answers, compared] = await Promise.all([readAnswers(inv), compareLists()]);
  const landed = inv.lists.reduce((a, l) => a + l.entries, 0);

  return (
    <Page
      crumbs={[{ label: SECTION.developer }, { label: 'Affinity', href: '/dev/affinity' }, { label: 'Inventory' }]}
      inspector={
        <>
          <div className="lbl">What this page shows</div>
          <div className="ihead">Counts, not people</div>
          <div className="imeta">From what the slice landed</div>
          <div className="scope">
            <div className="lbl">Named here</div>
            <p>
              A dropdown&rsquo;s values, because they are the words a stage is written in. The
              team, because they own the rows. Nobody else: no LP, no text field&rsquo;s contents,
              no note&rsquo;s words.
            </p>
          </div>
          <div className="scope">
            <div className="lbl">Never summed</div>
            <p>
              An amount field is described — how many, the median, the range — and not added up.
              Nobody has said yet whether it holds an indication or a signature, and a total of
              an unknown is how a committed figure gets invented (rule 1).
            </p>
          </div>
          <div className="note">
            <form action={writeInventoryReport}>
              <button className="btn" type="submit">Write it to {config.data.root}/reports/</button>
            </form>
          </div>
        </>
      }
    >
      <div className="lbl">
        <Link href="/dev/affinity">Affinity</Link> · <Link href="/dev/affinity/slice">First slice</Link>
      </div>
      <h1>What is in the slice</h1>
      <p className="sublede">
        {n(landed)} entries on {inv.lists.length} lists, described field by field. The questions
        at the top are the ones only you can answer; the translation into this tool&rsquo;s model
        waits for them.
      </p>

      {demo && (
        <div className="scope" style={{ marginBottom: 14 }}>
          <div className="lbl">Demo</div>
          <p>Invented entries from <code>fixtures/affinity/</code>.</p>
        </div>
      )}

      <div className="card">
        <div className="chead">
          <h2>Questions, round two</h2>
          <span className="lbl">{inv.questions.length} for you</span>
        </div>
        {inv.questions.length === 0 ? (
          <div className="cbody">None yet — read the slice first.</div>
        ) : (
          <div className="cbody">
            <ol className="asks">{inv.questions.map((q) => <li key={q}>{q}</li>)}</ol>
          </div>
        )}
      </div>

      <div className="card">
        <div className="chead">
          <h2>Answer sheet</h2>
          <span className="lbl mono">{answers.path}</span>
        </div>
        <div className="cbody">
          <p style={{ margin: '0 0 10px', fontSize: 13 }}>
            The questions above, as blanks to fill: for each list, which field is the stage and
            which rung each of its values evidences, which amount means what, who owns the rows,
            and which field says do-not-contact. Every answer starts as null, and the suggestions
            are comments — a wrong default would be worse than a gap.
          </p>
          {answers.exists && (
            <>
              <div className="fact">
                <span>Answered</span>
                <span>{n(answers.answered)} of {n(answers.asked)}</span>
              </div>
              {answers.problems.length > 0 && (
                <div className="warn" style={{ margin: '10px 0', fontSize: 12.5 }}>
                  <b>{answers.problems.length === 1 ? 'A problem' : `${answers.problems.length} problems`} in the file:</b>
                  <ul style={{ margin: '6px 0 0' }}>{answers.problems.slice(0, 8).map((p) => <li key={p}>{p}</li>)}</ul>
                </div>
              )}
            </>
          )}
          <form action={writeAnswerSheetAction} style={{ marginTop: 10 }}>
            <button className="btn p" type="submit" disabled={landed === 0}>
              {answers.exists ? 'Regenerate it, keeping your answers' : 'Write the answer sheet'}
            </button>
          </form>
          {answers.text && (
            <details className="sheet">
              <summary>Show the file</summary>
              <pre>{answers.text}</pre>
            </details>
          )}
        </div>
      </div>

      {compared.length > 0 && (
        <div className="card">
          <div className="chead">
            <h2>Older lists, against the one in use</h2>
            <span className="lbl">who would be lost if the old list were retired</span>
          </div>
          <div className="cbody">
            {compared.map((c) => (
              <div key={c.secondary} style={{ marginBottom: 12 }}>
                <div className="fact">
                  <span>“{c.secondary}” against “{c.primary}”</span>
                  <span>{n(c.total)} entries</span>
                </div>
                <div className="fact"><span>Already there — the same person</span><span>{n(c.byPerson)}</span></div>
                <div className="fact"><span>Already there — the same organization</span><span>{n(c.byOrganization)}</span></div>
                <div className="fact"><span><b>Not on the list in use</b></span><span><b>{n(c.missing.length)}</b>{c.missing.length ? ` · ${Object.entries(c.missing.reduce((m: Record<string, number>, u) => ((m[u.status ?? '—'] = (m[u.status ?? '—'] ?? 0) + 1), m), {})).map(([s, k]) => `${s} ${k}`).join(' · ')}` : ''}</span></div>
                <div className="fact"><span>Linked to nobody — to match by hand</span><span>{n(c.unlinked.length)}</span></div>
              </div>
            ))}
            <form action={writeComparisonAction}>
              <button className="btn" type="submit">Write the names to {config.data.root}/reports/</button>
              <span className="muted" style={{ fontSize: 12, marginLeft: 10 }}>Candidates to move across. Nothing is moved.</span>
            </form>
          </div>
        </div>
      )}

      {inv.overlap.length > 0 && (
        <div className="card">
          <div className="chead">
            <h2>On more than one list</h2>
            <span className="lbl">to coordinate across vehicles, not to compete over</span>
          </div>
          <div className="cbody">
            {inv.overlap.map((o) => (
              <div className="fact" key={`${o.a}|${o.b}`}>
                <span>{o.a} · {o.b}</span>
                <span>{n(o.n)} {o.kind === 'person' ? 'people' : 'entries'}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {inv.notes && (
        <div className="card">
          <div className="chead">
            <h2>Notes</h2>
            <span className="lbl">{n(inv.notes.notes)} notes · {n(inv.notes.entities)} entries</span>
          </div>
          <div className="cbody">
            <div className="fact"><span>Mention health</span><span>{n(inv.notes.health)} — flagged, never shown, never copied into anything derived</span></div>
            <div className="fact"><span>By year</span><span>{inv.notes.byYear.map((y) => `${y.year}: ${n(y.n)}`).join(' · ')}</span></div>
            <div className="fact"><span>By author</span><span>{inv.notes.byAuthor.map((a) => `${a.name} ${n(a.n)}`).join(' · ')}</span></div>
          </div>
        </div>
      )}

      {inv.relationships && (
        <div className="card">
          <div className="chead">
            <h2>Relationships to the team</h2>
            <span className="lbl">Affinity&rsquo;s interaction score · tier C until a person confirms</span>
          </div>
          <div className="cbody">
            <div className="fact">
              <span>People with a score to someone on the team</span>
              <span>{n(inv.relationships.withTeam)} of {n(inv.relationships.people)}</span>
            </div>
            <div className="fact">
              <span>Bands</span>
              <span>{n(inv.relationships.bands.regular)} regular · {n(inv.relationships.bands.occasional)} occasional · {n(inv.relationships.bands.sporadic)} sporadic</span>
            </div>
            {inv.relationships.byTeam.slice(0, 10).map((t) => (
              <div className="fact" key={t.name}>
                <span>{t.name}</span>
                <span>{n(t.regular)} regular · {n(t.occasional)} occasional · {n(t.sporadic)} sporadic</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {inv.lists.map((l) => {
        const filled = l.fields.filter((f) => f.filled > 0);
        const empty = l.fields.filter((f) => f.filled === 0);
        return (
          <div className="card" key={l.list.id}>
            <div className="chead">
              <h2>{l.list.name}</h2>
              <span className="lbl">
                {l.vehicleName ?? 'says SPV'} · {n(l.entries)} {TYPE[l.list.type]}{l.repeated ? ` · ${l.repeated} repeated` : ''}
              </span>
            </div>
            {l.entries === 0 ? (
              <div className="cbody">Nothing landed from this list.</div>
            ) : (
              <table className="list inv">
                <thead><tr><th>Field</th><th>Kind</th><th>Filled</th><th>What is in it</th></tr></thead>
                <tbody>
                  {filled.map((f) => {
                    const pct = Math.round((f.filled / Math.max(1, f.of)) * 100);
                    return (
                      <tr key={f.id}>
                        <td><b>{f.name}</b>{f.fieldType === 'list' && <span className="flag f-mute" style={{ marginLeft: 6 }}>list</span>}</td>
                        <td className="mono muted" style={{ fontSize: 11 }}>{f.valueType}</td>
                        <td style={{ width: 120 }}>
                          <div className="mono" style={{ fontSize: 11.5 }}>{pct}% <span className="muted">· {n(f.filled)}</span></div>
                          <div className="bbar" style={{ marginTop: 3 }}><i style={{ width: `${pct}%` }} /></div>
                        </td>
                        <td style={{ fontSize: 12 }}><What f={f} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
            {empty.length > 0 && (
              <p className="cover">
                <b>Empty on every entry ({empty.length}):</b> {empty.map((f) => f.name).join(', ')}.
              </p>
            )}
          </div>
        );
      })}
    </Page>
  );
}
