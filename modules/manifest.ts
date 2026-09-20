/**
 * Module registry — order matters, because migrations run in this order and cross-schema
 * references must already exist. This is a list, not a plugin framework (see CLAUDE.md,
 * "Do not build"). A module owns exactly one Postgres schema of the same name.
 */
export const MODULES = [
  { name: 'platform', schema: 'platform', title: 'Platform', plane: 'confidential' },
  { name: 'identity', schema: 'identity', title: 'Identity', plane: 'confidential' },
  { name: 'research', schema: 'research', title: 'Research & enrichment', plane: 'research' },
  { name: 'governance', schema: 'governance', title: 'Approvals & compliance', plane: 'confidential' },
  { name: 'coordination', schema: 'coordination', title: 'Ask coordination', plane: 'confidential' },
  { name: 'network', schema: 'network', title: 'Warm intro routes', plane: 'confidential' },
  { name: 'strategy', schema: 'strategy', title: 'Conversion strategy', plane: 'confidential' },
  { name: 'pipeline', schema: 'pipeline', title: 'Vehicles, exposure and forecast', plane: 'confidential' },
  { name: 'calendar', schema: 'calendar', title: 'Sprint calendar', plane: 'confidential' },
  { name: 'close', schema: 'close', title: 'Close room and SPV war room', plane: 'confidential' },
  { name: 'scoring', schema: 'scoring', title: 'Selection & recommendations', plane: 'confidential' },
  { name: 'signals', schema: 'signals', title: 'Signals', plane: 'research' },
  { name: 'meetings', schema: 'meetings', title: 'Meetings and decision room', plane: 'confidential' },
  { name: 'content', schema: 'content', title: 'Content studio and send gate', plane: 'confidential' },
  { name: 'grants', schema: 'grants', title: 'Grants rail', plane: 'research' },
  { name: 'agents', schema: 'agents', title: 'Agent runtime and evals', plane: 'confidential' },
  { name: 'compliance', schema: 'compliance', title: 'Claims and solicitation registry', plane: 'confidential' },
] as const;

export type ModuleName = (typeof MODULES)[number]['name'];
