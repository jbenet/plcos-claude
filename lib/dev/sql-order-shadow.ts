/**
 * Finds SQL where ORDER BY names an output column that the select list made with `col::text`
 * and no other name. Postgres resolves a bare ORDER BY name to the output column first, so the
 * sort is on text: the primary-key index cannot serve it, and keyset paging then seq-scans and
 * sorts the whole table for every page. Found 2 Oct 2026 in the route-policy topology load
 * (4.45 s per rebuild on 118K entities, 0.26 s fixed). A heuristic over template literals, used by
 * the property suite; qualify the column (`e.entity_id`) or alias the cast to fix a hit.
 */
const KEYWORDS = new Set(['from', 'as', 'and', 'or', 'where', 'order', 'group', 'limit', 'having', 'union', 'then', 'else', 'end', 'when', 'is', 'in', 'on', 'join', 'desc', 'asc', 'nulls', 'collate']);

export interface ShadowHit { line: number; column: string }

export function orderByShadows(source: string): ShadowHit[] {
  const hits: ShadowHit[] = [];
  for (const m of source.matchAll(/`([^`]*)`/gs)) {
    const sql = m[1]!;
    if (!/\bselect\b/i.test(sql) || !/\border\s+by\b/i.test(sql)) continue;
    const shadowing = new Set<string>();
    // A select-list item: the cast, an optional name, then a comma or FROM (not a WHERE comparison).
    for (const c of sql.matchAll(/(?<![\w.])(?:\w+\.)?(\w+)::text\b(?:\s+(?:as\s+)?(\w+))?(?=\s*(?:,|\bfrom\b))/gi)) {
      const column = c[1]!.toLowerCase();
      const alias = c[2]?.toLowerCase();
      if (!alias || KEYWORDS.has(alias) || alias === column) shadowing.add(column);
    }
    if (!shadowing.size) continue;
    for (const o of sql.matchAll(/\border\s+by\s+([^;)]*?)(?=\blimit\b|\boffset\b|\)|;|$)/gis)) {
      for (const term of o[1]!.split(',')) {
        const name = term.trim().split(/\s+/)[0]!.toLowerCase();
        if (shadowing.has(name)) hits.push({ line: source.slice(0, m.index).split('\n').length, column: name });
      }
    }
  }
  return hits;
}
