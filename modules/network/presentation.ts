import type { Route } from './types';

// Full evidence cards are expensive to render, even when route search is cached.
// Keep each response small; the complete ranked result and deep-link indices remain intact.
export const ROUTES_PER_PAGE = 6;
const integer = (value: string | undefined) => value !== undefined && /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : null;

/** Bound both equivalent presentations; original indices remain the route identity. */
export function routePage(routes: Route[], options: { expanded?: string; page?: string; selected?: string; family?: string }) {
  const alternatives = new Map<number, Array<{ route: Route; index: number }>>();
  const indexed = routes.map((route, index) => ({ route, index }));
  for (const entry of indexed) {
    const parent = entry.route.foldedUnder;
    if (parent == null) continue;
    const group = alternatives.get(parent) ?? [];
    group.push(entry);
    alternatives.set(parent, group);
  }
  const requestedFamily = integer(options.family);
  const family = requestedFamily !== null && routes[requestedFamily]
    ? routes[requestedFamily]!.foldedUnder ?? requestedFamily : null;
  const requestedSelection = integer(options.selected);
  const eligible = indexed.filter(({ route, index }) => family !== null
    ? index === family || route.foldedUnder === family
    : options.expanded === '1' || route.foldedUnder == null || index === requestedSelection);
  const selectedPosition = eligible.findIndex(({ index }) => index === requestedSelection);
  const pages = Math.max(1, Math.ceil(eligible.length / ROUTES_PER_PAGE));
  const page = selectedPosition >= 0 ? Math.floor(selectedPosition / ROUTES_PER_PAGE)
    : Math.min(pages - 1, integer(options.page) ?? 0);
  const shown = eligible.slice(page * ROUTES_PER_PAGE, (page + 1) * ROUTES_PER_PAGE);
  return { shown, alternatives, family, page, pages, eligibleCount: eligible.length,
    first: eligible.length ? page * ROUTES_PER_PAGE + 1 : 0,
    last: page * ROUTES_PER_PAGE + shown.length,
    selected: selectedPosition >= 0 ? requestedSelection! : shown[0]?.index ?? 0 };
}
