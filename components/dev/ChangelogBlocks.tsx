import Link from '@/components/ui/AppLink';
import { parseInline, type Block, type Inline } from '@/lib/markdown';

/**
 * A changelog entry's Markdown, as the changelog has always drawn it. Shared by the batch page and
 * an entry's own page (issue 0098), so an entry reads the same in both.
 */

/** Rewrite a repo-relative screenshot path onto the route that can serve it. */
function imageSrc(href: string): string {
  const marker = 'docs/changelog/shots/';
  const at = href.indexOf(marker);
  return at === -1 ? href : `/dev/shot/${href.slice(at + marker.length)}`;
}

/** A link to another entry file opens that entry's page; anything else in the repository stays text. */
function entryHref(href: string): string | null {
  const m = /(?:^|\/)entries\/([a-z0-9-]+)\.md(#.*)?$/.exec(href);
  return m ? `/dev/changelog/${m[1]}` : null;
}

export function Spans({ src }: { src: string }) {
  return (
    <>
      {parseInline(src).map((s: Inline, i) => {
        if (s.kind === 'code') return <code key={i}>{s.text}</code>;
        if (s.kind === 'strong') return <b key={i}>{s.text}</b>;
        if (s.kind === 'em') return <i key={i}>{s.text}</i>;
        if (s.kind === 'image') {
          return (
            <a
              key={i}
              className="clshotlink"
              href={imageSrc(s.href ?? '')}
              target="_blank"
              rel="noreferrer"
              title="Expand here · ⌘-click for a new tab"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="clshot" src={imageSrc(s.href ?? '')} alt={s.text} loading="lazy" />
            </a>
          );
        }
        if (s.kind === 'link') {
          const href = s.href ?? '';
          if (href.startsWith('http')) {
            return (
              <a key={i} href={href} target="_blank" rel="noreferrer">
                {s.text}
              </a>
            );
          }
          const entry = entryHref(href);
          if (entry) return <Link key={i} href={entry}>{s.text}</Link>;
          return (
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

export function Rendered({ block }: { block: Block }) {
  switch (block.kind) {
    case 'heading':
      return (
        <h3
          id={block.id}
          style={{
            fontFamily: 'var(--display)', fontSize: block.level <= 3 ? 16 : 14,
            fontWeight: 600, margin: '18px 0 6px', scrollMarginTop: 60,
          }}
        >
          <Spans src={block.text} />
        </h3>
      );
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
        <div className="card" style={{ marginBottom: 14, overflowX: 'auto' }}>
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

export function Blocks({ blocks }: { blocks: Block[] }) {
  return (
    <>
      {blocks.map((block, i) => (
        <Rendered key={i} block={block} />
      ))}
    </>
  );
}
