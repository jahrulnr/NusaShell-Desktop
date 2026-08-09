import { ApplicationError, type ApplicationErrorCode } from "../../errors/application-error.js";
import type {
  AgentMessage,
  AgentTokenUsage,
  AgentToolCall,
  AgentToolExecution,
  AgentTurnPartial,
  AgentTurnStep,
} from "./agent-turn-types.js";
import {
  AgentPolicyError,
  normalizeMaxRounds as normalizeMaxRoundsDomain,
} from "@nusashell/domain";

export function assertTurnActive(signal: AbortSignal | undefined, traceId: string): void {
  if (signal?.aborted) {
    throw new ApplicationError("AGENT_TURN_CANCELLED", "Agent turn cancelled", { traceId });
  }
}

export function repeatedToolDecision(
  calls: readonly AgentToolCall[],
  counts: Map<string, number>,
  maxRepeated: number,
): "execute" | "nudge" | "stop" {
  let decision: "execute" | "nudge" | "stop" = "execute";
  for (const call of calls) {
    const fingerprint = `${call.name}:${stableJson(call.args)}`;
    const count = (counts.get(fingerprint) ?? 0) + 1;
    counts.set(fingerprint, count);
    if (count >= maxRepeated) return "stop";
    if (count === 2) decision = "nudge";
  }
  return decision;
}

