import { setTimeout as delay } from 'node:timers/promises';
import { config } from '@/config/deployment';
import { assertReadTool, type ReadTool } from './tools';

/**
 * A minimal MCP client for DocSend's remote server (docs/32-docsend.md §4 E): Streamable HTTP, JSON-RPC over POST,
 * an answer as JSON or as a server-sent event stream. It initializes once, then calls tools from the read
 * allowlist (./tools.ts) and nothing else: no prompts, no resources, no sampling, no notifications but the one
 * the protocol requires after initializing.
 *
 *   - POST to the configured server only, no redirects, a 30-second timeout.
 *   - Pacing: at least `config.docsend.minIntervalMs` between calls.
 *   - A 429 or a 5xx backs off 2, 4, 8 seconds; four tries at most. A 401 is NotSignedIn, for the caller to
 *     refresh the sign-in once.
 *   - The access token appears in nothing this client throws.
 */

export const DOCSEND_MCP_URL = 'https://docsend.com/mcp';
export const PROTOCOL_VERSION = '2025-06-18';

export interface McpResponse { status: number; headers: Headers; text(): Promise<string> }
export interface McpTransport {
  readonly kind: 'https' | 'scripted';
  post(body: string, headers: Record<string, string>): Promise<McpResponse>;
}

export function httpsTransport(url = DOCSEND_MCP_URL, fetchImpl: typeof fetch = fetch): McpTransport {
  return {
    kind: 'https',
    post: (body, headers) => fetchImpl(url, { method: 'POST', headers, body, redirect: 'error', signal: AbortSignal.timeout(30_000) }),
  };
}

export class NotSignedIn extends Error {
  constructor() { super('DocSend: the sign-in was refused; connect DocSend again on Settings → Connections'); this.name = 'NotSignedIn'; }
}
class SessionExpired extends Error {}
export class DocsendError extends Error {
  constructor(readonly status: number, message: string) { super(message); this.name = 'DocsendError'; }
}

/** The JSON-RPC message in an answer: the body itself, or the last `data:` event that carries our id. */
export function parseAnswer(text: string, contentType: string | null, id: number): Record<string, unknown> | null {
  const pick = (m: unknown) => (m && typeof m === 'object' && (m as { id?: unknown }).id === id ? m as Record<string, unknown> : null);
  if ((contentType ?? '').includes('text/event-stream')) {
    let found: Record<string, unknown> | null = null;
    for (const block of text.split(/\r?\n\r?\n/)) {
      const data = block.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trimStart()).join('\n');
      if (!data) continue;
      try { found = pick(JSON.parse(data)) ?? found; } catch { /* a keep-alive or a partial event */ }
    }
    return found;
  }
  try { return pick(JSON.parse(text)); } catch { return null; }
}

/** A tool's result as data: its structured content, else its first text block read as JSON. */
export function toolData(result: unknown): unknown {
  const r = result as { isError?: boolean; structuredContent?: unknown; content?: Array<{ type: string; text?: string }> } | null;
  const text = r?.content?.find((c) => c.type === 'text')?.text;
  if (r?.isError) throw new DocsendError(200, `DocSend: the tool failed: ${(text ?? 'no detail').slice(0, 200)}`);
  if (r?.structuredContent !== undefined) return r.structuredContent;
  if (text === undefined) throw new DocsendError(200, 'DocSend: the tool returned no data');
  try { return JSON.parse(text); } catch { throw new DocsendError(200, `DocSend: the tool returned text, not data: ${text.slice(0, 200)}`); }
}

export interface DocsendClient {
  call(tool: ReadTool, args: Record<string, unknown>): Promise<unknown>;
  readonly stats: { requests: number; bytesIn: number };
}

export function docsendClient(opts: { transport: McpTransport; token: string; minIntervalMs?: number }): DocsendClient {
  const minInterval = opts.minIntervalMs ?? config.docsend.minIntervalMs;
  const stats = { requests: 0, bytesIn: 0 };
  let nextId = 1, session: string | null = null, ready: Promise<void> | null = null, last = 0;

  async function send(message: Record<string, unknown>, expectAnswer: boolean): Promise<Record<string, unknown> | null> {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${opts.token}`,
      'mcp-protocol-version': PROTOCOL_VERSION,
    };
    if (session) headers['mcp-session-id'] = session;
    for (let attempt = 0; ; attempt++) {
      const wait = last + minInterval - Date.now();
      if (wait > 0) await delay(wait);
      last = Date.now();
      stats.requests++;
      const res = await opts.transport.post(JSON.stringify(message), headers);
      const text = await res.text();
      stats.bytesIn += text.length;
      if (res.status === 401 || res.status === 403) throw new NotSignedIn();
      // The server forgot our session (MCP: 404 to a session id): start a new one and send again, once.
      if (res.status === 404 && session && message.method !== 'initialize') throw new SessionExpired();
      if ((res.status === 429 || res.status >= 500) && attempt < 3) { await delay(2000 * 2 ** attempt); continue; }
      if (res.status >= 400) throw new DocsendError(res.status, `DocSend answered ${res.status}`);
      session = res.headers.get('mcp-session-id') ?? session;
      if (!expectAnswer) return null;
      const answer = parseAnswer(text, res.headers.get('content-type'), message.id as number);
      if (!answer) throw new DocsendError(res.status, 'DocSend: no answer to the request');
      const error = answer.error as { message?: string } | undefined;
      if (error) throw new DocsendError(res.status, `DocSend: ${String(error.message ?? 'error').slice(0, 200)}`);
      return answer;
    }
  }

  const initialize = () => (ready ??= (async () => {
    await send({ jsonrpc: '2.0', id: nextId++, method: 'initialize', params: {
      protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'plcos', version: '1' },
    } }, true);
    await send({ jsonrpc: '2.0', method: 'notifications/initialized' }, false);
  })().catch((e) => { ready = null; throw e; }));

  return {
    stats,
    async call(tool, args) {
      assertReadTool(tool);
      const once = async () => {
        await initialize();
        return send({ jsonrpc: '2.0', id: nextId++, method: 'tools/call', params: { name: tool, arguments: args } }, true);
      };
      const answer = await once().catch(async (e) => {
        if (!(e instanceof SessionExpired)) throw e;
        session = null; ready = null;
        return once();
      });
      return toolData(answer!.result);
    },
  };
}
