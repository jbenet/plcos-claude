/** '$100K+ (floor)' (W1 1.49): at least that much, the top not known — many angel checks, sizes unknown. */
export const CAPACITY_BANDS = ['<$25K', '$25–50K', '$50–250K', '$100K+ (floor)', '$250K–1M', '$1–5M', '$5–25M', '>$25M', 'unknown'] as const;

export type CapacityBand = (typeof CAPACITY_BANDS)[number] | '<$250K';
/** Legacy input stays broad; do not invent a narrower estimate. */
export const capacityBandLabel = (band: string) => band === '<$250K' ? '<$250K (legacy; range unspecified)' : band;
export const readableCapacityBand = (band: string) => band === '<$250K' || (CAPACITY_BANDS as readonly string[]).includes(band);

