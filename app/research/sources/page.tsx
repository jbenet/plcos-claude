import { coalescePage } from '@/lib/page-render';
import Link from '@/components/ui/AppLink';
import { Page } from '@/components/shell/Page';
import { SECTION } from '@/lib/nav';
import { corpusCoverage, snapshotCount, sourceDocPage } from '@/lib/authz/read/research';
import { shortDate } from '@/lib/time';

export const dynamic = 'force-dynamic';

// The real corpus holds thousands of documents (17 MB of HTML on one page, 15 Oct 2026), so it is read a page at a time.
const PER_PAGE = 200;

async function Sources({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const asked = Math.floor(Number((await searchParams).page ?? 1));
  const page = Number.isFinite(asked) && asked > 1 ? asked : 1;
  const [{ docs, total }, coverage, snapshots] = await Promise.all([sourceDocPage((page - 1) * PER_PAGE, PER_PAGE), corpusCoverage(), snapshotCount()]);
  const first = (page - 1) * PER_PAGE;
  const pager = total > PER_PAGE && (
    <div className="lbl" style={{ margin: '12px 0', display: 'flex', gap: 16 }}>
      {page > 1 ? <Link href={page === 2 ? '/research/sources' : `/research/sources?page=${page - 1}`}>← Previous {PER_PAGE}</Link> : null}
      <span>
        {docs.length ? `${(first + 1).toLocaleString('en-US')}–${(first + docs.length).toLocaleString('en-US')}` : 'None'} of {total.toLocaleString('en-US')}
      </span>
      {first + docs.length < total ? <Link href={`/research/sources?page=${page + 1}`}>Next {PER_PAGE} →</Link> : null}
    </div>
  );

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
        {total === 11 ? 'Eleven' : total.toLocaleString('en-US')} documents of deliberately varying evidentiary strength, covering{' '}
        {coverage.from ? shortDate(coverage.from) : '—'} to {coverage.to ? shortDate(coverage.to) : '—'}. Each
        one states what it can support. Two of them exist specifically to be misread — a
        co-attendance list and a CSV of unknown provenance — because a corpus with no weak
        evidence in it does not test anything.
      </p>

      {pager}
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
      {pager}
    </Page>
  );
}

export default coalescePage('/research/sources', Sources);
