/** Client-safe: types, constants and the scorer. No database, by construction. */
export type {
  Gap, Method, MethodKind, MethodStatus, Score, ScoreParams, Verdict as MethodVerdict,
} from './scoring';
export {
  DEFAULT_PARAMS, METHOD_KIND_LABEL, METHOD_KIND_MEANS,
  STATUS_LABEL as METHOD_STATUS_LABEL, TIER_VALUE, VERDICT_LABEL as METHOD_VERDICT_LABEL,
  scoreMethods,
} from './scoring';
