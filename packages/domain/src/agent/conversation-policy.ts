/**
 * Conversation persistence policy (ticket #83, Klaster D).
 *
 * Size caps, artifact-eviction rules, title heuristic, message-sequence
 * normalization and resumed-assistant merging. Moved from
 * apps/desktop/src/main/agent-conversation-store.ts so the policy is
 * testable without Electron; the desktop main process keeps the JSONL I/O +
 * locking adapter and calls these rules.
 */
export const DEFAULT_MAX_BYTES = 8 * 1024 * 1024;
export const HISTORY_SOFT_CAP_RATIO = 0.8;

export const CANVAS_ARTIFACT_MAX_COUNT = 20;
export const CANVAS_ARTIFACT_MAX_TOTAL_BYTES = 3 * 1024 * 1024;
export const CANVAS_ARTIFACT_MAX_SOURCE_BYTES = 512 * 1024;
export const SUBAGENT_RUN_MAX_COUNT = 50;
export const RUNTIME_HYDRATION_MAX_MESSAGES = 64;
export const RUNTIME_HYDRATION_MAX_BYTES = 1024 * 1024;

/** Codex-style soft trim target: floor(maxBytes * HISTORY_SOFT_CAP_RATIO). */
export function softTrimTargetBytes(maxBytes: number): number {
  return Math.floor(maxBytes * HISTORY_SOFT_CAP_RATIO);
}

/** Title heuristic: collapse whitespace, cap at 60 chars with ellipsis. */
export function conversationTitle(content: string): string {
  const normalized = content.trim().replace(/\s+/g, " ");
  if (!normalized) return "New conversation";
  return normalized.length <= 60 ? normalized : `${normalized.slice(0, 57)}…`;
}

/** Structural artifact shape the eviction policy needs. */
export interface CanvasArtifactLike {
  readonly id: string;
  readonly createdAt: string;
  readonly source: string;
}

/**
 * Evict canvas artifacts oldest-first until count and total-byte caps hold.
 * The active artifact (activeId) is never evicted; when only the active
 * artifact remains the loop stops (best effort).
 */
export function evictCanvasArtifacts<T extends CanvasArtifactLike>(
  artifacts: readonly T[],
  activeId?: string,
): readonly T[] {
  let list = [...artifacts].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  while (list.length > CANVAS_ARTIFACT_MAX_COUNT) {
    const removable = list.findIndex((artifact) => artifact.id !== activeId);
    if (removable === -1) break;
    list.splice(removable, 1);
  }
  while (list.reduce((total, artifact) => total + artifact.source.length, 0) > CANVAS_ARTIFACT_MAX_TOTAL_BYTES) {
    const removable = list.findIndex((artifact) => artifact.id !== activeId);
    if (removable === -1) break;
    list.splice(removable, 1);
  }
  return list;
}

/** Structural conversation-message shapes (desktop contract satisfies them). */
export interface ConversationToolCallLike {
  readonly callPosition?: number;
  readonly id: string;
  readonly name: string;
  readonly args?: Readonly<Record<string, unknown>>;
  readonly output?: string;
  readonly error?: string;
}

export interface ConversationStepLike {
  readonly type: string;
  readonly content?: string;
  readonly stepPosition?: number;
  readonly calls?: readonly ConversationToolCallLike[];
}

export interface ConversationMessageLike {
  readonly id?: string;
  readonly position?: number;
  readonly revision?: number;
  readonly role: string;
  readonly content?: string;
  readonly reasoning?: string;
  readonly rounds?: number;
  readonly toolCalls?: readonly ConversationToolCallLike[];
  readonly steps?: readonly ConversationStepLike[];
}

export function maxMessagePosition<T extends ConversationMessageLike>(
  messages: readonly T[],
): number {
  return messages.reduce((highest, message) => (
    Number.isInteger(message.position) && (message.position ?? 0) > highest
      ? message.position as number
      : highest
  ), 0);
}

/**
 * Normalize a message sequence: assign stable ids/positions/revisions,
 * repair duplicate positions, renumber assistant tool calls and step
 * positions, then sort by position (ties broken by id). Reports whether any
 * change was made so callers can skip a write when the sequence is clean.
 */
