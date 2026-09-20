import Link from 'next/link';
import { Page } from '@/components/shell/Page';
import { Coverage } from '@/components/ui/Coverage';
import { listEntities } from '@/modules/identity';
import { claimCounts, corpusCoverage, listSourceDocs, unverifiedCount, weaklySupportedCount } from '@/modules/research';
import { listSyncSources } from '@/modules/platform';
import { shortDate } from '@/lib/time';

export const dynamic = 'force-dynamic';

const TYPE_LABEL: Record<string, string> = {
  person: 'Person', org: 'Organisation', family: 'Family office',
  foundation: 'Foundation', vehicle: 'Vehicle',
};

export default async function Research() {
  const [entities, counts, coverage, docs, unverified, weak, sources] = await Promise.all([
    listEntities(),
    claimCounts(),
    corpusCoverage(),
    listSourceDocs(),
    unverifiedCount(),
    weaklySupportedCount(),
    listSyncSources(),
  ]);

  const notInspected = sources
    .filter((s) => s.status === 'not_connected' && s.source !== 'seed')
    .map((s) => ({ source: s.label, why: s.detail ?? 'not connected' }));

  return (
    <Page
      crumbs={[{ label: 'Discover & qualify' }, { label: 'Research & enrichment' }]}
      inspector={
        <>
          <div className="lbl">Corpus</div>
          <div className="ihead">{coverage.documents} source documents</div>
          <div className="imeta">
            {coverage.from ? shortDate(coverage.from) : '—'} to {coverage.to ? shortDate(coverage.to) : '—'}
          </div>
          {coverage.byStrength.map((b) => (
            <div className="kv" key={b.strength}>
              <span>{b.strength} evidence</span>
              <span>{b.n}</span>
            </div>
          ))}
          <div className="scope">
            <div className="lbl">What a document can support</div>
            <p>
              Every source carries a line stating what it does and does not establish.
              Co-attendance, shared affiliation and a public follow are discovery clues; they do
              not become a relationship by being cited confidently.
            </p>
          </div>
          <Link className="btn" href="/research/sources" style={{ display: 'block', textAlign: 'center', padding: 8 }}>
            Read the corpus
          </Link>
          <div className="note">
            {docs.filter((d) => d.strength === 'weak').length} of {docs.length} documents are weak
            evidence. They are kept, labelled, and never allowed to carry a claim on their own.
          </div>
        </>
      }
    >
      <div className="lbl">Module 01 · Discover &amp; qualify</div>
      <h1>Research &amp; enrichment</h1>
      <p className="sublede">
        The universe, and what we can actually support about each name in it. Every
        externally-sourced field carries four things — source, as of, confidence, and who last
        verified it. A field that cannot show all four is not rendered as a fact.
      </p>

      <div className="kpis">
        <div className="kpi">
          <span className="tag t-plain">Entities</span>
          <div className="n">{entities.length}</div>
          <div className="f">Surrogate ids, minted once. A merge redirects; ids are never reused.</div>
        </div>
        <div className="kpi">
          <span className="tag t-plain">Claims on file</span>
          <div className="n">{[...counts.values()].reduce((a, b) => a + b, 0)}</div>
          <div className="f">Each one carries a full provenance tuple or it does not exist.</div>
        </div>
        <div className="kpi">
          <span className="tag t-soft">Unverified</span>
          <div className="n">{unverified}</div>
          <div className="f">Nobody has put their name to these. They still show their source.</div>
        </div>
        <div className="kpi">
          <span className="tag t-soft">Weakly supported</span>
          <div className="n">{weak}</div>
          <div className="f">
            Rest on a weak document. Usable as a lead, never as the basis of a brief.
          </div>
        </div>
      </div>

      <div className="card">
        <div className="chead">
          <h2>The universe</h2>
          <span className="lbl">{entities.length} entities · seed corpus</span>
        </div>
        <table className="list">
          <thead>
            <tr>
              <th>Name</th>
              <th style={{ width: 130 }}>Type</th>
              <th style={{ width: 90 }} className="right">
                Claims
              </th>
              <th style={{ width: 220 }}>Standing</th>
            </tr>
          </thead>
          <tbody>
            {entities.map((e) => {
              const n = counts.get(e.entityId) ?? 0;
              return (
                <tr key={e.entityId} className="clickable">
                  <td>
                    <Link href={`/orgs/${e.entityId}`}>
                      <b>{e.displayName}</b>
                    </Link>
                  </td>
                  <td className="muted">{TYPE_LABEL[e.entityType]}</td>
                  <td className="right mono">{n || '—'}</td>
                  <td className="muted">
                    {n === 0 ? 'Nothing supported on file yet' : `${n} field${n === 1 ? '' : 's'} with provenance`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <Coverage
          corpus={`${coverage.documents} seed source documents`}
          from={coverage.from ? shortDate(coverage.from) : null}
          to={coverage.to ? shortDate(coverage.to) : null}
          notInspected={notInspected}
        />
      </div>
    </Page>
  );
}
