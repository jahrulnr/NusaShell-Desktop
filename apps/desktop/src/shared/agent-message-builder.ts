/**
 * Shared assistant message builder.
 *
 * Constructs the durable `AgentConversationMessage` for an assistant turn
 * from an `AgentTurnResult` (or partial). Used by the desktop main process
 * to seal the reply off the renderer critical path, and by the renderer to
 * seal the streaming UI after the turn resolves.
 *
 * Mirrors the clamping logic in `agent-conversation-ui.js` so persisted
 * messages stay within the store validator's size caps.
 */
import type { AgentToolResult, AgentTurnResult, AgentTurnPartial } from "@nusashell/application";
import type {
  AgentConversationAttachment,
  AgentConversationMessage,
  AgentConversationToolCall,
  AgentConversationStep,
} from "./agent-conversation-contract.js";
import type { AgentMessage } from "@nusashell/application";
import {
  TOOL_ARGS_MAX_CHARS,
  TOOL_OUTPUT_MAX_CHARS,
  TOOL_ERROR_MAX_CHARS,
  clampText,
  formatToolOutput,
  boundToolArgs,
  boundedStructuredContent,
} from "@nusashell/domain";

/**
 * Build a durable tool call from an `AgentToolExecution`-like object.
 * Always includes `args` (defaulting to `{}`) so older transcripts without
 * args still validate against the schema.
 */
export function buildToolCall(call: {
  id: string;
  name: string;
  ok?: boolean;
  error?: string;
  args?: Record<string, unknown>;
  output?: string;
  result?: unknown;
  modelOutput?: string;
  toolResult?: AgentToolResult;
  status?: "success" | "error" | "cancelled" | "timeout";
  truncated?: boolean;
  structuredContent?: Record<string, unknown>;
}, callPosition?: number): AgentConversationToolCall {
  const rawArgs = call.args && typeof call.args === "object" && !Array.isArray(call.args) ? call.args : undefined;
  let safeArgs: Record<string, unknown> = {};
  if (rawArgs && Object.keys(rawArgs).length > 0) {
    try {
      const encoded = JSON.stringify(rawArgs);
      if (encoded.length <= TOOL_ARGS_MAX_CHARS) {
        safeArgs = rawArgs as Record<string, unknown>;
      } else {
        safeArgs = boundToolArgs(encoded, TOOL_ARGS_MAX_CHARS);
      }
    } catch {
      // keep safeArgs as {}
    }
  }

  // The persisted card is the same canonical string sent as role:"tool" to
  // the provider. Never rebuild a prettier-but-different view from `result`.
  const modelOutput = call.modelOutput;
  const output =
    modelOutput !== undefined
      ? clampText(modelOutput, TOOL_OUTPUT_MAX_CHARS)
      : call.output !== undefined
      ? clampText(call.output, TOOL_OUTPUT_MAX_CHARS)
      : call.error
        ? clampText(call.error, TOOL_OUTPUT_MAX_CHARS)
        : call.result !== undefined
          ? clampText(formatToolOutput(call.result), TOOL_OUTPUT_MAX_CHARS)
          : undefined;
  const status = call.status ?? call.toolResult?.status;
  const truncated = call.truncated ?? call.toolResult?.metadata.truncated;
  const structuredContent = boundedStructuredContent(
    call.structuredContent ?? call.toolResult?.structuredContent,
    TOOL_OUTPUT_MAX_CHARS,
  );

  return {
    id: call.id,
    ...(callPosition !== undefined ? { callPosition } : {}),
    name: call.name,
    ok: call.ok !== false,
    ...(call.error ? { error: clampText(call.error, TOOL_ERROR_MAX_CHARS) } : {}),
    args: safeArgs,
    ...(output ? { output } : {}),
    ...(modelOutput ? { modelOutput: clampText(modelOutput, TOOL_OUTPUT_MAX_CHARS) } : {}),
    ...(status ? { status } : {}),
    ...(truncated !== undefined ? { truncated } : {}),
    ...(structuredContent ? { structuredContent } : {}),
  };
}


function buildSteps(steps: readonly { type: string; content?: string; calls?: readonly any[]; model?: string; providerId?: string }[] | undefined): AgentConversationStep[] | undefined {
  if (!Array.isArray(steps) || steps.length === 0) return undefined;
  const result: AgentConversationStep[] = [];
  for (const step of steps) {
    const stepPosition = result.length + 1;
    if (step.type === "text" && typeof step.content === "string") {
      result.push({ type: "text", stepPosition, content: step.content });
    } else if (step.type === "reasoning" && typeof step.content === "string") {
      result.push({ type: "reasoning", stepPosition, content: step.content });
    } else if (step.type === "tool_calls" && Array.isArray(step.calls)) {
      const calls = step.calls.map((call: any, index: number) => buildToolCall(call, index + 1));
      if (calls.length > 0) result.push({ type: "tool_calls", stepPosition, calls });
    }
  }
  return result.length > 0 ? result : undefined;
}

