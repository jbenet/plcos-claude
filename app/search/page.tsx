import { coalescePage } from '@/lib/page-render';
import Link from '@/components/ui/AppLink';
import { Page } from '@/components/shell/Page';
import { EntityLink } from '@/components/entity/EntityLink';
import { EntitySummary } from '@/components/entity/EntitySummary';
import { searchEntities } from '@/modules/identity';
import { moduleHref, OVERVIEW_SECTION, STATIC_SECTIONS, VEHICLE_MODULES } from '@/lib/nav';

export const dynamic = 'force-dynamic';

const LIMIT = 100;

/**
 * Search everything (issue 0135): where the top bar's search goes once its context chip is dropped. Names on our
 * records (people and organisations, merged records followed) and the app's own pages. It says what it searched.
 */
async function Search({ searchParams }: { searchParams: Promise<{ q?: string; e?: string }> }) {
  const { q: raw, e } = await searchParams;
  const q = (raw ?? '').trim().slice(0, 120);
  const needle = q.toLowerCase();
  const entities = q ? await searchEntities(q, LIMIT) : [];
  const links = [...OVERVIEW_SECTION.links, ...STATIC_SECTIONS.flatMap((s) => s.links)]
    .map((l) => ({ label: l.label, href: l.href }))
    .concat(VEHICLE_MODULES.map((m) => ({ label: m.title, href: moduleHref(m, null) })));
  const pages = q ? [...new Map(links.filter((l) => l.label.toLowerCase().includes(needle)).map((l) => [l.href, l])).values()] : [];

  return (
    <Page
      crumbs={[{ label: 'Search' }]}
      inspector={e ? <EntitySummary entityId={e} /> : (
        <>
          <div className="lbl">What this searches</div>
          <p>Names of people and organisations on our records, and the app&rsquo;s pages. A name not found here is not on our records; it may still exist.</p>
          <div className="note">On a list with its own search, such as Network&rsquo;s groups or Routes, the top bar searches that list first.</div>
        </>
      )}
    >
      <div className="lbl">Search</div>
      <h1>{q ? <>&ldquo;{q}&rdquo;</> : 'Search'}</h1>
      <form className="listsearch" role="search" action="/search" method="get">
        <input type="search" name="q" defaultValue={q} placeholder="Search names and pages" aria-label="Search names and pages" />
        <button className="btn" type="submit">Search</button>
      </form>
      {!q ? <p className="muted">Type a name or a page.</p> : <>
        {pages.length > 0 && <div className="card">
          <div className="chead"><h2>Pages</h2><span className="lbl">{pages.length}</span></div>
          <div className="cbody">{pages.map((p) => <div key={p.href}><Link href={p.href}>{p.label}</Link></div>)}</div>
        </div>}
        <div className="card">
          <div className="chead">
            <h2>Names</h2>
            <span className="lbl">{entities.length === LIMIT ? `the first ${LIMIT}` : entities.length} · names starting with it first</span>
          </div>
          <div className="cbody">
            {entities.length === 0 ? <p className="muted" style={{ margin: 0 }}>No name on our records contains &ldquo;{q}&rdquo;.</p>
              : entities.map((x) => <div key={x.entityId} style={{ marginBottom: 4 }}>
                <EntityLink id={x.entityId} name={x.displayName} keep={{ q }} /> <span className="muted" style={{ fontSize: 12 }}>{x.entityType === 'person' ? 'person' : 'organisation'}</span>
              </div>)}
            {entities.length === LIMIT && <p className="muted" style={{ marginBottom: 0 }}>More match. <Link href={`/orgs/g/all?q=${encodeURIComponent(q)}`}>Search Everyone</Link> to page through them all, with what each is to us.</p>}
          </div>
        </div>
      </>}
    </Page>
  );
}

export default coalescePage('/search', Search);
