/**
 * A very small markdown renderer.
 *
 * Deliberately not a library: this renders exactly one document — our own CHANGELOG.md —
 * and the blast radius of a markdown parser that handles arbitrary input is larger than
 * the feature is worth. It covers what the changelog actually uses and nothing else.
 */

export type Block =
  | { kind: 'heading'; level: number; text: string; id: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'list'; ordered: boolean; items: string[] }
  | { kind: 'code'; text: string }
  | { kind: 'quote'; text: string }
  | { kind: 'table'; head: string[]; rows: string[][] }
  | { kind: 'rule' };

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

const splitRow = (line: string): string[] =>
  line.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());

export function parseMarkdown(src: string): Block[] {
  const lines = src.split(/\r?\n/);
  const blocks: Block[] = [];
  let i = 0;

  const flushParagraph = (buf: string[]) => {
    if (buf.length) blocks.push({ kind: 'paragraph', text: buf.join(' ').trim() });
    buf.length = 0;
  };

  const para: string[] = [];

  while (i < lines.length) {
    const line = lines[i]!;

    if (line.trim() === '') {
      flushParagraph(para);
      i += 1;
      continue;
    }

    if (/^```/.test(line)) {
      flushParagraph(para);
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !/^```/.test(lines[i]!)) {
        body.push(lines[i]!);
        i += 1;
      }
      i += 1;
      blocks.push({ kind: 'code', text: body.join('\n') });
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flushParagraph(para);
      const text = heading[2]!.trim();
      blocks.push({ kind: 'heading', level: heading[1]!.length, text, id: slugify(text) });
      i += 1;
      continue;
    }

    if (/^(-{3,}|\*{3,})$/.test(line.trim())) {
      flushParagraph(para);
      blocks.push({ kind: 'rule' });
      i += 1;
      continue;
    }

    if (/^>\s?/.test(line)) {
      flushParagraph(para);
      const body: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i]!)) {
        body.push(lines[i]!.replace(/^>\s?/, ''));
        i += 1;
      }
      blocks.push({ kind: 'quote', text: body.join(' ').trim() });
      continue;
    }

    if (/^\|/.test(line)) {
      flushParagraph(para);
      const head = splitRow(line);
      i += 1;
      // The |---|---| separator row, which carries no data.
      if (i < lines.length && /^\|[\s:|-]+\|?$/.test(lines[i]!)) i += 1;
      const rows: string[][] = [];
      while (i < lines.length && /^\|/.test(lines[i]!)) {
        rows.push(splitRow(lines[i]!));
        i += 1;
      }
      blocks.push({ kind: 'table', head, rows });
      continue;
    }

    const bullet = /^\s*([-*]|\d+\.)\s+(.*)$/.exec(line);
    if (bullet) {
      flushParagraph(para);
      const ordered = /\d/.test(bullet[1]!);
      const items: string[] = [];
      while (i < lines.length) {
        const next = /^\s*([-*]|\d+\.)\s+(.*)$/.exec(lines[i]!);
        if (!next) {
          // A wrapped continuation line belongs to the item above it.
          if (/^\s{2,}\S/.test(lines[i] ?? '') && items.length) {
            items[items.length - 1] += ` ${lines[i]!.trim()}`;
            i += 1;
            continue;
          }
          break;
        }
        items.push(next[2]!);
        i += 1;
      }
      blocks.push({ kind: 'list', ordered, items });
      continue;
    }

    para.push(line.trim());
    i += 1;
  }
  flushParagraph(para);
  return blocks;
}

export interface Inline {
  kind: 'text' | 'code' | 'strong' | 'em' | 'link' | 'image';
  text: string;
  href?: string;
}

/** Inline spans: `code`, **strong**, *em*, [link](href), ![alt](src). */
export function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  const pattern =
    /!\[([^\]]*)\]\(([^)]+)\)|\[([^\]]+)\]\(([^)]+)\)|`([^`]+)`|\*\*([^*]+)\*\*|\*([^*]+)\*|_([^_]+)_/g;
  let last = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(src)) !== null) {
    if (match.index > last) out.push({ kind: 'text', text: src.slice(last, match.index) });
    if (match[1] !== undefined) out.push({ kind: 'image', text: match[1], href: match[2] });
    else if (match[3] !== undefined) out.push({ kind: 'link', text: match[3], href: match[4] });
    else if (match[5] !== undefined) out.push({ kind: 'code', text: match[5] });
    else if (match[6] !== undefined) out.push({ kind: 'strong', text: match[6] });
    else if (match[7] !== undefined) out.push({ kind: 'em', text: match[7] });
    else if (match[8] !== undefined) out.push({ kind: 'em', text: match[8] });
    last = pattern.lastIndex;
  }
  if (last < src.length) out.push({ kind: 'text', text: src.slice(last) });
  return out;
}
