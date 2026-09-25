import { createElement, type ReactNode } from 'react';
import Link from '@/components/ui/AppLink';
import { docLink, type SystemDoc } from '@/lib/docs';
import { parseInline, parseMarkdown, type Block } from '@/lib/markdown';

export function documentBlocks(source: string) {
  const ids = new Set<string>();
  return parseMarkdown(source, { document: true }).map((block) => {
    if (block.kind !== 'heading') return block;
    const base = block.id || 'section';
    let id = base;
    let count = 1;
    while (ids.has(id)) id = `${base}-${count++}`;
    ids.add(id);
    return { ...block, id };
  });
}

export function SystemDocBody({ source, file, docs }: { source: string; file: string; docs: SystemDoc[] }) {
  function Ref({ href, children }: { href: string; children: ReactNode }) {
    const target = docLink(href, file, docs);
    if (!target) return <>{children}</>;
    return /^https?:\/\//i.test(target)
      ? <a href={target} target="_blank" rel="noreferrer">{children}</a>
      : <Link href={target}>{children}</Link>;
  }
  function Spans({ text }: { text: string }) {
    return <>{parseInline(text).map((span, i) => {
      if (span.kind === 'code') return <Ref key={i} href={span.text}><code>{span.text}</code></Ref>;
      if (span.kind === 'strong') return <strong key={i}><Spans text={span.text} /></strong>;
      if (span.kind === 'em') return <em key={i}><Spans text={span.text} /></em>;
      if (span.kind === 'link') return <Ref key={i} href={span.href ?? ''}><Spans text={span.text} /></Ref>;
      // No file or image serving endpoint is introduced by the docs reader.
      if (span.kind === 'image') return <span key={i} className="muted">{span.text || 'Image'}</span>;
      return <span key={i}>{span.text}</span>;
    })}</>;
  }
  function Lists({ block }: { block: Extract<Block, { kind: 'list' }> }) {
    let at = 0;
    const indent = (index: number) => block.indents?.[index] ?? 0;
    const marker = (index: number) => block.markers?.[index] ?? (block.ordered ? '1.' : '-');
    const ordered = (index: number) => /^\d/.test(marker(index));
    function level(depth: number): ReactNode[] {
      const groups: ReactNode[] = [];
      while (at < block.items.length && indent(at) >= depth) {
        // Tolerate a document that comes back to an intermediate indentation level.
        if (indent(at) > depth) { groups.push(...level(indent(at))); continue; }
        const numbered = ordered(at);
        const start = at;
        const children: ReactNode[] = [];
        while (at < block.items.length && indent(at) === depth && ordered(at) === numbered) {
          const index = at++;
          const nested = at < block.items.length && indent(at) > depth ? level(indent(at)) : null;
          children.push(<li key={index} value={numbered ? Number.parseInt(marker(index), 10) : undefined}>
            <Spans text={block.items[index]!} />{nested}
          </li>);
        }
        const Tag = numbered ? 'ol' : 'ul';
        groups.push(<Tag key={start}>{children}</Tag>);
      }
      return groups;
    }
    return <>{level(indent(0))}</>;
  }
  return <article className="system-doc">{documentBlocks(source).map((block, i) => {
    switch (block.kind) {
      case 'heading': return createElement(`h${block.level}`, { key: i, id: block.id },
        <a className="doc-heading" href={`#${block.id}`}><Spans text={block.text} /></a>);
      case 'paragraph': return <p key={i}><Spans text={block.text} /></p>;
      case 'code': return <pre key={i} className="block"><code>{block.text}</code></pre>;
      case 'quote': return <blockquote key={i}><Spans text={block.text} /></blockquote>;
      case 'rule': return <hr key={i} />;
      case 'list': return <Lists key={i} block={block} />;
      case 'table': return <div className="doc-table" key={i}><table>
        <thead><tr>{block.head.map((cell, j) => <th scope="col" key={j}><Spans text={cell} /></th>)}</tr></thead>
        <tbody>{block.rows.map((row, j) => <tr key={j}>{row.map((cell, k) => <td key={k}><Spans text={cell} /></td>)}</tr>)}</tbody>
      </table></div>;
    }
  })}</article>;
}
