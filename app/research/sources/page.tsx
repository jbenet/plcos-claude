import Link from '@/components/ui/AppLink';
import { Page } from '@/components/shell/Page';
import { SECTION } from '@/lib/nav';
import { corpusCoverage, listSourceDocs, snapshotCount } from '@/modules/research';
import { shortDate } from '@/lib/time';

export const dynamic = 'force-dynamic';

export default async function Sources() {
  const [docs, coverage, snapshots] = await Promise.all([listSourceDocs(), corpusCoverage(), snapshotCount()]);

  return (
    <Page
      crumbs={[
        { label: SECTION.other },
        { label: 'Research corpus', href: '/research' },
        { label: 'Every source document' },
      ]}
      inspector={
        <>
          <div className="lbl">Two kinds of copy</div>
          <div className="ihead">Cache is not snapshot</div>
          <div className="imeta">research.read_cache · research.snapshot</div>
          <div className="kv">
            <span>Cache exists for</span>
            <span>latency and quota</span>
          </div>
          <div className="kv">
            <span>Cache guarantee</span>
            <span>none</span>
          </div>
          <div className="kv">
            <span>Snapshot exists for</span>
            <span>explaining an output</span>
          </div>
          <div className="kv">
            <span>Snapshots stored</span>
            <span>{snapshots}</span>
          </div>
          <div className="scope">
            <div className="lbl">Why they are separate tables</div>
            <p>
              Collapsing them into &ldquo;raw JSON we keep&rdquo; is how a six-week-old copy gets
              read as the current state of a CRM. A snapshot is labelled non-authoritative
              wherever it is rendered; a cache is never rendered as history.
            </p>
          </div>
          <div className="note">
            No connector has written to either yet. The rows that exist were written by the seed
            so the distinction is visible before it matters.
          </div>
        </>
      }
    >
      <div className="lbl">
        <Link href="/research">← Research &amp; enrichment</Link>
      </div>
      <h1 style={{ marginTop: 8 }}>The corpus</h1>
      <p className="sublede">
        Eleven documents of deliberately varying evidentiary strength, covering{' '}
        {coverage.from ? shortDate(coverage.from) : '—'} to {coverage.to ? shortDate(coverage.to) : '—'}. Each
        one states what it can support. Two of them exist specifically to be misread — a
        co-attendance list and a CSV of unknown provenance — because a corpus with no weak
        evidence in it does not test anything.
      </p>

      {docs.map((d) => (
        <div className="card" key={d.docId}>
          <div className="chead">
            <h2>
              <span className="mono" style={{ fontSize: 13, color: 'var(--clay)', marginRight: 8 }}>
                {d.docId}
              </span>
              {d.title}
            </h2>
            <span className={`strength st-${d.strength}`}>{d.strength}</span>
          </div>
          <div className="cbody">
            <p style={{ color: 'var(--muted)' }}>{d.body}</p>
            <div className="fact">
              <span>Origin</span>
              <span>{d.origin}</span>
            </div>
            <div className="fact">
              <span>As of</span>
              <span>{shortDate(d.asOf)}</span>
            </div>
            <div className="fact">
              <span>Kind</span>
              <span className="mono" style={{ fontSize: 11.5 }}>
                {d.kind}
              </span>
            </div>
          </div>
          <div className="cover">
            <b>Supports:</b> {d.supports}
          </div>
        </div>
      ))}
    </Page>
  );
}
