/**
 * The email body as a document, and the two renderings made from it (docs/25-email-drafts.md).
 *
 * The editor (components/email/EmailDraftBox.tsx) is TipTap restricted to what an email needs:
 * paragraphs, line breaks, bold, italic, links, bullet and numbered lists, and pictures that are
 * attachments of the draft. The browser sends the editor's JSON, never its HTML. The server runs
 * `normalizeDoc` on whatever arrives, so a forged or pasted node that the editor would not have
 * made is reduced to its words here, and HTML is only ever written by `renderHtml` below — the
 * server never parses HTML a browser sent.
 *
 * The text/plain alternative is rendered from the same tree by `renderText`, so the two parts
 * say the same words by construction (a property checks it).
 *
 * Client-safe: no server imports.
 */

export interface DocMark { type: string; attrs?: Record<string, unknown> }
export interface DocNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: DocNode[];
  text?: string;
  marks?: DocMark[];
}

/** The node and mark names the editor is built with. The editor imports these, so they cannot drift. */
export const EMAIL_NODES = ['doc', 'paragraph', 'text', 'hardBreak', 'bulletList', 'orderedList', 'listItem', 'emailImage'] as const;
export const EMAIL_MARKS = ['bold', 'italic', 'link'] as const;
/** Link targets an email may carry. Anything else (javascript:, data:, file:) loses the link and keeps the words. */
export const LINK_PROTOCOLS = ['http:', 'https:', 'mailto:'] as const;

const MAX_DEPTH = 12; // GUESS: lists three deep need about nine levels; deeper is not a letter.
const MAX_NODES = 20_000; // GUESS: a long letter is a few hundred nodes.
/** Blocks whose words are kept as a paragraph when they are stripped. */
const TEXT_BLOCKS = new Set(['heading', 'codeBlock', 'title', 'caption', 'detailsSummary']);
/** Blocks whose child blocks are kept when they are stripped. */
const WRAPPER_BLOCKS = new Set(['blockquote', 'details', 'detailsContent', 'taskList', 'taskItem', 'tableRow', 'table', 'tableCell', 'tableHeader', 'columns', 'column']);

export const EMPTY_DOC: DocNode = { type: 'doc', content: [{ type: 'paragraph' }] };

