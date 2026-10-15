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
  check('PACKED ROWS share repeated plain values, send Dates as instants, and other columns as they are',
    'd' in packed.c.scoreKind! && 'd' in packed.c.spv! && 'e' in packed.c.at! && 'v' in packed.c.nan!
      && back[0]!.at !== back[1]!.at && (back[0]!.at as Date).getTime() === when.getTime(),
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
    link: i % 6 ? `/meetings?e=e-${i % 40}&m=${(i * 7919).toString(16).padStart(8, '0')}-invented` : `/close`,
    loose: i % 2 ? `x${i}` : null, copyOfLoose: i % 2 ? `x${i}` : null, text: i % 4 ? 'same' : 'other', notText: i % 4 ? 'same' : 0,
    key: `e-${i % 40}:invented`, almostKey: i === 399 ? 'other' : `e-${i % 40}:invented`,
    seen: i % 3 ? new Date(Date.UTC(2026, 9, 1 + (i % 9), 10)) : null, ...(i % 3 ? { mixed: new Date(Date.UTC(2026, 9, 1)) } : {}),
  }));
  const shapedPacked = packRows(shaped), shapedBack = unpackRows<typeof shaped[number]>(shapedPacked);
  check('PACKED ROWS send a column equal to an earlier one as its name, and split unique text by its shape',
    shapedBack.every((row, i) => isDeepStrictEqual(row, shaped[i]) && ('maybe' in row) === ('alsoMaybe' in row))
      && 'a' in shapedPacked.c.orgId! && 'a' in shapedPacked.c.alsoMaybe! && 'a' in shapedPacked.c.m! && 'a' in shapedPacked.c.copyOfLoose!
      && !('a' in shapedPacked.c.notText!) && 'h' in shapedPacked.c.href! && 'h' in shapedPacked.c.id!
      && (shapedPacked.c.link as { r?: string }).r === 'id'
      && (shapedPacked.c.key as { a?: string; s?: string }).s === ':invented' && !('a' in shapedPacked.c.almostKey!)
      && 'e' in shapedPacked.c.seen! && 'v' in shapedPacked.c.mixed! && shapedBack[1]!.seen !== shapedBack[10]!.seen,
    JSON.stringify(Object.fromEntries(Object.entries(shapedPacked.c).map(([k, c]) => [k, Object.keys(c).join('')]))));
  const vehicles = ['invented-one', 'invented-two', 'invented-three'];
  const floor = Array.from({ length: 300 }, (_, i) => {
    const entityId = `00000000-0000-4000-8000-${(i * 104729).toString(16).padStart(12, '0')}`;
    return { key: `${entityId}:${vehicles[i % 3]}`, label: i % 2 ? `${entityId}!` : `${entityId}?`, entityId, name: `Invented ${i}`,
      upper: i === 7 ? entityId.toUpperCase() : entityId.replace('00000000', 'ffffffff'), edge: i % 2 ? 'ffffffff-ffff-4fff-bfff-ffffffffffff' : `0000000${i % 10}-0000-4000-8000-00000000000${i % 10}` };
  });
  const floorPacked = packRows(floor);
  check('PACKED ROWS send a column that is a later column plus a few endings as that column and the endings',
    unpackRows<typeof floor[number]>(floorPacked).every((row, i) => isDeepStrictEqual(row, floor[i]))
      && (floorPacked.c.key as { a?: string }).a === 'entityId' && 'x' in floorPacked.c.key!
      && 'x' in floorPacked.c.label! && 'u' in floorPacked.c.entityId! && !('u' in floorPacked.c.upper!)
      && JSON.stringify(floorPacked.c.key).length < 1000,
    JSON.stringify(Object.fromEntries(Object.entries(floorPacked.c).map(([k, c]) => [k, `${Object.keys(c).join('')} ${JSON.stringify(c).length}`]))));
  const ids = Array.from({ length: 50 }, (_, i) => ({ id: `${(i * 2654435761 % 4294967296).toString(16).padStart(8, '0')}-abcd-4ef0-9123-${(i * 40503).toString(16).padStart(12, '0')}` }));
  const idsPacked = packRows(ids);
  check('PACKED ROWS send distinct ids as 22 characters each and read them back exactly',
    unpackRows<{ id: string }>(JSON.parse(JSON.stringify(idsPacked))).every((row, i) => row.id === ids[i]!.id)
      && (idsPacked.c.id as { u?: string }).u?.length === 50 * 22,
    JSON.stringify(idsPacked).length + ' bytes for 50 ids');
  check('PACKED ROWS of no rows read back as no rows', unpackRows(packRows([])).length === 0, '');
}