/**
 * Build the durable assistant message from a completed turn result.
 */
export function buildAssistantMessage(
  result: AgentTurnResult,
  options: { readonly contextUpdated?: boolean } = {},
): AgentConversationMessage {
  const toolCalls = Array.isArray(result.toolCalls) && result.toolCalls.length > 0
    ? result.toolCalls.map((call, index) => buildToolCall(call, index + 1))
    : undefined;
  const steps = buildSteps(result.steps as any);
  const visibleModel = result.requestedModel ?? result.model;
  const resolvedModel = result.requestedModel && result.model && result.requestedModel !== result.model
    ? result.model
    : undefined;
  return {
    role: "assistant",
    content: result.text,
    traceId: result.traceId,
    ...(visibleModel !== undefined ? { model: visibleModel } : {}),
    ...(resolvedModel !== undefined ? { resolvedModel } : {}),
    rounds: result.rounds,
    ...(options.contextUpdated ? { contextUpdated: true } : {}),
    ...(result.reasoning ? { reasoning: result.reasoning } : {}),
    ...(toolCalls ? { toolCalls } : {}),
    ...(steps ? { steps } : {}),
  };
}

/**
 * Split one live run around same-turn steer boundaries for durable replay.
 * The provider sees assistant work → user steer → assistant continuation;
 * storing the run as one assistant row would move the steer outside its real
 * context and make the next turn replay a different transcript.
 */
export function buildSteeredTranscript(result: AgentTurnResult): AgentConversationMessage[] {
  const boundaries = [...(result.steerBoundaries ?? [])].sort((a, b) => a.stepOffset - b.stepOffset);
  if (boundaries.length === 0) return [buildAssistantMessage(result)];
  const allSteps = [...(result.steps ?? [])];
  const allCalls = [...(result.toolCalls ?? [])];
  const transcript: AgentConversationMessage[] = [];
  let stepStart = 0;
  let callStart = 0;

  for (const boundary of boundaries) {
    appendAssistantSegment(transcript, result, allSteps.slice(stepStart, boundary.stepOffset), allCalls.slice(callStart, boundary.toolCallOffset));
    for (const message of boundary.userMessages) transcript.push(toDurableUserMessage(message));
    stepStart = boundary.stepOffset;
    callStart = boundary.toolCallOffset;
  }
  // A steer may be accepted after the final provider sample, leaving no
  // continuation content. Still materialize its empty assistant tail so the
  // reserved assistant identity can be sealed and the steer is durable.
  appendAssistantSegment(transcript, result, allSteps.slice(stepStart), allCalls.slice(callStart), result.text, true);
  return transcript;
}

export function buildSteeredInterruptedTranscript(
  partial: AgentTurnPartial,
  interruptReason: "cancel" | "provider" | "max_rounds",
): AgentConversationMessage[] {
  const boundaries = [...(partial.steerBoundaries ?? [])].sort((a, b) => a.stepOffset - b.stepOffset);
  if (boundaries.length === 0) return [buildInterruptedMessage(partial, { interruptReason })];
  const resultShape: AgentTurnResult = {
    traceId: partial.traceId,
    text: partial.text,
    rounds: partial.rounds,
    toolCalls: partial.toolCalls,
    steps: partial.steps,
    ...(partial.model ? { model: partial.model } : {}),
    ...(partial.providerId ? { providerId: partial.providerId } : {}),
    ...(partial.api ? { api: partial.api } : {}),
    ...(partial.reasoning ? { reasoning: partial.reasoning } : {}),
    ...(partial.usage ? { usage: partial.usage } : {}),
  };
  const transcript: AgentConversationMessage[] = [];
  let stepStart = 0;
  let callStart = 0;
  for (const boundary of boundaries) {
    appendAssistantSegment(transcript, resultShape, partial.steps.slice(stepStart, boundary.stepOffset), partial.toolCalls.slice(callStart, boundary.toolCallOffset));
    for (const message of boundary.userMessages) transcript.push(toDurableUserMessage(message));
    stepStart = boundary.stepOffset;
    callStart = boundary.toolCallOffset;
  }
  const { steerBoundaries: _steerBoundaries, ...partialBase } = partial;
  const allCompletedText = partial.steps.filter((step) => step.type === "text").map((step) => step.content).join("");
  const remainingSteps = partial.steps.slice(stepStart);
  const remainingCompletedText = remainingSteps.filter((step) => step.type === "text").map((step) => step.content).join("");
  transcript.push(buildInterruptedMessage({
    ...partialBase,
    text: partial.text === allCompletedText ? remainingCompletedText : partial.text,
    steps: remainingSteps,
    toolCalls: partial.toolCalls.slice(callStart),
  }, { interruptReason }));
  return transcript;
}

