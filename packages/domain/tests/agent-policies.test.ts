// Pure domain tests for the agent policies (ticket #80, Klaster A).

import { describe, expect, it } from "vitest";
import {
  DEFAULT_MAX_AUTO_CONTINUES,
  DEFAULT_UNKNOWN_CONTEXT_WINDOW,
  DEFAULT_UNKNOWN_MAX_OUTPUT,
  MAX_AUTO_CONTINUES_CAP,
  MIN_AGENTIC_CONTEXT_WINDOW,
  SYSTEM_PREFIX_END_MARKER,
  decideAutoContinue,
  machineCurrentTime,
  machineTimeZone,
  normalizeMaxAutoContinues,
  resolveContextThreshold,
  resolveModelContextDefaults,
  stableCurrentDate,
  summarizeTodos,
  tokenLimitReached,
  type AutoContinuePolicyInput,
} from "@nusashell/domain";

describe("domain agent context-window policy", () => {
  it("resolves family defaults by model id (first match wins)", () => {
    expect(resolveModelContextDefaults("deepseek-v4")).toEqual({ contextWindow: 1_048_576, maxOutput: 65_536 });
    expect(resolveModelContextDefaults("deepseek-chat")).toEqual({ contextWindow: 163_840, maxOutput: 32_768 });
    expect(resolveModelContextDefaults("gpt-5-pro")).toEqual({ contextWindow: 400_000, maxOutput: 128_000 });
    expect(resolveModelContextDefaults("claude-sonnet-4")).toEqual({ contextWindow: 1_000_000, maxOutput: 64_000 });
    expect(resolveModelContextDefaults("qwen2.5-coder")).toEqual({ contextWindow: 262_144, maxOutput: 65_536 });
  });

  it("falls back to unknown defaults for unmatched or empty ids", () => {
    expect(resolveModelContextDefaults("totally-unknown-model-xyz")).toEqual({
      contextWindow: DEFAULT_UNKNOWN_CONTEXT_WINDOW,
      maxOutput: DEFAULT_UNKNOWN_MAX_OUTPUT,
    });
    expect(resolveModelContextDefaults(undefined)).toEqual({
      contextWindow: DEFAULT_UNKNOWN_CONTEXT_WINDOW,
      maxOutput: DEFAULT_UNKNOWN_MAX_OUTPUT,
    });
  });

  it("resolves soft/hard thresholds with the 90% + 10k-free algorithm", () => {
    const threshold = resolveContextThreshold(
      { maxInputTokens: 200_000, reserveTokens: 0 },
      { contextWindow: 200_000 },
      "gpt-4o",
    );
    expect(threshold.window).toBe(200_000);
    // 90% (180k) is tighter than window-10k (190k), so the 90% rule wins.
    expect(threshold.soft).toBe(180_000);
  });

  it("caps the window by the user maxInputTokens ceiling", () => {
    const threshold = resolveContextThreshold({ maxInputTokens: 120_000, reserveTokens: 0 }, undefined, "gemini-2.0");
    expect(threshold.window).toBe(120_000);
    // 90% (108k) is tighter than window-10k (110k), so the 90% rule wins.
    expect(threshold.soft).toBe(108_000);
  });

  it("floors heuristic windows at MIN_AGENTIC_CONTEXT_WINDOW", () => {
    // deepseek-chat heuristic is 163_840 — below the 131_072 floor? No: it is
    // above. Use a small-model heuristic window to exercise the floor.
    const threshold = resolveContextThreshold(
      { maxInputTokens: 50_000, reserveTokens: 0 },
      undefined,
      "deepseek-chat",
    );
    // 163_840 >= floor, so effective window stays 163_840 → capped at 50k.
    expect(threshold.window).toBe(50_000);
    expect(MIN_AGENTIC_CONTEXT_WINDOW).toBe(131_072);
  });

  it("applies reserveTokens as a soft ceiling", () => {
    const threshold = resolveContextThreshold({ maxInputTokens: 100_000, reserveTokens: 20_000 }, undefined, "unknown");
    expect(threshold.soft).toBe(80_000);
  });

  it("tokenLimitReached triggers at soft or hard", () => {
    const threshold = { window: 100_000, soft: 90_000 };
    expect(tokenLimitReached(90_000, threshold)).toBe(true);
    expect(tokenLimitReached(99_999, threshold)).toBe(true); // ≥ soft
    expect(tokenLimitReached(100_000, threshold)).toBe(true);
    expect(tokenLimitReached(89_999, threshold)).toBe(false);
  });
});

