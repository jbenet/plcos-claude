import { coalescePage } from '@/lib/page-render';
import { changelogBatches, changelogBody, changelogItems, BATCH_SIZE } from '@/lib/changelog';
import Link from '@/components/ui/AppLink';
import { Page } from '@/components/shell/Page';
import { SECTION } from '@/lib/nav';
import { ShotLightbox } from '@/components/dev/ShotLightbox';
import { Blocks } from '@/components/dev/ChangelogBlocks';
import s from './changelog.module.css';

export const dynamic = 'force-dynamic';

/**
 * The changelog, ten entries at a time (issue 0098). The page holds the latest batch, the one still
 * growing; older batches are one click away and scroll the same way; every entry opens on its own
 * page. Newest first inside a batch, as before.
 */
async function Changelog({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const items = await changelogItems();
  const batches = changelogBatches(items);
  const latest = batches.at(-1)!;
  const asked = Number(Array.isArray(sp.batch) ? sp.batch[0] : sp.batch);
  const batch = batches.find((b) => b.n === asked) ?? latest;
  const bodies = await Promise.all([...batch.items].reverse().map(changelogBody));
  const older = batches.find((b) => b.n === batch.n - 1);
  const newer = batches.find((b) => b.n === batch.n + 1);
  const href = (n: number) => (n === latest.n ? '/dev/changelog' : `/dev/changelog?batch=${n}`);

  return (
    <Page
      crumbs={[{ label: SECTION.developer }, { label: 'Changelog' }]}
      inspector={
        <>
          <div className="lbl">{batch.latest ? 'Latest batch' : `Batch ${batch.n}`} · newest first</div>
          <div className="ihead">{batch.range}</div>
          <div className="imeta">
            {batch.items.length} of {BATCH_SIZE} entries{batch.latest && batch.items.length < BATCH_SIZE ? ' · still growing' : ''}
          </div>
          <ul className={s.toc}>
            {bodies.map(({ item, divider }) => (
              <li key={item.slug}>
                <a href={`#${item.slug}`}>
                  {item.key && <span className={s.k}>{item.key}</span>}
                  {divider ? <i>{item.title}</i> : item.title}
                </a>
              </li>
            ))}
          </ul>

          <div className="lbl" style={{ marginTop: 22 }}>Every batch</div>
          <ul className={s.batches}>
            {[...batches].reverse().map((b) => (
              <li key={b.n}>
                <Link href={href(b.n)} className={b.n === batch.n ? s.on : undefined} aria-current={b.n === batch.n ? 'page' : undefined}>
                  <span>{b.range}</span>
                  <span className={s.n}>{b.latest ? 'latest' : `batch ${b.n}`} · {b.items.length}</span>
                </Link>
              </li>
            ))}
          </ul>
          <div className="note">
            One file per entry in <code>docs/changelog/entries/</code>, in the order of{' '}
            <code>docs/changelog/index.md</code>. Batches are cut from that order, ten at a time, oldest first, so a
            batch never changes once it is full: the eleventh entry starts the next one.
          </div>
        </>
      }
    >
      <ShotLightbox />
      <div className="lbl">Developer</div>
      <h1>Changelog</h1>
      <p className="sublede">
        What landed, what was left out, and where the build disagreed with the plan — ten entries at a time,
        newest first. This page holds the latest batch while it grows; every entry opens on its own page.
      </p>

      <nav className={s.batchbar} aria-label="Batches">
        <span className="lbl">Batch</span>
        {[...batches].reverse().map((b) => (
          <Link
            key={b.n}
            href={href(b.n)}
            className={`${s.pill} ${b.n === batch.n ? s.on : ''}`}
            aria-current={b.n === batch.n ? 'page' : undefined}
            aria-label={`Batch ${b.n}${b.latest ? ', latest' : ''}: ${b.range}`}
          >
            {b.latest ? <><span className={s.small}>Latest</span>{b.n}</> : b.n}
          </Link>
        ))}
      </nav>

      <div className={s.batchhead}>
        <h2>{batch.latest ? `Latest batch · ${batch.n}` : `Batch ${batch.n}`}</h2>
        <span className={s.meta}>
          {batch.range} · entries {batch.items[0]!.n}–{batch.items.at(-1)!.n} of {items.length}
          {batch.latest && batch.items.length < BATCH_SIZE ? ` · ${batch.items.length} of ${BATCH_SIZE}, still growing` : ''}
        </span>
      </div>

      {bodies.map(({ item, blocks, divider }) =>
        divider ? (
          <div key={item.slug} id={item.slug} className={`${s.era} ${s.entry}`}>
            <Link href={`/dev/changelog/${item.slug}`} className="lbl">{item.title}</Link>
            <Blocks blocks={blocks} />
          </div>
        ) : (
          <article className={`card ${s.entry}`} key={item.slug} id={item.slug}>
            <div className="chead">
              <h2 className={s.title}>
                <Link href={`/dev/changelog/${item.slug}`}>{item.title}</Link>
              </h2>
              <span className={s.side}>
                {item.key && <span className={s.key}>{item.key}</span>}
                <Link href={`/dev/changelog/${item.slug}`} className={s.open} aria-label={`Open ${item.label}`}>Open</Link>
              </span>
            </div>
            <div className={`cbody ${s.body}`}>
              <Blocks blocks={blocks} />
            </div>
          </article>
        ),
      )}

      <nav className={s.pager} aria-label="Older and newer batches">
        {newer ? (
          <Link href={href(newer.n)}>
            <span className={s.dir}>← Newer</span>
            <span className={s.what}>{newer.latest ? 'Latest' : `Batch ${newer.n}`} · {newer.range}</span>
          </Link>
        ) : <span className={s.blank} />}
        {older ? (
          <Link href={href(older.n)} className={s.next}>
            <span className={s.dir}>Older →</span>
            <span className={s.what}>Batch {older.n} · {older.range}</span>
          </Link>
        ) : <span className={s.blank} />}
      </nav>

      <p className="note">
        <Link href="/dev/status">Status</Link> shows what is running right now, <Link href="/dev/logs">Logs</Link> every
        commit, run and import as it happened; this is the history of how it got there.
      </p>
    </Page>
  );
}

export default coalescePage('/dev/changelog', Changelog);
