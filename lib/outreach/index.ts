/**
 * Outreach for juanmail (docs/27-outreach-api.md). The services behind the MCP outreach tools (lib/mcp/tools.ts),
 * which are the primary interface, and the thin REST wrapper (app/api/outreach/[op]) that runs the same tools.
 */
export { corsOrigin, preflight, serveOutreach } from './http';
export { BUCKETS, FUND_FIRST_CHOICES, OutreachRefused, outreachQueue, outreachVehicles, type Bucket, type Check } from './reads';
export { OUTREACH_READ, OUTREACH_SCOPES, OUTREACH_WRITE, type OutreachScope } from './scopes';
