// Pure domain tests for context-compaction policy (ticket #80, Klaster A).
// Ported from packages/application/tests/agent-turn-utils.test.ts + new coverage for
// token estimation, in-list shrink and hydration filtering.

import { describe, expect, it } from "vitest";
import {
  HYDRATE_TOOL_CALL_PREFIX,
  estimateMessageTokens,
  formatMessagesForSummary,
  shrinkToolContents,
  withoutRuntimeHydration,
  type AgentMessageLike,
} from "../src/agent/context-compaction-policy.js";
import { clampToolText } from "../src/agent/tool-policy.js";

describe("HYDRATE_TOOL_CALL_PREFIX", () => {
  it("is the reserved hydration transcript id namespace", () => {
    expect(HYDRATE_TOOL_CALL_PREFIX).toBe("hydrate:");
  });
});

describe("estimateMessageTokens", () => {
  it("uses the chars/4 heuristic across content and assistant toolCalls", () => {
    const messages: AgentMessageLike[] = [
      { role: "user", content: "x".repeat(40) },
      { role: "assistant", content: "y".repeat(20), toolCalls: [{ id: "c1", name: "read", args: { path: "/a" } }] },
    ];
    const expected = Math.ceil((40 + 20 + JSON.stringify([{ id: "c1", name: "read", args: { path: "/a" } }]).length) / 4);
    expect(estimateMessageTokens(messages)).toBe(expected);
  });

  it("returns 0 for an empty message list", () => {
    expect(estimateMessageTokens([])).toBe(0);
  });
});

