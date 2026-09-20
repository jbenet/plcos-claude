export type Dimension = 'capacity' | 'affinity' | 'propensity' | 'time_to_decision';

export const DIMENSIONS: Dimension[] = ['capacity', 'affinity', 'propensity', 'time_to_decision'];

export const DIMENSION_LABEL: Record<Dimension, string> = {
  capacity: 'Capacity',
  affinity: 'Affinity',
  propensity: 'Propensity',
  time_to_decision: 'Time to decision',
};

export const DIMENSION_MEANS: Record<Dimension, string> = {
  capacity: 'Can they write a cheque this size at all, on evidence rather than reputation.',
  affinity: 'Does the mandate actually match — the thesis, the instrument, the stage.',
  propensity: 'Do they commit to managers like us, or do they look and pass.',
  time_to_decision: 'Will they decide inside our window. A yes in March is a no for this close.',
};

export interface Weights {
  weightsId: string;
  label: string;
  capacity: number;
  affinity: number;
  propensity: number;
  timeToDecision: number;
  active: boolean;
  createdByName: string | null;
  createdAt: Date;
}

export interface Factor {
  dimension: Dimension;
  value: number;
  basis: string;
  source: string | null;
  asOf: Date;
  recordedByName: string | null;
}

/** A band, not a percentage. The number is shown with its inputs or not at all. */
export type Band = 'strong' | 'worth_a_look' | 'weak' | 'unscored';

export const BAND_LABEL: Record<Band, string> = {
  strong: 'Strong on the rubric',
  worth_a_look: 'Worth a look',
  weak: 'Weak on the evidence',
  unscored: 'Not scored',
};

export interface Scored {
  entityId: string;
  entityName: string;
  vehicleId: string;
  vehicleName: string;
  factors: Factor[];
  missing: Dimension[];
  /** Null when any factor is missing. A partial rubric is not a score. */
  score: number | null;
  band: Band;
  /** Which dimension contributed most, so the ranking can be argued with. */
  leading: Dimension | null;
}
