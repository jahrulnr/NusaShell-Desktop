// Pure domain tests for the skill curator policy (ticket #84, Klaster E).
// Pins the stale/archive/pinned state machine and the activity-time helper
// without any registry/usage I/O.

import { describe, expect, it } from "vitest";
import {
  DEFAULT_CURATOR_SETTINGS,
  decideSkillState,
  latestActivityAt,
  type CuratorSettings,
  type SkillState,
} from "@nusashell/domain";

const settings: CuratorSettings = { ...DEFAULT_CURATOR_SETTINGS };

describe("domain skill curator policy", () => {
  it("exposes the agreed default settings (30d stale / 90d archive)", () => {
    expect(DEFAULT_CURATOR_SETTINGS).toEqual({
      enabled: true,
      staleAfterDays: 30,
      archiveAfterDays: 90,
      pruneUserOwned: false,
    });
  });

  describe("decideSkillState", () => {
    const base = {
      currentState: "active" as SkillState,
      daysSinceActivity: 0,
      pinned: false,
      origin: "agent",
      settings,
    };

    it("keeps an active skill active before the stale threshold", () => {
      expect(decideSkillState({ ...base, daysSinceActivity: 10 })).toBeNull();
    });

    it("moves active → stale after staleAfterDays", () => {
      expect(decideSkillState({ ...base, daysSinceActivity: 30 })).toBe("stale");
      expect(decideSkillState({ ...base, daysSinceActivity: 60 })).toBe("stale");
    });

    it("moves stale → archived after archiveAfterDays", () => {
      expect(decideSkillState({ ...base, currentState: "stale", daysSinceActivity: 90 })).toBe("archived");
    });

    it("steps active → stale first even past the archive threshold (stair-step)", () => {
      // The first-match branch (`active && days >= staleAfterDays`) wins, so an
      // active skill always becomes `stale` before it can be archived. The
      // `active → archived` branch in the original service is unreachable; the
      // domain migration preserves that exact behavior.
      expect(decideSkillState({ ...base, daysSinceActivity: 120 })).toBe("stale");
    });

    it("never downgrades when already archived", () => {
      expect(decideSkillState({ ...base, currentState: "archived", daysSinceActivity: 200 })).toBeNull();
    });

    it("skips pinned skills regardless of age", () => {
      expect(decideSkillState({ ...base, pinned: true, daysSinceActivity: 400 })).toBeNull();
    });

    it("skips non-agent origins when pruneUserOwned is false", () => {
      expect(decideSkillState({ ...base, origin: "user", daysSinceActivity: 400 })).toBeNull();
      expect(decideSkillState({ ...base, origin: "bundled", daysSinceActivity: 400 })).toBeNull();
    });

    it("prunes user-owned skills when pruneUserOwned is true", () => {
      const pruningSettings: CuratorSettings = { ...settings, pruneUserOwned: true };
      expect(
        decideSkillState({ ...base, origin: "user", daysSinceActivity: 400, settings: pruningSettings }),
      ).toBe("stale");
    });

    it("respects custom thresholds (stair-step preserved)", () => {
      const fast: CuratorSettings = { ...settings, staleAfterDays: 7, archiveAfterDays: 21 };
      expect(decideSkillState({ ...base, daysSinceActivity: 8, settings: fast })).toBe("stale");
      expect(decideSkillState({ ...base, daysSinceActivity: 22, settings: fast })).toBe("stale");
      expect(
        decideSkillState({ ...base, currentState: "stale", daysSinceActivity: 22, settings: fast }),
      ).toBe("archived");
    });
  });

  describe("latestActivityAt", () => {
    it("picks the newest of used/viewed/patched", () => {
      const record = {
        lastUsedAt: "2026-08-01T00:00:00.000Z",
        lastViewedAt: "2026-08-05T00:00:00.000Z",
        lastPatchedAt: "2026-08-03T00:00:00.000Z",
        createdAt: "2026-07-01T00:00:00.000Z",
      };
      expect(latestActivityAt(record)).toBe("2026-08-05T00:00:00.000Z");
    });

    it("falls back to createdAt when there is no activity", () => {
      const record = {
        lastUsedAt: null,
        lastViewedAt: null,
        lastPatchedAt: null,
        createdAt: "2026-07-01T00:00:00.000Z",
      };
      expect(latestActivityAt(record)).toBe("2026-07-01T00:00:00.000Z");
    });
  });
});
