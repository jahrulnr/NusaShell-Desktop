/**
 * Skill-curator policy — pure domain rule (ticket #84, Klaster E).
 *
 * Moved from `packages/application/src/skill/skill-curator-service.ts`.
 * Holds the curator settings defaults, the stale/archive state machine, and
 * the activity-time helper. I/O (registry listing, provenance lookup, usage
 * records, state persistence) stays in the application `SkillCuratorService`.
 */

export type SkillState = "active" | "stale" | "archived";

/** Minimal structural timestamps needed to compute the latest activity. */
export interface ActivityTimestamps {
  readonly lastUsedAt: string | null;
  readonly lastViewedAt: string | null;
  readonly lastPatchedAt: string | null;
  readonly createdAt: string;
}

export function latestActivityAt(record: ActivityTimestamps): string {
  const candidates = [record.lastUsedAt, record.lastViewedAt, record.lastPatchedAt].filter(
    (value): value is string => value !== null,
  );
  if (candidates.length === 0) return record.createdAt;
  return candidates.reduce((latest, current) => (current > latest ? current : latest));
}

export interface CuratorSettings {
  readonly enabled: boolean;
  readonly staleAfterDays: number;
  readonly archiveAfterDays: number;
  readonly pruneUserOwned: boolean;
}

export const DEFAULT_CURATOR_SETTINGS: CuratorSettings = {
  enabled: true,
  staleAfterDays: 30,
  archiveAfterDays: 90,
  pruneUserOwned: false,
};

export interface CuratorDecisionInput {
  readonly currentState: SkillState;
  /** Full days since the last activity, already computed by the caller. */
  readonly daysSinceActivity: number;
  readonly pinned: boolean;
  /** Provenance origin (`agent`, `user`, `bundled`, …). */
  readonly origin: string;
  readonly settings: CuratorSettings;
}

/**
 * Decide the next curator state for a skill, or null when nothing should
 * change. Pure: the caller is responsible for reading provenance/usage and
 * persisting the outcome.
 */
export function decideSkillState(input: CuratorDecisionInput): SkillState | null {
  const { currentState, daysSinceActivity, pinned, origin, settings } = input;
  if (pinned) return null;
  if (origin !== "agent" && !settings.pruneUserOwned) return null;

  let nextState: SkillState | null = null;
  if (currentState === "active" && daysSinceActivity >= settings.staleAfterDays) {
    nextState = "stale";
  } else if (currentState === "stale" && daysSinceActivity >= settings.archiveAfterDays) {
    nextState = "archived";
  } else if (currentState === "active" && daysSinceActivity >= settings.archiveAfterDays) {
    nextState = "archived";
  }

  if (!nextState || nextState === currentState) return null;
  return nextState;
}
