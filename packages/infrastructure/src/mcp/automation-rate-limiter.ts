/**
 * Per-plugin token-bucket rate limiter for automation notifications.
 *
 * The business policy — defaults and the refill math — lives in
 * @nusashell/domain (ticket #82, Klaster C). This class is the stateful port
 * implementation: it owns the per-plugin buckets and delegates refill to the
 * pure domain rule.
 *
 * Defaults: 10 events/minute steady rate, 2x capacity for burst (20 tokens
 * from cold), 64 KB payload cap. Configurable via constructor.
 *
 * See tmp/plan/watch-to-agent/04-mcp-automation-contract.md §Rate limiting.
 */
import {
  DEFAULT_AUTOMATION_RATE_LIMITS,
  refillAutomationBucket,
  type AutomationBucket,
  type RateLimiterSettings,
} from "@nusashell/domain";

export { DEFAULT_AUTOMATION_RATE_LIMITS, type RateLimiterSettings } from "@nusashell/domain";

export class AutomationRateLimiter {
  private readonly buckets = new Map<string, AutomationBucket>();
  private readonly now: () => number;

  constructor(
    private readonly settings: RateLimiterSettings = DEFAULT_AUTOMATION_RATE_LIMITS,
    now?: () => number,
  ) {
    this.now = now ?? (() => Date.now());
  }

  /**
   * Check if a plugin is allowed to emit. Consumes one token if allowed.
   * Returns `true` when the plugin has budget, `false` when rate-limited.
   */
  allow(pluginId: string): boolean {
    const bucket = this.getOrCreateBucket(pluginId);
    this.refill(bucket);
    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return true;
    }
    return false;
  }

  /**
   * Bound a payload to the configured byte cap. Returns the (possibly
   * truncated) serialized string. The caller is responsible for logging a
   * warning when truncation occurs.
   */
  boundPayload(payload: unknown): { truncated: boolean; text: string } {
    const text = serializePayload(payload);
    if (text.length <= this.settings.maxPayloadBytes) {
      return { truncated: false, text };
    }
    return {
      truncated: true,
      text: text.slice(0, this.settings.maxPayloadBytes),
    };
  }

  /** Reset a plugin's bucket (e.g. on plugin stop). */
  reset(pluginId: string): void {
    this.buckets.delete(pluginId);
  }

  /** Reset all buckets. */
  resetAll(): void {
    this.buckets.clear();
  }

  private getOrCreateBucket(pluginId: string): AutomationBucket {
    let bucket = this.buckets.get(pluginId);
    if (!bucket) {
      bucket = {
        tokens: this.settings.burstCapacity,
        lastRefillMs: this.now(),
      };
      this.buckets.set(pluginId, bucket);
    }
    return bucket;
  }

  private refill(bucket: AutomationBucket): void {
    const next = refillAutomationBucket(bucket, this.now(), this.settings);
    bucket.tokens = next.tokens;
    bucket.lastRefillMs = next.lastRefillMs;
  }
}

function serializePayload(payload: unknown): string {
  if (typeof payload === "string") return payload;
  try {
    return JSON.stringify(payload);
  } catch {
    return String(payload ?? "");
  }
}
