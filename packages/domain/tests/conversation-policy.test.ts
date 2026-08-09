// Pure domain tests for the conversation store policy (ticket #83, Klaster D):
// size caps, artifact eviction, title heuristic, message-sequence
// normalization and resumed-assistant merging. No Electron, no JSONL I/O.

import { describe, expect, it } from "vitest";
import {
  CANVAS_ARTIFACT_MAX_COUNT,
  CANVAS_ARTIFACT_MAX_SOURCE_BYTES,
  CANVAS_ARTIFACT_MAX_TOTAL_BYTES,
  conversationTitle,
  DEFAULT_MAX_BYTES,
  evictCanvasArtifacts,
  HISTORY_SOFT_CAP_RATIO,
  maxMessagePosition,
  mergeResumedAssistantMessage,
  normalizeMessageSequence,
  RUNTIME_HYDRATION_MAX_BYTES,
  RUNTIME_HYDRATION_MAX_MESSAGES,
  softTrimTargetBytes,
  SUBAGENT_RUN_MAX_COUNT,
  type CanvasArtifactLike,
  type ConversationMessageLike,
} from "../src/index.js";

describe("conversation policy constants", () => {
  it("pins the per-conversation JSONL cap and soft trim ratio", () => {
    expect(DEFAULT_MAX_BYTES).toBe(8 * 1024 * 1024);
    expect(HISTORY_SOFT_CAP_RATIO).toBe(0.8);
    expect(softTrimTargetBytes(DEFAULT_MAX_BYTES)).toBe(Math.floor(8 * 1024 * 1024 * 0.8));
  });

  it("pins canvas artifact caps", () => {
    expect(CANVAS_ARTIFACT_MAX_COUNT).toBe(20);
    expect(CANVAS_ARTIFACT_MAX_TOTAL_BYTES).toBe(3 * 1024 * 1024);
    expect(CANVAS_ARTIFACT_MAX_SOURCE_BYTES).toBe(512 * 1024);
  });

  it("pins subagent run and runtime hydration limits", () => {
    expect(SUBAGENT_RUN_MAX_COUNT).toBe(50);
    expect(RUNTIME_HYDRATION_MAX_MESSAGES).toBe(64);
    expect(RUNTIME_HYDRATION_MAX_BYTES).toBe(1024 * 1024);
  });
});

describe("conversationTitle", () => {
  it("trims and collapses whitespace", () => {
    expect(conversationTitle("  hello   world  ")).toBe("hello world");
  });

  it("returns placeholder for empty content", () => {
    expect(conversationTitle("   ")).toBe("New conversation");
    expect(conversationTitle("")).toBe("New conversation");
  });

  it("caps at 60 chars with ellipsis", () => {
    const long = "x".repeat(80);
    expect(conversationTitle(long)).toBe(`${"x".repeat(57)}…`);
  });

  it("keeps short content unchanged", () => {
    expect(conversationTitle("short title")).toBe("short title");
  });
});

describe("evictCanvasArtifacts", () => {
  function artifact(id: string, createdAt: string, source: string): CanvasArtifactLike {
    return { id, createdAt, source };
  }

  it("evicts oldest artifacts beyond the count cap but keeps the active one", () => {
    const artifacts = Array.from({ length: 22 }, (_, i) => artifact(`a${i}`, `2025-01-01T00:00:0${i % 10}Z`, "x"));
    const evicted = evictCanvasArtifacts(artifacts, "a21");
    expect(evicted.length).toBe(CANVAS_ARTIFACT_MAX_COUNT);
    expect(evicted.some((a) => a.id === "a21")).toBe(true);
  });

  it("evicts oldest non-active artifacts beyond the total byte cap", () => {
    const artifacts = [
      artifact("keep", "2025-01-01T00:00:01Z", "y".repeat(2 * 1024 * 1024)),
      artifact("old", "2025-01-01T00:00:00Z", "x".repeat(2 * 1024 * 1024)),
      artifact("new", "2025-01-01T00:00:02Z", "z".repeat(2 * 1024 * 1024)),
    ];
    const evicted = evictCanvasArtifacts(artifacts, "keep");
    expect(evicted.some((a) => a.id === "keep")).toBe(true);
    expect(evicted.reduce((sum, a) => sum + a.source.length, 0)).toBeLessThanOrEqual(
      CANVAS_ARTIFACT_MAX_TOTAL_BYTES,
    );
  });

  it("returns an empty list untouched", () => {
    expect(evictCanvasArtifacts([])).toEqual([]);
  });
});

