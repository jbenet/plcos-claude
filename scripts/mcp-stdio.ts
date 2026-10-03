/**
 * A stdio bridge to Capital OS's MCP endpoint (docs/26-mcp.md), for clients that start local MCP
 * servers as commands — Claude Desktop. It holds no logic and no data: each message from stdin goes
 * to /api/mcp with the token, and each answer comes back on stdout. Claude Code needs none of this;
 * it speaks HTTP to the endpoint directly.
 *
 *   PLCOS_MCP_URL=http://localhost:3000/api/mcp PLCOS_MCP_TOKEN=plcos_mcp_… npx tsx scripts/mcp-stdio.ts
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const url = process.env.PLCOS_MCP_URL ?? 'http://localhost:3000/api/mcp';
const token = process.env.PLCOS_MCP_TOKEN ?? '';
// stdout carries the protocol, so every word for a person goes to stderr.
const say = (line: string) => process.stderr.write(`[capital-os mcp] ${line}\n`);
if (!token.startsWith('plcos_mcp_')) {
  say('Set PLCOS_MCP_TOKEN to a token made in Preferences → MCP access.');
  process.exit(1);
}

const local = new StdioServerTransport();
const remote = new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: { Authorization: `Bearer ${token}` } } });
local.onmessage = (message) => {
  remote.send(message).catch((e: unknown) => {
    say(`${url}: ${e instanceof Error ? e.message : String(e)}`);
    // Answer the request rather than leave the client waiting.
    if ('id' in message && 'method' in message) void local.send({ jsonrpc: '2.0', id: message.id, error: { code: -32000, message: `Capital OS did not answer: ${e instanceof Error ? e.message : String(e)}` } });
  });
};
remote.onmessage = (message) => { void local.send(message); };
remote.onerror = (e) => say(e.message);
local.onclose = () => { void remote.close(); process.exit(0); };
await remote.start();
await local.start();
say(`bridging stdio to ${url}`);
