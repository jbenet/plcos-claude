import { randomBytes, randomUUID } from 'node:crypto';

/**
 * The MIME builder for drafts (docs/25-email-drafts.md §Editor). Dependency-free and small, so the
 * whole of what reaches Gmail is in this file and its properties.
 *
 *   text only                 text/plain
 *   rich                      multipart/alternative (text/plain, text/html)
 *   + pictures in the text    multipart/related (the above, each picture with a Content-ID)
 *   + attached files          multipart/mixed (the above, each file)
 *
 * Every header value is stripped of CR and LF before it is written, so nothing a person types can
 * add a header. Non-ASCII words in headers are RFC 2047 encoded-words of at most 75 characters,
 * folded; file names use RFC 2231. Text parts are quoted-printable UTF-8, files base64. Lines end
 * in CRLF. Each draft has its own Message-ID, made once when the draft is created.
 */

export interface Address { name?: string | null; email: string }

export interface MimeAttachment {
  filename: string;
  contentType: string;
  data: Uint8Array;
  /** Shown in the text: a picture in multipart/related, referred to by its Content-ID. */
  inline?: boolean;
  /** Without angle brackets. Required when inline. */
  contentId?: string;
}

export interface MimeInput {
  from?: Address | null;
  to: Address[];
  cc?: Address[];
  bcc?: Address[];
  subject: string;
  text: string;
  /** Null for a plain-text message: then there is no HTML part at all. */
  html: string | null;
  attachments?: MimeAttachment[];
  /** With angle brackets, as it goes in the header. */
  messageId: string;
  inReplyTo?: string | null;
  references?: string[];
  date: Date;
}

const CRLF = '\r\n';
const oneLine = (s: string) => s.replace(/[\r\n]+/g, ' ');
const ascii = (s: string) => /^[\x20-\x7e]*$/.test(s);

/** A conservative address check: ASCII local part and a dotted domain. Internationalised addresses are refused, not guessed at. */
export const EMAIL_RE = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;

/** "Ana Ruiz <ana@example.org>, bo@example.org; …" → addresses, and whatever could not be read. */
export function parseAddresses(input: string): { ok: Address[]; bad: string[] } {
  const ok: Address[] = [];
  const bad: string[] = [];
  const parts: string[] = [];
  let cur = '';
  let quoted = false;
  let angle = false;
  for (const ch of oneLine(input)) {
    if (ch === '"' && !angle) quoted = !quoted;
    if (ch === '<' && !quoted) angle = true;
    if (ch === '>' && !quoted) angle = false;
    if ((ch === ',' || ch === ';') && !quoted && !angle) { parts.push(cur); cur = ''; continue; }
    cur += ch;
  }
  parts.push(cur);
  for (const raw of parts.map((p) => p.trim()).filter(Boolean)) {
    const m = /^(.*?)<([^<>]+)>$/.exec(raw);
    const email = (m ? m[2]! : raw).trim();
    const name = m ? m[1]!.trim().replace(/^"(.*)"$/, '$1').replace(/\\(.)/g, '$1').trim() : '';
    if (!EMAIL_RE.test(email) || email.length > 254) { bad.push(raw); continue; }
    if (!ok.some((a) => a.email.toLowerCase() === email.toLowerCase())) ok.push(name ? { name, email } : { email });
  }
  return { ok, bad };
}

export const formatAddress = (a: Address) => (a.name ? `${a.name} <${a.email}>` : a.email);

/**
 * RFC 2047 B encoded-words, each at most 75 characters, never splitting a UTF-8 character.
 * ASCII text without "=?" goes through as it is.
 */
export function encodeWords(s: string): string[] {
  const value = oneLine(s);
  if (ascii(value) && !value.includes('=?')) return [value];
  const words: string[] = [];
  let chunk: number[] = [];
  const flush = () => { if (chunk.length) words.push(`=?UTF-8?B?${Buffer.from(chunk).toString('base64')}?=`); chunk = []; };
  for (const ch of value) {
    const bytes = [...Buffer.from(ch, 'utf8')];
    // 45 bytes is 60 base64 characters; with the 12 of =?UTF-8?B? and ?= that is 72, under 75.
    if (chunk.length + bytes.length > 45) flush();
    chunk.push(...bytes);
  }
  flush();
  return words;
}

