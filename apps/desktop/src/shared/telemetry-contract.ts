/** Shared renderer/main contract for the Usage (telemetry) view. */

export interface TelemetrySteeringSummaryContract {
  readonly count: number;
  readonly fired: number;
  readonly skipped: number;
  readonly skippedByReason: Record<string, number>;
}

export interface TelemetryRecentTurnContract {
  readonly traceId: string;
  readonly conversationId?: string;
  readonly status: string;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly durationMs: number;
  readonly providerId?: string;
  readonly model?: string;
  readonly rounds: number;
  readonly toolCalls: number;
  readonly toolsSucceeded: number;
  readonly toolsFailed: number;
  readonly compactionCount: number;
  readonly inputTokens?: number;
  readonly cachedInputTokens?: number;
  readonly freshInputTokens?: number;
  readonly outputTokens?: number;
  readonly reasoningOutputTokens?: number;
}

export interface TelemetryDailyTurnContract {
  readonly date: string;
  readonly total: number;
  readonly completed: number;
  readonly failed: number;
}

export interface TelemetryReportContract {
  readonly generatedAt: string;
  readonly telemetryDir: string | null;
  readonly enabled: boolean;
  readonly providerRequests: number;
  readonly turns: number;
  readonly turnsByStatus: Record<string, number>;
  readonly steering: TelemetrySteeringSummaryContract;
  readonly cacheHitRate: number;
  readonly freshTokenRatio: number;
  readonly providerRequestsPerTurn: number;
  readonly providerRequestsPerCompletedTurn: number;
  readonly providerRequestsPerTraceMedian: number;
  readonly providerRequestsPerTraceP95: number;
  readonly roundsPerTurnMedian: number;
  readonly roundsPerTurnP95: number;
  readonly freshTokensPerCompletedTurn: number;
  readonly costPerCompletedTurn: number | null;
  readonly failureWasteRatio: number;
  readonly dailyTurns: readonly TelemetryDailyTurnContract[];
  readonly recentTurns: readonly TelemetryRecentTurnContract[];
}