export function safeHref(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const href = raw.trim();
  if (!href || href.length > 2000 || /[\u0000-\u001f\u007f\s]/.test(href)) return null;
  try {
    const u = new URL(href);
    return (LINK_PROTOCOLS as readonly string[]).includes(u.protocol) ? href : null;
  } catch {
    return null;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface Normalized {
  doc: DocNode;
  /** What was removed, by node or mark name, each once: "heading", "mark:underline", "link:javascript". */
  stripped: string[];
}

/**
 * Reduce anything to the email schema. Never throws on shape: an unknown block keeps its words,
 * an unknown mark is dropped, a link to anything but http(s) or mailto loses its link.
 */
export function normalizeDoc(input: unknown): Normalized {
  const stripped = new Set<string>();
  let count = 0;
  const node = (x: unknown): DocNode | null => {
    if (!x || typeof x !== 'object' || Array.isArray(x)) return null;
    if (++count > MAX_NODES) { stripped.add('too-many-nodes'); return null; }
    return x as DocNode;
  };
  const kids = (n: DocNode): unknown[] => (Array.isArray(n.content) ? n.content : []);
  const cleanText = (s: unknown) => (typeof s === 'string' ? s.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').replace(/[\r\n\t]+/g, ' ') : '');

  const marks = (raw: unknown): DocMark[] | undefined => {
    if (!Array.isArray(raw)) return undefined;
    const out: DocMark[] = [];
    const seen = new Set<string>();
    for (const m of raw) {
      if (!m || typeof m !== 'object') continue;
      const type = String((m as DocMark).type);
      if (seen.has(type)) continue;
      if (type === 'bold' || type === 'italic') { out.push({ type }); seen.add(type); continue; }
      if (type === 'link') {
        const href = safeHref((m as DocMark).attrs?.href);
        if (href) { out.push({ type: 'link', attrs: { href } }); seen.add(type); }
        else stripped.add('link:unsafe');
        continue;
      }
      stripped.add(`mark:${type}`);
    }
    // A fixed order, so equal formatting is equal JSON.
    out.sort((a, b) => EMAIL_MARKS.indexOf(a.type as never) - EMAIL_MARKS.indexOf(b.type as never));
    return out.length ? out : undefined;
  };

  const inline = (raw: unknown[], depth: number): DocNode[] => {
    const out: DocNode[] = [];
    for (const r of raw) {
      const n = node(r);
      if (!n) continue;
      if (n.type === 'text') {
        const text = cleanText(n.text);
        if (!text) continue;
        const m = marks(n.marks);
        out.push(m ? { type: 'text', text, marks: m } : { type: 'text', text });
      } else if (n.type === 'hardBreak') {
        out.push({ type: 'hardBreak' });
      } else {
        stripped.add(n.type === 'emailImage' ? 'inline-image' : String(n.type));
        if (depth < MAX_DEPTH) out.push(...inline(kids(n), depth + 1));
        else if (typeof n.text === 'string') out.push({ type: 'text', text: cleanText(n.text) });
      }
    }
    return out;
  };

  const block = (raw: unknown, depth: number): DocNode[] => {
    const n = node(raw);
    if (!n) return [];
    if (depth > MAX_DEPTH) { stripped.add('too-deep'); return []; }
    switch (n.type) {
      case 'paragraph': {
        const content = inline(kids(n), depth + 1);
        return [content.length ? { type: 'paragraph', content } : { type: 'paragraph' }];
      }
      case 'bulletList':
      case 'orderedList': {
        const items: DocNode[] = [];
        for (const k of kids(n)) {
          const item = node(k);
          if (!item) continue;
          if (item.type !== 'listItem') { stripped.add(String(item.type)); items.push({ type: 'listItem', content: block(item, depth + 2) }); continue; }
          const content = kids(item).flatMap((c) => block(c, depth + 2));
          items.push({ type: 'listItem', content: content.length && content[0]!.type === 'paragraph' ? content : [{ type: 'paragraph' }, ...content] });
        }
        if (!items.length) return [];
        const start = n.type === 'orderedList' && Number.isInteger(n.attrs?.start) && Number(n.attrs!.start) > 1 && Number(n.attrs!.start) < 10_000 ? Number(n.attrs!.start) : null;
        return [start ? { type: n.type, attrs: { start }, content: items } : { type: n.type, content: items }];
      }
      case 'emailImage': {
        const id = n.attrs?.attachmentId;
        if (typeof id !== 'string' || !UUID.test(id)) { stripped.add('image:not-an-attachment'); return []; }
        const alt = cleanText(n.attrs?.alt).slice(0, 300);
        return [{ type: 'emailImage', attrs: { attachmentId: id.toLowerCase(), alt } }];
      }
      case 'hardBreak':
      case 'text':
        return [{ type: 'paragraph', content: inline([n], depth + 1) }];
      default: {
        stripped.add(String(n.type));
        if (n.type === 'horizontalRule' || n.type === 'image') return [];
        if (WRAPPER_BLOCKS.has(String(n.type))) return kids(n).flatMap((c) => block(c, depth + 1));
        if (TEXT_BLOCKS.has(String(n.type))) {
          const content = inline(kids(n), depth + 1).map((c) => (c.type === 'text' ? { type: 'text', text: c.text } : c));
          return content.length ? [{ type: 'paragraph', content }] : [];
        }
        // Unknown: keep any blocks under it, or its words as one paragraph.
        const children = kids(n);
        const looksInline = children.every((c) => c && typeof c === 'object' && ['text', 'hardBreak'].includes(String((c as DocNode).type)));
        if (looksInline) {
          const content = inline(children, depth + 1);
          return content.length ? [{ type: 'paragraph', content }] : [];
        }
        return children.flatMap((c) => block(c, depth + 1));
      }
    }
  };

  const root = node(input);
  const top = root && root.type === 'doc' ? kids(root) : root ? [root] : [];
  if (root && root.type !== 'doc') stripped.add('not-a-doc');
  const content = top.flatMap((b) => block(b, 1));
  return { doc: content.length ? { type: 'doc', content } : EMPTY_DOC, stripped: [...stripped].sort() };
}

// ── Renderings ────────────────────────────────────────────────────────────────────────────

export const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export interface RenderOptions {
  /** Where a picture's bytes are: `cid:…` in the email, the attachment's URL in the preview. */
  imageSrc: (attachmentId: string) => string | null;
}

/**
 * Plain HTML with no styles, classes or fonts: what the recipient's mail program shows in its own
 * defaults. Wrapped the way Gmail wraps a message it composes.
 */
export function renderHtml(doc: DocNode, opts: RenderOptions): string {
  const inline = (nodes: DocNode[] = []) => nodes.map((n) => {
    if (n.type === 'hardBreak') return '<br>';
    if (n.type !== 'text' || !n.text) return '';
    let s = escapeHtml(n.text);
    const ms = n.marks ?? [];
    if (ms.some((m) => m.type === 'italic')) s = `<em>${s}</em>`;
    if (ms.some((m) => m.type === 'bold')) s = `<strong>${s}</strong>`;
    const link = ms.find((m) => m.type === 'link');
    const href = link ? safeHref(link.attrs?.href) : null;
    if (href) s = `<a href="${escapeHtml(href)}">${s}</a>`;
    return s;
  }).join('');
  const block = (n: DocNode): string => {
    switch (n.type) {
      case 'paragraph': {
        const inner = inline(n.content);
        return `<p>${inner || '<br>'}</p>`;
      }
      case 'bulletList':
        return `<ul>${(n.content ?? []).map(block).join('')}</ul>`;
      case 'orderedList':
        return `<ol${n.attrs?.start ? ` start="${Number(n.attrs.start)}"` : ''}>${(n.content ?? []).map(block).join('')}</ol>`;
      case 'listItem': {
        // A one-paragraph item is written without the <p>, as mail programs expect.
        const c = n.content ?? [];
        return `<li>${c.map((x, i) => (x.type === 'paragraph' && i === 0 ? inline(x.content) : block(x))).join('')}</li>`;
      }
      case 'emailImage': {
        const src = opts.imageSrc(String(n.attrs?.attachmentId));
        return src ? `<p><img src="${escapeHtml(src)}" alt="${escapeHtml(String(n.attrs?.alt ?? ''))}"></p>` : '';
      }
      default:
        return '';
    }
  };
  return `<div dir="ltr">${(doc.content ?? []).map(block).join('')}</div>`;
}

/** A link written for plain text: its words, then where it goes, unless the words are the address. */
function linkText(text: string, href: string): string {
  const bare = href.replace(/^mailto:/i, '');
  return text.trim() === href || text.trim() === bare ? text : `${text} (${bare})`;
}

/** The text/plain alternative. Lists keep their bullets and numbers; formatting is dropped, never marked up. */
export function renderText(doc: DocNode, names: (attachmentId: string) => string | null = () => null): string {
  const inline = (nodes: DocNode[] = []) => {
    let out = '';
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i]!;
      if (n.type === 'hardBreak') { out += '\n'; continue; }
      if (n.type !== 'text' || !n.text) continue;
      const href = safeHref(n.marks?.find((m) => m.type === 'link')?.attrs?.href);
      if (!href) { out += n.text; continue; }
      // Consecutive text nodes with the same link (bold inside a link) are one link.
      let text = n.text;
      while (i + 1 < nodes.length && nodes[i + 1]!.type === 'text' && safeHref(nodes[i + 1]!.marks?.find((m) => m.type === 'link')?.attrs?.href) === href) text += nodes[++i]!.text;
      out += linkText(text, href);
    }
    return out;
  };
  const blocks = (list: DocNode[] = [], indent: string): string[] => list.map((n) => {
    switch (n.type) {
      case 'paragraph':
        return inline(n.content).split('\n').map((l) => indent + l).join('\n');
      case 'bulletList':
      case 'orderedList': {
        const start = Number(n.attrs?.start ?? 1) || 1;
        return (n.content ?? []).map((item, k) => {
          const bullet = n.type === 'bulletList' ? '- ' : `${start + k}. `;
          const pad = ' '.repeat(bullet.length);
          const parts = blocks(item.content, indent + pad);
          const first = (parts[0] ?? '').slice((indent + pad).length);
          return [indent + bullet + first, ...parts.slice(1)].join('\n');
        }).join('\n');
      }
      case 'emailImage': {
        const name = names(String(n.attrs?.attachmentId)) ?? String(n.attrs?.alt || 'picture');
        return `${indent}[image: ${name}]`;
      }
      default:
        return '';
    }
  });
  return blocks(doc.content, '')
    .join('\n\n')
    .split('\n').map((l) => l.replace(/[ \t]+$/, '')).join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Plain text into a document: blank lines make paragraphs, single newlines line breaks. No markup is read. */
export function textToDoc(text: string): DocNode {
  const paras = text.replace(/\r\n?/g, '\n').split(/\n{2,}/).map((p) => p.replace(/^\n+|\n+$/g, ''));
  const content = paras.filter((p, i) => p.length || paras.length === 1 || i === 0).map((p) => {
    const lines = p.split('\n');
    const inline: DocNode[] = [];
    lines.forEach((line, i) => {
      if (i) inline.push({ type: 'hardBreak' });
      if (line) inline.push({ type: 'text', text: line });
    });
    return inline.length ? { type: 'paragraph', content: inline } : { type: 'paragraph' };
  });
  return content.length ? { type: 'doc', content } : EMPTY_DOC;
}

/** Every attachment a document shows inline, in order, each once. */
export function inlineImages(doc: DocNode): string[] {
  const out: string[] = [];
  const walk = (n: DocNode) => {
    if (n.type === 'emailImage' && typeof n.attrs?.attachmentId === 'string' && !out.includes(n.attrs.attachmentId)) out.push(n.attrs.attachmentId);
    (n.content ?? []).forEach(walk);
  };
  walk(doc);
  return out;
}

/** True when a document has no words and no pictures. */
export function isEmptyDoc(doc: DocNode): boolean {
  return renderText(doc).trim() === '' && inlineImages(doc).length === 0;
}
