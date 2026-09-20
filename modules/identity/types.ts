export type EntityType = 'person' | 'org' | 'family' | 'foundation' | 'vehicle';

export interface Entity {
  entityId: string;
  entityType: EntityType;
  displayName: string;
  mergedInto: string | null;
  retiredAt: Date | null;
}

export interface SourceRecord {
  source: string;
  sourceId: string;
  entityId: string;
  confidence: number | null;
  resolvedBy: string;
}
