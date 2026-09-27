export type ActivitySource = 'affinity' | 'warehouse' | 'dakota' | 'linear' | 'intake' | 'search' | 'fetch' | 'sec' | 'agents';
export interface ActivityPoint {
  day: string;                 // YYYY-MM-DD (UTC)
  source: ActivitySource;
  segment: string | null;      // a sub-series within the source (e.g. affinity: 'lists' | 'notes' | 'meetings'; dakota: 'account' | 'contact'; linear: 'issues' | 'projects' | …; agents: workflow id), or null
  requests: number | null;     // outbound requests (null = unknown)
  bytesIn: number | null;
  bytesOut: number | null;
  records: number | null;      // records or entries pulled or written
  estimated: boolean;          // true = backfilled estimate, drawn dashed or lighter
  basis?: string;              // how an estimate was made
}
export interface OriginCount { day: string; origin: string; requests: number; estimated: boolean }  // search/fetch hosts, e.g. 'sec.gov'
export interface SourceSummary { id: ActivitySource; label: string; state: 'connected' | 'read-only' | 'files' | 'planned'; lastAt: string | null; note: string }
export interface ActivityData { points: ActivityPoint[]; origins: OriginCount[]; sources: SourceSummary[]; asOf: string }
