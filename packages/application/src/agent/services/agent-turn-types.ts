import type {
  AgentMessage,
  AgentModelCapabilities,
  AgentTokenUsage,
  AgentToolCall,
  AgentPromptCachePolicy,
  ReasoningEffort,
} from "../ports/agent-provider.port.js";
import type { AgentToolGateway } from "../ports/agent-tool-gateway.port.js";
import type { AgentProvider } from "../ports/agent-provider.port.js";
import type { LoggerPort } from "../../plugin/ports/logger.port.js";
import type { AutoContinueDecision } from "./auto-continue-policy.js";

// Tool-execution constants (ticket #80, Klaster A) moved to the domain layer;
// re-exported here so existing application imports keep resolving.
export {
  MAX_REPEATED_TOOL_CALLS,
  DEFAULT_MAX_TOOL_ROUNDS,
  MAX_TOOL_ROUNDS_CAP,
  DEFAULT_SOFT_RECOVER_ATTEMPTS,
  MAX_SOFT_RECOVER_ATTEMPTS,
  DEFAULT_MAX_CONCURRENT_TOOL_CALLS,
  MAX_CONCURRENT_TOOL_CALLS_CAP,
  BARRIER_TOOLS,
} from "@nusashell/domain";

export interface RunAgentTurnInput {
  readonly messages: readonly AgentMessage[];
  readonly pluginIds: readonly string[];
  readonly maxToolRounds?: number;
  readonly model?: string;
  readonly effort?: ReasoningEffort;
  readonly modelCapabilities?: AgentModelCapabilities;
  readonly promptCache?: AgentPromptCachePolicy;
  readonly traceId?: string;
  readonly interactive?: boolean;
  /** Conversation workspace bound for tool I/O / subagent cwd. */
  readonly workspace?: string;
  readonly signal?: AbortSignal;
  readonly onTextDelta?: (delta: string) => void;
  readonly onReasoningDelta?: (delta: string) => void;
  readonly onToolCallStart?: (call: AgentToolCall) => void;
  readonly onToolCallEnd?: (execution: AgentToolExecution) => void;
  readonly onContextUpdate?: (update: AgentContextUpdate) => void;
  /**
   * Optional leading system messages for the summarizer only (compact path).
   * On a resumed turn the live `messages` may skip `injectSystemPrompts` for
   * cost; supplying the injected system prefix here keeps the summarizer's
   * input identical to a normal turn without changing the whole turn.
   */
  readonly systemContext?: readonly AgentMessage[];
  /**
   * Build a synthetic hydration transcript (assistant toolCalls + tool
   * results) for post-compaction continuation. Assembled by the handler from
   * read-only runtime snapshots; never executes the gateway. The desktop keeps
   * the latest complete graph as a hidden conversation checkpoint.
   */
  readonly buildHydrationTranscript?: () => Promise<readonly AgentMessage[]>;
  /**
   * Consume a runtime change (for example, a live workspace switch) and build
   * its synthetic hydration transcript. The runner calls this only at safe
   * provider/tool round boundaries. The desktop replaces the hidden room
   * checkpoint with the latest complete graph when the turn seals.
   */
  readonly consumeRuntimeUpdate?: () => Promise<readonly AgentMessage[]>;
  /**
   * Builds the TODO block to seal into the compaction summary user message
   * (Option B: user summary + todo -> assistant toolCalls -> tool results).
   * Only invoked at the compaction boundary; returns undefined when there is no
   * active TODO so the summary stays clean.
   */
  readonly todoPromptForCompaction?: () => string | undefined;
  /**
   * Fired whenever the sealed step list grows (reasoning / text / tool_calls).
   * Used by ActiveTurnProjection — not every token.
   */
  readonly onStepsChanged?: (steps: readonly AgentTurnStep[]) => void;
}

export interface AgentContextUpdate {
  readonly estimatedTokens: number;
  readonly usage?: AgentTokenUsage;
}

