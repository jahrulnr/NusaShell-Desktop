/**
 * Automation rate-limit policy (ticket #82, Klaster C).
 *
 * Business rule: how often a plugin may emit automation events — steady rate
 * per minute, burst capacity (2x from cold), and a payload byte cap. The
 * stateful token-bucket implementation stays in infrastructure as a port
 * implementation; the refill math lives here as a pure function so the rule is
 * pinned by domain tests and infra cannot drift from it.
 *
 * Defaults: 10 events/minute steady rate, 2x capacity for burst (20 tokens
 * from cold), 64 KB payload cap.
 */
export interface RateLimiterSettings {
  readonly steadyRatePerMinute: number;
  readonly burstCapacity: number;
  readonly maxPayloadBytes: number;
}

export const DEFAULT_AUTOMATION_RATE_LIMITS: RateLimiterSettings = {
  steadyRatePerMinute: 10,
  burstCapacity: 20,
  maxPayloadBytes: 64 * 1024,
};

export interface AutomationBucket {
  tokens: number;
  lastRefillMs: number;
}

/**
 * Pure refill: accrue tokens at the steady rate since the last refill, capped
 * at burst capacity. Returns a fresh bucket; the input is never mutated.
 * When time has not advanced (elapsed <= 0) the bucket is returned unchanged
 * (same timestamp).
 */
export function refillAutomationBucket(
  bucket: AutomationBucket,
  nowMs: number,
  settings: RateLimiterSettings,
): AutomationBucket {
  const elapsedMs = nowMs - bucket.lastRefillMs;
  if (elapsedMs <= 0) {
    return { ...bucket };
  }
  const refillTokens = (elapsedMs / 60_000) * settings.steadyRatePerMinute;
  return {
    tokens: Math.min(settings.burstCapacity, bucket.tokens + refillTokens),
    lastRefillMs: nowMs,
  };
}
