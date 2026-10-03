/**
 * Reading a message back: the preview's outline of what will reach Gmail, and the properties'
 * check that what `buildMime` wrote is well formed. Deliberately separate from the builder, so a
 * mistake in one is not repeated by the other. Handles what the builder writes, not all of MIME.
 */

export interface MimeNode {
  headers: Array<[string, string]>;
  contentType: string;
  params: Record<string, string>;
  children: MimeNode[];
  /** Decoded bytes of a leaf. */
  body: Buffer | null;
  /** The longest line of this part's own headers and undecoded body, CRLF excluded. */
  longestLine: number;
  /** Lines in this part that end in a bare LF or CR. */
  bareLineEnds: number;
}

export const header = (n: MimeNode, name: string) => n.headers.find(([k]) => k === name.toLowerCase())?.[1] ?? null;

function unfold(block: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const line of block.split('\r\n')) {
    if (/^[ \t]/.test(line) && out.length) out[out.length - 1]![1] += line;
    else {
      const i = line.indexOf(':');
      if (i > 0) out.push([line.slice(0, i).trim().toLowerCase(), line.slice(i + 1).trim()]);
    }
  }
  return out;
}

function parseType(value: string | null): { type: string; params: Record<string, string> } {
  const [type, ...rest] = (value ?? 'text/plain').split(';');
  const params: Record<string, string> = {};
  for (const p of rest) {
    const i = p.indexOf('=');
    if (i < 0) continue;
    params[p.slice(0, i).trim().toLowerCase()] = p.slice(i + 1).trim().replace(/^"(.*)"$/, '$1');
  }
  return { type: type!.trim().toLowerCase(), params };
}

export function decodeQuotedPrintable(s: string): Buffer {
  const bytes: number[] = [];
  const text = s.replace(/=\r\n/g, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (c === '=' && /^[0-9A-F]{2}$/.test(text.slice(i + 1, i + 3))) { bytes.push(parseInt(text.slice(i + 1, i + 3), 16)); i += 2; }
    else bytes.push(...Buffer.from(c, 'utf8'));
  }
  return Buffer.from(bytes);
}

/** RFC 2047 encoded-words back to text; whitespace between two encoded-words is dropped. */
export function decodeWords(s: string): string {
  return s
    .replace(/(=\?[^?]+\?[BbQq]\?[^?]*\?=)\s+(?==\?)/g, '$1')
    .replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (_m, _cs: string, enc: string, data: string) =>
      enc.toUpperCase() === 'B' ? Buffer.from(data, 'base64').toString('utf8') : decodeQuotedPrintable(data.replace(/_/g, ' ')).toString('utf8'));
}

export function parseMime(raw: string): MimeNode {
  const split = raw.indexOf('\r\n\r\n');
  const headBlock = split < 0 ? raw : raw.slice(0, split);
  const bodyText = split < 0 ? '' : raw.slice(split + 4);
  const headers = unfold(headBlock);
  const { type, params } = parseType(headers.find(([k]) => k === 'content-type')?.[1] ?? null);
  const lines = raw.split('\r\n');
  const own = { longestLine: Math.max(0, ...headBlock.split('\r\n').map((l) => l.length)), bareLineEnds: lines.filter((l) => /[\r\n]/.test(l)).length };
  if (type.startsWith('multipart/')) {
    const b = params.boundary ?? '';
    const segments = bodyText.split(`--${b}`);
    const children = segments.slice(1).filter((seg) => !seg.startsWith('--')).map((seg) => parseMime(seg.replace(/^\r\n/, '').replace(/\r\n$/, '')));
    return { headers, contentType: type, params, children, body: null, ...own };
  }
  const cte = (headers.find(([k]) => k === 'content-transfer-encoding')?.[1] ?? '7bit').toLowerCase();
  const body = cte === 'base64' ? Buffer.from(bodyText.replace(/\r\n/g, ''), 'base64') : cte === 'quoted-printable' ? decodeQuotedPrintable(bodyText) : Buffer.from(bodyText, 'utf8');
  return { headers, contentType: type, params, children: [], body, longestLine: Math.max(own.longestLine, ...bodyText.split('\r\n').map((l) => l.length)), bareLineEnds: own.bareLineEnds };
}

/** Every leaf, depth first. */
export function leaves(n: MimeNode): MimeNode[] {
  return n.children.length ? n.children.flatMap(leaves) : [n];
}

export interface OutlineRow { depth: number; type: string; detail: string }

/** The preview's tree: one row per part, with its size and what it is. */
export function outline(raw: string): OutlineRow[] {
  const rows: OutlineRow[] = [];
  const walk = (n: MimeNode, depth: number) => {
    const disp = header(n, 'content-disposition');
    const name = /filename\*?=(?:UTF-8'')?"?([^";]+)/i.exec(disp ?? '')?.[1];
    const detail = n.children.length
      ? `${n.children.length} parts`
      : [n.body ? `${n.body.length.toLocaleString('en-US')} bytes` : '', name ? decodeURIComponent(name) : '', header(n, 'content-id') ?? ''].filter(Boolean).join(' · ');
    rows.push({ depth, type: n.contentType, detail });
    n.children.forEach((c) => walk(c, depth + 1));
  };
  walk(parseMime(raw), 0);
  return rows;
}

/** The raw message for reading: base64 bodies longer than a few lines are cut to a note of their size. */
export function elide(raw: string, keepLines = 3): string {
  const out: string[] = [];
  let run: string[] = [];
  const flush = () => {
    if (run.length > keepLines) out.push(...run.slice(0, keepLines), `[… ${(run.length - keepLines).toLocaleString('en-US')} more lines of base64 …]`);
    else out.push(...run);
    run = [];
  };
  for (const line of raw.split('\r\n')) {
    if (/^[A-Za-z0-9+/]{60,76}={0,2}$/.test(line)) run.push(line);
    else { flush(); out.push(line); }
  }
  flush();
  return out.join('\n');
}