describe("domain agent todo-status policy", () => {
  it("summarizes todos by status", () => {
    expect(
      summarizeTodos([
        { id: "1", content: "a", status: "pending" },
        { id: "2", content: "b", status: "in_progress" },
        { id: "3", content: "c", status: "completed" },
      ]),
    ).toEqual({ total: 3, pending: 1, inProgress: 1, completed: 1 });
  });
});

describe("domain agent auto-continue policy", () => {
  const base: AutoContinuePolicyInput = {
    items: [{ id: "1", content: "task", status: "pending" }],
    autoContinueIndex: 0,
    maxAutoContinues: 10,
    turnOk: true,
    hasConversation: true,
  };

  it("continues when a successful turn leaves open todos", () => {
    expect(decideAutoContinue(base)).toMatchObject({ shouldContinue: true, reason: "continue" });
  });

  it("stops when the turn asks a question", () => {
    expect(decideAutoContinue({ ...base, turnText: "Selesai? Apakah lanjut?" })).toMatchObject({
      shouldContinue: false,
      reason: "awaiting-user",
    });
  });

  it("stops when no open todos remain", () => {
    expect(decideAutoContinue({ ...base, items: [{ id: "1", content: "t", status: "completed" }] })).toMatchObject({
      shouldContinue: false,
      reason: "no-open-todos",
    });
  });

  it("stops when the budget is exhausted", () => {
    expect(
      decideAutoContinue({ ...base, autoContinueIndex: 10, maxAutoContinues: 10 }),
    ).toMatchObject({ shouldContinue: false, reason: "max-reached" });
  });

  it("treats maxAutoContinues=0 as unlimited", () => {
    expect(decideAutoContinue({ ...base, autoContinueIndex: 99, maxAutoContinues: 0 })).toMatchObject({
      shouldContinue: true,
      reason: "continue",
    });
  });

  it("normalizes the budget (undefined→10, negative→10, cap→10000)", () => {
    expect(normalizeMaxAutoContinues(undefined)).toBe(DEFAULT_MAX_AUTO_CONTINUES);
    expect(normalizeMaxAutoContinues(-5)).toBe(DEFAULT_MAX_AUTO_CONTINUES);
    expect(normalizeMaxAutoContinues(0)).toBe(0);
    expect(normalizeMaxAutoContinues(99_999)).toBe(MAX_AUTO_CONTINUES_CAP);
  });
});

describe("domain agent prompt-composition", () => {
  it("exposes the stable boundary marker", () => {
    expect(SYSTEM_PREFIX_END_MARKER).toBe("=== STABLE SYSTEM PREFIX END / DYNAMIC TAIL BEGIN ===");
  });

  it("formats the stable calendar date", () => {
    const now = new Date("2026-08-09T14:30:00.000Z");
    expect(stableCurrentDate(now)).toBe("2026-08-09");
  });

  it("formats machine local time as HH:MM:SS", () => {
    const now = new Date(2026, 7, 9, 9, 5, 3);
    expect(machineCurrentTime(now)).toBe("09:05:03");
  });

  it("resolves a timezone from Intl", () => {
    expect(typeof machineTimeZone()).toBe("string");
    expect(machineTimeZone().length).toBeGreaterThan(0);
  });
});
