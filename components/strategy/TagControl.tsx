'use client';

import { createContext, useContext, useState, type ReactNode } from 'react';
import { tagEventAction } from '@/app/targets/actions';

export interface TagVehicle { slug: string; name: string }

const Vehicles = createContext<TagVehicle[]>([]);

/** The vehicles a tag can name, given once for a whole timeline rather than to every row. */
export function TagVehicles({ vehicles, children }: { vehicles: TagVehicle[]; children: ReactNode }) {
  return <Vehicles.Provider value={vehicles}>{children}</Vehicles.Provider>;
}

/**
 * Say what a row is about (N81): the vehicles, none of them, or not a raise at all. A person's tag
 * stands over the rules and Claude's reading, and the next translation keeps it. Folded shut, and
 * the form is built only when it opens: an LP with a thousand rows would otherwise carry a thousand
 * forms.
 */
export function TagControl({ tagRef, now, checked, general, pursuitId, what }: {
  tagRef: string;
  /** What it says now, and who said so. */
  now: string;
  checked: string[];
  general: boolean;
  pursuitId: string;
  what: string;
}) {
  const vehicles = useContext(Vehicles);
  const [open, setOpen] = useState(false);
  return (
    <details className="retag" onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <summary>Tag</summary>
      {open && (
        <form action={tagEventAction} className="retag-body">
          <div className="p2">Now: {now}</div>
          <input type="hidden" name="ref" value={tagRef} />
          <input type="hidden" name="pursuitId" value={pursuitId} />
          <fieldset>
            <legend>What is this {what} about?</legend>
            {vehicles.map((v) => (
              <label key={v.slug}><input type="checkbox" name="vehicle" value={v.slug} defaultChecked={checked.includes(v.slug)} /> {v.name}</label>
            ))}
            <label><input type="checkbox" name="other" defaultChecked={general} /> General — not about a raise: a catch-up, background, another company</label>
          </fieldset>
          <input name="why" placeholder="Why, in a few words (optional)" maxLength={200} aria-label="Why" />
          <div className="retag-acts">
            <button className="btn" type="submit">Save tag</button>
            <span className="muted">Nothing ticked: about a raise, which vehicle unclear. Every LP on it takes the tag.</span>
          </div>
        </form>
      )}
    </details>
  );
}
