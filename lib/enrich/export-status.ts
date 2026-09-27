import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Counts-only receipt; never persist a database error, query or source payload here. */
export interface ResearchExportStatus {
  at: string;
  identityReviewError: 'timeout' | 'failed' | null;
  lpUnitReviewError?: 'timeout' | 'failed' | null;
}

export async function readResearchExportStatus(dir: string): Promise<ResearchExportStatus | null> {
  try {
    const status = JSON.parse(await readFile(join(dir, 'export-status.json'), 'utf8')) as ResearchExportStatus;
    return typeof status.at === 'string' && [null, 'timeout', 'failed'].includes(status.identityReviewError) ? status : null;
  } catch { return null; }
}
