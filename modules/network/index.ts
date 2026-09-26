export type {
  Edge, EdgeKind, EvidenceTier, Route, RouteHop, RouteSearch, RouteVerdict, RouteScore, RouteScoreFactor, RouteStrength, RouteStats, RouteGraph,
} from './types';
export { CLUE_KINDS, TIER_MEANING, VERDICT_LABEL } from './types';
export { edgeCoverage, entityForUser, enumeratePaths, enumeratePathsFromSources, listEdges, tierCounts, routeSources } from './repo';
export { planRoutes, selectTopRoutes, routeGraph, summarizeRoutes, summarizePipelineRoutes } from './service';
export { tieWarmth, tieDetailsProblems, edgeWarmth, routeWarmth, foldRoutes, warmthReader, scoreRoute, routeStrength, investmentTie } from './warmth';
export type { TieDetails, Warmth, WarmthKind, RouteScoreContext } from './warmth';
export { buildNetwork, reviewEdge, type BuildCounts } from './build';
export type { Component, Influence, Standing, StandingDomain } from './influence';
export { DOMAIN_LABEL, influenceFor, listStandings, VEHICLE_DOMAINS } from './influence';

export { routePage, ROUTES_PER_PAGE } from './presentation';

export { precomputeRoutes } from './cache';
export { planRoutesLive } from './service';
