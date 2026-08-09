/**
 * Agent context-compaction policy (ticket #80, Klaster A).
 *
 * Pure, I/O-free rules for the compaction path: token estimation, the
 * extractive summary excerpt, in-list tool-result shrinking and hydration
 * transcript filtering. Moved from
 * `packages/application/src/agent/services/agent-turn-utils.ts` and
 * `agent-context-compaction.ts` so the algorithms are testable without the
 * provider/logger runtime. The `ContextCompactor` orchestration class (which
 * calls the provider and assembles the replacement history) stays in the
 * application layer and consumes these rules.
 */

import {
  clampToolResultContent,
  clampToolText,
  type AgentToolCallLike,
  type AgentToolExecutionLike,
} from "./tool-policy.js";

/** Reserved call-ID namespace for the hidden runtime-hydration transcript. */
export const HYDRATE_TOOL_CALL_PREFIX = "hydrate:";

// ---------------------------------------------------------------------------
// Structural message type (application AgentMessage is assignable)
// ---------------------------------------------------------------------------

export interface AgentContentPartLike {
  readonly type: string;
  readonly text?: string;
  readonly name?: string;
}

export interface AgentMessageLike {
  readonly role: "system" | "user" | "assistant" | "tool";
  readonly content?: string | readonly AgentContentPartLike[];
  readonly toolCallId?: string;
  readonly name?: string;
  readonly toolCalls?: readonly AgentToolCallLike[];
  readonly reasoning?: string;
}

// ---------------------------------------------------------------------------
// Token estimation
// ---------------------------------------------------------------------------

export function estimateMessageTokens(messages: readonly AgentMessageLike[]): number {
  let chars = 0;
  for (const message of messages) {
    if ("content" in message) {
      chars += typeof message.content === "string"
        ? message.content.length
        : JSON.stringify(message.content).length;
    }
    if (message.role === "assistant" && message.toolCalls) chars += JSON.stringify(message.toolCalls).length;
  }
  return Math.ceil(chars / 4);
}

// ---------------------------------------------------------------------------
// Extractive summary excerpt
// ---------------------------------------------------------------------------

