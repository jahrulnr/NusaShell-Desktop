import type { QueryHandler } from "../../../messaging/query-handler.js";
import type { TelemetryQueryPort, TelemetryReport } from "../../telemetry-query.port.js";
import type { TelemetryRecord, AgentTurnTelemetry } from "../../telemetry.types.js";
import type { TelemetryGetReportQuery, TelemetryGetReportResult } from "./telemetry-get-report.query.js";

const EMPTY_REPORT = (now: Date, telemetryDir: string | null, enabled: boolean): TelemetryReport => ({
  generatedAt: now.toISOString(),
  telemetryDir,
  enabled,
  providerRequests: 0,
  turns: 0,
  turnsByStatus: {},
  steering: { count: 0, fired: 0, skipped: 0, skippedByReason: {} },
  cacheHitRate: 0,
  freshTokenRatio: 0,
  providerRequestsPerTurn: 0,
  providerRequestsPerCompletedTurn: 0,
  providerRequestsPerTraceMedian: 0,
  providerRequestsPerTraceP95: 0,
  roundsPerTurnMedian: 0,
  roundsPerTurnP95: 0,
  freshTokensPerCompletedTurn: 0,
  costPerCompletedTurn: null,
  failureWasteRatio: 0,
  dailyTurns: buildDailyTurns([], now),
  recentTurns: [],
});

function utcDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function buildDailyTurns(turns: readonly AgentTurnTelemetry[], now: Date) {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(end);
    date.setUTCDate(end.getUTCDate() - (6 - index));
    return { date: utcDateKey(date), total: 0, completed: 0, failed: 0 };
  });
  const byDate = new Map(days.map((day) => [day.date, day]));
  for (const turn of turns) {
    const completedAt = new Date(turn.completedAt);
    if (Number.isNaN(completedAt.getTime())) continue;
    const day = byDate.get(utcDateKey(completedAt));
    if (!day) continue;
    day.total += 1;
    if (turn.status === "completed") day.completed += 1;
    if (turn.status === "failed") day.failed += 1;
  }
  return days;
}

/**
 * Aggregate TelemetryReport from the raw JSONL records.
 * Pure — takes records so it is unit-testable without a filesystem.
 */
