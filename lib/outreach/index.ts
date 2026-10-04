/**
 * The mail desk's outreach API (docs/27-outreach-api.md). One service layer for the REST routes
 * (app/api/outreach/[op]) and the matching MCP read tools (lib/mcp/tools.ts).
 */
export { corsOrigin, preflight, serveOutreach } from './http';
export { BUCKETS, FUND_FIRST_CHOICES, OutreachRefused, outreachQueue, outreachVehicles, type Bucket, type Check } from './reads';
export { OUTREACH_READ, OUTREACH_SCOPES, OUTREACH_WRITE, type OutreachScope } from './scopes';
