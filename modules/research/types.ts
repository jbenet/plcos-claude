export type Confidence = 'high' | 'medium' | 'low';
export type DocStrength = 'strong' | 'moderate' | 'weak';

export interface SourceDoc {
  docId: string;
  title: string;
  kind: string;
  origin: string;
  asOf: Date;
  strength: DocStrength;
  /** What this document can and cannot be used to support. */
  supports: string;
  body: string;
}

/** The provenance tuple. A field that cannot show all four does not get claimed. */
export interface Provenance {
  source: string;
  asOf: Date;
  confidence: Confidence;
  lastVerifiedBy: string | null;
  lastVerifiedAt: Date | null;
}

export interface Claim {
  claimId: string;
  entityId: string;
  field: string;
  value: string;
  provenance: Provenance;
  supersededBy: string | null;
}

export interface Note {
  noteId: string;
  entityId: string | null;
  author: string | null;
  kind: string;
  body: string;
  tags: string[];
  data: Record<string, unknown>;
  createdAt: Date;
}

/**
 * How a claim's field reads on a page. The seed's fields are written as labels already; a
 * translated one (N47) is a key, and its number is dollars.
 */
export const CLAIM_LABEL: Record<string, string> = {
  typical_check_usd: 'Typical check, as the list records it',
  aum_usd: 'AUM — their claim, not verified',
};
export const claimLabel = (field: string): string => CLAIM_LABEL[field] ?? field;