export function stableJson(value: unknown): string {
  // `undefined` must produce a distinct fingerprint from `null`/`NaN` (which
  // JSON.stringify renders as "null"); otherwise the repeated-call guard
  // conflates genuinely different arguments.
  if (value === undefined) return '"\\u0000undefined"';
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    return `{${Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function emptyUsage(): AgentTokenUsage {
  return { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, cacheWriteTokens: 0, reasoningOutputTokens: 0 };
}

export function addUsage(target: Mutable<AgentTokenUsage>, value: AgentTokenUsage | undefined): void {
  if (!value) return;
  target.inputTokens += value.inputTokens;
  target.outputTokens += value.outputTokens;
  target.cachedInputTokens += value.cachedInputTokens;
  target.cacheWriteTokens += value.cacheWriteTokens;
  target.reasoningOutputTokens += value.reasoningOutputTokens;
}

export function hasUsage(value: AgentTokenUsage): boolean {
  return Object.values(value).some((tokens) => tokens > 0);
}

type Mutable<T> = { -readonly [Key in keyof T]: T[Key] };

export function validateRequestedTools(
  calls: readonly AgentToolCall[],
  toolsByName: ReadonlyMap<string, unknown>,
  traceId: string,
): void {
  for (const call of calls) {
    if (!call.id || !call.name || !toolsByName.has(call.name)) {
      throw new ApplicationError("AGENT_TOOL_NOT_ALLOWED", "AI provider requested a tool outside the MCP allowlist", {
        traceId,
        toolName: call.name,
      });
    }
  }
}

/**
 * Bounded concurrency pool. Runs `worker(item, index)` with at most
 * `concurrency` in-flight, preserving results indexed by original position.
 * No external dependency — just a tiny index-based worker pool.
 */
export async function runPool<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const limit = Math.max(1, concurrency);
  const results: R[] = new Array(items.length);
  let next = 0;
  async function run(): Promise<void> {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      const item = items[index];
      if (item === undefined) return;
      results[index] = await worker(item, index);
    }
  }
  const workers: Promise<void>[] = [];
  for (let i = 0; i < Math.min(limit, items.length); i++) {
    workers.push(run());
  }
  await Promise.all(workers);
  return results;
}

export function hasTurnProgress(
  toolCalls: readonly AgentToolExecution[],
  steps: readonly AgentTurnStep[],
): boolean {
  if (toolCalls.length > 0) return true;
  return steps.some((step) => step.type === "tool_calls");
}

/**
 * Broader progress check for partial attachment: true if there are in-turn
 * tools OR already-streamed live text/reasoning OR completed text steps.
 * Used on cancel / provider fail / mid-turn catch so pure-text cuts still
 * persist an interrupted assistant with the partial body.
 */
export function hasResumableProgress(
  toolCalls: readonly AgentToolExecution[],
  steps: readonly AgentTurnStep[],
  liveText?: string,
  liveReasoning?: string,
): boolean {
  if (hasTurnProgress(toolCalls, steps)) return true;
  if (liveText && liveText.trim()) return true;
  if (liveReasoning && liveReasoning.trim()) return true;
  return steps.some((step) => step.type === "text");
}

export function buildTurnPartial(
  traceId: string,
  completedRounds: number,
  toolCalls: readonly AgentToolExecution[],
  steps: readonly AgentTurnStep[],
  messages: readonly AgentMessage[],
  model: string | undefined,
  providerId: string | undefined,
  api: "chat" | "responses" | "messages" | undefined,
  reasoning: string | undefined,
  usage: AgentTokenUsage,
  liveText?: string,
  liveReasoning?: string,
  steerBoundaries?: readonly import("./agent-turn-types.js").AgentSteerBoundary[],
): AgentTurnPartial {
  // Prefer live-streamed text/reasoning over empty defaults so mid-stream
  // failures preserve already-painted paragraphs. Fall back to completed text
  // steps (if any), then "".
  const textSteps = liveText ?? steps
    .filter((step) => step.type === "text")
    .map((step) => (step as { content: string }).content)
    .join("");
  const text = (liveText && liveText.trim()) ? liveText : textSteps;
  const reasoningValue = (liveReasoning && liveReasoning.trim()) ? liveReasoning : reasoning;
  return {
    traceId,
    rounds: Math.max(0, completedRounds),
    text,
    toolCalls: [...toolCalls],
    steps: [...steps],
    messages: [...messages],
    ...(steerBoundaries?.length ? { steerBoundaries: [...steerBoundaries] } : {}),
    ...(model ? { model } : {}),
    ...(providerId ? { providerId } : {}),
    ...(api ? { api } : {}),
    ...(reasoningValue ? { reasoning: reasoningValue } : {}),
    ...(hasUsage(usage) ? { usage: { ...usage } } : {}),
  };
}

/**
 * Re-throw with `details.partial` when the turn already has tool progress so
 * the desktop can seal/persist an interrupted assistant and Retry can resume
 * (including user cancel). Errors that already carry a partial pass through.
 */
export function rethrowWithTurnPartial(error: unknown, partial: AgentTurnPartial | undefined): never {
  if (!partial) throw error;
  if (error instanceof ApplicationError) {
    if (error.details && Object.prototype.hasOwnProperty.call(error.details, "partial")) throw error;
    throw new ApplicationError(error.code, error.message, {
      ...error.details,
      partial,
      traceId: typeof error.details?.traceId === "string" ? error.details.traceId : partial.traceId,
    });
  }
  const cause = error instanceof Error ? error.message : String(error);
  throw new ApplicationError("INTERNAL_ERROR", cause, { cause, partial, traceId: partial.traceId });
}

/**
 * Normalize the per-turn tool-round ceiling (rule moved to the domain layer).
 * The domain policy throws `AgentPolicyError`; this boundary wrapper maps it
 * back to the application `AGENT_INVALID_INPUT` contract.
 */
export function normalizeMaxRounds(value: number | undefined): number {
  try {
    return normalizeMaxRoundsDomain(value);
  } catch (error) {
    if (error instanceof AgentPolicyError) {
      throw new ApplicationError(error.code as ApplicationErrorCode, error.message);
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Domain-owned agent tool/compaction policy re-exports (ticket #80, Klaster A)
// ---------------------------------------------------------------------------
export {
  MAX_REPEATED_TOOL_CALLS,
  DEFAULT_MAX_TOOL_ROUNDS,
  MAX_TOOL_ROUNDS_CAP,
  DEFAULT_SOFT_RECOVER_ATTEMPTS,
  MAX_SOFT_RECOVER_ATTEMPTS,
  DEFAULT_MAX_CONCURRENT_TOOL_CALLS,
  MAX_CONCURRENT_TOOL_CALLS_CAP,
  BARRIER_TOOLS,
  isToolAllowed,
  isLazyResolvableMcpToolName,
  unknownToolExecution,
  unwrapUntrustedToolResult,
  clampToolResultContent,
  serializeToolResult,
  normalizeSoftRecover,
  normalizeConcurrentToolCalls,
  isBarrierTool,
  segmentToolBatch,
  cancelledExecution,
  estimateMessageTokens,
  formatMessagesForSummary,
  type AgentToolCallLike,
  type AgentToolExecutionLike,
  type ToolBatchSegment,
} from "@nusashell/domain";

/** Agent-turn text clamp (appends an explicit ellipsis marker). */
export { clampToolText as clampText } from "@nusashell/domain";

// Context-window policy is domain-owned (ticket #80, Klaster A). Re-exported
// here so the import graph stays stable.
export {
  DEFAULT_UNKNOWN_CONTEXT_WINDOW,
  DEFAULT_UNKNOWN_MAX_OUTPUT,
  MIN_AGENTIC_CONTEXT_WINDOW,
  resolveModelContextDefaults,
  resolveContextThreshold,
  tokenLimitReached,
  positiveInteger,
  type ModelContextDefaults,
  type ContextWindowSettings,
  type ContextThreshold,
} from "@nusashell/domain";
