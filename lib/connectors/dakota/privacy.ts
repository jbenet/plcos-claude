import type { Queryable } from '@/lib/db';
/** No record leaves this check. Dakota can appear across the graph, not just on LP pages. */
export async function hasDakota(tx: Queryable): Promise<boolean> {
  return Boolean(await tx.one("select 1 from identity.source_record where source='dakota' limit 1"));
}
export const DAKOTA_FILE_REFUSAL = 'File feedback and screenshots are unavailable while Dakota records are present. Keep Dakota details in the database.';
