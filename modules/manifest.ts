/**
 * Module registry — order matters, because migrations run in this order and cross-schema
 * references must already exist. This is a list, not a plugin framework (see CLAUDE.md,
 * "Do not build"). A module owns exactly one Postgres schema of the same name.
 */
export const MODULES = [
  { name: 'platform', schema: 'platform', title: 'Platform', plane: 'confidential' },
  { name: 'identity', schema: 'identity', title: 'Identity', plane: 'confidential' },
  { name: 'research', schema: 'research', title: 'Research & enrichment', plane: 'research' },
] as const;

export type ModuleName = (typeof MODULES)[number]['name'];
