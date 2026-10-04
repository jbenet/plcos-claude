/**
 * Email drafts (docs/25-email-drafts.md), on the fake mailguard in lib/connectors/mailguard/fake.ts and
 * invented data only. Nothing here reaches mailguard or Google.
 *   - the mailguard allowlist refuses every send, delete and read of bodies, by any route the code offers; the client has no send;
 *   - a key is accepted only when mailguard's own answer says it is drafts-only: one that can send, an
 *     unknown permission, a malformed answer, an expired or draft-less policy are refused and not stored;
 *     a key widened later is caught before the next move; a revoked one fails cleanly;
 *   - the MIME is well formed: structure, encoded headers, line lengths, CRLF, unique Message-IDs;
 *   - a follow-up threads through mailguard's replyTo; a new email does not;
 *   - the plain-text and HTML parts carry the same words;
 *   - the editor's schema and the server's normaliser strip what an email should not carry;
 *   - each move and each check writes an audit entry, with counts and no words, addresses or key.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getSchema } from '@tiptap/react';
import type { Db } from '../../lib/db';
import { ALLOWED, MUST_REFUSE, allowedRequest, parseBase } from '../../lib/connectors/mailguard/allowlist';
import { DraftOnlyViolation, guarded, mailguardClient, type MailguardTransport } from '../../lib/connectors/mailguard/client';
import { FAKE_BASE, FAKE_DOMAIN, fakeMintKey, fakeReceive, fakeRevoke, fakeSendInGmail, fakeSetGrant, fakeTransport, readFake } from '../../lib/connectors/mailguard/fake';
import { CAN_SEND, KNOWN_CAPABILITIES, draftOnlyVerdict } from '../../lib/connectors/mailguard/scope';
import { memoryStore } from '../../lib/connectors/mailguard/tokens';
import { connection, type MailguardRuntime } from '../../lib/connectors/mailguard';
import { EMAIL_MARKS, EMAIL_NODES, normalizeDoc, renderHtml, renderText, textToDoc, type DocNode } from '../../lib/email/doc';
import { buildMime, newMessageId, parseAddresses } from '../../lib/email/mime';
import { decodeWords, header, leaves, parseMime } from '../../lib/email/mime-parse';
import { latestOf, replyTo } from '../../lib/email/threading';
import type { Check } from './harness';

// A small seeded generator, so a failure reproduces.
function rng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}

const WORDS = ['fund', 'neuro', 'Zürich', 'naïve', 'café', 'raise', '—', 'größe', 'ok', 'Q4', 'déjà', 'vu', 'αβγ', '東京', 'note', 'a&b', '<x>', '"q"'];

function randomDoc(r: () => number): DocNode {
  const pick = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)]!;
  const words = (n: number) => Array.from({ length: n }, () => pick(WORDS)).join(' ');
  const inline = (): DocNode[] => Array.from({ length: 1 + Math.floor(r() * 4) }, () => {
    const marks = [] as Array<{ type: string; attrs?: Record<string, unknown> }>;
    if (r() < 0.3) marks.push({ type: 'bold' });
    if (r() < 0.3) marks.push({ type: 'italic' });
    if (r() < 0.2) marks.push({ type: 'link', attrs: { href: pick(['https://example.org/a', 'mailto:ana@example.org', 'https://example.org/x?y=1&z=2']) } });
    return marks.length ? { type: 'text', text: `${words(1 + Math.floor(r() * 3))} `, marks } : { type: 'text', text: `${words(1 + Math.floor(r() * 3))} ` };
  });
  const para = (): DocNode => ({ type: 'paragraph', content: r() < 0.2 ? [...inline(), { type: 'hardBreak' }, ...inline()] : inline() });
  const list = (depth: number): DocNode => ({
    type: r() < 0.5 ? 'bulletList' : 'orderedList',
    content: Array.from({ length: 1 + Math.floor(r() * 3) }, () => ({ type: 'listItem', content: depth < 2 && r() < 0.3 ? [para(), list(depth + 1)] : [para()] })),
  });
  return { type: 'doc', content: Array.from({ length: 1 + Math.floor(r() * 5) }, () => (r() < 0.3 ? list(0) : para())) };
}

/** The words a reader sees in the HTML part: tags dropped, entities decoded. */
const htmlWords = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&').split(/\s+/).filter(Boolean);
/** The words of the text part, without what plain text adds: link addresses, bullets and numbers. */
const textWords = (text: string) => text.replace(/ \((?:https?:\/\/|)[^()\s]+\)/g, '').split(/\s+/).filter((w) => w && w !== '-' && !/^\d+\.$/.test(w));

/** A whoami answer as mailguard gives it, for the pure checks. */
const whoami = (capabilities: string[], toolGrant: string[] = capabilities, extra: Record<string, unknown> = {}) => ({
  tool: 'Invented tool', mailbox: 'someone@example.org', capabilities,
  layers: [{ layer: 'system', policy: { grant: ['*'] } }, { layer: 'tool', policy: { grant: toolGrant, ...extra } }],
});