describe("mergeResumedAssistantMessage", () => {
  const prev: ConversationMessageLike = {
    id: "m1",
    role: "assistant",
    content: "first",
    reasoning: "step one",
    toolCalls: [{ id: "c1", name: "a", callPosition: 1 }],
    rounds: 2,
  };
  const next: ConversationMessageLike = {
    id: "m2",
    role: "assistant",
    content: "second",
    reasoning: "step two",
    toolCalls: [{ id: "c2", name: "b", callPosition: 1 }],
    rounds: 3,
  };

  it("merges reasoning, tool calls, steps and sums rounds", () => {
    const merged = mergeResumedAssistantMessage(prev, next);
    expect(merged.reasoning).toBe("step one\n\nstep two");
    expect(merged.toolCalls).toHaveLength(2);
    expect(merged.rounds).toBe(5);
    expect(merged.content).toBe("second");
  });

  it("keeps a single reasoning when both are identical", () => {
    const merged = mergeResumedAssistantMessage(
      { ...prev, reasoning: "same" },
      { ...next, reasoning: "same" },
    );
    expect(merged.reasoning).toBe("same");
  });

  it("omits reasoning when neither side has it", () => {
    const { reasoning: _prevReasoning, ...prevNoReasoning } = prev;
    const { reasoning: _nextReasoning, ...nextNoReasoning } = next;
    const merged = mergeResumedAssistantMessage(
      prevNoReasoning as ConversationMessageLike,
      nextNoReasoning as ConversationMessageLike,
    );
    expect(merged.reasoning).toBeUndefined();
  });
});

describe("normalizeMessageSequence", () => {
  it("assigns legacy ids and positions to messages without them", () => {
    const messages: ConversationMessageLike[] = [
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
    ];
    const { messages: normalized, changed } = normalizeMessageSequence("conv-1", messages);
    expect(changed).toBe(true);
    expect(normalized[0]?.id).toMatch(/^msg_legacy_conv-1_1$/);
    expect(normalized[0]?.position).toBe(1);
    expect(normalized[1]?.position).toBe(2);
  });

  it("keeps valid ids/positions and reports unchanged", () => {
    const messages: ConversationMessageLike[] = [
      { id: "a", position: 1, revision: 1, role: "user", content: "hi" },
      { id: "b", position: 2, revision: 1, role: "assistant", content: "hello" },
    ];
    const { messages: normalized, changed } = normalizeMessageSequence("conv-1", messages);
    expect(changed).toBe(false);
    expect(normalized[0]).toBe(messages[0]);
    expect(normalized[1]).toBe(messages[1]);
  });

  it("repairs duplicate positions by assigning fresh ones", () => {
    const messages: ConversationMessageLike[] = [
      { id: "a", position: 1, role: "user", content: "hi" },
      { id: "b", position: 1, role: "assistant", content: "hello" },
    ];
    const { messages: normalized, changed } = normalizeMessageSequence("conv-1", messages);
    expect(changed).toBe(true);
    const positions = normalized.map((m) => m.position);
    expect(new Set(positions).size).toBe(2);
  });

  it("sorts by position then id", () => {
    const messages: ConversationMessageLike[] = [
      { id: "z", position: 2, role: "user", content: "second" },
      { id: "a", position: 1, role: "user", content: "first" },
    ];
    const { messages: normalized } = normalizeMessageSequence("conv-1", messages);
    expect(normalized.map((m) => m.id)).toEqual(["a", "z"]);
  });
});

describe("maxMessagePosition", () => {
  it("returns the highest integer position", () => {
    const messages: ConversationMessageLike[] = [
      { id: "a", position: 3, role: "user", content: "x" },
      { id: "b", position: 7, role: "user", content: "y" },
      { id: "c", role: "user", content: "z" },
    ];
    expect(maxMessagePosition(messages)).toBe(7);
  });

  it("returns 0 when no positions are set", () => {
    expect(maxMessagePosition([])).toBe(0);
  });
});
