import { describe, expect, it } from "vitest";
import {
  computeTelemetryReport,
  type TelemetryRecord,
  type TelemetryQueryPort,
} from "../src/index.js";
import { TelemetryGetReportHandler } from "../src/index.js";

function turn(overrides: Partial<import("../src/index.js").AgentTurnTelemetry> = {}): TelemetryRecord {
  return {
    kind: "agent_turn",
    schemaVersion: 1,
    traceId: "trace-1",
    conversationId: "conv-1",
    startedAt: "2026-08-08T10:00:00.000Z",
    completedAt: "2026-08-08T10:00:05.000Z",
    durationMs: 5000,
    providerId: "openai",
    model: "gpt-4o",
    status: "completed",
    rounds: 2,
    tools: { calls: 3, succeeded: 3, failed: 0 },
    compaction: { count: 0 },
    usage: {
      inputTokens: 1000,
      outputTokens: 200,
      cachedInputTokens: 300,
      cacheWriteTokens: 0,
      reasoningOutputTokens: 0,
      source: "provider",
    },
    ...overrides,
  };
}

function request(overrides: Partial<import("../src/index.js").ProviderRequestTelemetry> = {}): TelemetryRecord {
  return {
    kind: "provider_request",
    schemaVersion: 1,
    traceId: "trace-1",
    timestamp: "2026-08-08T10:00:02.000Z",
    providerId: "openai",
    model: "gpt-4o",
    round: 1,
    usage: {
      inputTokens: 1000,
      outputTokens: 200,
      cachedInputTokens: 300,
      cacheWriteTokens: 0,
      reasoningOutputTokens: 0,
      source: "provider",
    },
    timing: {
      startedAt: "2026-08-08T10:00:00.000Z",
      completedAt: "2026-08-08T10:00:02.000Z",
      latencyMs: 2000,
    },
    outcome: { status: "completed", finishReason: "stop" },
    ...overrides,
  };
}

