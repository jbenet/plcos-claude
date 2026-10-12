/** Invented rows only: packing a list for the browser gives back the same rows (performance pass, 12 Oct 2026). */
import { isDeepStrictEqual } from 'node:util';
import { packRows, unpackRows } from '../../lib/packed-rows';
import type { Check } from './harness';

export async function packedRowsProperties(check: Check) {
  const when = new Date('2026-10-01T00:00:00Z');
  const rows: Array<Record<string, unknown>> = Array.from({ length: 300 }, (_, i) => ({
    id: `row-${i}`, status: ['new', 'sourcing', 'passed'][i % 3], score: i % 5 ? i : null, scoreKind: 'Provisional',
    spv: { stance: 'unknown', minDeals: null }, people: i % 7 ? [] : [{ id: `p-${i}`, name: 'Invented Person' }],
    flag: i % 2 === 0, at: when, ...(i % 11 ? { optional: 'x' } : {}), odd: i % 13 ? '1' : 1, nan: i === 4 ? Number.NaN : 0,
  }));
  const packed = packRows(rows);
  const back = unpackRows<Record<string, unknown>>(packed);
  check('PACKED ROWS read back equal to the rows packed: values, types, missing keys and Dates',
    back.length === rows.length && back.every((row, i) => isDeepStrictEqual(row, rows[i]))
      && back.every((row, i) => ('optional' in row) === ('optional' in rows[i]!)), JSON.stringify(back.slice(0, 2)));
  check('PACKED ROWS share repeated plain values, and send other columns as they are',
    'd' in packed.c.scoreKind! && 'd' in packed.c.spv! && 'v' in packed.c.at! && 'v' in packed.c.nan!,
    JSON.stringify(Object.fromEntries(Object.entries(packed.c).map(([k, c]) => [k, 'd' in c ? 'shared' : 'raw']))));
  check('PACKED ROWS keep a string and a number that print alike apart',
    back.every((row, i) => row.odd === rows[i]!.odd), '');
  check('PACKED ROWS are smaller than the rows as JSON', JSON.stringify(packed).length < JSON.stringify(rows).length * 0.6,
    `${JSON.stringify(packed).length} vs ${JSON.stringify(rows).length}`);
  check('PACKED ROWS of no rows read back as no rows', unpackRows(packRows([])).length === 0, '');
}
