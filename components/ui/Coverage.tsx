import { Info } from './Info';

export interface CoverageProps {
  corpus: string;
  from: string | null;
  to: string | null;
  /** Sources deliberately not inspected. Rendered, not logged. */
  notInspected: Array<{ source: string; why: string }>;
}

const list = (names: string[]): string =>
  names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;

/**
 * Rule 7. Every search surface states which corpus and date range were inspected, and
 * distinguishes "no supported result in the material available" from "none exists". The corpus and
 * dates stay on the line; what was left out, and what an empty result means, sit behind the "i"
 * (Juan, 11 Oct 2026: too much text nobody reads).
 */
export function Coverage({ corpus, from, to, notInspected }: CoverageProps) {
  return (
    <p className="cover">
      <b>Searched:</b> {corpus}
      {from && to ? `, ${from} to ${to}` : ''}.
      <Info label="What was searched">
        {notInspected.length > 0 && (
          <span className="ip">
            {list(notInspected.map((n) => n.source))} {notInspected.length === 1 ? 'was' : 'were'} not inspected: no
            connector is attached before L13.
          </span>
        )}
        <span className="ip">An empty result here means nothing supported was found in the material available, not that nothing exists.</span>
      </Info>
    </p>
  );
}
