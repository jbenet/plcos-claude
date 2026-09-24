'use client';

import { createContext, useContext } from 'react';
import type { FloorItem } from '@/lib/floor-client';
import { RUNG_LABEL, STATUS_LABEL, type PursuitStatus } from '@/modules/strategy/client';

/**
 * What the reader has pointed at, and what the filter bar is hiding.
 *
 * Passed through context rather than through fifteen sets of props. A view opts in by
 * calling `useFloorSelection()`; the ones that have not been taught to yet keep working,
 * which is the whole reason it is a context and not a required prop.
 */

export type Selected =
  | { kind: 'item'; key: string }
  | { kind: 'person'; name: string }
  | { kind: 'entity'; entityId: string; name: string }
  | { kind: 'note'; title: string; lines: Array<{ label: string; value: string }> }
  | null;

export interface FloorFilter {
  /** Matches a target, an owner, an advocate or a piece of work, case-insensitively. */
  find: string;
  owner: string | 'everyone';
  signal: 'all' | 'hot' | 'quiet' | 'blocked' | 'urgent' | 'stalled' | 'evidence' | 'unsized' | 'wired';
  /** The pipeline status (N62, issue 0008), not the rung: the ladder is the evidence under it. */
  status: PursuitStatus | 'all';
}

export const EMPTY_FILTER: FloorFilter = {
  find: '', owner: 'everyone', signal: 'all', status: 'all',
};

export const SIGNAL_LABEL: Record<FloorFilter['signal'], string> = {
  all: 'All signals',
  hot: 'Moving — recorded in the last week',
  quiet: 'Gone quiet — nothing for six weeks',
  blocked: 'Blocked, restricted or contested',
  urgent: 'Dated in the next fortnight',
  stalled: 'Stalled — three weeks without a record',
  evidence: 'Needs evidence — ahead of the ladder',
  unsized: 'No number from them',
  wired: 'Cash received',
};

export function matches(item: FloorItem, f: FloorFilter): boolean {
  if (f.owner !== 'everyone' && item.ownerName !== f.owner) return false;
  if (f.status !== 'all' && item.status !== f.status) return false;
  switch (f.signal) {
    case 'hot': if (item.temp !== 'hot') return false; break;
    case 'quiet': if (item.temp !== 'cold' && item.temp !== 'unmoved') return false; break;
    case 'blocked': if (!item.blocked && !item.restricted && !item.conflict) return false; break;
    case 'urgent': if (!item.urgent) return false; break;
    case 'stalled': if (!item.stalled) return false; break;
    case 'evidence': if (!item.needsEvidence) return false; break;
    case 'unsized': if (item.amount !== null) return false; break;
    case 'wired': if (!item.cashReceived) return false; break;
    default: break;
  }
  if (f.find.trim()) {
    const q = f.find.trim().toLowerCase();
    const hay = [
      item.entityName, item.vehicleName, item.ownerName, item.headline ?? '',
      item.blocked ?? '', item.urgent ?? '', STATUS_LABEL[item.status],
      item.rung ? RUNG_LABEL[item.rung] : '', item.needsEvidence ? 'needs evidence' : '',
    ].join(' ').toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}

interface FloorCtx {
  selected: Selected;
  select: (next: Selected) => void;
  filter: FloorFilter;
}

const Ctx = createContext<FloorCtx>({ selected: null, select: () => {}, filter: EMPTY_FILTER });

export const FloorProvider = Ctx.Provider;

export function useFloor(): FloorCtx {
  return useContext(Ctx);
}
