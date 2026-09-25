import { notFound } from 'next/navigation';
import Link from '@/components/ui/AppLink';
import { Page } from '@/components/shell/Page';
import { SystemDocBody, documentBlocks } from '@/components/dev/SystemDoc';
import { docHref, listSystemDocs, readSystemDoc } from '@/lib/docs';
import { SECTION } from '@/lib/nav';

export const dynamic = 'force-dynamic';

export default async function Doc({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const source = await readSystemDoc(slug);
  if (source === null) notFound();
  const docs = await listSystemDocs();
  const doc = docs.find((item) => item.slug === slug);
  if (!doc) notFound();
  const headings = documentBlocks(source).filter((block) => block.kind === 'heading');
  return <Page
    crumbs={[{ label: SECTION.developer }, { label: 'Docs', href: '/dev/docs' }, { label: doc.title }]}
    inspector={<>
      <div className="lbl">In this document</div>
      <nav className="doc-contents" aria-label="Document contents">
        {headings.map((heading) => <a key={heading.id} href={`#${heading.id}`}>{heading.text}</a>)}
      </nav>
    </>}
  >
    <div className="doc-toolbar"><Link href="/dev/docs">← All docs</Link><span className="mono">{doc.file}</span></div>
    {doc.superseded && <p className="scope">This plan is superseded by <Link href={docHref('docs-13-synthesis-r3')}>13 — the current plan</Link>.</p>}
    <SystemDocBody source={source} file={doc.file} docs={docs} />
  </Page>;
}
