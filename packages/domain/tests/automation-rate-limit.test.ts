// Pure domain tests for the automation rate-limit policy (ticket #82, Klaster C).
// Business rule: how often a plugin may emit automation events (steady rate,
// burst capacity, payload cap). The stateful token-bucket implementation stays
// in infrastructure and delegates the refill math here.

import { describe, expect, it } from "vitest";
import {
  DEFAULT_AUTOMATION_RATE_LIMITS,
  refillAutomationBucket,
  type AutomationBucket,
  type RateLimiterSettings,
} from "../src/index.js";

describe("automation rate-limit policy", () => {
  it("pins the business defaults: 10/min steady, 2x burst (20), 64 KiB payload cap", () => {
    expect(DEFAULT_AUTOMATION_RATE_LIMITS).toEqual({
      steadyRatePerMinute: 10,
      burstCapacity: 20,
      maxPayloadBytes: 64 * 1024,
    });
  });

  it("refills tokens over time at the steady rate", () => {
    const settings: RateLimiterSettings = {
      steadyRatePerMinute: 60,
      burstCapacity: 6,
      maxPayloadBytes: 1024,
    };
    const bucket: AutomationBucket = refillAutomationBucket(
      { tokens: 0, lastRefillMs: 0 },
      1_000,
      settings,
    );
    // 60/min = 1 token per second
    expect(bucket.tokens).toBe(1);
    expect(bucket.lastRefillMs).toBe(1_000);
  });

  it("caps refill at burst capacity", () => {
    const settings: RateLimiterSettings = {
      steadyRatePerMinute: 10,
      burstCapacity: 3,
      maxPayloadBytes: 1024,
    };
    const bucket = refillAutomationBucket(
      { tokens: 2, lastRefillMs: 0 },
      60_000 * 100,
      settings,
    );
    expect(bucket.tokens).toBe(3);
  });

  it("does not refill when time has not advanced", () => {
    const settings: RateLimiterSettings = {
      steadyRatePerMinute: 60,
      burstCapacity: 6,
      maxPayloadBytes: 1024,
    };
    const bucket = refillAutomationBucket(
      { tokens: 2, lastRefillMs: 5_000 },
      5_000,
      settings,
    );
    expect(bucket.tokens).toBe(2);
    expect(bucket.lastRefillMs).toBe(5_000);
  });

  it("accrues fractional tokens without rounding (float bucket)", () => {
    const settings: RateLimiterSettings = {
      steadyRatePerMinute: 10,
      burstCapacity: 20,
      maxPayloadBytes: 1024,
    };
    const bucket = refillAutomationBucket(
      { tokens: 0, lastRefillMs: 0 },
      30_000,
      settings,
    );
    expect(bucket.tokens).toBeCloseTo(5);
  });

  it("returns a fresh bucket instead of mutating the input", () => {
    const settings: RateLimiterSettings = {
      steadyRatePerMinute: 60,
      burstCapacity: 6,
      maxPayloadBytes: 1024,
    };
    const input: AutomationBucket = { tokens: 1, lastRefillMs: 0 };
    const output = refillAutomationBucket(input, 1_000, settings);
    expect(input.tokens).toBe(1);
    expect(output).not.toBe(input);
  });
});
