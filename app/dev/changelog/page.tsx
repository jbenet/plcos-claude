import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import Link from 'next/link';
import { Page } from '@/components/shell/Page';
import { parseInline, parseMarkdown, type Block, type Inline } from '@/lib/markdown';

export const dynamic = 'force-dynamic';

/** Rewrite a repo-relative screenshot path onto the route that can serve it. */
function imageSrc(href: string): string {
  const marker = 'docs/changelog/shots/';
  const at = href.indexOf(marker);
  return at === -1 ? href : `/dev/shot/${href.slice(at + marker.length)}`;
}

function Spans({ src }: { src: string }) {
  return (
    <>
      {parseInline(src).map((s: Inline, i) => {
        if (s.kind === 'code') return <code key={i}>{s.text}</code>;
        if (s.kind === 'strong') return <b key={i}>{s.text}</b>;
        if (s.kind === 'em') return <i key={i}>{s.text}</i>;
        if (s.kind === 'image') {
          return (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={i} className="clshot" src={imageSrc(s.href ?? '')} alt={s.text} loading="lazy" />
          );
        }
        if (s.kind === 'link') {
          const href = s.href ?? '';
          return href.startsWith('http') ? (
            <a key={i} href={href} target="_blank" rel="noreferrer">
              {s.text}
            </a>
          ) : (
            <span key={i} className="mono" style={{ fontSize: 11.5 }}>
              {s.text}
            </span>
          );
        }
        return <span key={i}>{s.text}</span>;
      })}
    </>
  );
}

function Rendered({ block }: { block: Block }) {
  switch (block.kind) {
    case 'heading': {
      if (block.level === 1) return null; // the page already has a title
      const size = block.level === 2 ? 22 : block.level === 3 ? 16 : 14;
      return (
        <h2
          id={block.id}
          style={{
            fontFamily: 'var(--display)', fontSize: size, fontWeight: 600,
            margin: block.level === 2 ? '28px 0 8px' : '18px 0 6px',
            scrollMarginTop: 60,
          }}
        >
          <Spans src={block.text} />
        </h2>
      );
    }
    case 'paragraph':
      return (
        <p style={{ fontSize: 13.5, lineHeight: 1.65, margin: '0 0 12px' }}>
          <Spans src={block.text} />
        </p>
      );
    case 'list': {
      const Tag = block.ordered ? 'ol' : 'ul';
      return (
        <Tag style={{ fontSize: 13.5, lineHeight: 1.65, margin: '0 0 12px', paddingLeft: 20 }}>
          {block.items.map((item, i) => (
            <li key={i} style={{ marginBottom: 5 }}>
              <Spans src={item} />
            </li>
          ))}
        </Tag>
      );
    }
    case 'code':
      return <pre className="block" style={{ margin: '0 0 14px' }}>{block.text}</pre>;
    case 'quote':
      return (
        <blockquote className="scope" style={{ margin: '0 0 14px' }}>
          <p style={{ margin: 0, fontSize: 13, lineHeight: 1.6 }}>
            <Spans src={block.text} />
          </p>
        </blockquote>
      );
    case 'table':
      return (
        <div className="card" style={{ marginBottom: 14 }}>
          <table className="list">
            {block.head.some((h) => h !== '') && (
              <thead>
                <tr>
                  {block.head.map((h, i) => (
                    <th key={i}>
                      <Spans src={h} />
                    </th>
                  ))}
                </tr>
              </thead>
            )}
            <tbody>
              {block.rows.map((row, i) => (
                <tr key={i}>
                  {row.map((cell, j) => (
                    <td key={j}>
                      <Spans src={cell} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case 'rule':
      return <hr style={{ border: 0, borderTop: '1px solid var(--line)', margin: '26px 0' }} />;
  }
}

export default async function Changelog() {
  const src = await readFile(join(process.cwd(), 'CHANGELOG.md'), 'utf8');
  const blocks = parseMarkdown(src);
  const entries = blocks.filter((b) => b.kind === 'heading' && b.level === 2);

  return (
    <Page
      crumbs={[{ label: 'Developer' }, { label: 'Changelog' }]}
      inspector={
        <>
          <div className="lbl">Contents</div>
          <div className="ihead">{entries.length} entries</div>
          <div className="imeta">Newest last — it reads as a build log</div>
          <div style={{ marginTop: 10 }}>
            {entries.map((e) => (
              <a
                key={e.kind === 'heading' ? e.id : ''}
                href={`#${e.kind === 'heading' ? e.id : ''}`}
                className="prov"
                style={{ display: 'block', color: 'var(--ink)' }}
              >
                <div className="p1" style={{ fontSize: 12 }}>
                  {e.kind === 'heading' ? e.text : ''}
                </div>
              </a>
            ))}
          </div>
          <div className="note">
            Rendered from <code>CHANGELOG.md</code> in this repository. The screenshots come from{' '}
            <code>docs/changelog/shots/</code> through a route that only serves PNGs from that
            directory.
          </div>
        </>
      }
    >
      <div className="lbl">Developer</div>
      <h1>Changelog</h1>
      <p className="sublede">
        What landed at each stage, what was deliberately left out, and where the build disagreed
        with the plan. Read from <code>CHANGELOG.md</code>, so it cannot drift from the repository.
      </p>

      <div className="card">
        <div className="cbody" style={{ maxWidth: '88ch' }}>
          {blocks.map((block, i) => (
            <Rendered key={i} block={block} />
          ))}
        </div>
      </div>

      <p className="note">
        <Link href="/dev/status">Status</Link> shows what is running right now;
        this is the history of how it got there.
      </p>
    </Page>
  );
}