describe("formatMessagesForSummary", () => {
  it("excludes hidden runtime hydration while retaining ordinary tool evidence", () => {
    const messages: AgentMessageLike[] = [
      { role: "user", content: "fix it" },
      { role: "assistant", content: "", toolCalls: [{ id: "hydrate:one:0", name: "runtime_context", args: {} }] },
      { role: "tool", toolCallId: "hydrate:one:0", name: "runtime_context", content: "large hidden snapshot" },
      { role: "assistant", content: "Working", toolCalls: [{ id: "call-1", name: "write", args: { path: "a.txt" } }] },
      { role: "tool", toolCallId: "call-1", name: "write", content: "saved" },
    ];

    const summary = formatMessagesForSummary(messages);
    expect(summary).not.toContain("runtime_context");
    expect(summary).not.toContain("large hidden snapshot");
    expect(summary).toContain("write");
    expect(summary).toContain("saved");
  });

  it("includes tool call args alongside names on assistant messages", () => {
    const messages: AgentMessageLike[] = [
      { role: "user", content: "write a file" },
      { role: "assistant", content: "Done.", toolCalls: [
        { id: "call-1", name: "write", args: { path: "/a.txt", content: "hi" } },
        { id: "call-2", name: "list", args: { path: "/" } },
      ] },
      { role: "tool", toolCallId: "call-1", name: "write", content: "wrote 2 bytes" },
      { role: "tool", toolCallId: "call-2", name: "list", content: "a.txt" },
    ];

    const summary = formatMessagesForSummary(messages);
    expect(summary).toContain("write(");
    expect(summary).toContain("/a.txt");
    expect(summary).toContain("list(");
    expect(summary).toContain("wrote 2 bytes");
  });

  it("appends assistant reasoning when present", () => {
    const messages: AgentMessageLike[] = [
      { role: "assistant", content: "Wrote it.", reasoning: "I chose /a.txt because the user asked for a scratch file.", toolCalls: [
        { id: "call-1", name: "write", args: { path: "/a.txt" } },
      ] },
      { role: "tool", toolCallId: "call-1", name: "write", content: "ok" },
    ];

    const summary = formatMessagesForSummary(messages);
    expect(summary).toContain("Reasoning:");
    expect(summary).toContain("scratch file");
  });

  it("scales the per-tool-result budget with summaryMaxChars and caps at 4000", () => {
    const longOutput = "x".repeat(10_000);
    const messages: AgentMessageLike[] = [
      { role: "tool", toolCallId: "c1", name: "read", content: longOutput },
    ];

    const small = formatMessagesForSummary(messages, 1_000);
    const large = formatMessagesForSummary(messages, 40_000);

    // summaryMaxChars=1000 → budget = max(800, 125) = 800
    expect(small).toContain(clampToolText(longOutput, 800));
    // summaryMaxChars=40000 → budget = min(4000, 5000) = 4000
    expect(large).toContain(clampToolText(longOutput, 4_000));
    expect(large.length).toBeGreaterThan(small.length);
  });

  it("keeps assistant → tool result join order so cause precedes effect", () => {
    const messages: AgentMessageLike[] = [
      { role: "assistant", content: "Writing.", toolCalls: [{ id: "c1", name: "write", args: { path: "/a" } }] },
      { role: "tool", toolCallId: "c1", name: "write", content: "wrote" },
    ];

    const summary = formatMessagesForSummary(messages);
    const assistantIdx = summary.indexOf("Assistant:");
    const toolIdx = summary.indexOf("Tool write:");
    expect(assistantIdx).toBeGreaterThanOrEqual(0);
    expect(toolIdx).toBeGreaterThan(assistantIdx);
  });

  it("truncates tool args to ~400 chars in the summary", () => {
    const bigArgs = { content: "y".repeat(5_000) };
    const messages: AgentMessageLike[] = [
      { role: "assistant", content: "", toolCalls: [{ id: "c1", name: "write", args: bigArgs }] },
    ];

    const summary = formatMessagesForSummary(messages);
    // The args JSON is clamped to 400 chars; the full 5000-char content must not survive.
    expect(summary).not.toContain("y".repeat(500));
    expect(summary.length).toBeLessThan(1_000);
  });

  it("skips injected system prompts so user work is not starved out of the handoff excerpt", () => {
    const injected = "You are NusaShell. ".repeat(800); // ~16k chars of re-injectable system
    const messages: AgentMessageLike[] = [
      { role: "system", content: injected },
      { role: "system", content: "mcp-tools workflow instructions ".repeat(400) },
      { role: "user", content: "analisa bug curl di ui ya" },
      {
        role: "assistant",
        content: "Menganalisis…",
        toolCalls: [{ id: "c1", name: "mcp_nusashell_files_read", args: { path: "ui/form.go" } }],
      },
      { role: "tool", toolCallId: "c1", name: "mcp_nusashell_files_read", content: "package form\n// curl parser here" },
      { role: "system", content: "Conversation summary:\nPrior handoff about draft package import" },
    ];

    const summary = formatMessagesForSummary(messages, 12_000);
    expect(summary).toContain("analisa bug curl di ui ya");
    expect(summary).toContain("read");
    expect(summary).toContain("curl parser here");
    expect(summary).toContain("Conversation summary:");
    expect(summary).toContain("draft package import");
    // Must not burn the budget only on live system/mcp-tools walls.
    expect(summary).not.toContain(injected.slice(0, 80));
    expect(summary).not.toContain("mcp-tools workflow instructions ");
  });

  it("skips Live MCP (runtime) system block from the summary excerpt", () => {
    const liveMcp = "## Live MCP (runtime)\nRunning: nusashell.notes\nAdvertised this turn: mcp_nusashell_createNote\nPrefer these names.";
    const messages: AgentMessageLike[] = [
      { role: "system", content: liveMcp },
      { role: "user", content: "buat catatan: beli kopi" },
      { role: "assistant", content: "Membuat…", toolCalls: [{ id: "c1", name: "mcp_nusashell_createNote", args: { text: "beli kopi" } }] },
      { role: "tool", toolCallId: "c1", name: "mcp_nusashell_createNote", content: "created" },
    ];
    const summary = formatMessagesForSummary(messages, 12_000);
    // User work + tool outcome must survive.
    expect(summary).toContain("beli kopi");
    expect(summary).toContain("created");
    // The Live MCP block must NOT be copy-pasted into the excerpt.
    expect(summary).not.toContain("## Live MCP (runtime)");
    expect(summary).not.toContain("Running: nusashell.notes");
    expect(summary).not.toContain("Advertised this turn");
  });
});