export interface AgentToolExecution {
  readonly id: string;
  readonly name: string;
  readonly ok: boolean;
  readonly args?: Readonly<Record<string, unknown>>;
  readonly result?: unknown;
  readonly error?: string;
  /** Exact role:"tool" content sent to the provider; reused by the UI. */
  readonly modelOutput?: string;
  /**
   * Canonical typed tool result (dual-rep). Populated by the execution policy
   * after migration; legacy `ok`/`result`/`error` remain derived for consumers
   * that have not yet switched.
   */
  readonly toolResult?: import("./agent-tool-result.js").AgentToolResult;
}

export type AgentTurnStep =
  | { readonly type: "reasoning"; readonly content: string; readonly model?: string; readonly providerId?: string }
  | { readonly type: "tool_calls"; readonly calls: readonly AgentToolExecution[]; readonly model?: string; readonly providerId?: string }
  | { readonly type: "text"; readonly content: string; readonly model?: string; readonly providerId?: string };

export interface AgentSteerBoundary {
  /** Step/tool offsets immediately before this user steer entered the graph. */
  readonly stepOffset: number;
  readonly toolCallOffset: number;
  readonly userMessages: readonly Extract<AgentMessage, { role: "user" }>[];
}

export interface AgentTurnResult {
  readonly traceId: string;
  readonly text: string;
  readonly rounds: number;
  readonly toolCalls: readonly AgentToolExecution[];
  readonly steps?: readonly AgentTurnStep[];
  /** Route/model identifier selected by the caller before provider resolution. */
  readonly requestedModel?: string;
  /** Canonical/upstream model identifier reported by the provider response. */
  readonly model?: string;
  readonly providerId?: string;
  readonly api?: "chat" | "responses" | "messages";
  readonly reasoning?: string;
  readonly usage?: AgentTokenUsage;
  readonly compaction?: AgentCompactionCheckpoint;
  readonly messages?: readonly AgentMessage[];
  readonly steerBoundaries?: readonly AgentSteerBoundary[];
  /**
   * Outer multi-turn auto-continue decision. Attached only on a successful
   * complete turn when a conversation is bound and a todo port is configured;
   * omitted on failed/cancelled paths so the desktop never chains those.
   */
  readonly autoContinue?: AutoContinueDecision;
}

export interface AgentCompactionCheckpoint {
  readonly summary: string;
  readonly compactedMessageCount: number;
  readonly estimatedInputTokens: number;
  readonly via: "provider" | "extractive";
  /**
   * Codex-aligned retained user message texts (chronological) packed into the
   * replacement history. Present when the compactor produced a memento
   * replacement; absent for legacy checkpoints (migration falls back to
   * `compactedMessageCount` slice).
   */
  readonly retainedUserMessages?: readonly string[];
}

/**
 * Mid-turn progress snapshot attached to ApplicationError `details.partial`
 * when a turn fails after tool work has already accumulated (provider 4xx/5xx
 * after soft recover, allowlist rejection, listTools failure, etc.).
 * Field names mirror `AgentTurnResult` so the desktop can treat it like a
 * result for sealing/persisting the interrupted assistant message.
 */
export interface AgentTurnPartial {
  readonly traceId: string;
  readonly rounds: number;
  readonly text: string;
  readonly toolCalls: readonly AgentToolExecution[];
  readonly steps: readonly AgentTurnStep[];
  readonly messages: readonly AgentMessage[];
  readonly steerBoundaries?: readonly AgentSteerBoundary[];
  readonly model?: string;
  readonly providerId?: string;
  readonly api?: "chat" | "responses" | "messages";
  readonly reasoning?: string;
  readonly usage?: AgentTokenUsage;
}

export interface AgentContextOptions {
  readonly compactionEnabled: boolean;
  readonly maxInputTokens: number;
  readonly reserveTokens: number;
  readonly recentTurns: number;
  readonly summaryMaxChars: number;
}

export interface AgentTurnRunnerDeps {
  readonly provider: AgentProvider;
  readonly toolGateway: AgentToolGateway;
  readonly logger?: LoggerPort;
  readonly defaultMaxToolRounds?: number;
  readonly defaultMaxRepeatedToolCalls?: number;
  readonly softRecoverAttempts?: number;
  readonly maxConcurrentToolCalls?: number;
  readonly context?: AgentContextOptions;
  readonly compactPrompt?: string;
}

export type { AgentMessage, AgentTokenUsage, AgentToolCall, AgentProvider, AgentToolGateway };