function appendAssistantSegment(
  transcript: AgentConversationMessage[],
  result: AgentTurnResult,
  steps: readonly NonNullable<AgentTurnResult["steps"]>[number][],
  toolCalls: readonly AgentTurnResult["toolCalls"][number][],
  fallbackText = "",
  force = false,
): void {
  const text = steps.filter((step) => step.type === "text").map((step) => step.content).join("\n\n") || fallbackText;
  const reasoning = steps.filter((step) => step.type === "reasoning").map((step) => step.content).join("\n\n");
  if (!force && !text && !reasoning && toolCalls.length === 0) return;
  const { steerBoundaries: _steerBoundaries, reasoning: _aggregateReasoning, ...base } = result;
  transcript.push(buildAssistantMessage({
    ...base,
    text,
    steps,
    toolCalls,
    ...(reasoning ? { reasoning } : {}),
  }));
}

function toDurableUserMessage(message: Extract<AgentMessage, { role: "user" }>): AgentConversationMessage {
  if (typeof message.content === "string") return { role: "user", content: message.content, steer: true };
  const text: string[] = [];
  const attachments: AgentConversationAttachment[] = [];
  for (const part of message.content) {
    if (part.type === "text") text.push(part.text);
    else if (part.type === "image") attachments.push({ type: "image", dataUrl: part.dataUrl, mediaType: dataUrlMediaType(part.dataUrl), name: part.name ?? "image" });
    else attachments.push({ type: "file", dataUrl: part.dataUrl, mediaType: part.mediaType, name: part.name });
  }
  return { role: "user", content: text.join("\n\n"), steer: true, ...(attachments.length ? { attachments } : {}) };
}

function dataUrlMediaType(dataUrl: string): string {
  return /^data:([^;,]+)/i.exec(dataUrl)?.[1] ?? "image/*";
}

/**
 * True when partial messages contain settled tool traffic (assistant toolCalls
 * and/or tool results) — not mere inject+user preamble before first tool.
 */
function hasSettledToolGraph(partial: AgentTurnPartial): boolean {
  if (Array.isArray(partial.toolCalls) && partial.toolCalls.length > 0) return true;
  if (Array.isArray(partial.steps)
    && partial.steps.some((step) => step.type === "tool_calls" && Array.isArray(step.calls) && step.calls.length > 0)) {
    return true;
  }
  if (!Array.isArray(partial.messages)) return false;
  return partial.messages.some((message) => {
    if (message.role === "tool") return true;
    if (message.role === "assistant" && Array.isArray(message.toolCalls) && message.toolCalls.length > 0) {
      return true;
    }
    return false;
  });
}

/**
 * Build the interrupted assistant message from a partial turn result.
 * Prefers live `partial.text` for Continue; attaches `resumeMessages` only when
 * the tool graph has settled so Retry can tool-resume without blocking text Continue
 * on pre-tool provider fails (inject-only snapshots).
 */
export function buildInterruptedMessage(
  partial: AgentTurnPartial,
  options?: { readonly interruptReason?: "cancel" | "provider" | "max_rounds" },
): AgentConversationMessage {
  const toolCalls = Array.isArray(partial.toolCalls) && partial.toolCalls.length > 0
    ? partial.toolCalls.map((call, index) => buildToolCall(call, index + 1))
    : undefined;
  const steps = buildSteps(partial.steps as any);
  const streamedText = typeof partial.text === "string" ? partial.text.trim() : "";
  const stub = `Turn interrupted after ${partial.rounds} tool round${partial.rounds === 1 ? "" : "s"}.`;
  const interruptReason = options?.interruptReason ?? "provider";
  const attachResume = hasSettledToolGraph(partial)
    && Array.isArray(partial.messages)
    && partial.messages.length > 0;
  return {
    role: "assistant",
    content: streamedText || stub,
    status: "interrupted",
    interruptReason,
    traceId: partial.traceId,
    ...(partial.model !== undefined ? { model: partial.model } : {}),
    rounds: partial.rounds,
    ...(partial.reasoning ? { reasoning: partial.reasoning } : {}),
    ...(toolCalls ? { toolCalls } : {}),
    ...(steps ? { steps } : {}),
    ...(attachResume ? { resumeMessages: partial.messages } : {}),
  };
}
