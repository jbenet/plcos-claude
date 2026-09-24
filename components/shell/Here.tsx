'use client';

import { createContext, useContext, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { vehicleOfPath } from '@/lib/paths';

/**
 * The vehicle the links on screen belong to (issues 0027–0028, real), for AppLink to put an old
 * address in its place: the vehicle the address names, else the last one it named, else the one the
 * server read at load — the proxy's rule, which sets the cookie from the address. On the server,
 * usePathname() is the path the proxy rewrote to, so the address the browser asked for comes from
 * the layout, as the rail's does (issue 0011).
 */
const Vehicle = createContext('all');

export function HereProvider({ asked, vehicle, children }: { asked: string | null; vehicle: string; children: React.ReactNode }) {
  const routed = usePathname();
  const path = typeof window === 'undefined' ? (asked ?? routed) : routed;
  const last = useRef(vehicle);
  const named = vehicleOfPath(path);
  if (named) last.current = named;
  return <Vehicle.Provider value={last.current}>{children}</Vehicle.Provider>;
}

export const useVehicleSlug = () => useContext(Vehicle);
