import Link from '@/components/ui/AppLink';
import { Page } from '@/components/shell/Page';
import { SECTION } from '@/lib/nav';
import { config } from '@/config/deployment';
import { ago, shortDate } from '@/lib/time';
import { affinityReady } from '@/lib/connectors/affinity';
import { discovered, initForMatching } from '@/lib/connectors/affinity/discover';
import { matchLists, matchTeam, spvCandidates } from '@/lib/connectors/affinity/match';
import { runDiscovery } from '../actions';

export const dynamic = 'force-dynamic';

const TYPE: Record<string, string> = { company: 'Organizations', opportunity: 'Opportunities', person: 'People' };

export default async function AffinityLists() {
  const demo = config.data.profile === 'demo';
  const ready = affinityReady();
  const [found, init] = await Promise.all([discovered(), initForMatching()]);
  const { run, lists, fields, users } = found;
  const matches = init ? matchLists(init, lists) : [];
  const spvs = spvCandidates(lists, matches);
  const team = init ? matchTeam(init, users) : [];
  const fieldsOf = (id: number) => fields.filter((f) => f.listId === id);
  const claimedBy = new Map(matches.filter((m) => m.list).map((m) => [m.list!.id, m.vehicleName]));
  const unmatched = matches.filter((m) => !m.list).length;

  return (
    <Page
      crumbs={[{ label: SECTION.developer }, { label: 'Affinity', href: '/dev/affinity' }, { label: 'Lists' }]}
      inspector={
        <>
          <div className="lbl">What discovery reads</div>
          <div className="ihead">Names and fields, not people</div>
          <div className="imeta">One request per list, plus a few</div>
          <div className="scope">
            <div className="lbl">Not an entry in sight</div>
            <p>
              Discovery reads each list&rsquo;s name, type and fields, and the account&rsquo;s users.
              It reads no list entries, so nothing here is about a single LP. That comes with the
              first slice, once the lists below are the right ones.
            </p>
          </div>
          <div className="scope">
            <div className="lbl">Matched means matched</div>
            <p>
              A name matches when it is the same once case, spacing and the kind of dash are set
              aside. Anything looser is shown as a suggestion and imports nothing until the init
              file says the list&rsquo;s exact name.
            </p>
          </div>
          <div className="note">Everything here landed raw in <code>sources.raw_record</code>; re-running discovery stores only what changed.</div>
        </>
      }
    >
      <div className="lbl"><Link href="/dev/affinity">Affinity</Link> · <Link href="/dev/affinity/slice">First slice →</Link></div>
      <h1>Lists in Affinity</h1>
      <p className="sublede">
        What the key can see, against what the init file asks for. The questions about which
        field means stage, owner or amount start from the fields listed here.
      </p>

      {demo && (
        <div className="scope" style={{ marginBottom: 14 }}>
          <div className="lbl">Demo</div>
          <p>
            A fake Affinity from <code>fixtures/affinity/</code>, matched against{' '}
            <code>fixtures/affinity/init.demo.jsonc</code> — list names written the way people
            write them, so the matching has something to do.
          </p>
        </div>
      )}

      <div className="card">
        <div className="chead">
          <h2>Discovery</h2>
          <span className="lbl">
            {run ? `${run.status === 'ok' ? 'last run' : run.status} ${ago(run.startedAt)}${run.runByName ? ` · ${run.runByName}` : ''}` : 'never run'}
          </span>
        </div>
        <div className="cbody">
          <form action={runDiscovery}>
            <button className="btn p" type="submit" disabled={!ready.ready}>
              {run ? 'Discover again' : 'Discover lists'}
            </button>
            <span className="muted" style={{ fontSize: 12, marginLeft: 10 }}>
              {ready.ready ? 'Lists, their fields and the account’s users. No entries.' : ready.why}
            </span>
          </form>
          {run && (
            <div style={{ marginTop: 14 }}>
              <div className="fact"><span>Result</span><span>{run.note ?? '—'}</span></div>
              <div className="fact"><span>Pages read</span><span>{run.requests}</span></div>
              <div className="fact">
                <span>Records</span>
                <span>{run.records} seen · {run.newRecords} new or changed since the last run</span>
              </div>
              {run.status === 'failed' && (
                <div className="warn" style={{ marginTop: 10, fontSize: 12.5 }}>
                  <b>Stopped before the end.</b> What it landed before stopping is below, and is
                  not the whole account.
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {init && (
        <div className="card">
          <div className="chead">
            <h2>What the init file asks for</h2>
            <span className="lbl">
              {matches.length ? `${matches.length - unmatched} of ${matches.length} matched` : 'no list names given'}
            </span>
          </div>
          {matches.length === 0 ? (
            <div className="cbody">The init file names no Affinity lists yet.</div>
          ) : (
            <table className="list">
              <thead><tr><th>Vehicle</th><th>The file says</th><th>In Affinity</th></tr></thead>
              <tbody>
                {matches.map((m) => (
                  <tr key={`${m.vehicleSlug}:${m.wanted}`}>
                    <td><b>{m.vehicleName}</b></td>
                    <td className="mono" style={{ fontSize: 12 }}>{m.wanted}</td>
                    <td>
                      {m.list ? (
                        <>
                          <span className="flag f-ok">matched</span>{' '}
                          {m.list.name} <span className="muted">· {TYPE[m.list.type]} · {fieldsOf(m.list.id).length} fields</span>
                        </>
                      ) : lists.length === 0 ? (
                        <span className="muted">Not checked — run discovery first.</span>
                      ) : (
                        <>
                          <span className="flag f-block">no list by that name</span>
                          {m.closest ? (
                            <span className="muted">
                              {' '}Closest: <b>{m.closest.list.name}</b>. Not used until the file says so.
                            </span>
                          ) : (
                            <span className="muted"> Nothing close.</span>
                          )}
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="cover">
            <b>Coverage:</b> {lists.length ? `the ${lists.length} lists this key can see` : 'nothing yet'}.
            A list the key&rsquo;s owner cannot see in Affinity is not in this set, and reads here
            as &ldquo;no list by that name&rdquo; rather than &ldquo;no such list&rdquo;.
          </p>
        </div>
      )}

      {spvs.length > 0 && (
        <div className="card">
          <div className="chead">
            <h2>SPV lists no vehicle claims</h2>
            <span className="lbl">{spvs.length} candidates</span>
          </div>
          <div className="cbody">
            <p style={{ margin: '0 0 10px', fontSize: 13 }}>
              Each of these says SPV in its name. To import one, add a vehicle for it to the init
              file with this exact list name, and say which, if any, is 506(b).
            </p>
            {spvs.map((l) => (
              <div className="fact" key={l.id}>
                <span>{l.name}</span>
                <span className="muted">{TYPE[l.type]} · {fieldsOf(l.id).length} fields · {l.isPublic ? 'shared' : 'private'}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {init && team.length > 0 && (
        <div className="card">
          <div className="chead">
            <h2>The team, in Affinity</h2>
            <span className="lbl">{users.length} Affinity users seen</span>
          </div>
          <table className="list">
            <tbody>
              {team.map((t) => (
                <tr key={t.handle}>
                  <td><b>{t.name}</b> <span className="muted mono" style={{ fontSize: 11 }}>{t.handle}</span></td>
                  <td>
                    {t.user ? (
                      <>
                        <span className={`flag ${t.via === 'affinityEmail' ? 'f-ok' : 'f-mute'}`}>
                          {t.via === 'affinityEmail' ? 'matched' : 'probably'}
                        </span>{' '}
                        {[t.user.firstName, t.user.lastName].filter(Boolean).join(' ')} · {t.user.primaryEmailAddress}
                        {t.via === 'email' && <span className="muted"> — by their email; set affinityEmail to confirm</span>}
                      </>
                    ) : users.length === 0 ? (
                      <span className="muted">Not checked — run discovery first.</span>
                    ) : (
                      <span className="muted">No Affinity user with that address.</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="card">
        <div className="chead">
          <h2>Every list</h2>
          <span className="lbl">{lists.length} lists · {fields.length} fields</span>
        </div>
        {lists.length === 0 ? (
          <div className="cbody">Nothing discovered yet.</div>
        ) : (
          <table className="list">
            <thead><tr><th>List</th><th>Holds</th><th>Fields</th><th>Vehicle</th><th>Created</th></tr></thead>
            <tbody>
              {lists.map((l) => {
                const fs = fieldsOf(l.id);
                return (
                  <tr key={l.id}>
                    <td>
                      <b>{l.name}</b>
                      {!l.isPublic && <span className="flag f-mute" style={{ marginLeft: 6 }}>private</span>}
                    </td>
                    <td className="muted">{TYPE[l.type]}</td>
                    <td>
                      <details>
                        <summary>{fs.length}</summary>
                        <div className="fieldlist">
                          {fs.map((f) => (
                            <span key={f.id} title={`${f.type}${f.enrichmentSource ? ` · ${f.enrichmentSource}` : ''}`}>
                              {f.name} <i>{f.valueType}</i>
                            </span>
                          ))}
                        </div>
                      </details>
                    </td>
                    <td>{claimedBy.get(l.id) ?? <span className="muted">—</span>}</td>
                    <td className="muted">{shortDate(new Date(l.createdAt))}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </Page>
  );
}