describe("computeTelemetryReport", () => {
  it("aggregates turns and provider requests into the dashboard shape", () => {
    const report = computeTelemetryReport(
      [
        turn({ traceId: "trace-1", completedAt: "2026-08-08T10:00:05.000Z", status: "completed" }),
        request(),
        request({ round: 2 }),
        turn({ traceId: "trace-2", completedAt: "2026-08-08T10:00:06.000Z", status: "failed" }),
        turn({ traceId: "trace-3", completedAt: "2026-08-08T10:00:07.000Z", status: "superseded", usage: undefined as unknown as import("../src/index.js").TelemetryTokenUsage }),
      ],
      new Date("2026-08-09T00:00:00.000Z"),
      50,
    );
    expect(report.turns).toBe(3);
    expect(report.turnsByStatus).toEqual({ completed: 1, failed: 1, cancelled: 0, superseded: 1 });
    expect(report.providerRequests).toBe(2);
    // 1 completed turn → fresh tokens = 1000-300 = 700
    expect(report.freshTokensPerCompletedTurn).toBe(700);
    expect(report.cacheHitRate).toBeCloseTo(300 / 1000);
    expect(report.providerRequestsPerTurn).toBeCloseTo(2 / 3);
    expect(report.providerRequestsPerCompletedTurn).toBe(2);
    expect(report.costPerCompletedTurn).toBeNull();
    expect(report.recentTurns).toHaveLength(3);
    // Newest first
    expect(report.recentTurns[0]?.traceId).toBe("trace-3");
    expect(report.recentTurns[0]?.status).toBe("superseded");
    // No usage → freshInputTokens omitted (undefined)
    expect(report.recentTurns[0]?.freshInputTokens).toBeUndefined();
    expect(report.recentTurns[1]?.traceId).toBe("trace-2");
  });

  it("reports failure waste ratio from non-completed turns", () => {
    const report = computeTelemetryReport(
      [
        turn({ status: "completed", usage: { inputTokens: 500, outputTokens: 50, cachedInputTokens: 0, cacheWriteTokens: 0, reasoningOutputTokens: 0, source: "provider" } }),
        turn({ status: "failed", usage: { inputTokens: 5000, outputTokens: 1000, cachedInputTokens: 0, cacheWriteTokens: 0, reasoningOutputTokens: 0, source: "provider" } }),
      ],
      new Date("2026-08-09T00:00:00.000Z"),
      50,
    );
    expect(report.failureWasteRatio).toBeCloseTo(6000 / 6550);
  });

  it("handles empty records without throwing", () => {
    const report = computeTelemetryReport([], new Date(), 50);
    expect(report.turns).toBe(0);
    expect(report.providerRequests).toBe(0);
    expect(report.recentTurns).toEqual([]);
    expect(report.roundsPerTurnMedian).toBe(0);
  });

  it("sorts recent turns newest-first and caps by recentLimit", () => {
    const turns = Array.from({ length: 5 }, (_, i) =>
      turn({
        traceId: `trace-${i}`,
        completedAt: `2026-08-08T10:00:0${i}.000Z`,
      }),
    );
    const report = computeTelemetryReport(turns, new Date(), 2);
    expect(report.recentTurns).toHaveLength(2);
    expect(report.recentTurns[0]?.traceId).toBe("trace-4");
  });

  it("builds a zero-filled seven calendar day series from every turn", () => {
    const report = computeTelemetryReport(
      [
        turn({ traceId: "old", completedAt: "2026-08-02T23:59:59.000Z" }),
        turn({ traceId: "first", completedAt: "2026-08-03T01:00:00.000Z" }),
        turn({ traceId: "failed", completedAt: "2026-08-08T22:00:00.000Z", status: "failed" }),
        turn({ traceId: "latest", completedAt: "2026-08-09T00:00:00.000Z" }),
      ],
      new Date("2026-08-09T12:00:00.000Z"),
      1,
    );

    expect(report.recentTurns).toHaveLength(1);
    expect(report.dailyTurns).toEqual([
      { date: "2026-08-03", total: 1, completed: 1, failed: 0 },
      { date: "2026-08-04", total: 0, completed: 0, failed: 0 },
      { date: "2026-08-05", total: 0, completed: 0, failed: 0 },
      { date: "2026-08-06", total: 0, completed: 0, failed: 0 },
      { date: "2026-08-07", total: 0, completed: 0, failed: 0 },
      { date: "2026-08-08", total: 1, completed: 0, failed: 1 },
      { date: "2026-08-09", total: 1, completed: 1, failed: 0 },
    ]);
  });
});

describe("TelemetryGetReportHandler", () => {
  it("returns disabled empty report when query port is disabled", async () => {
    const port: TelemetryQueryPort = {
      enabled: false,
      telemetryDir: null,
      async readRecords() { return []; },
    };
    const handler = new TelemetryGetReportHandler(port);
    const report = await handler.handle({ kind: "telemetry.get-report" });
    expect(report.enabled).toBe(false);
    expect(report.telemetryDir).toBeNull();
    expect(report.turns).toBe(0);
  });

  it("passes through records from the port and fills telemetryDir", async () => {
    let receivedOptions: unknown = "not-called";
    const port: TelemetryQueryPort = {
      enabled: true,
      telemetryDir: "/tmp/telemetry",
      async readRecords(options) {
        receivedOptions = options;
        return [turn()];
      },
    };
    const handler = new TelemetryGetReportHandler(port);
    const report = await handler.handle({ kind: "telemetry.get-report", recentLimit: 10 });
    expect(report.enabled).toBe(true);
    expect(report.telemetryDir).toBe("/tmp/telemetry");
    expect(report.turns).toBe(1);
    expect(report.recentTurns).toHaveLength(1);
    expect(receivedOptions).toBeUndefined();
  });

  it("fails soft when the port read throws", async () => {
    const port: TelemetryQueryPort = {
      enabled: true,
      telemetryDir: "/tmp/telemetry",
      async readRecords() { throw new Error("boom"); },
    };
    const handler = new TelemetryGetReportHandler(port);
    const report = await handler.handle({ kind: "telemetry.get-report" });
    expect(report.enabled).toBe(true);
    expect(report.turns).toBe(0);
    expect(report.recentTurns).toEqual([]);
  });
});