export function normalizeMessageSequence<T extends ConversationMessageLike>(
  conversationId: string,
  messages: readonly T[],
): { messages: T[]; changed: boolean } {
  const reservedPositions = new Set(messages.flatMap((message) => (
    Number.isInteger(message.position) && (message.position ?? 0) > 0
      ? [message.position as number]
      : []
  )));
  const seenIds = new Set<string>();
  const seenPositions = new Set<number>();
  const safeConversationId = conversationId.replace(/[^a-zA-Z0-9_-]/g, "_");
  let nextLegacyPosition = 1;
  let changed = false;

  const normalized = messages.map((message, index) => {
    let messageId = typeof message.id === "string" && message.id.length > 0 && !seenIds.has(message.id)
      ? message.id
      : "";
    if (!messageId) {
      const base = `msg_legacy_${safeConversationId}_${index + 1}`;
      messageId = base;
      let suffix = 1;
      while (seenIds.has(messageId)) messageId = `${base}_${suffix++}`;
      changed = true;
    }
    seenIds.add(messageId);

    let position = Number.isInteger(message.position)
      && (message.position ?? 0) > 0
      && !seenPositions.has(message.position as number)
      ? message.position as number
      : 0;
    if (!position) {
      while (reservedPositions.has(nextLegacyPosition) || seenPositions.has(nextLegacyPosition)) {
        nextLegacyPosition += 1;
      }
      position = nextLegacyPosition;
      nextLegacyPosition += 1;
      changed = true;
    }
    seenPositions.add(position);

    const revision = Number.isInteger(message.revision) && (message.revision ?? 0) >= 1
      ? message.revision as number
      : 1;
    if (revision !== message.revision) changed = true;
    const nested = normalizeAssistantMessageOrder(message);
    if (nested.changed) changed = true;

    if (!nested.changed && messageId === message.id && position === message.position && revision === message.revision) {
      return message;
    }
    return { ...nested.message, id: messageId, position, revision } as T;
  });

  const ordered = [...normalized].sort((left, right) => {
    const positionOrder = (left.position ?? 0) - (right.position ?? 0);
    if (positionOrder !== 0) return positionOrder;
    return (left.id ?? "").localeCompare(right.id ?? "");
  });
  if (!changed && ordered.some((message, index) => message !== normalized[index])) changed = true;
  return { messages: ordered, changed };
}

/**
 * Renumber assistant tool calls (callPosition) and step positions (index+1).
 * Leaves non-assistant messages untouched.
 */
export function normalizeAssistantMessageOrder<T extends ConversationMessageLike>(
  message: T,
): { message: T; changed: boolean } {
  if (message.role !== "assistant") return { message, changed: false };
  let changed = false;
  const normalizeCalls = (calls: readonly ConversationToolCallLike[]) => calls.map((call, index) => {
    const callPosition = index + 1;
    if (call.callPosition === callPosition) return call;
    changed = true;
    return { ...call, callPosition };
  });
  const toolCalls = Array.isArray(message.toolCalls) ? normalizeCalls(message.toolCalls) : undefined;
  const steps = Array.isArray(message.steps)
    ? message.steps.map((step, index) => {
        const stepPosition = index + 1;
        if (step.type === "tool_calls") {
          const calls = normalizeCalls(step.calls ?? []);
          if (step.stepPosition === stepPosition && calls.every((call, callIndex) => call === (step.calls ?? [])[callIndex])) {
            return step;
          }
          changed = true;
          return { ...step, stepPosition, calls };
        }
        if (step.stepPosition === stepPosition) return step;
        changed = true;
        return { ...step, stepPosition };
      })
    : undefined;
  if (!changed) return { message, changed: false };
  return {
    message: {
      ...message,
      ...(toolCalls ? { toolCalls } : {}),
      ...(steps ? { steps } : {}),
    } as T,
    changed: true,
  };
}

/**
 * Merge a resumed (interrupted) assistant message into its prior bubble:
 * concatenate reasoning, append tool calls and steps, sum rounds. The next
 * message's identity/content win; rounds are summed only when both sides
 * carry a count.
 */
export function mergeResumedAssistantMessage<T extends ConversationMessageLike>(
  previous: T,
  next: T,
): T {
  const previousReasoning = typeof previous.reasoning === "string" ? previous.reasoning : "";
  const nextReasoning = typeof next.reasoning === "string" ? next.reasoning : "";
  const reasoning = previousReasoning && nextReasoning && previousReasoning !== nextReasoning
    ? `${previousReasoning}\n\n${nextReasoning}`
    : nextReasoning || previousReasoning;
  const previousToolCalls = Array.isArray(previous.toolCalls) ? previous.toolCalls : [];
  const nextToolCalls = Array.isArray(next.toolCalls) ? next.toolCalls : [];
  const previousSteps = Array.isArray(previous.steps) ? previous.steps : [];
  const nextSteps = Array.isArray(next.steps) ? next.steps : [];

  return {
    ...next,
    ...(reasoning ? { reasoning } : {}),
    ...(previousToolCalls.length || nextToolCalls.length
      ? { toolCalls: [...previousToolCalls, ...nextToolCalls] }
      : {}),
    ...(previousSteps.length || nextSteps.length
      ? { steps: [...previousSteps, ...nextSteps] }
      : {}),
    ...(previous.rounds !== undefined && next.rounds !== undefined
      ? { rounds: previous.rounds + next.rounds }
      : {}),
  } as T;
}
