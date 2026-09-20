import type { ReactNode } from 'react';

export interface ProvenanceTuple {
  source: string;
  asOf: string;
  confidence: 'high' | 'medium' | 'low';
  lastVerifiedBy: string | null;
}

/**
 * Rule 9, as a component. A claim that cannot show all four parts of the tuple is not
 * rendered as a fact — `Unsupported` is returned instead, and the caller cannot forget to
 * handle it because there is nothing else to render.
 */
export function ProvenanceLine({ prov }: { prov: ProvenanceTuple }): ReactNode {
  if (!prov.source || !prov.asOf) return <Unsupported why="No source on file" />;
  return (
    <span className="provline mono">
      {prov.source} · as of {prov.asOf} · {prov.confidence}
      {prov.lastVerifiedBy ? ` · verified by ${prov.lastVerifiedBy}` : ' · not verified by anyone'}
    </span>
  );
}

export function Unsupported({ why }: { why: string }) {
  return (
    <span className="stat unavailable" title={why}>
      <i />
      Source unavailable
    </span>
  );
}

/** Plain-language status, never a numeric confidence rendered as fact. */
export function ConfidenceWord({ confidence, verified }: { confidence: string; verified: boolean }) {
  if (verified) {
    return (
      <span className="stat verified">
        <i />
        Verified by a person
      </span>
    );
  }
  if (confidence === 'low') {
    return (
      <span className="stat evidence">
        <i />
        Needs evidence
      </span>
    );
  }
  return (
    <span className="stat waiting">
      <i />
      Unverified
    </span>
  );
}