export function computeTelemetryReport(
  records: readonly TelemetryRecord[],
  now: Date = new Date(),
  recentLimit = 50,
): TelemetryReport {
  const providerRequests = records.filter((record): record is Extract<TelemetryRecord, { kind: "provider_request" }> => record.kind === "provider_request");
  const turns = records.filter((record): record is AgentTurnTelemetry => record.kind === "agent_turn");
  const steeringRecords = records.filter((record): record is Extract<TelemetryRecord, { kind: "steering" }> => record.kind === "steering");

  const steering = {
    count: steeringRecords.length,
    fired: steeringRecords.filter((record) => record.outcome === "fired").length,
    skipped: steeringRecords.filter((record) => record.outcome === "skipped").length,
    skippedByReason: steeringRecords.reduce<Record<string, number>>((acc, record) => {
      if (record.outcome === "skipped" && record.reason) {
        acc[record.reason] = (acc[record.reason] ?? 0) + 1;
      }
      return acc;
    }, {}),
  };

  const byStatus: Record<string, number> = { completed: 0, failed: 0, cancelled: 0, superseded: 0 };
  for (const turn of turns) {
    if (turn.status in byStatus) {
      byStatus[turn.status] = (byStatus[turn.status] ?? 0) + 1;
    }
  }
  const completedTurns = turns.filter((turn) => turn.status === "completed");

  const withUsage = providerRequests.filter((request) => request.usage);
  const inputTokens = withUsage.reduce((sum, request) => sum + (request.usage?.inputTokens ?? 0), 0);
  const cachedInputTokens = withUsage.reduce((sum, request) => sum + (request.usage?.cachedInputTokens ?? 0), 0);
  const freshInputTokens = Math.max(0, inputTokens - cachedInputTokens);

  // Provider requests per trace (≈ per turn) for amplification stats.
  const perTrace = new Map<string, number>();
  for (const request of providerRequests) {
    perTrace.set(request.traceId, (perTrace.get(request.traceId) ?? 0) + 1);
  }
  const perTraceCounts = [...perTrace.values()];

  const turnTotalTokens = (turn: AgentTurnTelemetry) =>
    (turn.usage?.inputTokens ?? 0) + (turn.usage?.outputTokens ?? 0);
  const totalTurnTokens = turns.reduce((sum, turn) => sum + turnTotalTokens(turn), 0);
  const wastedTurnTokens = turns
    .filter((turn) => turn.status !== "completed")
    .reduce((sum, turn) => sum + turnTotalTokens(turn), 0);

  const freshOf = (usage: { inputTokens?: number; cachedInputTokens?: number } | undefined) =>
    Math.max(0, (usage?.inputTokens ?? 0) - (usage?.cachedInputTokens ?? 0));
  const freshPerCompleted = completedTurns.map((turn) => freshOf(turn.usage));
  const roundsPerTurn = turns.map((turn) => turn.rounds ?? 0);

  const ratio = (numerator: number, denominator: number) => (denominator > 0 ? numerator / denominator : 0);

  const percentile = (values: number[], p: number) => {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const rank = (p / 100) * (sorted.length - 1);
    const low = Math.floor(rank);
    const high = Math.ceil(rank);
    if (low === high) return sorted[low] ?? 0;
    const weight = rank - low;
    return (sorted[low] ?? 0) * (1 - weight) + (sorted[high] ?? 0) * weight;
  };
  const median = (values: number[]) => percentile(values, 50);

  const recentTurns = [...turns]
    .sort((a, b) => (a.completedAt < b.completedAt ? 1 : a.completedAt > b.completedAt ? -1 : 0))
    .slice(0, recentLimit)
    .map((turn) => ({
      traceId: turn.traceId,
      ...(turn.conversationId ? { conversationId: turn.conversationId } : {}),
      status: turn.status,
      startedAt: turn.startedAt,
      completedAt: turn.completedAt,
      durationMs: turn.durationMs,
      ...(turn.providerId ? { providerId: turn.providerId } : {}),
      ...(turn.model ? { model: turn.model } : {}),
      rounds: turn.rounds ?? 0,
      toolCalls: turn.tools?.calls ?? 0,
      toolsSucceeded: turn.tools?.succeeded ?? 0,
      toolsFailed: turn.tools?.failed ?? 0,
      compactionCount: turn.compaction?.count ?? 0,
      ...(turn.usage?.inputTokens !== undefined ? { inputTokens: turn.usage.inputTokens } : {}),
      ...(turn.usage?.cachedInputTokens !== undefined ? { cachedInputTokens: turn.usage.cachedInputTokens } : {}),
      ...(turn.usage ? { freshInputTokens: freshOf(turn.usage) } : {}),
      ...(turn.usage?.outputTokens !== undefined ? { outputTokens: turn.usage.outputTokens } : {}),
      ...(turn.usage?.reasoningOutputTokens !== undefined ? { reasoningOutputTokens: turn.usage.reasoningOutputTokens } : {}),
    }));

  return {
    generatedAt: now.toISOString(),
    telemetryDir: null, // filled by the handler with the actual path
    enabled: true,
    providerRequests: providerRequests.length,
    turns: turns.length,
    turnsByStatus: byStatus,
    steering,
    cacheHitRate: ratio(cachedInputTokens, inputTokens),
    freshTokenRatio: ratio(freshInputTokens, inputTokens),
    providerRequestsPerTurn: ratio(providerRequests.length, turns.length),
    providerRequestsPerCompletedTurn: ratio(providerRequests.length, completedTurns.length),
    providerRequestsPerTraceMedian: median(perTraceCounts),
    providerRequestsPerTraceP95: percentile(perTraceCounts, 95),
    roundsPerTurnMedian: median(roundsPerTurn),
    roundsPerTurnP95: percentile(roundsPerTurn, 95),
    freshTokensPerCompletedTurn: ratio(
      freshPerCompleted.reduce((sum, value) => sum + value, 0),
      completedTurns.length,
    ),
    costPerCompletedTurn: null,
    failureWasteRatio: ratio(wastedTurnTokens, totalTurnTokens),
    dailyTurns: buildDailyTurns(turns, now),
    recentTurns,
  };
}

/** Query handler for `telemetry.get-report` — fail-soft read of the JSONL spine. */
export class TelemetryGetReportHandler implements QueryHandler<TelemetryGetReportQuery, TelemetryGetReportResult> {
  constructor(private readonly query: TelemetryQueryPort) {}

  async handle(query: TelemetryGetReportQuery): Promise<TelemetryGetReportResult> {
    if (!this.query.enabled || !this.query.telemetryDir) {
      return EMPTY_REPORT(new Date(), null, false);
    }
    try {
      // Aggregate the whole retained telemetry spine. recentLimit only caps the
      // detail list; applying it to raw records corrupts every summary metric.
      const records = await this.query.readRecords();
      const report = computeTelemetryReport(records, new Date(), Math.max(1, query.recentLimit ?? 50));
      return { ...report, telemetryDir: this.query.telemetryDir };
    } catch {
      // Fail-soft: never break a UI query on telemetry read errors.
      return EMPTY_REPORT(new Date(), this.query.telemetryDir, true);
    }
  }
}