/** A display name: a quoted string when it is ASCII, encoded-words when it is not. */
function displayName(name: string): string {
  const n = oneLine(name).trim();
  if (ascii(n) && !n.includes('=?')) return /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~ -]+$/.test(n) ? n : `"${n.replace(/(["\\])/g, '\\$1')}"`;
  return encodeWords(n).join(' ');
}

/** Fold a header at spaces so no line passes 78 characters where it can be helped (RFC 5322 2.2.3). */
function fold(name: string, value: string): string {
  const tokens = value.split(' ');
  const lines: string[] = [];
  let line = `${name}:`;
  for (const t of tokens) {
    if (line.length + 1 + t.length > 78 && line.length > name.length + 1) { lines.push(line); line = ` ${t}`; }
    else line += ` ${t}`;
  }
  lines.push(line);
  return lines.join(CRLF);
}

const addressHeader = (name: string, list: Address[]) =>
  fold(name, list.map((a) => (a.name ? `${displayName(a.name)} <${oneLine(a.email)}>` : oneLine(a.email))).join(', '));

/** RFC 2231 file name parameters, with a plain ASCII fallback for old programs. */
function filenameParams(param: 'filename' | 'name', filename: string): string {
  const f = oneLine(filename).replace(/[\\/]/g, '_').trim() || 'attachment';
  const fallback = f.replace(/[^\x20-\x7e]/g, '_').replace(/(["\\])/g, '\\$1');
  if (ascii(f)) return `${param}="${fallback}"`;
  const pct = [...Buffer.from(f, 'utf8')].map((b) => (/[A-Za-z0-9.\-_~]/.test(String.fromCharCode(b)) ? String.fromCharCode(b) : `%${b.toString(16).toUpperCase().padStart(2, '0')}`)).join('');
  return `${param}="${fallback}"; ${param}*=UTF-8''${pct}`;
}

/** Quoted-printable (RFC 2045 6.7) for UTF-8 text, lines at most 76 characters, CRLF line ends. */
export function quotedPrintable(text: string): string {
  const out: string[] = [];
  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
    const bytes = Buffer.from(line, 'utf8');
    const enc: string[] = [];
    bytes.forEach((b, i) => {
      const last = i === bytes.length - 1;
      if ((b >= 33 && b <= 126 && b !== 61) || ((b === 32 || b === 9) && !last)) enc.push(String.fromCharCode(b));
      else enc.push(`=${b.toString(16).toUpperCase().padStart(2, '0')}`);
    });
    let cur = '';
    for (const e of enc) {
      if (cur.length + e.length > 75) { out.push(`${cur}=`); cur = ''; }
      cur += e;
    }
    out.push(cur);
  }
  return out.join(CRLF);
}

const base64Lines = (data: Uint8Array) => (Buffer.from(data).toString('base64').match(/.{1,76}/g) ?? ['']).join(CRLF);

/** Boundaries start with "=_", which neither quoted-printable nor base64 can produce. */
const boundary = () => `=_plc_${randomBytes(12).toString('hex')}`;

/** RFC 5322 date, in UTC: "Fri, 02 Oct 2026 20:15:00 +0000". */
export function rfc5322Date(d: Date): string {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const p = (n: number) => String(n).padStart(2, '0');
  return `${days[d.getUTCDay()]}, ${p(d.getUTCDate())} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} +0000`;
}

/** A new Message-ID. The domain is the sender's when known (Gmail may set its own when it sends). */
export function newMessageId(domain?: string | null): string {
  const d = domain && /^[A-Za-z0-9.-]+$/.test(domain) ? domain.toLowerCase() : 'drafts.plc-raise-tools.invalid';
  return `<${randomUUID()}@${d}>`;
}

export const MESSAGE_ID_RE = /^<[^<>\s@]+@[^<>\s@]+>$/;

interface Part { headers: string[]; body: string }

const textPart = (type: 'plain' | 'html', body: string): Part => ({
  headers: [`Content-Type: text/${type}; charset="UTF-8"`, 'Content-Transfer-Encoding: quoted-printable'],
  body: quotedPrintable(body),
});

const multipart = (subtype: 'alternative' | 'related' | 'mixed', parts: Part[]): Part => {
  const b = boundary();
  return {
    headers: [`Content-Type: multipart/${subtype}; boundary="${b}"`],
    body: [...parts.map((p) => `--${b}${CRLF}${p.headers.join(CRLF)}${CRLF}${CRLF}${p.body}`), `--${b}--`].join(CRLF) + CRLF,
  };
};

const filePart = (a: MimeAttachment): Part => {
  const type = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/i.test(a.contentType) ? a.contentType.toLowerCase() : 'application/octet-stream';
  const headers = [
    `Content-Type: ${type}; ${filenameParams('name', a.filename)}`,
    'Content-Transfer-Encoding: base64',
    `Content-Disposition: ${a.inline ? 'inline' : 'attachment'}; ${filenameParams('filename', a.filename)}`,
  ];
  if (a.inline) headers.push(`Content-ID: <${oneLine(a.contentId ?? '').replace(/[<>]/g, '')}>`);
  return { headers: headers.map((h) => (h.length > 78 ? h.replace(/; /g, `;${CRLF} `) : h)), body: base64Lines(a.data) };
};

/** Build the whole message. Throws on input that cannot make a valid message; warnings belong to the caller. */
export function buildMime(m: MimeInput): string {
  if (!MESSAGE_ID_RE.test(m.messageId)) throw new Error('A draft needs a Message-ID like <id@domain>.');
  if (m.inReplyTo && !MESSAGE_ID_RE.test(m.inReplyTo)) throw new Error('In-Reply-To must be a Message-ID like <id@domain>.');
  const attachments = m.attachments ?? [];
  const inline = attachments.filter((a) => a.inline);
  for (const a of inline) if (!a.contentId || !/^[^<>\s]+$/.test(a.contentId)) throw new Error(`The picture ${a.filename} has no Content-ID.`);
  const files = attachments.filter((a) => !a.inline);

  let body: Part = m.html === null ? textPart('plain', m.text) : multipart('alternative', [textPart('plain', m.text), textPart('html', m.html)]);
  if (inline.length && m.html !== null) body = multipart('related', [body, ...inline.map(filePart)]);
  // A plain-text message has nowhere to show a picture, so its pictures travel as files.
  const asFiles = m.html === null ? [...inline.map((a) => ({ ...a, inline: false })), ...files] : files;
  if (asFiles.length) body = multipart('mixed', [body, ...asFiles.map(filePart)]);

  const headers: string[] = [];
  if (m.from) headers.push(addressHeader('From', [m.from]));
  if (m.to.length) headers.push(addressHeader('To', m.to));
  if (m.cc?.length) headers.push(addressHeader('Cc', m.cc));
  if (m.bcc?.length) headers.push(addressHeader('Bcc', m.bcc));
  headers.push(fold('Subject', encodeWords(m.subject).join(' ')));
  headers.push(`Date: ${rfc5322Date(m.date)}`);
  headers.push(`Message-ID: ${m.messageId}`);
  if (m.inReplyTo) headers.push(`In-Reply-To: ${m.inReplyTo}`);
  const refs = (m.references ?? []).filter((r) => MESSAGE_ID_RE.test(r));
  if (refs.length) headers.push(fold('References', refs.join(' ')));
  headers.push('MIME-Version: 1.0');
  headers.push(...body.headers);
  return `${headers.join(CRLF)}${CRLF}${CRLF}${body.body}`;
}

/** Gmail's `raw`: the message in base64url without padding. */
export const toBase64Url = (raw: string) => Buffer.from(raw, 'utf8').toString('base64url');
