import Link from '@/components/ui/AppLink';
import { Page } from '@/components/shell/Page';
import { docHref, listSystemDocs } from '@/lib/docs';
import { SECTION } from '@/lib/nav';

export const dynamic = 'force-dynamic';

export default async function Docs() {
  const docs = await listSystemDocs();
  return <Page crumbs={[{ label: SECTION.developer }, { label: 'Docs' }]}>
    <div className="lbl">Developer</div>
    <h1>Docs</h1>
    <p className="sublede">The system’s plan, architecture and working rules. Start with the agent guide and the current plan; the numbered research follows.</p>
    <p className="note">For what shipped, read the <Link href="/dev/changelog">Changelog</Link>.</p>
    <ol className="doc-index">
      {docs.map((doc) => <li key={doc.slug}>
        <Link href={docHref(doc.slug)}><strong>{doc.title}</strong><span className="mono">{doc.file}</span></Link>
        {doc.superseded && <Link className="doc-superseded" href={docHref('docs-13-synthesis-r3')}>Superseded by 13</Link>}
      </li>)}
    </ol>
  </Page>;
}
