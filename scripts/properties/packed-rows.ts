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
  // A list-of-objects column is packed as one list (people, firms): each row gets its own items back, in order.
  const listed = Array.from({ length: 50 }, (_, i) => ({ id: `lp-${i}`, people: Array.from({ length: i % 4 }, (_, j) => ({
    id: `person-${(i + j) % 9}`, name: `Invented Person ${(i + j) % 9}`, role: j ? 'Invented role' : '', contact: j === 0,
    individual: j === 2 ? `row-${i}` : null, ...(j === 1 ? { since: when } : {}) })) }));
  const nested = packRows(listed), again = unpackRows<typeof listed[number]>(nested);
  check('PACKED ROWS pack a column of object lists as one list, and give each row its own items back',
    'l' in nested.c.people! && again.every((row, i) => isDeepStrictEqual(row, listed[i]))
      && again[1]!.people !== again[5]!.people && JSON.stringify(nested).length < JSON.stringify(listed).length * 0.7,
    `${JSON.stringify(nested).length} vs ${JSON.stringify(listed).length}`);
  // A column equal to an earlier one is sent as its name; unique text of a few shapes splits at its last separator.
  const shaped = Array.from({ length: 400 }, (_, i) => ({
    id: `meet:${(i * 7919).toString(16).padStart(8, '0')}-invented`, entityId: `e-${i % 40}`, orgId: `e-${i % 40}`,
    ...(i % 9 ? { maybe: `m${i}`, alsoMaybe: `m${i}` } : {}), n: i % 3 ? i : null, m: i % 3 ? i : null,
    href: i % 5 ? `/meetings?e=e-${i % 40}&m=${(i * 7919).toString(16).padStart(8, '0')}` : `/close/${i}`,
    loose: i % 2 ? `x${i}` : null, copyOfLoose: i % 2 ? `x${i}` : null, text: i % 4 ? 'same' : 'other', notText: i % 4 ? 'same' : 0,
  }));
  const shapedPacked = packRows(shaped), shapedBack = unpackRows<typeof shaped[number]>(shapedPacked);
  check('PACKED ROWS send a column equal to an earlier one as its name, and split unique text by its shape',
    shapedBack.every((row, i) => isDeepStrictEqual(row, shaped[i]) && ('maybe' in row) === ('alsoMaybe' in row))
      && 'a' in shapedPacked.c.orgId! && 'a' in shapedPacked.c.alsoMaybe! && 'a' in shapedPacked.c.m! && 'a' in shapedPacked.c.copyOfLoose!
      && !('a' in shapedPacked.c.notText!) && 'h' in shapedPacked.c.href! && 'h' in shapedPacked.c.id!,
    JSON.stringify(Object.fromEntries(Object.entries(shapedPacked.c).map(([k, c]) => [k, Object.keys(c).join('')]))));
  check('PACKED ROWS of no rows read back as no rows', unpackRows(packRows([])).length === 0, '');
}
