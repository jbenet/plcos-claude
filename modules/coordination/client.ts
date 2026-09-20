/**
 * The client-safe half of this module's surface: types and constants, no data access.
 *
 * A 'use client' component that imports from `index.ts` drags the repository — and with it
 * `node:fs` through the Db seam — into the browser bundle. Splitting the inert exports out
 * makes that a compile-time impossibility rather than a thing to remember.
 */
export type {
  Ask, AskOutcome, AskStatus, ConflictCase, ConflictReason, ConflictStatus,
  GuardBlock, GuardReport, Restriction,
} from './types';
export { REASON_LABEL, RULE_LABEL } from './types';