export async function emailProperties(check: Check, db: Db) {
  const dir = await mkdtemp(join(tmpdir(), 'plcos-mailguard-fake-'));
  try {
    // ── 1. Draft-only: the allowlist refuses every send ────────────────────────────────────
    {
      const transport = fakeTransport(dir);
      const send = guarded(transport, FAKE_BASE);
      // Even a key that could send everything at "mailguard": the guard stops it first.
      const wide = await fakeMintKey(dir, { mailbox: `wide@${FAKE_DOMAIN}`, grant: ['*'] });
      const auth = { authorization: `Bearer ${wide}` };
      let refused = 0;
      for (const m of MUST_REFUSE) {
        try { await send(new URL(m.path, FAKE_BASE), { method: m.method as 'POST', headers: auth, body: m.method === 'GET' ? undefined : '{}' }); }
        catch (e) { if (e instanceof DraftOnlyViolation) refused++; }
      }
      // Smuggling: a header that would change the method, a GET with a body, another host, plain http, credentials in the URL,
      // a format that returns bodies, an extra parameter, no key, a key that is not one.
      const sneaky: Array<() => Promise<unknown>> = [
        () => send(new URL('/api/v1/drafts', FAKE_BASE), { method: 'POST', headers: { ...auth, 'X-HTTP-Method-Override': 'POST' }, body: '{}' }),
        () => send(new URL('/api/v1/me', FAKE_BASE), { method: 'GET', headers: auth, body: 'x' }),
        () => send(new URL('https://mailguard.elsewhere.example/api/v1/drafts'), { method: 'POST', headers: auth, body: '{}' }),
        () => send(new URL('http://mailguard.fake.example.test/api/v1/drafts'), { method: 'POST', headers: auth, body: '{}' }),
        () => send(new URL('https://u:p@mailguard.fake.example.test/api/v1/me'), { method: 'GET', headers: auth }),
        () => send(new URL('/api/v1/threads/t1?format=full', FAKE_BASE), { method: 'GET', headers: auth }),
        () => send(new URL('/api/v1/threads/t1?format=metadata&q=x', FAKE_BASE), { method: 'GET', headers: auth }),
        () => send(new URL('/api/v1/drafts?send=1', FAKE_BASE), { method: 'POST', headers: auth, body: '{}' }),
        () => send(new URL('/api/v1/me', FAKE_BASE), { method: 'GET', headers: {} }),
        () => send(new URL('/api/v1/me', FAKE_BASE), { method: 'GET', headers: { authorization: 'Bearer not-a-key' } }),
      ];
      let sneakyRefused = 0;
      for (const s of sneaky) { try { await s(); } catch (e) { if (e instanceof DraftOnlyViolation) sneakyRefused++; } }
      const state = await readFake(dir);
      // The fake itself would "send" if it were reached: the guard, not the fake, is what stops it.
      const reachDir = await mkdtemp(join(tmpdir(), 'plcos-mailguard-reach-'));
      const reachKey = await fakeMintKey(reachDir, { mailbox: `wide@${FAKE_DOMAIN}`, grant: ['*'] });
      await fakeTransport(reachDir)(new URL('/api/v1/messages/send', FAKE_BASE), { method: 'POST', headers: { authorization: `Bearer ${reachKey}` }, body: '{}' });
      const reached = (await readFake(reachDir)).sendAttempts.length;
      await rm(reachDir, { recursive: true, force: true });
      const client = mailguardClient({ transport, base: FAKE_BASE, key: wide });
      check('Email: the mailguard allowlist refuses every send, delete and body read, and every smuggled variant, before the transport — even with a key that could send',
        refused === MUST_REFUSE.length && sneakyRefused === sneaky.length && state.sendAttempts.length === 0 && reached === 1
          && !Object.keys(client).some((k) => /send|delete|trash|modify|label/i.test(k)),
        `${refused}/${MUST_REFUSE.length} named, ${sneakyRefused}/${sneaky.length} smuggled refused; the guarded fake saw ${state.sendAttempts.length} sends, the bare fake ${reached}; client methods: ${Object.keys(client).join(', ')}`);

      // Independently of the allowlist's own table: random method × path × query, allowed only if it is one of the four shapes.
      const r = rng(7);
      const segs = ['api', 'v1', 'me', 'drafts', 'threads', 'messages', 'send', 'labels', 'r123', 't9', 'attachments', 'modify', 'trash', 'mcp'];
      const queries = ['', '', '?format=metadata', '?format=full', '?format=metadata&x=1', '?q=1'];
      const id = (x: string) => /^[A-Za-z0-9_-]+$/.test(x) && x !== 'send';
      const expected = (m: string, p: string, q: string) => {
        const s = p.split('/').slice(1);
        if (s[0] !== 'api' || s[1] !== 'v1') return false;
        const [a, b] = [s[2], s[3]];
        if (s.length === 3 && m === 'GET' && a === 'me') return q === '';
        if (s.length === 3 && m === 'POST' && a === 'drafts') return q === '';
        if (s.length === 4 && m === 'PUT' && a === 'drafts' && id(b!)) return q === '';
        if (s.length === 4 && m === 'GET' && a === 'threads' && id(b!)) return q === '?format=metadata';
        return false;
      };
      let agree = 0, sendAllowed = 0;
      const N = 3000;
      for (let i = 0; i < N; i++) {
        const m = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'][Math.floor(r() * 5)]!;
        const tail = Array.from({ length: 1 + Math.floor(r() * 3) }, () => segs[Math.floor(r() * segs.length)]).join('/');
        const p = r() < 0.8 ? `/api/v1/${tail}` : `/${tail}`;
        const q = queries[Math.floor(r() * queries.length)]!;
        const ok = 'endpoint' in allowedRequest(m, new URL(`${p}${q}`, FAKE_BASE), FAKE_BASE);
        if (ok === expected(m, p, q)) agree++;
        if (ok && /send/.test(p)) sendAllowed++;
      }
      const bases = ['https://mail.example.com', 'http://localhost:3999', 'http://mail.example.com', 'https://mail.example.com/api', 'not a url', ''].map((b) => parseBase(b) instanceof URL);
      check('Email: 3,000 random mailguard requests are allowed exactly when they are one of the four draft, thread-header and whoami shapes; none that sends; mailguard’s address must be https (or this machine)',
        agree === N && sendAllowed === 0 && ALLOWED.length === 4 && bases.join() === 'true,true,false,false,false,false',
        `${agree}/${N} agree; ${sendAllowed} send paths allowed; ${ALLOWED.length} allowlist entries; addresses ${bases.join(',')}`);
    }

    // ── 2. MIME ───────────────────────────────────────────────────────────────────────────
    {
      const r = rng(11);
      let wellFormed = 0, failures: string[] = [];
      const ids = new Set<string>();
      const picture = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
      const file = Buffer.from(Array.from({ length: 5000 }, (_, i) => i % 256));
      for (let i = 0; i < 200; i++) {
        const doc = randomDoc(r);
        const plain = i % 5 === 0;
        const withPicture = i % 3 === 0;
        const withFile = i % 2 === 0;
        const subject = `Ünïcode — ${WORDS[i % WORDS.length]} ${'long words '.repeat(i % 7)}\r\nBcc: injected@example.org`;
        const messageId = newMessageId('example.org');
        ids.add(messageId);
        const content = withPicture && !plain ? { type: 'doc', content: [...(doc.content ?? []), { type: 'emailImage', attrs: { attachmentId: '00000000-0000-4000-8000-000000000001', alt: 'chart' } }] } : doc;
        const html = plain ? null : renderHtml(content, { imageSrc: () => 'cid:pic-1@drafts.example' });
        const raw = buildMime({
          from: { name: 'Lior Ödegaard', email: 'lior@example.org' },
          to: [{ name: 'Ana "the LP" Ruiz', email: 'ana@example.org' }, { email: 'bo@example.org' }],
          cc: [{ name: 'Zoë', email: 'zoe@example.org' }],
          subject, text: renderText(content), html,
          attachments: [
            ...(withPicture ? [{ filename: 'chart.png', contentType: 'image/png', data: picture, inline: true, contentId: 'pic-1@drafts.example' }] : []),
            ...(withFile ? [{ filename: 'Größe — one-pager.pdf', contentType: 'application/pdf', data: file }] : []),
          ],
          messageId, date: new Date('2026-10-02T12:00:00Z'),
        });
        const top = parseMime(raw);
        const problems: string[] = [];
        if (/[^\r]\n/.test(raw) || /\r(?!\n)/.test(raw)) problems.push('bare line end');
        const longest = Math.max(...raw.split('\r\n').map((l) => l.length));
        if (longest > 998) problems.push(`line of ${longest}`);
        const bodyLines = raw.split('\r\n\r\n').slice(1).join('\r\n\r\n').split('\r\n');
        if (bodyLines.some((l) => l.length > 76 && !/^--=_plc_/.test(l) && !/^Content-/.test(l))) problems.push('body line over 76');
        if (/^Bcc:/m.test(raw)) problems.push('header injected');
        if (decodeWords(header(top, 'subject') ?? '') !== subject.replace(/[\r\n]+/g, ' ')) problems.push('subject does not decode');
        if (!/"Ana \\"the LP\\" Ruiz" <ana@example.org>/.test(header(top, 'to') ?? '')) problems.push(`To reads ${header(top, 'to')}`);
        if (decodeWords(header(top, 'cc') ?? '') !== 'Zoë <zoe@example.org>') problems.push('Cc does not decode');
        if ((header(top, 'subject') ?? '').split(/\s+/).some((w) => w.startsWith('=?') && w.length > 75)) problems.push('encoded-word over 75');
        if (header(top, 'message-id') !== messageId) problems.push('Message-ID');
        const shape = (n: ReturnType<typeof parseMime>): string => (n.children.length ? `${n.contentType}(${n.children.map(shape).join(',')})` : n.contentType);
        const want = (() => {
          let s = plain ? 'text/plain' : 'multipart/alternative(text/plain,text/html)';
          if (withPicture && !plain) s = `multipart/related(${s},image/png)`;
          // A plain-text email has nowhere to show a picture, so it travels as a file.
          const files = [...(withPicture && plain ? ['image/png'] : []), ...(withFile ? ['application/pdf'] : [])];
          if (files.length) s = `multipart/mixed(${s},${files.join(',')})`;
          return s;
        })();
        if (shape(top) !== want) problems.push(`shape ${shape(top)} not ${want}`);
        const parts = leaves(top);
        const textPart = parts.find((p) => p.contentType === 'text/plain')!;
        // Line ends are CRLF on the wire (RFC 2045 canonical form); the text is the same.
        if (textPart.body!.toString('utf8').replace(/\r\n/g, '\n') !== renderText(content)) problems.push('text body does not round-trip');
        const htmlPart = parts.find((p) => p.contentType === 'text/html');
        if (html !== null && htmlPart?.body!.toString('utf8') !== html) problems.push('html body does not round-trip');
        const pdf = parts.find((p) => p.contentType === 'application/pdf');
        if (withFile && (!pdf || !pdf.body!.equals(file) || !/filename\*=UTF-8''Gr%C3%B6%C3%9Fe/.test(header(pdf, 'content-disposition') ?? ''))) problems.push('file does not round-trip');
        const png = parts.find((p) => p.contentType === 'image/png');
        if (withPicture && !plain && (header(png!, 'content-id') !== '<pic-1@drafts.example>' || !html!.includes('cid:pic-1@drafts.example'))) problems.push('inline picture is not referred to by its Content-ID');
        if (problems.length) failures.push(`#${i}: ${problems.join('; ')}`); else wellFormed++;
      }
      check('Email: 200 generated messages are well formed (structure, RFC 2047/2231 headers, CRLF, line lengths, no header injection, bytes round-trip)',
        wellFormed === 200, failures.slice(0, 3).join(' | ') || `${wellFormed} of 200`);
      check('Email: every draft gets its own Message-ID', ids.size === 200, `${ids.size} distinct of 200`);
      const parsed = parseAddresses('Ana Ruiz <ana@example.org>, "Ruiz, Bo" <bo@example.org>; not an address, ana@example.org');
      check('Email: recipient lists parse names, quotes and separators, refuse what is not an address, and drop repeats',
        parsed.ok.length === 2 && parsed.ok[1]!.name === 'Ruiz, Bo' && parsed.bad.length === 1, JSON.stringify(parsed));
    }

    // ── 3. The plain-text and HTML parts say the same thing ──────────────────────────────
    {
      const r = rng(23);
      let same = 0;
      const diffs: string[] = [];
      for (let i = 0; i < 300; i++) {
        const doc = normalizeDoc(randomDoc(r)).doc;
        const a = htmlWords(renderHtml(doc, { imageSrc: () => null })).join(' ');
        const b = textWords(renderText(doc)).join(' ');
        if (a === b) same++; else if (diffs.length < 2) diffs.push(`html: ${a.slice(0, 80)} | text: ${b.slice(0, 80)}`);
      }
      const t = renderText({ type: 'doc', content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'See ' }, { type: 'text', text: 'the deck', marks: [{ type: 'link', attrs: { href: 'https://example.org/d' } }] }] },
        { type: 'orderedList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'one' }] }] }, { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'two' }] }] }] },
      ] });
      check('Email: the text/plain part carries the HTML part’s words, with link addresses spelled out and lists kept',
        same === 300 && t === 'See the deck (https://example.org/d)\n\n1. one\n2. two', diffs.join(' || ') || `300 of 300; sample: ${JSON.stringify(t)}`);
      const back = renderText(textToDoc('Hi Ana,\n\nLine one\nline two'));
      check('Email: plain text survives a trip through the document', back === 'Hi Ana,\n\nLine one\nline two', JSON.stringify(back));
    }

    // ── 4. The editor and the server strip what an email should not carry ────────────────
    {
      const schema = getSchema((await import('../../components/email/extensions')).EMAIL_EXTENSIONS);
      const nodes = Object.keys(schema.nodes);
      const marks = Object.keys(schema.marks);
      check('Email: the editor’s schema has only the email nodes and marks (no headings, quotes, code, strike, underline, colours, fonts or outside pictures)',
        nodes.every((n) => (EMAIL_NODES as readonly string[]).includes(n)) && marks.every((m) => (EMAIL_MARKS as readonly string[]).includes(m)),
        `nodes: ${nodes.join(', ')}; marks: ${marks.join(', ')}`);
      const dirty = {
        type: 'doc', content: [
          { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Title', marks: [{ type: 'textStyle', attrs: { color: 'red', fontFamily: 'Comic Sans' } }] }] },
          { type: 'blockquote', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'quoted', marks: [{ type: 'strike' }, { type: 'underline' }, { type: 'bold' }] }] }] },
          { type: 'codeBlock', content: [{ type: 'text', text: 'code()' }] },
          { type: 'horizontalRule' },
          { type: 'paragraph', content: [{ type: 'text', text: 'click', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] }, { type: 'text', text: ' here', marks: [{ type: 'highlight', attrs: { color: 'yellow' } }] }] },
          { type: 'image', attrs: { src: 'https://tracker.example/pixel.gif' } },
          { type: 'emailImage', attrs: { attachmentId: '../../etc/passwd' } },
          { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'cell' }] }] }] }] },
          { type: 'paragraph', attrs: { style: 'color:red' }, content: [{ type: 'text', text: 'ok' }] },
        ],
      };
      const n = normalizeDoc(dirty);
      const html = renderHtml(n.doc, { imageSrc: () => null });
      const tags = [...html.matchAll(/<\/?([a-z0-9]+)([^>]*)>/g)];
      const words = htmlWords(html).join(' ');
      const types = new Set<string>();
      const walk = (x: DocNode) => { types.add(x.type); x.marks?.forEach((m) => types.add(`mark:${m.type}`)); x.content?.forEach(walk); };
      walk(n.doc);
      check('Email: the server reduces pasted formatting to words — no heading, quote, code, rule, table, colour, strike, outside picture or javascript: link survives',
        tags.every(([, t, attrs]) => ['div', 'p', 'br', 'strong', 'em', 'a', 'ul', 'ol', 'li'].includes(t!) && !/style|class|on\w+=/i.test(attrs!) && (t !== 'a' || /^ href="https?:|^ href="mailto:/.test(attrs!)))
          && !html.includes('javascript') && !html.includes('tracker') && words === 'Title quoted code() click here cell ok'
          && [...types].every((t) => ['doc', 'paragraph', 'text', 'mark:bold'].includes(t))
          && JSON.stringify(normalizeDoc(n.doc).doc) === JSON.stringify(n.doc),
        `${html.slice(0, 160)} · stripped ${n.stripped.join(', ')}`);
    }

    // ── 5. Threading, unit ───────────────────────────────────────────────────────────────
    {
      const h = replyTo({ messageId: '<b@x.org>', references: ['<a@x.org>'], subject: 'Neurotech', threadId: 't1' }, 'fallback');
      const again = replyTo({ messageId: '<c@x.org>', references: h.references.concat('<b@x.org>'), subject: 'Re: Neurotech', threadId: 't1' }, 'fallback');
      const long = replyTo({ messageId: '<z@x.org>', references: Array.from({ length: 40 }, (_, i) => `<r${i}@x.org>`), subject: null, threadId: null }, 'Fallback');
      check('Email: a reply carries the thread id, In-Reply-To the answered message, References the chain (first kept, capped), and one "Re:"',
        h.threadId === 't1' && h.inReplyTo === '<b@x.org>' && h.references.join(' ') === '<a@x.org> <b@x.org>' && h.subject === 'Re: Neurotech'
          && again.subject === 'Re: Neurotech' && again.references.join(' ') === '<a@x.org> <b@x.org> <c@x.org>'
          && long.references.length === 20 && long.references[0] === '<r0@x.org>' && long.references[19] === '<z@x.org>' && long.subject === 'Fallback'
          && latestOf([{ messageId: '<1@x>' }, { messageId: null }])?.messageId === '<1@x>',
        JSON.stringify({ h, again: again.subject }));
    }

    // ── 5b. Draft-time checks (rules 3, 8, 11, 12): warnings, never blocks ───────────────
    {
      const { draftWarnings } = await import('../../modules/email');
      const base = {
        purpose: 'intro_ask' as const,
        vehicle: { id: 'v1', name: 'Fund One', slug: 'one', kind: 'fund' as const, exemption: '506(c)' },
        otherVehicles: [{ name: 'SPV Two', slug: 'two' }],
        lpRestrictions: [], connectorId: 'c1', connectorName: 'Connie', connectorRestrictions: [],
        wrap: { found: true, note: null, maxPermittedUse: 'accredited_only', instrument: 'lp_commitment' },
        grantGate: null, introAsks: [{ status: 'approved', connectorId: 'c1' }], subject: 'Intro?', text: 'Hello', attachmentCount: 0,
      };
      const rules = (w: ReturnType<typeof draftWarnings>) => w.map((x) => `${x.level}:${x.rule}`).sort().join(' ');
      const clean = draftWarnings(base);
      const viaConnector = draftWarnings({ ...base, lpRestrictions: [{ scope: 'connector', connectorId: 'c1', connectorName: 'Connie', channel: null, instruction: 'Not via Connie.' }] });
      const otherConnector = draftWarnings({ ...base, lpRestrictions: [{ scope: 'connector', connectorId: 'c2', connectorName: 'Cal', channel: null, instruction: 'Not via Cal.' }] });
      const blanket = draftWarnings({ ...base, purpose: 'first_message', lpRestrictions: [{ scope: 'blanket', connectorId: null, connectorName: null, channel: null, instruction: 'Do not approach.' }] });
      const noWrap = draftWarnings({ ...base, wrap: { ...base.wrap, found: false }, text: 'Also about SPV Two.' });
      const unapproved = draftWarnings({ ...base, introAsks: [{ status: 'proposed', connectorId: 'c1' }] });
      const grants = draftWarnings({ ...base, purpose: 'first_message', vehicle: { ...base.vehicle, kind: 'grant_rail', exemption: 'n/a' }, grantGate: { blocked: true, reason: 'No invitation.' } });
      const b506 = draftWarnings({ ...base, purpose: 'first_message', vehicle: { ...base.vehicle, exemption: '506(b)' } });
      check('Email: draft-time checks warn on restrictions (stop through the barred connector, note through another), a missing wrap rule, another vehicle named, an unapproved intro ask, 506(b) and the grants gate',
        rules(clean) === '' && rules(viaConnector) === 'stop:restriction' && rules(otherConnector) === 'note:restriction' && rules(blanket) === 'stop:restriction'
          && rules(noWrap) === 'check:other_vehicle check:wrap' && rules(unapproved) === 'check:intro_ticket' && rules(grants) === 'stop:grants' && rules(b506) === 'check:wrap',
        JSON.stringify({ clean: rules(clean), viaConnector: rules(viaConnector), noWrap: rules(noWrap), unapproved: rules(unapproved), grants: rules(grants), b506: rules(b506) }));
    }

    // ── 6. The key must be drafts-only, read from mailguard's own answer ─────────────────
    {
      const v = (a: unknown) => draftOnlyVerdict(a, Date.parse('2026-10-03T12:00:00Z'));
      const code = (a: unknown) => { const x = v(a); return x.ok ? 'ok' : x.code; };
      const cases: Array<[string, unknown, string]> = [
        ['drafts and headers', whoami(['draft', 'read.metadata']), 'ok'],
        ['drafts only', whoami(['draft']), 'ok'],
        ['can send', whoami(['draft', 'read.metadata', 'send']), 'can_send'],
        ['everything', whoami([...KNOWN_CAPABILITIES], ['*']), 'can_send'],
        ['its own policy grants *, the system stops send', whoami(['draft', 'read.metadata'], ['*']), 'tool_grants_send'],
        ['its own policy grants send, the system stops it', whoami(['draft'], ['draft', 'send']), 'tool_grants_send'],
        ['an unknown capability', whoami(['draft', 'mail.forward']), 'unknown_capability'],
        ['an unknown grant', whoami(['draft'], ['draft', 'forward']), 'unknown_capability'],
        ['no draft', whoami(['read.metadata']), 'no_draft'],
        ['expired', whoami(['draft'], ['draft'], { expiresAt: '2026-10-01T00:00:00Z' }), 'expired'],
        ['an unreadable expiry', whoami(['draft'], ['draft'], { expiresAt: 'soon' }), 'expired'],
        ['no layers', { tool: 't', mailbox: 'a@b.org', capabilities: ['draft'] }, 'malformed'],
        ['no tool layer', { ...whoami(['draft']), layers: [{ layer: 'system', policy: { grant: ['*'] } }] }, 'malformed'],
        ['capabilities not a list', { ...whoami(['draft']), capabilities: 'draft' }, 'malformed'],
        ['no mailbox', { ...whoami(['draft']), mailbox: 'nobody' }, 'malformed'],
        ['nothing', null, 'malformed'],
      ];
      const wrong = cases.filter(([, a, want]) => code(a) !== want).map(([name, a]) => `${name}: ${code(a)}`);
      const sendText = v(whoami(['draft', 'send']));
      // Random answers: accepted exactly when draft is in, send is out, everything is known and the tool's own grant names neither send nor *.
      const r = rng(31);
      const pool = [...KNOWN_CAPABILITIES, 'forward', 'send.later', 'read.*'];
      let agree = 0, sendAccepted = 0;
      for (let i = 0; i < 1000; i++) {
        const caps = pool.filter(() => r() < 0.25);
        const grant = r() < 0.15 ? ['*'] : caps.filter((c) => r() < 0.9);
        const want = caps.includes('draft') && !caps.includes('send') && caps.every((c) => (KNOWN_CAPABILITIES as readonly string[]).includes(c))
          && !grant.includes('*') && !grant.includes('send') && grant.every((g) => (KNOWN_CAPABILITIES as readonly string[]).includes(g) || g === 'read.*');
        const got = v(whoami(caps, grant));
        if (got.ok === want) agree++;
        if (got.ok && (caps.includes('send') || grant.includes('send') || grant.includes('*'))) sendAccepted++;
      }
      check('Email: a mailguard key is drafts-only only when its own whoami says so — send, an own grant of send or *, anything unknown, no draft, an expired policy or a malformed answer are refused; 1,000 random answers agree and none that can send passes',
        wrong.length === 0 && !sendText.ok && sendText.reason === CAN_SEND && agree === 1000 && sendAccepted === 0,
        wrong.join('; ') || `${agree}/1000 agree; ${sendAccepted} send-capable accepted; refusal: ${sendText.ok ? '' : sendText.reason}`);
    }

    // ── 7. Connecting, and drafts end to end on the fake ─────────────────────────────────
    {
      const email = await import('../../modules/email');
      const { authorizeAction } = await import('../../lib/authz/server');
      const users = await db.query<{ id: string; handle: string; name: string; email: string; access: string; vehicles: string[] | null; approves: string[] }>(
        "select id::text, handle, name, email, access::text, vehicles, approves from platform.app_user where handle in ('juan') or access = 'gp' order by handle = 'juan' desc, handle limit 2");
      const juan = users[0]!, other = users[1]!;
      const actor = { id: juan.id, handle: juan.handle, name: juan.name, email: juan.email };
      const mailbox = `juan@${FAKE_DOMAIN}`;
      const store = memoryStore();
      const base: MailguardRuntime = { mode: 'fake', base: FAKE_BASE, transport: fakeTransport(dir), store, envKey: null, fakeDir: dir };
      const refusedWith = async (work: () => Promise<unknown>) => { try { await work(); return null; } catch (e) { return e instanceof email.DraftRefused ? e.message : `threw ${(e as Error).name}`; } };
      const calls = async (name: string) => (await readFake(dir)).calls[name] ?? 0;

      // Connect: a key that can send is refused and not stored; so is one with an unknown permission, or not a key at all; a narrowed one is kept.
      const sender = await fakeMintKey(dir, { mailbox, grant: ['draft', 'read.metadata', 'send'] });
      const sendRefusal = await refusedWith(() => email.connectMailguard(actor, sender, base));
      const storedAfterSend = await store.get(juan.handle);
      const odd: MailguardTransport = async (url, init) => url.pathname === '/api/v1/me'
        ? { status: 200, text: async () => JSON.stringify(whoami(['draft', 'mail.forward'])) } : base.transport(url, init);
      const oddKey = await fakeMintKey(dir, { mailbox });
      const unknownRefusal = await refusedWith(() => email.connectMailguard(actor, oddKey, { ...base, transport: odd }));
      const whoamisBefore = await calls('whoami');
      const formatRefusal = await refusedWith(() => email.connectMailguard(actor, 'mg_short', base));
      const formatSentNothing = (await calls('whoami')) === whoamisBefore;
      const storedAfterRefusals = await store.get(juan.handle);
      const key = await fakeMintKey(dir, { mailbox, grant: ['draft', 'read.metadata'] });
      const connected = await email.connectMailguard(actor, key, base);
      check('Email: connecting refuses a key that can send ("This token can send email…"), one with an unknown permission and one that is not a key (sending nothing), storing none; a drafts-only key is kept',
        sendRefusal === CAN_SEND && storedAfterSend === null && !!unknownRefusal && /does not know/.test(unknownRefusal) && !!formatRefusal && formatSentNothing
          && storedAfterRefusals === null && connected.ok && connected.mailbox === mailbox && connected.canThread && (await store.get(juan.handle)) === key,
        JSON.stringify({ sendRefusal, unknownRefusal: unknownRefusal?.slice(0, 60), formatRefusal: formatRefusal?.slice(0, 40), formatSentNothing, kept: (await store.get(juan.handle)) === key }));

      const pursuits = await db.query<{ id: string; vehicle: string }>("select pursuit_id::text id, vehicle_id::text vehicle from strategy.active_pursuit p join platform.vehicle v on v.id = p.vehicle_id where v.kind <> 'grant_rail' order by pursuit_id limit 2");
      const first = await email.createDraft(actor, { purpose: 'first_message', vehicleId: pursuits[0]!.vehicle, pursuitId: pursuits[0]!.id });
      const second = await email.createDraft(actor, { purpose: 'first_message', vehicleId: pursuits[1]!.vehicle, pursuitId: pursuits[1]!.id });
      const fill = async (id: string, subject: string) => {
        const d = (await email.draftWithChecks(actor, id)).draft;
        await email.saveDraft(actor, id, { revision: d.revision, to: 'Ana Ruiz <ana@example.org>, Zoë Ödegaard <zoe@example.org>', cc: '', bcc: '', subject, mode: 'rich', doc: d.doc });
      };
      await fill(first, 'Invented subject one');
      await fill(second, 'Invented subject two');
      const m1 = await email.moveDraft(actor, first, base);
      const m2 = await email.moveDraft(actor, second, base);
      const d1 = (await email.draftWithChecks(actor, first)).draft;
      const d2 = (await email.draftWithChecks(actor, second)).draft;
      const box = () => readFake(dir).then((s) => s.mailboxes[mailbox]!);
      const made1 = (await box()).messages[(await box()).drafts[m1.gmailDraftId]!]!;
      check('Email: two new emails land through mailguard as two Gmail drafts in two threads, with no reply headers; names outside ASCII go as bare addresses',
        m1.threadId !== m2.threadId && d1.messageId !== d2.messageId && !made1.inReplyTo && d1.status === 'in_gmail' && m1.threadSource === 'new'
          && made1.subject === 'Invented subject one' && made1.to.join(', ') === 'Ana Ruiz <ana@example.org>, zoe@example.org' && m1.account === mailbox,
        JSON.stringify({ t1: m1.threadId, t2: m2.threadId, to: made1.to }));

      // A second move replaces the same Gmail draft; once it is sent there, a move makes a new one.
      const again = await email.moveDraft(actor, first, base);
      await fakeSendInGmail(dir, mailbox, again.gmailDraftId);
      const renewed = await email.moveDraft(actor, first, base);
      const d1b = (await email.draftWithChecks(actor, first)).draft;
      check('Email: moving again replaces the Gmail draft; after it was sent in Gmail, the next move is a new draft with a new Message-ID in our records',
        again.replaced && again.gmailDraftId === m1.gmailDraftId && !renewed.replaced && renewed.newMessageId && renewed.gmailDraftId !== m1.gmailDraftId && d1b.messageId !== d1.messageId,
        JSON.stringify({ again: again.replaced, renewed: renewed.newMessageId }));

      // The LP answers in the thread; the follow-up answers that answer, through mailguard's replyTo.
      await fakeSendInGmail(dir, mailbox, m2.gmailDraftId);
      const answer = await fakeReceive(dir, mailbox, m2.threadId, 'Re: Invented subject two');
      const follow = await email.createDraft(actor, { purpose: 'follow_up', vehicleId: pursuits[1]!.vehicle, replyToDraftId: second });
      await fill(follow, 'Re: Invented subject two');
      const mf = await email.moveDraft(actor, follow, base);
      const made = (await box()).messages[(await box()).drafts[mf.gmailDraftId]!]!;
      const theirs = (await box()).messages[answer]!;
      check('Email: a follow-up lands in the thread and answers its latest sent or received message (mailguard sets the headers from Gmail’s), never a draft',
        made.threadId === m2.threadId && made.inReplyTo === theirs.messageIdHeader && (made.references ?? '').endsWith(theirs.messageIdHeader) && mf.threadSource === 'thread',
        JSON.stringify({ thread: made.threadId === m2.threadId, irt: made.inReplyTo, source: mf.threadSource }));

      // Widened at mailguard after connecting: the next move checks first and stops before writing anything.
      await fakeSetGrant(dir, key, ['draft', 'read.metadata', 'send']);
      const createsBefore = (await calls('drafts.create')) + (await calls('drafts.update'));
      const widened = await refusedWith(() => email.moveDraft(actor, second, base));
      const wroteNothing = (await calls('drafts.create')) + (await calls('drafts.update')) === createsBefore;
      const widenedStatus = await connection(base, juan.handle, 0);
      await fakeSetGrant(dir, key, ['draft', 'read.metadata']);
      const narrowedAgain = await email.moveDraft(actor, second, base);
      check('Email: a key widened to send after it was connected is caught by the check before the next move — refused, nothing written — and works again once narrowed',
        !!widened && widened.startsWith(CAN_SEND) && wroteNothing && widenedStatus.inspection?.ok === false && narrowedAgain.gmailDraftId.length > 0,
        JSON.stringify({ widened: widened?.slice(0, 70), wroteNothing }));

      // The Keychain's key (handed to the live server at start) is checked the same way.
      const envStore = memoryStore();
      const envSender = await fakeMintKey(dir, { mailbox, grant: ['draft', 'send'] });
      const envRt: MailguardRuntime = { ...base, store: envStore, envKey: { handle: juan.handle, key: envSender } };
      const envRefused = await refusedWith(() => email.moveDraft(actor, second, envRt));
      const envStatus = await connection(envRt, juan.handle, 0);
      const envGood: MailguardRuntime = { ...envRt, envKey: { handle: juan.handle, key } };
      const envMoved = await email.moveDraft(actor, second, envGood);
      check('Email: the Keychain key is held to the same check — one that can send stops drafting for its owner; a drafts-only one moves',
        !!envRefused && envRefused.startsWith(CAN_SEND) && envStatus.source === 'keychain' && envStatus.inspection?.ok === false && envMoved.replaced,
        JSON.stringify({ envRefused: envRefused?.slice(0, 50), source: envStatus.source }));

      // Revoked at mailguard: a clean refusal that names no key.
      const spare = await fakeMintKey(dir, { mailbox });
      const spareStore = memoryStore();
      await spareStore.put(juan.handle, spare);
      await fakeRevoke(dir, spare);
      const revoked = await refusedWith(() => email.moveDraft(actor, second, { ...base, store: spareStore }));
      const fake = await readFake(dir);
      check('Email: a revoked key fails cleanly — the move is refused in words, with no key in them — and nothing was ever sent',
        !!revoked && /does not accept this token/.test(revoked) && !/mg_/.test(revoked) && fake.sendAttempts.length === 0 && !fake.calls.send,
        JSON.stringify({ revoked: revoked?.slice(0, 80), sends: fake.sendAttempts.length }));

      await email.testMailguard(actor, base);
      const audits = await db.query<{ action: string; detail: Record<string, unknown> }>(
        "select action, detail from platform.audit_log where (subject_type = 'email_draft' and subject_id = any($1::text[])) or (subject_type = 'app_user' and subject_id = $2 and action like 'email.mailguard_%') order by at",
        [[first, second, follow], juan.id]);
      const moves = audits.filter((a) => a.action === 'email.draft_moved');
      const kinds = new Set(audits.map((a) => a.action));
      const text = JSON.stringify(audits);
      check('Email: every move and every key check is audit-logged — counts, ids, codes and the warnings shown — never the subject, the words, an address or a key',
        moves.length === 7 && moves.every((m) => typeof m.detail.gmailDraftId === 'string' && typeof m.detail.bytes === 'number' && Array.isArray(m.detail.warnings))
          && ['email.mailguard_connected', 'email.mailguard_refused', 'email.mailguard_checked', 'email.draft_move_failed'].every((k) => kinds.has(k))
          && audits.some((a) => a.action === 'email.mailguard_refused' && a.detail.code === 'can_send' && a.detail.stored === false)
          && !/Invented subject|ana@example\.org|Ana Ruiz|mg_[0-9A-Za-z]{12}_/.test(text),
        `${moves.length} moves of ${audits.length} entries; kinds ${[...kinds].join(', ')}`);

      // Ownership: another person cannot read, save or move it; a double click cannot move twice.
      const otherP = { access: other.access as 'gp', vehicles: other.vehicles, approves: other.approves, id: other.id };
      let refusedOther = 0;
      for (const name of ['app/email/actions.ts#saveDraftAction', 'app/email/actions.ts#moveDraftAction', 'app/email/actions.ts#previewDraftAction'] as const) {
        try { await authorizeAction(otherP, name, [{ draftId: first }], db); } catch { refusedOther++; }
      }
      await authorizeAction({ access: 'admin', vehicles: null, approves: [], id: juan.id }, 'app/email/actions.ts#moveDraftAction', [{ draftId: first }], db);
      await db.query("update email.draft set moving_since = now() where draft_id = $1", [second]);
      const locked = /being moved/.test((await refusedWith(() => email.moveDraft(actor, second, base))) ?? '');
      await db.query('update email.draft set moving_since = null where draft_id = $1', [second]);
      // A stale revision is refused rather than overwriting.
      let stale = false;
      try { await email.saveDraft(actor, first, { revision: 1, to: '', cc: '', bcc: '', subject: 'x', mode: 'plain', text: 'x' }); } catch (e) { stale = /changed since you opened it/.test((e as Error).message); }
      check('Email: a draft is its owner’s alone; a move in progress refuses a second; an edit on a stale revision is refused',
        refusedOther === 3 && locked && stale, JSON.stringify({ refusedOther, locked, stale }));

      // Forget: the key is gone here, and a move after that is refused.
      await email.forgetMailguard(actor, base);
      const afterForget = await refusedWith(() => email.moveDraft(actor, first, base));
      check('Email: forgetting the key removes it here; a move after that is refused and asks for a drafts-only token',
        (await store.get(juan.handle)) === null && !!afterForget && /drafts-only mailguard token/.test(afterForget), afterForget ?? 'moved');
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