export function formatMessagesForSummary(
  messages: readonly AgentMessageLike[],
  summaryMaxChars = 12_000,
  hydrationCallIdPrefix: string = HYDRATE_TOOL_CALL_PREFIX,
): string {
  // Per-tool-result budget scales with the overall summary cap so a handful of
  // large outcomes cannot starve the rest of the conversation. Floor at 800
  // (the previous fixed cap) and cap at 4000 so a single result never dominates.
  const toolBudget = Math.min(4_000, Math.max(800, Math.floor(summaryMaxChars / 8)));
  // Injected system prompts (system.md, mcp-tools, skills catalog, memory, …)
  // are re-applied every turn by injectPrompts. Including them in the handoff
  // excerpt starves the 12k summary budget and produces "fresh session" ghosts.
  // Keep only durable conversation content + prior compaction checkpoints.
  const lines: string[] = [];
  for (const message of messages) {
    if (message.role === "system") {
      if (typeof message.content === "string" && message.content.startsWith("Conversation summary:")) {
        lines.push(`System: ${clampToolText(message.content, toolBudget)}`);
      }
      continue;
    }
    if (message.role === "tool") {
      if (message.toolCallId && message.toolCallId.startsWith(hydrationCallIdPrefix)) continue;
      const toolContent = typeof message.content === "string" ? message.content : "";
      lines.push(`Tool ${message.name}: ${clampToolResultContent(toolContent, toolBudget, message.name)}`);
      continue;
    }
    if (message.role === "assistant") {
      const calls = message.toolCalls?.filter((call) => !call.id.startsWith(hydrationCallIdPrefix)).map((call) => {
        const argsText = call.args ? clampToolText(JSON.stringify(call.args), 400) : "";
        return argsText ? `${call.name}(${argsText})` : call.name;
      }).join(", ");
      const reasoning = message.reasoning ? clampToolText(message.reasoning, 600) : "";
      if (!message.content && !calls && !reasoning) continue;
      lines.push(
        `Assistant: ${message.content ?? ""}${calls ? `\nTool calls: ${calls}` : ""}${reasoning ? `\nReasoning: ${reasoning}` : ""}`.trim(),
      );
      continue;
    }
    const content = typeof message.content === "string"
      ? message.content
      : (message.content ?? []).map((part) => part.type === "text" ? part.text : `[${part.type}: ${part.name ?? "attachment"}]`).join("\n");
    lines.push(`User: ${content}`);
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Hydration transcript filtering
// ---------------------------------------------------------------------------

/**
 * Drop the synthetic runtime-hydration exchange (assistant toolCalls + tool
 * results with `hydrate:` ids) from a live message list before summarization
 * so the summary only reflects durable conversation content.
 */
export function withoutRuntimeHydration<T extends AgentMessageLike>(
  messages: readonly T[],
): T[] {
  return messages.flatMap((message): T[] => {
    if (message.role === "tool" && message.toolCallId && message.toolCallId.startsWith(HYDRATE_TOOL_CALL_PREFIX)) return [];
    if (message.role !== "assistant" || !message.toolCalls?.length) return [message];
    const toolCalls = message.toolCalls.filter((call) => !call.id.startsWith(HYDRATE_TOOL_CALL_PREFIX));
    if (toolCalls.length === message.toolCalls.length) return [message];
    if (toolCalls.length === 0 && !message.content && !message.reasoning) return [];
    const { toolCalls: _hydrationCalls, ...assistant } = message;
    return [{ ...assistant, ...(toolCalls.length > 0 ? { toolCalls } : {}) } as unknown as T];
  });
}

// ---------------------------------------------------------------------------
// In-list tool-result shrink
// ---------------------------------------------------------------------------

/** Structural logger (application `LoggerPort` is assignable). */
export interface PolicyLogger {
  readonly warn: (msg: string, ...args: unknown[]) => void;
}

/**
 * In-list tool shrink: clamp `role:"tool"` message contents from oldest to
 * newest until the estimated token count drops below the soft threshold.
 * Preserves all messages (protocol validity) — only trims content.
 */
export function shrinkToolContents<T extends AgentMessageLike>(
  messages: T[],
  threshold: { readonly soft: number },
  logger?: PolicyLogger,
): void {
  const toolIndexes: number[] = [];
  for (let i = 0; i < messages.length; i += 1) {
    const message = messages[i];
    if (message && message.role === "tool") toolIndexes.push(i);
  }
  if (toolIndexes.length === 0) return;

  // Per-tool budget: divide the excess across tool messages, oldest first.
  // Each tool message gets clamped to at most `perToolBudget` chars.
  // Start with a conservative budget and reduce until under threshold.
  const targetChars = threshold.soft * 4;
  let totalChars = 0;
  for (const m of messages) {
    if (m && "content" in m) {
      totalChars += typeof m.content === "string" ? m.content.length : JSON.stringify(m.content).length;
    }
  }
  if (totalChars <= targetChars) return;

  const excess = totalChars - targetChars;
  // Clamp oldest tool messages first, up to removing `excess` chars total.
  let remaining = excess;
  for (const idx of toolIndexes) {
    if (remaining <= 0) break;
    const msg = messages[idx];
    if (!msg || msg.role !== "tool" || typeof msg.content !== "string") continue;
    if (msg.content.length <= 200) continue; // skip tiny results
    const maxKeep = Math.max(200, msg.content.length - remaining);
    const clamped = clampToolResultContent(msg.content, maxKeep, msg.name);
    remaining -= (msg.content.length - clamped.length);
    messages[idx] = { ...msg, content: clamped };
  }

  // If still over, do a second pass with a harder per-tool cap.
  const stillOver = estimateMessageTokens(messages) > threshold.soft;
  if (stillOver) {
    const perToolBudget = Math.max(200, Math.floor(targetChars / Math.max(1, toolIndexes.length)));
    for (const idx of toolIndexes) {
      const msg = messages[idx];
      if (!msg || msg.role !== "tool" || typeof msg.content !== "string") continue;
      if (msg.content.length <= perToolBudget) continue;
      messages[idx] = { ...msg, content: clampToolResultContent(msg.content, perToolBudget, msg.name) };
    }
  }

  // Third pass: replace oldest results with short stubs when a large tool-round
  // count still cannot fit under soft (100×200-char floors still overflow 9k).
  let finalEstimate = estimateMessageTokens(messages);
  if (finalEstimate > threshold.soft) {
    for (const idx of toolIndexes) {
      if (estimateMessageTokens(messages) <= threshold.soft) break;
      const msg = messages[idx];
      if (!msg || msg.role !== "tool" || typeof msg.content !== "string") continue;
      if (msg.content.length <= 80) continue;
      messages[idx] = {
        ...msg,
        content: `[truncated tool result: ${msg.name}]`,
      };
    }
    finalEstimate = estimateMessageTokens(messages);
    if (finalEstimate > threshold.soft) {
      logger?.warn("Agent context still over budget after shrink estimatedTokens=%d threshold=%d toolMessages=%d", finalEstimate, threshold.soft, toolIndexes.length);
    }
  }
}

// Keep AgentToolExecutionLike referenced so structural callers can import the
// pair together without reaching into tool-policy for every symbol.
export type { AgentToolExecutionLike };
