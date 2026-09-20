'use client';

import { useState } from 'react';

export interface EvidenceDoc {
  docId: string;
  title: string;
  origin: string;
  asOf: string;
  strength: 'strong' | 'moderate' | 'weak';
  supports: string;
}

/**
 * The inline source pointer, used everywhere a claim is made.
 *
 * It carries a discipline rather than a decoration: the popover states what the document
 * can support, not just where it came from — which is the difference between citing a
 * conference attendee list and relying on one.
 */
export function EvidenceRef({ doc }: { doc: EvidenceDoc }) {
  const [open, setOpen] = useState(false);

  return (
    <span className="evref">
      <button
        className="src"
        onClick={() => setOpen(!open)}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        aria-expanded={open}
        aria-label={`Source ${doc.docId}: ${doc.title}`}
      >
        {doc.docId}
      </button>
      {open && (
        <span className="evpop" role="tooltip">
          <span className="lbl">
            {doc.docId} · {doc.strength} evidence
          </span>
          <b>{doc.title}</b>
          <span className="o">
            {doc.origin} · as of {doc.asOf}
          </span>
          <span className="s">{doc.supports}</span>
        </span>
      )}
    </span>
  );
}
