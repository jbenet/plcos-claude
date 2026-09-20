import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Batch, Connector, CoreRecord, Invalidation, Watermark } from './types';

/**
 * The only connector that exists before L13: it reads a JSON file from fixtures/.
 * Everything that will later come from Affinity, EDGAR or Drive arrives through this
 * shape first, so the product gets proven against the contract and not against a vendor.
 */
export function fixtureConnector<TRaw>(
  source: string,
  file: string,
  normalize: (raw: TRaw) => CoreRecord[],
): Connector<TRaw> {
  const load = async (): Promise<TRaw[]> => {
    const text = await readFile(join(process.cwd(), 'fixtures', file), 'utf8');
    const parsed: unknown = JSON.parse(text);
    return Array.isArray(parsed) ? (parsed as TRaw[]) : [];
  };

  return {
    source,
    capabilities: { backfill: true, poll: false, webhook: 'none', bulkShare: false },

    async *backfill(): AsyncIterable<Batch<TRaw>> {
      yield { records: await load(), cursor: null, fetchedAt: new Date() };
    },

    async *poll(_watermark: Watermark): AsyncIterable<Batch<TRaw>> {
      // A fixture does not change. Saying so is better than yielding an empty batch that
      // reads as "nothing new upstream".
      return;
    },

    async onWebhook(): Promise<Invalidation[]> {
      return [];
    },

    normalize,
  };
}
