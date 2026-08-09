// SkillState and the activity-time rule are domain-owned (ticket #84,
// Klaster E) so the curator policy and the usage port share one source.
import type { SkillState } from "@nusashell/domain";
export type { SkillState } from "@nusashell/domain";
export { latestActivityAt } from "@nusashell/domain";

export type UsageBumpKind = "use" | "view" | "patch";

export interface SkillUsageRecord {
  readonly skillId: string;
  readonly useCount: number;
  readonly lastUsedAt: string | null;
  readonly viewCount: number;
  readonly lastViewedAt: string | null;
  readonly patchCount: number;
  readonly lastPatchedAt: string | null;
  readonly createdAt: string;
  readonly state: SkillState;
  readonly pinned: boolean;
  readonly archivedAt: string | null;
}

export interface SkillUsagePort {
  record(skillId: string, kind: UsageBumpKind): Promise<void>;
  getRecord(skillId: string): Promise<SkillUsageRecord>;
  listRecords(): Promise<readonly SkillUsageRecord[]>;
  setState(skillId: string, state: SkillState): Promise<void>;
  setPinned(skillId: string, pinned: boolean): Promise<void>;
  clear(skillId: string): Promise<void>;
}
