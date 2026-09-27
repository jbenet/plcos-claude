/** Request-local sharing for the three visualization projections. React cache expires with
 * the render: a later request always reads current records, never a completed-page cache. */
import { cache } from 'react';
import { circuitBreaker as breaker } from '@/modules/agents';
import { listAsks as asks, listConflicts as conflicts, listRestrictions as restrictions, connectorLoad as load } from '@/modules/coordination';
import { listAssets as assets } from '@/modules/content';
import { listOpenTickets as tickets } from '@/modules/governance';
import { coverageGaps as gaps } from '@/modules/library';
import { listMeetings as meetings, listObjections as objections } from '@/modules/meetings';
import { poolChecks as pools } from '@/modules/pipeline';
import { listVehicles as vehicles } from '@/modules/platform';
import { listMethods as methods } from '@/modules/research';
import { listPursuits as pursuits } from '@/modules/strategy';

export const circuitBreaker = cache(breaker);
export const listAsks = cache(asks);
export const listConflicts = cache(conflicts);
export const listRestrictions = cache(restrictions);
export const connectorLoad = cache(load);
export const listAssets = cache(assets);
export const listOpenTickets = cache(tickets);
export const coverageGaps = cache(gaps);
export const listMeetings = cache(meetings);
export const listObjections = cache(objections);
export const poolChecks = cache(pools);
export const listVehicles = cache(vehicles);
export const listMethods = cache(methods);
export const listPursuits = cache(pursuits);
