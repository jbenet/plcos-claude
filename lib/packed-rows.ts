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
 */
export interface PackedRows {
  n: number;
  /** Column → its values in row order, or `[distinct values, index per row]`. */
  c: Record<string, { v: unknown[] } | { d: unknown[]; i: number[] }>;
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
const keyOf = (value: unknown) => `${Array.isArray(value) ? 'a' : typeof value}${JSON.stringify(value)}`;

export function packRows<T extends object>(rows: readonly T[]): PackedRows {
  const columns = new Set<string>();
  for (const row of rows) for (const k of Object.keys(row)) columns.add(k);
  const c: PackedRows['c'] = {};
  for (const k of columns) {
    // A row without the key reads back without it: `undefined` stands for missing.
    const values = rows.map((row) => (Object.prototype.hasOwnProperty.call(row, k) ? (row as Record<string, unknown>)[k] : undefined));
    if (!values.every((v) => v === undefined || plain(v))) { c[k] = { v: values }; continue; }
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
    c[k] = dictLength < rawLength ? { d, i } : { v: values };
  }
  return { n: rows.length, c };
}

export function unpackRows<T>(packed: PackedRows): T[] {
  const rows: Record<string, unknown>[] = Array.from({ length: packed.n }, () => ({}));
  for (const [k, col] of Object.entries(packed.c)) {
    if ('v' in col) col.v.forEach((v, r) => { if (v !== undefined) rows[r]![k] = v; });
    else col.i.forEach((index, r) => { const v = col.d[index]; if (v !== undefined) rows[r]![k] = v; });
  }
  return rows as T[];
}
