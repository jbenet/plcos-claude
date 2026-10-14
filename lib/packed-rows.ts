/**
 * A list's rows, packed for the trip to the browser (performance pass, 12 Oct 2026).
 *
 * Pipeline and Selection send every LP in scope, and each row as an object repeats its ~70 key names
 * and the same few values ("Provisional", the vehicle's name and id, an unknown SPV stance). At 3,000
 * LPs that was 6 MB of HTML, and the browser spent about a second parsing it before the page could be
 * used. Packed, each column is sent once: its values in row order, or, when fewer distinct values make
 * it shorter, each distinct value once and an index per row. Unpacking gives rows equal to the ones
 * packed, with plain values shared between rows that had equal ones; nothing here may mutate a row.
 *
 * A column is shared only when every value in it is plain JSON (strings, finite numbers, booleans,
 * null, arrays and plain objects of those), so equal text always means equal values; any other column
 * (a Date, say) is sent as it is, which the page's own serialiser already handles.
 *
 * A column whose every value is a list of objects (a row's people, its firms) is itself packed: all
 * rows' items as one packed list, and each row's count. Each row reads back its own new array.
 *
 * Two more encodings (performance pass, 14 Oct 2026; a calendar of 56,000 dated rows was 11.6 MB):
 * - A column equal to an earlier one on every row (an org's entityId and orgId, its org and name) is
 *   sent as that column's name.
 * - A text column of mostly unique values with a few shapes (`/meetings?e=<LP>&m=<meeting>`,
 *   `meet:<id>`) is split at its last `=`, `:` or `/`: the heads shared as above, the tails as they are.
 */
export interface PackedRows {
  n: number;
  /** Column → its values in row order, or `[distinct values, index per row]`. */
  c: Record<string, { v: unknown[] } | { d: unknown[]; i: number[] } | { l: PackedRows; k: number[] }
    | { a: string } | { h: { d: unknown[]; i: number[] }; t: string[] }>;
}

function plain(value: unknown): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value) && !Object.is(value, -0);
  if (Array.isArray(value)) return value.every(plain);
  if (typeof value === 'object') {
    const proto = Object.getPrototypeOf(value);
    return (proto === Object.prototype || proto === null) && Object.values(value as object).every(plain);
  }
  return false;
}

/** Keyed by type and text, so a string and a number that print alike stay apart. */
const record = (value: unknown) => typeof value === 'object' && value !== null && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));

const keyOf = (value: unknown) => `${Array.isArray(value) ? 'a' : typeof value}${JSON.stringify(value)}`;

/** Each distinct value once and an index per row, and whether that is shorter than the values as they are. */
function share(values: unknown[]) {
  const d: unknown[] = [], at = new Map<string, number>(), i: number[] = [];
  let rawLength = 0, dictLength = 0;
  for (const v of values) {
    const key = v === undefined ? 'u' : keyOf(v);
    rawLength += key.length;
    let index = at.get(key);
    if (index === undefined) { index = d.length; at.set(key, index); d.push(v); dictLength += key.length; }
    i.push(index);
    dictLength += String(index).length + 1;
  }
  return { d, i, rawLength, dictLength };
}

/** Text split after its last `=`, `:` or `/`, when shared heads and plain tails are shorter; else null. */
function split(values: unknown[], rawLength: number) {
  if (!values.length || !values.every((v) => typeof v === 'string')) return null;
  const heads: string[] = [], t: string[] = [];
  for (const v of values as string[]) {
    const cut = Math.max(v.lastIndexOf('='), v.lastIndexOf(':'), v.lastIndexOf('/')) + 1;
    heads.push(v.slice(0, cut)); t.push(v.slice(cut));
  }
  const { d, i, rawLength: headRaw, dictLength } = share(heads);
  const length = Math.min(headRaw, dictLength) + t.reduce((n, x) => n + x.length + 3, 0);
  return length < rawLength * 0.8 ? { h: { d, i }, t } : null;
}

export function packRows<T extends object>(rows: readonly T[]): PackedRows {
  const columns = new Set<string>();
  for (const row of rows) for (const k of Object.keys(row)) columns.add(k);
  const c: PackedRows['c'] = {};
  const plainColumns: Array<[string, unknown[]]> = [];
  for (const k of columns) {
    // A row without the key reads back without it: `undefined` stands for missing.
    const values = rows.map((row) => (Object.prototype.hasOwnProperty.call(row, k) ? (row as Record<string, unknown>)[k] : undefined));
    if (values.length && values.every((v) => Array.isArray(v) && v.every(record)) && values.some((v) => (v as unknown[]).length)) {
      const lists = values as object[][];
      c[k] = { l: packRows(lists.flat()), k: lists.map((list) => list.length) };
      continue;
    }
    if (!values.every((v) => v === undefined || plain(v))) { c[k] = { v: values }; continue; }
    // Text, numbers, booleans and nulls only: equal values are identical, so a copy reads back equal.
    const same = values.every((v) => v === undefined || v === null || typeof v !== 'object')
      ? plainColumns.find(([, other]) => other.every((v, r) => Object.is(v, values[r]))) : undefined;
    if (same) { c[k] = { a: same[0] }; continue; }
    if (values.every((v) => v === undefined || v === null || typeof v !== 'object')) plainColumns.push([k, values]);
    const { d, i, rawLength, dictLength } = share(values);
    c[k] = dictLength < rawLength ? { d, i } : split(values, rawLength) ?? { v: values };
  }
  return { n: rows.length, c };
}

export function unpackRows<T>(packed: PackedRows): T[] {
  const rows: Record<string, unknown>[] = Array.from({ length: packed.n }, () => ({}));
  for (const [k, col] of Object.entries(packed.c)) {
    if ('l' in col) {
      const items = unpackRows<unknown>(col.l);
      let at = 0;
      col.k.forEach((count, r) => { rows[r]![k] = items.slice(at, at + count); at += count; });
    } else if ('v' in col) col.v.forEach((v, r) => { if (v !== undefined) rows[r]![k] = v; });
    else if ('h' in col) col.t.forEach((tail, r) => { rows[r]![k] = (col.h.d[col.h.i[r]!] as string) + tail; });
    else if ('d' in col) col.i.forEach((index, r) => { const v = col.d[index]; if (v !== undefined) rows[r]![k] = v; });
  }
  // A copied column reads its source's values; sources are always earlier, plain, and never copies.
  for (const [k, col] of Object.entries(packed.c)) {
    if ('a' in col) rows.forEach((row) => { const v = row[col.a]; if (v !== undefined) row[k] = v; });
  }
  return rows as T[];
}