describe("withoutRuntimeHydration", () => {
  it("drops hydration tool messages and their assistant toolCalls", () => {
    const messages: AgentMessageLike[] = [
      { role: "user", content: "hi" },
      { role: "assistant", content: "", toolCalls: [
        { id: "hydrate:abc:0", name: "runtime_context", args: {} },
        { id: "call-1", name: "write", args: { path: "/a" } },
      ] },
      { role: "tool", toolCallId: "hydrate:abc:0", name: "runtime_context", content: "{}" },
      { role: "tool", toolCallId: "call-1", name: "write", content: "saved" },
    ];
    const filtered = withoutRuntimeHydration(messages);
    expect(filtered.some((m) => m.role === "tool" && m.toolCallId?.startsWith("hydrate:"))).toBe(false);
    const assistant = filtered.find((m) => m.role === "assistant") as AgentMessageLike;
    expect(assistant.toolCalls?.map((c) => c.id)).toEqual(["call-1"]);
    expect(filtered).toContainEqual({ role: "tool", toolCallId: "call-1", name: "write", content: "saved" });
  });

  it("drops an assistant message that had only hydration calls and no content", () => {
    const messages: AgentMessageLike[] = [
      { role: "assistant", content: "", toolCalls: [{ id: "hydrate:abc:0", name: "runtime_context", args: {} }] },
      { role: "tool", toolCallId: "hydrate:abc:0", name: "runtime_context", content: "{}" },
    ];
    const filtered = withoutRuntimeHydration(messages);
    expect(filtered.some((m) => m.role === "assistant")).toBe(false);
    expect(filtered).toHaveLength(0);
  });

  it("keeps messages unchanged when no hydration calls are present", () => {
    const messages: AgentMessageLike[] = [
      { role: "user", content: "hi" },
      { role: "assistant", content: "ok", toolCalls: [{ id: "c1", name: "write", args: {} }] },
      { role: "tool", toolCallId: "c1", name: "write", content: "saved" },
    ];
    expect(withoutRuntimeHydration(messages)).toEqual(messages);
  });
});

describe("shrinkToolContents", () => {
  const soft = 200; // chars/4 tokens; 200 tokens ≈ 800 chars

  it("clamps tool result contents oldest-first until under the soft threshold", () => {
    const big = "x".repeat(2_000);
    const messages: AgentMessageLike[] = [
      { role: "user", content: "go" },
      { role: "tool", toolCallId: "c1", name: "read", content: big },
      { role: "tool", toolCallId: "c2", name: "list", content: big },
    ];
    shrinkToolContents(messages, { soft });
    const totalChars = messages
      .filter((m): m is AgentMessageLike & { content: string } => m.role === "tool" && typeof m.content === "string")
      .reduce((acc, m) => acc + m.content.length, 0);
    expect(totalChars).toBeLessThan(soft * 4);
    expect(estimateMessageTokens(messages)).toBeLessThanOrEqual(soft);
  });

  it("keeps messages untouched when already under budget", () => {
    const messages: AgentMessageLike[] = [
      { role: "tool", toolCallId: "c1", name: "read", content: "tiny" },
    ];
    shrinkToolContents(messages, { soft: 1_000 });
    expect(messages[0]).toEqual({ role: "tool", toolCallId: "c1", name: "read", content: "tiny" });
  });

  it("replaces oldest results with short stubs when many large results still overflow", () => {
    const messages: AgentMessageLike[] = Array.from({ length: 60 }, (_, i) => ({
      role: "tool" as const,
      toolCallId: `c${i}`,
      name: "read",
      content: "x".repeat(2_000),
    }));
    const originalTokens = estimateMessageTokens(messages);
    shrinkToolContents(messages, { soft: 200 });
    // The algorithm replaces every oversized result with a short stub; the
    // stub wall can still exceed a tiny 200-token soft budget (the designed
    // give-up path that logs a warn), but it must be drastically smaller.
    expect(messages.some((m) => m.content === "[truncated tool result: read]")).toBe(true);
    expect(estimateMessageTokens(messages)).toBeLessThan(originalTokens / 10);
  });
});
