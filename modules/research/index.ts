export type { Claim, Confidence, DocStrength, Note, Provenance, SourceDoc } from './types';
export { CLAIM_LABEL, claimLabel } from './types';
export {
  addTeamContext, claimCounts, claimsFor, corpusCoverage, getSourceDoc, listSourceDocs, noteKindCounts,
  notesFor, snapshotCount, unverifiedCount, weaklySupportedCount,
} from './repo';
export type {
  Gap, Method, MethodKind, MethodStatus, Score, ScoreParams, Verdict as MethodVerdict,
} from './scoring';
export {
  DEFAULT_PARAMS, METHOD_KIND_LABEL, METHOD_KIND_MEANS,
  STATUS_LABEL as METHOD_STATUS_LABEL, TIER_VALUE, VERDICT_LABEL as METHOD_VERDICT_LABEL,
  scoreMethods,
} from './scoring';
export { gapsFor, gapsForTarget, listMethods, selectMethod } from './enrichment';
