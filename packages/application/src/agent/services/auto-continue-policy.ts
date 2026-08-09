/**
 * Auto-continue policy (ticket #80, Klaster A).
 *
 * The pure policy moved to `packages/domain/src/agent/auto-continue-policy.ts`;
 * this module re-exports it so application consumers keep a stable import
 * path and the outer-loop decision has a single source of truth.
 */
export {
  MAX_AUTO_CONTINUES_CAP,
  DEFAULT_MAX_AUTO_CONTINUES,
  decideAutoContinue,
  normalizeMaxAutoContinues,
  type AutoContinueReason,
  type AutoContinueDecision,
  type AutoContinuePolicyInput,
} from "@nusashell/domain";
