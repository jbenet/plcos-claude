/**
 * The outreach scopes (docs/27-outreach-api.md §2). They ride in an MCP token's `tools`, beside the MCP
 * tool names: the token row is the work envelope for both. Neither names an MCP tool, so neither appears
 * on /api/mcp; a token without them gets 403 from /api/outreach. Read and write are separate grants.
 */
export const OUTREACH_READ = 'outreach:read';
export const OUTREACH_WRITE = 'outreach:write';
export const OUTREACH_SCOPES = [OUTREACH_READ, OUTREACH_WRITE] as const;
export type OutreachScope = (typeof OUTREACH_SCOPES)[number];
