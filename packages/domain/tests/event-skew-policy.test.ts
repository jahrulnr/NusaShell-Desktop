// Pure domain tests for the event-skew policy (ticket #83, Klaster D):
// delivery-latency thresholds and flood-window warning suppression.
// Ported from apps/desktop/tests/event-skew-checker.test.ts.

import { describe, expect, it, vi } from "vitest";
import {
  checkEventSkew,
  FLOOD_WINDOW_MS,
  SKEW_THRESHOLD_MS,
} from "../src/index.js";

describe("event skew policy", () => {
  it("pins the skew threshold and flood window", () => {
    expect(SKEW_THRESHOLD_MS).toBe(250);
    expect(FLOOD_WINDOW_MS).toBe(5000);
  });

  it("returns no warning when skew is below threshold", () => {
    const warn = vi.fn();
    const result = checkEventSkew(
      { event: "agent.text_delta", sequence: 1, emittedAt: 900 },
      { now: 1000, thresholdMs: 250, warn, lastWarnAt: 0 },
    );
    expect(result.warned).toBe(false);
    expect(warn).not.toHaveBeenCalled();
  });

  it("warns when skew exceeds threshold", () => {
    const warn = vi.fn();
    const result = checkEventSkew(
      { event: "agent.text_delta", sequence: 5, emittedAt: 500 },
      { now: 1000, thresholdMs: 250, warn, lastWarnAt: 0 },
    );
    expect(result.warned).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
    const msg = warn.mock.calls[0]![0] as string;
    expect(msg).toContain("ipc.skew");
    expect(msg).toContain("event=agent.text_delta");
    expect(msg).toContain("skewMs=500");
    expect(msg).toContain("sequence=5");
  });

  it("does not warn again within the flood window", () => {
    const warn = vi.fn();
    const r1 = checkEventSkew(
      { event: "x", sequence: 1, emittedAt: 500 },
      { now: 1000, thresholdMs: 250, warn, lastWarnAt: 0 },
    );
    expect(r1.warned).toBe(true);
    const r2 = checkEventSkew(
      { event: "x", sequence: 2, emittedAt: 600 },
      { now: 1100, thresholdMs: 250, warn, lastWarnAt: r1.lastWarnAt },
    );
    expect(r2.warned).toBe(false);
  });

  it("warns again after the flood window expires", () => {
    const warn = vi.fn();
    const r1 = checkEventSkew(
      { event: "x", sequence: 1, emittedAt: 500 },
      { now: 1000, thresholdMs: 250, warn, lastWarnAt: 0 },
    );
    const r2 = checkEventSkew(
      { event: "x", sequence: 2, emittedAt: 5600 },
      { now: 6000, thresholdMs: 250, warn, lastWarnAt: r1.lastWarnAt },
    );
    expect(r2.warned).toBe(true);
  });

  it("no-ops when emittedAt is missing", () => {
    const warn = vi.fn();
    const result = checkEventSkew(
      { event: "x", sequence: 1 } as never,
      { now: 1000, thresholdMs: 250, warn, lastWarnAt: 0 },
    );
    expect(result.warned).toBe(false);
    expect(warn).not.toHaveBeenCalled();
  });
});
