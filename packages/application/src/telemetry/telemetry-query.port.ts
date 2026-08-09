import type { TelemetryRecord } from "./telemetry.types.js";

/** Read options for a telemetry query (fail-soft, metadata-only). */
export interface TelemetryReadOptions {
  /** Optional global record limit after sorting by event timestamp, newest first. */
  readonly limit?: number;
  /** If true, only read records after this ISO timestamp (exclusive). */
  readonly since?: string;
}

/** Summary of one aggregated telemetry dashboard response. */
export interface TelemetryReport {
  readonly generatedAt: string;
  readonly telemetryDir: string | null;
  readonly enabled: boolean;
  readonly providerRequests: number;
  readonly turns: number;
  readonly turnsByStatus: Record<string, number>;
  readonly steering: TelemetrySteeringSummary;
  readonly cacheHitRate: number;
  readonly freshTokenRatio: number;
  readonly providerRequestsPerTurn: number;
  readonly providerRequestsPerCompletedTurn: number;
  readonly providerRequestsPerTraceMedian: number;
  readonly providerRequestsPerTraceP95: number;
  readonly roundsPerTurnMedian: number;
  readonly roundsPerTurnP95: number;
  readonly freshTokensPerCompletedTurn: number;
  // Cost passthrough is a follow-up; always null for now per token-telemetry.md.
  readonly costPerCompletedTurn: number | null;
  readonly failureWasteRatio: number;
  /** Seven UTC calendar days ending at generatedAt, oldest first. */
  readonly dailyTurns: readonly DailyTurnSummary[];
  /** Recently finished turns (newest first). */
  readonly recentTurns: readonly RecentTurn[];
}

export interface DailyTurnSummary {
  readonly date: string;
  readonly total: number;
  readonly completed: number;
  readonly failed: number;
}

export interface TelemetrySteeringSummary {
  readonly count: number;
  readonly fired: number;
  readonly skipped: number;
  readonly skippedByReason: Record<string, number>;
}

export interface RecentTurn {
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

/**
 * Read-only port for telemetry. Implementations read the JSONL files written
 * by a TelemetryPort (write path). MUST be fail-soft: missing dir, corrupt
 * lines, or I/O errors yield an empty/partial result, never a throw that
 * could break a query.
 */
export interface TelemetryQueryPort {
  /** Whether a telemetry directory is configured (telemetry enabled). */
  readonly enabled: boolean;
  /** Configured telemetry directory, or null when disabled. */
  readonly telemetryDir: string | null;
  /** Read raw records (provider_request / agent_turn), fail-soft. */
  readRecords(options?: TelemetryReadOptions): Promise<readonly TelemetryRecord[]>;
}
