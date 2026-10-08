export const IMPORT_KINDS = ['workflow','findings','prospects','duplicates','pursuits','lp-units','spv-stance','dakota','strategy-moves','affinity','network','export','linear','linear-rebuild','calendar'] as const;
export type ImportKind = typeof IMPORT_KINDS[number];
export interface ImportJob {
  id: string; kind: ImportKind; actor: string; input: Record<string, unknown>;
  status: 'queued' | 'running' | 'completed' | 'failed'; phase: string;
  done: number; total: number | null; result: Record<string, unknown> | null; error: string | null;
  created_at: Date; started_at: Date | null; heartbeat_at: Date | null; finished_at: Date | null;
}
export type ImportProgress = (phase: string, done?: number, total?: number | null) => Promise<void>;
export const IMPORT_LABELS: Record<ImportKind, string> = {
  workflow: 'Run research workflow', network: 'Build network', export: 'Export research set',
  findings: 'Import findings', prospects: 'Add prospects', duplicates: 'Merge duplicate identities',
  pursuits: 'Consolidate pursuits', 'lp-units': 'Re-point pursuits to their LP', 'spv-stance': 'Derive SPV stance', dakota: 'Import Dakota', 'strategy-moves': 'Import strategy moves', affinity: 'Affinity sync', linear: 'Sync Linear', 'linear-rebuild': 'Purge and re-map Linear', calendar: 'Read calendars',
};
