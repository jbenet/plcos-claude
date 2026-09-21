export type { Claim, Confidence, DocStrength, Note, Provenance, SourceDoc } from './types';
export {
  claimCounts, claimsFor, corpusCoverage, getSourceDoc, listSourceDocs, noteKindCounts,
  notesFor, snapshotCount, unverifiedCount, weaklySupportedCount,
} from './repo';
export type { Gap, Method, MethodKind, MethodStatus } from './enrichment';
export {
  METHOD_KIND_LABEL, METHOD_KIND_MEANS, STATUS_LABEL as METHOD_STATUS_LABEL,
  gapsFor, gapsForTarget, listMethods,
} from './enrichment';
