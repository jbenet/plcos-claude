import { notFound } from 'next/navigation';
import { coalescePage } from '@/lib/page-render';
import { changelogBatches, changelogBody, changelogItems, BATCH_SIZE } from '@/lib/changelog';
import Link from '@/components/ui/AppLink';
import { Page } from '@/components/shell/Page';
import { SECTION } from '@/lib/nav';
import { ShotLightbox } from '@/components/dev/ShotLightbox';
import { Blocks } from '@/components/dev/ChangelogBlocks';
import s from '../changelog.module.css';

export const dynamic = 'force-dynamic';

/** One changelog entry on its own page (issue 0098). Only a file named in the index opens. */
async function Entry({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const items = await changelogItems();
  const at = items.findIndex((i) => i.slug === slug);
  if (at < 0) notFound();
  const item = items[at]!;
  const { blocks, divider } = await changelogBody(item);
  const batches = changelogBatches(items);
  const batch = batches.find((b) => b.n === item.batch)!;
  const older = items[at - 1];
  const newer = items[at + 1];
  const batchHref = batch.latest ? '/dev/changelog' : `/dev/changelog?batch=${batch.n}`;

  return (
    <Page
      crumbs={[{ label: SECTION.developer }, { label: 'Changelog' }, { label: item.key || item.title }]}
      inspector={
        <>
          <div className="lbl">{batch.latest ? 'Latest batch' : `Batch ${batch.n}`}</div>
          <div className="ihead">{batch.range}</div>
          <div className="imeta">
            {batch.items.length} of {BATCH_SIZE} entries · <Link href={batchHref}>read the batch</Link>
          </div>
          <ul className={s.toc}>
            {[...batch.items].reverse().map((i) => (
              <li key={i.slug}>
                <Link href={`/dev/changelog/${i.slug}`} className={i.slug === slug ? s.here : undefined} aria-current={i.slug === slug ? 'page' : undefined}>
                  {i.key && <span className={s.k}>{i.key}</span>}
                  {i.title}
                </Link>
              </li>
            ))}
          </ul>
          <div className="note">
            Stored once, in <code>{item.file}</code>. Entry {item.n} of {items.length}, in the order of{' '}
            <code>docs/changelog/index.md</code>.
          </div>
        </>
      }
    >
      <ShotLightbox />
      <div className={s.entryhead}>
        <div className="lbl">
          <Link href="/dev/changelog">Changelog</Link> · <Link href={batchHref}>{batch.latest ? 'latest batch' : `batch ${batch.n}`}</Link>
          {item.key ? ` · ${item.key}` : ''}
        </div>
        <span className={s.file}>{item.file}</span>
      </div>
      <h1>{item.title}</h1>

      {divider ? (
        <div className={s.era}><Blocks blocks={blocks} /></div>
      ) : (
        <article className="card">
          <div className={`cbody ${s.body}`}>
            {blocks.length ? <Blocks blocks={blocks} /> : <p className="muted">This entry has a heading and nothing under it.</p>}
          </div>
        </article>
      )}

      <nav className={s.pager} aria-label="Older and newer entries">
        {newer ? (
          <Link href={`/dev/changelog/${newer.slug}`}>
            <span className={s.dir}>← Newer</span>
            <span className={s.what}>{newer.label}</span>
          </Link>
        ) : <span className={s.blank} />}
        {older ? (
          <Link href={`/dev/changelog/${older.slug}`} className={s.next}>
            <span className={s.dir}>Older →</span>
            <span className={s.what}>{older.label}</span>
          </Link>
        ) : <span className={s.blank} />}
      </nav>
    </Page>
  );
}

export default coalescePage('/dev/changelog/[slug]', Entry);
