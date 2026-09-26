'use client';

import { useRef, type ReactNode } from 'react';

/** Native disclosures remain usable before hydration. Bulk controls affect presentation only. */
export function RouteSections({ children }: { children: ReactNode }) {
  const scope = useRef<HTMLDivElement>(null);
  const setAll = (open: boolean) => scope.current?.querySelectorAll('details').forEach((d) => { d.open = open; });
  return <div className="routes-workspace" ref={scope}>
    <div className="routes-disclosures"><button type="button" onClick={() => setAll(false)}>Collapse all</button><button type="button" onClick={() => setAll(true)}>Expand all</button></div>
    {children}
  </div>;
}
