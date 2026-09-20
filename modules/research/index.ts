export type { Claim, Confidence, DocStrength, Note, Provenance, SourceDoc } from './types';
export {
  claimCounts, claimsFor, corpusCoverage, getSourceDoc, listSourceDocs, noteKindCounts,
  notesFor, snapshotCount, unverifiedCount, weaklySupportedCount,
} from './repo';
