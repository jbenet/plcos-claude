/**
 * Email drafts (docs/25-email-drafts.md), on the fake Google in lib/connectors/gmail/fake.ts and
 * invented data only. Nothing here reaches Google.
 *   - the allowlist refuses every send endpoint, by any route the code offers, and the client has no send;
 *   - the MIME is well formed: structure, encoded headers, line lengths, CRLF, unique Message-IDs;
 *   - a reply or follow-up threads; a new email does not;
 *   - the plain-text and HTML parts carry the same words;
 *   - the editor's schema and the server's normaliser strip what an email should not carry;
 *   - each move writes an audit entry, with counts and no words or addresses;
 *   - OAuth: PKCE, a wider grant is refused and revoked, disconnect revokes.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getSchema } from '@tiptap/react';
import type { Db } from '../../lib/db';
import { ALLOWED, GMAIL_ORIGIN, GOOGLE_REVOKE_URL, GOOGLE_TOKEN_URL, MUST_REFUSE, SCOPES, allowedRequest } from '../../lib/connectors/gmail/allowlist';
import { gmailClient } from '../../lib/connectors/gmail/client';
import { FAKE_CLIENT, FAKE_DOMAIN, fakeConsent, fakeReceive, fakeSendInGmail, fakeTransport, readFake } from '../../lib/connectors/gmail/fake';
import { DraftOnlyViolation, guarded } from '../../lib/connectors/gmail/fetch';
import { beginConnect, completeConnect, disconnect, type GmailRuntime } from '../../lib/connectors/gmail';
import { wantedScopes } from '../../lib/connectors/gmail/oauth';
import { memoryStore } from '../../lib/connectors/gmail/tokens';
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

export async function emailProperties(check: Check, db: Db) {
  const dir = await mkdtemp(join(tmpdir(), 'plcos-gmail-fake-'));
  try {
    // ── 1. Draft-only: the allowlist refuses every send ────────────────────────────────────
    {
      const transport = fakeTransport(dir);
      const send = guarded(transport);
      let refused = 0;
      for (const m of MUST_REFUSE) {
        try { await send(new URL(m.path, GMAIL_ORIGIN), { method: m.method as 'POST', headers: { authorization: 'Bearer x' }, body: m.method === 'GET' ? undefined : '{}' }); }
        catch (e) { if (e instanceof DraftOnlyViolation) refused++; }
      }
      // Smuggling: a format that returns bodies, a header that would change the method, a GET with a body, another host.
      const sneaky: Array<() => Promise<unknown>> = [
        () => send(new URL('/gmail/v1/users/me/drafts/r1?format=raw', GMAIL_ORIGIN), { method: 'GET', headers: {} }),
        () => send(new URL('/gmail/v1/users/me/threads/t1?format=full', GMAIL_ORIGIN), { method: 'GET', headers: {} }),
        () => send(new URL('/gmail/v1/users/me/drafts/r1?alt=media', GMAIL_ORIGIN), { method: 'GET', headers: {} }),
        () => send(new URL('/gmail/v1/users/me/drafts', GMAIL_ORIGIN), { method: 'POST', headers: { 'X-HTTP-Method-Override': 'POST' }, body: '{}' }),
        () => send(new URL('/gmail/v1/users/me/drafts/send', GMAIL_ORIGIN), { method: 'PUT', headers: {}, body: '{}' }),
        () => send(new URL('/gmail/v1/users/me/profile', GMAIL_ORIGIN), { method: 'GET', headers: {}, body: 'x' }),
        () => send(new URL('https://www.googleapis.com/gmail/v1/users/me/drafts'), { method: 'POST', headers: {}, body: '{}' }),
        () => send(new URL(GOOGLE_TOKEN_URL), { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'grant_type=client_credentials' }),
        () => send(new URL(GOOGLE_REVOKE_URL), { method: 'GET', headers: {} }),
      ];
      let sneakyRefused = 0;
      for (const s of sneaky) { try { await s(); } catch (e) { if (e instanceof DraftOnlyViolation) sneakyRefused++; } }
      const state = await readFake(dir);
      // The fake itself would "send" if it were reached: the guard, not the fake, is what stops it.
      const reachDir = await mkdtemp(join(tmpdir(), 'plcos-gmail-reach-'));
      const rawFake = fakeTransport(reachDir);
      await rawFake(new URL('/gmail/v1/users/me/messages/send', GMAIL_ORIGIN), { method: 'POST', headers: { authorization: 'Bearer none' }, body: '{}' });
      const client = gmailClient({ transport, accessToken: async () => 'x' });
      check('Email: the Gmail allowlist refuses every send endpoint and every smuggled variant before the transport',
        refused === MUST_REFUSE.length && sneakyRefused === sneaky.length && state.sendAttempts.length === 0
          && !Object.keys(client).some((k) => /send|insert|import|delete/i.test(k)),
        `${refused}/${MUST_REFUSE.length} named, ${sneakyRefused}/${sneaky.length} smuggled refused; fake saw ${state.sendAttempts.length} sends; client methods: ${Object.keys(client).join(', ')}`);
      await rm(reachDir, { recursive: true, force: true });

      // Independently of the allowlist's own table: random method × path, allowed only if it is one of these five shapes.
      const r = rng(7);
      const segs = ['users', 'me', 'drafts', 'messages', 'threads', 'send', 'import', 'profile', 'r123', 'batch', 'settings', 'labels', 'attachments', 't9'];
      const expected = (m: string, p: string) => /^\/gmail\/v1\/users\/me\/(profile|drafts|drafts\/[^/]+|threads\/[^/]+|messages\/[^/]+)$/.test(p) && !/\/(send|import|batch\w*)$/.test(p) && (
        (m === 'GET' && p === '/gmail/v1/users/me/profile') || (m === 'POST' && p === '/gmail/v1/users/me/drafts')
        || (['GET', 'PUT'].includes(m) && /\/drafts\/[^/]+$/.test(p)) || (m === 'GET' && /\/(threads|messages)\/[^/]+$/.test(p)));
      let agree = 0, sendAllowed = 0;
      const N = 3000;
      for (let i = 0; i < N; i++) {
        const m = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'][Math.floor(r() * 5)]!;
        const p = `/gmail/v1/users/me/${Array.from({ length: 1 + Math.floor(r() * 3) }, () => segs[Math.floor(r() * segs.length)]).join('/')}`;
        const ok = 'endpoint' in allowedRequest(m, new URL(p, GMAIL_ORIGIN));
        if (ok === expected(m, p)) agree++;
        if (ok && /send/.test(p)) sendAllowed++;
      }
      check('Email: 3,000 random Gmail requests are allowed exactly when they are one of the six draft and header shapes; none that sends',
        agree === N && sendAllowed === 0 && ALLOWED.length === 6, `${agree}/${N} agree; ${sendAllowed} send paths allowed; ${ALLOWED.length} allowlist entries`);
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

    // ── 6. OAuth on the fake ─────────────────────────────────────────────────────────────
    const store = memoryStore();
    const rt: GmailRuntime = {
      mode: 'fake', authorizeUrl: 'http://fake.example.test/consent', client: { ...FAKE_CLIENT, redirectUri: 'http://localhost:3999/api/email/google/callback' },
      transport: fakeTransport(dir), store, scopes: wantedScopes(true), fakeDir: dir,
    };
    const consent = async (handle: string, scopes = rt.scopes) => {
      const { url, pending } = beginConnect({ ...rt, scopes }, handle, null);
      const back = new URL(await fakeConsent(dir, new URL(url).searchParams));
      return { code: back.searchParams.get('code')!, pending, url };
    };
    {
      const c = await consent('juan');
      const u = new URL(c.url);
      const grant = await completeConnect(rt, 'juan', c.code, c.pending);
      // A replayed code, a wrong verifier, and a grant wider than asked.
      let replay = false, wrongVerifier = false, wider = false;
      try { await completeConnect(rt, 'juan', c.code, c.pending); } catch { replay = true; }
      const d = await consent('juan');
      try { await completeConnect(rt, 'juan', d.code, { ...d.pending, verifier: 'x'.repeat(43) }); } catch { wrongVerifier = true; }
      const before = (await readFake(dir)).revoked;
      const w = await consent('juan', [...rt.scopes, 'https://www.googleapis.com/auth/gmail.send']);
      try { await completeConnect(rt, 'juan', w.code, { ...w.pending, scopes: rt.scopes }); } catch (e) { wider = e instanceof DraftOnlyViolation; }
      const revokedWider = (await readFake(dir)).revoked === before + 1;
      check('Email: connecting uses PKCE, offline access and no merged grants; a replayed code, a wrong verifier and a wider grant are refused (the wider one revoked)',
        grant.email === `juan@${FAKE_DOMAIN}` && u.searchParams.get('code_challenge_method') === 'S256' && u.searchParams.get('access_type') === 'offline'
          && u.searchParams.get('include_granted_scopes') === 'false' && u.searchParams.get('scope') === `${SCOPES.compose} ${SCOPES.metadata}`
          && replay && wrongVerifier && wider && revokedWider && (await store.get('juan'))?.refreshToken.startsWith('fake-rt-') === true,
        JSON.stringify({ email: grant.email, replay, wrongVerifier, wider, revokedWider }));
    }

    // ── 7. Drafts end to end on the fake: move, threads, audit, ownership ────────────────
    {
      const email = await import('../../modules/email');
      const { authorizeAction } = await import('../../lib/authz/server');
      const users = await db.query<{ id: string; handle: string; name: string; email: string; access: string; vehicles: string[] | null; approves: string[] }>(
        "select id::text, handle, name, email, access::text, vehicles, approves from platform.app_user where handle in ('juan') or access = 'gp' order by handle = 'juan' desc, handle limit 2");
      const juan = users[0]!, other = users[1]!;
      const pursuits = await db.query<{ id: string; vehicle: string }>("select pursuit_id::text id, vehicle_id::text vehicle from strategy.active_pursuit p join platform.vehicle v on v.id = p.vehicle_id where v.kind <> 'grant_rail' order by pursuit_id limit 2");
      const origin = 'http://localhost:3999';
      const actor = { id: juan.id, handle: juan.handle, name: juan.name, email: juan.email };
      const first = await email.createDraft(actor, { purpose: 'first_message', vehicleId: pursuits[0]!.vehicle, pursuitId: pursuits[0]!.id });
      const second = await email.createDraft(actor, { purpose: 'first_message', vehicleId: pursuits[1]!.vehicle, pursuitId: pursuits[1]!.id });
      const fill = async (id: string, subject: string) => {
        const d = (await email.draftWithChecks(actor, id)).draft;
        await email.saveDraft(actor, id, { revision: d.revision, to: 'Ana Ruiz <ana@example.org>', cc: '', bcc: '', subject, mode: 'rich', doc: d.doc });
      };
      await fill(first, 'Invented subject one');
      await fill(second, 'Invented subject two');
      const m1 = await email.moveDraft(actor, first, origin, rt);
      const m2 = await email.moveDraft(actor, second, origin, rt);
      const d1 = (await email.draftWithChecks(actor, first)).draft;
      const d2 = (await email.draftWithChecks(actor, second)).draft;
      check('Email: two new emails land as two Gmail drafts in two threads, with different Message-IDs and no In-Reply-To',
        m1.threadId !== m2.threadId && d1.messageId !== d2.messageId && !d1.inReplyTo && d1.status === 'in_gmail' && m1.threadSource === 'new',
        JSON.stringify({ t1: m1.threadId, t2: m2.threadId }));

      // A second move replaces the same Gmail draft; once it is sent there, a move makes a new email.
      const again = await email.moveDraft(actor, first, origin, rt);
      await fakeSendInGmail(dir, `juan@${FAKE_DOMAIN}`, again.gmailDraftId, '<gmail-rewrote-it@mail.example>');
      const renewed = await email.moveDraft(actor, first, origin, rt);
      const d1b = (await email.draftWithChecks(actor, first)).draft;
      check('Email: moving again replaces the Gmail draft; after it was sent in Gmail, the next move is a new email with a new Message-ID',
        again.replaced && again.gmailDraftId === m1.gmailDraftId && !renewed.replaced && renewed.newMessageId && d1b.messageId !== d1.messageId,
        JSON.stringify({ again: again.replaced, renewed: renewed.newMessageId }));

      // The LP answers in the thread; the follow-up answers that answer.
      const firstThread = m2.threadId;
      await fakeSendInGmail(dir, `juan@${FAKE_DOMAIN}`, m2.gmailDraftId, '<sent-by-gmail@mail.example>');
      await fakeReceive(dir, `juan@${FAKE_DOMAIN}`, firstThread, { 'Message-ID': '<their-answer@example.org>', References: '<sent-by-gmail@mail.example>', 'In-Reply-To': '<sent-by-gmail@mail.example>', Subject: 'Re: Invented subject two' });
      const follow = await email.createDraft(actor, { purpose: 'follow_up', vehicleId: pursuits[1]!.vehicle, replyToDraftId: second });
      await fill(follow, 'Re: Invented subject two');
      const mf = await email.moveDraft(actor, follow, origin, rt);
      const fake = await readFake(dir);
      const box = fake.mailboxes[`juan@${FAKE_DOMAIN}`]!;
      const made = box.messages[box.drafts[mf.gmailDraftId]!]!;
      const top = parseMime(made.raw);
      check('Email: a follow-up lands in the thread and answers its latest message, read from Gmail’s headers (not our guess at the sent Message-ID)',
        made.threadId === firstThread && header(top, 'in-reply-to') === '<their-answer@example.org>'
          && (header(top, 'references') ?? '').split(/\s+/).join(' ') === '<sent-by-gmail@mail.example> <their-answer@example.org>'
          && decodeWords(header(top, 'subject') ?? '') === 'Re: Invented subject two' && mf.threadSource === 'gmail',
        JSON.stringify({ thread: made.threadId === firstThread, irt: header(top, 'in-reply-to'), refs: header(top, 'references') }));
      check('Email: nothing was sent — the fake Gmail recorded no send attempt through any of it', fake.sendAttempts.length === 0, `${fake.sendAttempts.length} send attempts`);

      const audits = await db.query<{ action: string; detail: Record<string, unknown> }>(
        "select action, detail from platform.audit_log where subject_type = 'email_draft' and subject_id = any($1::text[]) order by at", [[first, second, follow]]);
      const moves = audits.filter((a) => a.action === 'email.draft_moved');
      const text = JSON.stringify(moves);
      check('Email: every move is audit-logged with counts, ids and the warnings shown — never the subject, the words or an address',
        moves.length === 5 && moves.every((m) => typeof m.detail.gmailDraftId === 'string' && typeof m.detail.bytes === 'number' && Array.isArray(m.detail.warnings))
          && !/Invented subject|ana@example\.org|Ana Ruiz/.test(text),
        `${moves.length} move entries of ${audits.length}; ${text.slice(0, 160)}`);

      // Ownership: another person cannot read, save or move it; a double click cannot move twice.
      const otherP = { access: other.access as 'gp', vehicles: other.vehicles, approves: other.approves, id: other.id };
      let refusedOther = 0;
      for (const name of ['app/email/actions.ts#saveDraftAction', 'app/email/actions.ts#moveDraftAction', 'app/email/actions.ts#previewDraftAction'] as const) {
        try { await authorizeAction(otherP, name, [{ draftId: first }], db); } catch { refusedOther++; }
      }
      await authorizeAction({ access: 'admin', vehicles: null, approves: [], id: juan.id }, 'app/email/actions.ts#moveDraftAction', [{ draftId: first }], db);
      await db.query("update email.draft set moving_since = now() where draft_id = $1", [second]);
      let locked = false;
      try { await email.moveDraft(actor, second, origin, rt); } catch (e) { locked = e instanceof email.DraftRefused && /being moved/.test(e.message); }
      await db.query('update email.draft set moving_since = null where draft_id = $1', [second]);
      // A stale revision is refused rather than overwriting.
      let stale = false;
      try { await email.saveDraft(actor, first, { revision: 1, to: '', cc: '', bcc: '', subject: 'x', mode: 'plain', text: 'x' }); } catch (e) { stale = /changed since you opened it/.test((e as Error).message); }
      check('Email: a draft is its owner’s alone; a move in progress refuses a second; an edit on a stale revision is refused',
        refusedOther === 3 && locked && stale, JSON.stringify({ refusedOther, locked, stale }));

      // Disconnect revokes at Google and forgets the token.
      const before = (await readFake(dir)).revoked;
      const out = await disconnect(rt, 'juan');
      let after = false;
      try { await email.moveDraft(actor, first, origin, rt); } catch (e) { after = e instanceof email.DraftRefused; }
      check('Email: disconnecting revokes the grant at Google and forgets it; a move after that is refused',
        out.revoked && (await readFake(dir)).revoked === before + 1 && !(await store.get('juan')) && after, JSON.stringify(out));
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
