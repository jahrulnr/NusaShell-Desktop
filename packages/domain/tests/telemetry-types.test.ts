// Domain contract tests for the telemetry record shapes (ticket #84, Klaster E).
// Pins the metadata-first invariant: telemetry records must never carry prompt
// content, keys, or cost fields — only numeric usage, timing, and status.

import { describe, expect, it } from "vitest";
import type {
  AgentTurnTelemetry,
  ProviderRequestTelemetry,
  SteeringTelemetry,
  TelemetryRecord,
} from "@nusashell/domain";

/** Keys that must never appear on any telemetry record payload. */
const FORBIDDEN_KEYS = ["prompt", "messages", "content", "output", "apiKey", "authorization", "cost", "key"];

function collectKeys(value: unknown, prefix = "", seen: string[] = []): string[] {
  if (typeof value !== "object" || value === null) return seen;
  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    seen.push(path);
    collectKeys(child, path, seen);
  }
  return seen;
}

describe("domain telemetry types (metadata-first contract)", () => {
  const providerRequest: ProviderRequestTelemetry = {
    kind: "provider_request",
    schemaVersion: 1,
    traceId: "trace-1",
    conversationId: "conv-1",
    timestamp: "2026-08-08T10:00:00.000Z",
    providerId: "anthropic",
    model: "claude-4",
    round: 1,
    usage: {
      inputTokens: 100,
      outputTokens: 50,
      cachedInputTokens: 40,
      cacheWriteTokens: 0,
      reasoningOutputTokens: 0,
      source: "provider",
    },
    timing: { startedAt: "2026-08-08T10:00:00.000Z", completedAt: "2026-08-08T10:00:01.000Z", latencyMs: 1000 },
    outcome: { status: "completed", finishReason: "stop" },
  };

  const agentTurn: AgentTurnTelemetry = {
    kind: "agent_turn",
    schemaVersion: 1,
    traceId: "trace-1",
    conversationId: "conv-1",
    startedAt: "2026-08-08T10:00:00.000Z",
    completedAt: "2026-08-08T10:01:00.000Z",
    durationMs: 60_000,
    providerId: "anthropic",
    model: "claude-4",
    status: "completed",
    rounds: 3,
    tools: { calls: 5, succeeded: 4, failed: 1 },
    compaction: { count: 0 },
  };

  const steering: SteeringTelemetry = {
    kind: "steering",
    schemaVersion: 1,
    traceId: "trace-1",
    conversationId: "conv-1",
    triggeredAt: "2026-08-08T10:01:00.000Z",
    jobCount: 2,
    outcome: "skipped",
    reason: "composer-busy",
  };

  it("exposes the three discriminated record kinds at schemaVersion 1", () => {
    const records: TelemetryRecord[] = [providerRequest, agentTurn, steering];
    expect(records.map((record) => record.kind)).toEqual(["provider_request", "agent_turn", "steering"]);
    for (const record of records) {
      expect(record.schemaVersion).toBe(1);
    }
  });

  it("never carries prompt, key, or cost content in any record", () => {
    for (const record of [providerRequest, agentTurn, steering]) {
      const keys = collectKeys(record);
      const forbidden = keys.filter((key) => {
        const leaf = key.split(".").pop()!;
        return FORBIDDEN_KEYS.includes(leaf);
      });
      expect(forbidden).toEqual([]);
    }
  });

  it("keeps steering reasons restricted to the agreed vocabulary", () => {
    const reasons = ["not-idle", "composer-busy", "other"] as const;
    for (const reason of reasons) {
      const record: SteeringTelemetry = { ...steering, outcome: "skipped", reason };
      expect(record.reason).toBe(reason);
    }
    // Fired steers must not carry a reason (omit the optional field entirely).
    const fired: SteeringTelemetry = {
      kind: "steering",
      schemaVersion: 1,
      traceId: "trace-1",
      conversationId: "conv-1",
      triggeredAt: "2026-08-08T10:01:00.000Z",
      jobCount: 1,
      outcome: "fired",
    };
    expect(fired.outcome).toBe("fired");
    expect("reason" in fired).toBe(false);
  });
});
