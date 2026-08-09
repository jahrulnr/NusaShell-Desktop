import { describe, expect, it } from "vitest";
import {
  RunAgentTurnHandler,
  type AgentProvider,
  type AgentProviderRequest,
  type AgentProviderResult,
  type AgentToolGateway,
  type McpLiveSnapshot,
  type PromptLoaderPort,
  type MemoryStorePort,
  type MemorySnapshot,
  type SkillRegistryPort,
  type SkillSummary,
  type ConversationTodoPort,
  type AgentTodoItem,
  extractLatestRuntimeHydration,
} from "../src/index.js";

describe("runtime hydration checkpoint extraction", () => {
  it("keeps the latest complete synthetic graph", () => {
    const oldHydration = [
      { role: "assistant" as const, content: "", toolCalls: [{ id: "hydrate:old:0", name: "runtime_context", args: {} }] },
      { role: "tool" as const, toolCallId: "hydrate:old:0", name: "runtime_context", content: "old" },
    ];
    const latestHydration = [
      { role: "assistant" as const, content: "", toolCalls: [
        { id: "hydrate:new:0", name: "runtime_context", args: {} },
        { id: "hydrate:new:1", name: "memory", args: { action: "list" } },
      ] },
      { role: "tool" as const, toolCallId: "hydrate:new:0", name: "runtime_context", content: "new" },
      { role: "tool" as const, toolCallId: "hydrate:new:1", name: "memory", content: "{}" },
    ];

    expect(extractLatestRuntimeHydration([
      { role: "system", content: "system" },
      { role: "user", content: "first" },
      ...oldHydration,
      { role: "assistant", content: "answer" },
      { role: "user", content: "switch workspace" },
      ...latestHydration,
    ])).toEqual(latestHydration);
  });

  it("rejects an incomplete synthetic graph", () => {
    expect(extractLatestRuntimeHydration([
      { role: "user", content: "hello" },
      { role: "assistant", content: "", toolCalls: [
        { id: "hydrate:broken:0", name: "runtime_context", args: {} },
        { id: "hydrate:broken:1", name: "memory", args: { action: "list" } },
      ] },
      { role: "tool", toolCallId: "hydrate:broken:0", name: "runtime_context", content: "{}" },
    ])).toEqual([]);
  });
});

class ScriptedProvider implements AgentProvider {
  readonly id = "scripted";
  readonly requests: AgentProviderRequest[] = [];
  constructor(private readonly responses: readonly AgentProviderResult[]) {}

  async complete(request: AgentProviderRequest): Promise<AgentProviderResult> {
    this.requests.push(request);
    const response = this.responses[this.requests.length - 1];
    if (!response) throw new Error("No scripted provider response");
    return response;
  }
}

class FakeToolGateway implements AgentToolGateway {
  readonly begunTurns: string[] = [];
  beginTurn(turnId: string) { this.begunTurns.push(turnId); }
  endTurn(_turnId: string) {}
  cancelTurn() {}
  async listTools() { return []; }
  async execute() { return { ok: true }; }
  async getMcpLiveSnapshot(_turnId: string): Promise<McpLiveSnapshot> {
    return { running: [], tools: [] };
  }
}

function makeRegistry(provider: AgentProvider) {
  return {
    get: (id: string) => (id === provider.id ? provider : undefined),
    list: () => [provider],
  };
}

const RUNTIME = {
  strategy: "failover" as const,
  totalAttemptBudget: 1,
  maxToolRounds: 1,
  maxRepeatedToolCalls: 1,
  softRecoverAttempts: 0,
  maxConcurrentToolCalls: 1,
};

const fakePromptLoader: PromptLoaderPort = {
  async loadPrompts() {
    return [
      { name: "system", content: "You are the NusaShell agent.", isTemplate: false },
      { name: "mcp-tools", content: "Use advertised tools.", isTemplate: false },
    ];
  },
  async loadSubagentPrompt() { return ""; },
  async loadCompactPrompt() {
    return "Create a concise context checkpoint for another AI.";
  },
  async loadContinuePrompt() { return ""; },
  async loadReviewPrompt(_kind: never) { return ""; },
};

// A provider that records every request and returns a plain text answer.
function makeHandler(provider: AgentProvider, tools: AgentToolGateway): RunAgentTurnHandler {
  return new RunAgentTurnHandler(
    makeRegistry(provider),   // providers
    tools,                    // toolGateway
    "scripted",               // defaultProviderId
    RUNTIME,                  // runtime
    undefined,                // logger
    undefined,                // coordinator
    undefined,                // onTextDelta
    undefined,                // onReasoningDelta
    undefined,                // onToolCallStart
    undefined,                // onToolCallEnd
    undefined,                // onContextUpdate
    undefined,                // promptLoader (no static prompts → no system prefix)
    undefined,                // userPrompt
    undefined,                // memoryStore
    (_result) => {},          // onTurnComplete
  );
}

const liveMemorySnapshot: MemorySnapshot = {
  memory: [{ text: "jahrulnr's bug-fix workflow: plan first, then implement.", createdAt: null }],
  user: [{ text: "jahrulnr is a Go developer.", createdAt: null }],
  usage: { memory: { chars: 80, limit: 2200 }, user: { chars: 30, limit: 1375 } },
};
const fakeMemoryStore: MemoryStorePort = {
  async loadSnapshot() { return liveMemorySnapshot; },
  async add() { throw new Error("not used in hydration"); },
  async replace() { throw new Error("not used in hydration"); },
  async remove() { throw new Error("not used in hydration"); },
};

const liveSkills: readonly SkillSummary[] = [
  { id: "mcp-creator", name: "mcp-creator", description: "Author NusaShell MCP plugins", fileCount: 1, updatedAt: "2026-01-01" },
  { id: "gosite-project-map", name: "gosite-project-map", description: "Orientation for GoSite", fileCount: 1, updatedAt: "2026-01-01" },
];
const fakeSkillRegistry: SkillRegistryPort = {
  async list() { return liveSkills; },
  async search() { return []; },
  async get() { throw new Error("not used"); },
  async read() { throw new Error("not used"); },
  async installFromArchive() { throw new Error("not used"); },
  async create() { throw new Error("not used"); },
  async write() { throw new Error("not used"); },
  async delete() { throw new Error("not used"); },
  async archive() { throw new Error("not used"); },
  async restore() { throw new Error("not used"); },
  async listArchived() { return []; },
};

const fakeTodoPort: ConversationTodoPort = {
  get(_conversationId: string): readonly AgentTodoItem[] {
    return [
      { id: "t1", content: "wire composer to pass memoryStore to handler", status: "in_progress" },
      { id: "t2", content: "review hydration diff", status: "pending" },
    ];
  },
  set(_conversationId: string, _items: readonly AgentTodoItem[]): void {},
  clear(_conversationId: string): void {},
};

describe("Runtime hydration transcript (fresh room)", () => {
  it("fresh-room first request contains a synthetic parallel tool-call + tool-result exchange before the assistant response", async () => {
    const provider = new ScriptedProvider([{ text: "ok" }]);
    const tools = new FakeToolGateway();
    const handler = makeHandler(provider, tools);

    await handler.handle({
      kind: "run-agent-turn",
      traceId: "trace-fresh",
      messages: [{ role: "user", content: "hi" }],
      pluginIds: [],
    });

    // The first (and only) provider request carries the hydration transcript.
    const request = provider.requests[0];
    expect(request).toBeDefined();
    if (!request) throw new Error("expected a provider request");
    // Request ends with: user "hi" → assistant(toolCalls) → tool results → (model answers).
    const messages = request.messages.map((m) => m.role);
    expect(messages[messages.length - 1]).toBe("tool");
    const assistantIdx = messages.findIndex((r) => r === "assistant");
    expect(assistantIdx).toBeGreaterThan(-1);
    expect(messages[assistantIdx - 1]).toBe("user");
    const assistant = request.messages[assistantIdx] as
      | { role: "assistant"; content?: string; toolCalls?: readonly { id: string; name: string; args: Readonly<Record<string, unknown>> }[] }
      | undefined;
    expect(assistant?.role).toBe("assistant");
    expect(assistant?.toolCalls?.length).toBe(5);
    const callNames = (assistant?.toolCalls ?? []).map((c) => c.name).sort();
    expect(callNames).toEqual(["mcp_list", "memory", "runtime_context", "skill_list", "tool_list"].sort());

    const results = request.messages.slice(assistantIdx + 1).filter((m) => m.role === "tool");
    expect(results.length).toBe(5);
    const ids = new Set(results.map((r) => (r as { toolCallId?: string }).toolCallId));
    expect(ids.size).toBe(5);
  });
});

describe("Runtime hydration transcript (normal later turn)", () => {
  it("self-heals a legacy room that has no hidden hydration checkpoint", async () => {
    const provider = new ScriptedProvider([{ text: "ok" }]);
    const tools = new FakeToolGateway();
    const handler = makeHandler(provider, tools);

    // Simulate an existing conversation: the caller passes full history (messageCount > 1).
    await handler.handle({
      kind: "run-agent-turn",
      traceId: "trace-later",
      messages: [
        { role: "user", content: "first" },
        { role: "assistant", content: "answer one" },
        { role: "user", content: "second" },
      ],
      pluginIds: [],
    });

    const request = provider.requests[0];
    expect(request).toBeDefined();
    if (!request) throw new Error("expected a provider request");
    expect(extractLatestRuntimeHydration(request.messages)).toHaveLength(6);
  });

  it("keeps an existing complete hydration graph without adding a duplicate", async () => {
    const provider = new ScriptedProvider([{ text: "ok" }]);
    const tools = new FakeToolGateway();
    const handler = makeHandler(provider, tools);
    const hydration = [
      { role: "assistant" as const, content: "", toolCalls: [{ id: "hydrate:saved:0", name: "runtime_context", args: {} }] },
      { role: "tool" as const, toolCallId: "hydrate:saved:0", name: "runtime_context", content: "{}" },
    ];

    await handler.handle({
      kind: "run-agent-turn",
      traceId: "trace-later-saved",
      messages: [
        { role: "user", content: "first" },
        ...hydration,
        { role: "assistant", content: "answer one" },
        { role: "user", content: "second" },
      ],
      pluginIds: [],
    });

    const request = provider.requests[0];
    if (!request) throw new Error("expected a provider request");
    expect(request.messages.filter(
      (message) => message.role === "assistant"
        && message.toolCalls?.some((call) => call.id.startsWith("hydrate:")),
    )).toHaveLength(1);
    expect(extractLatestRuntimeHydration(request.messages)).toEqual(hydration);
  });
});

describe("Runtime hydration transcript (compaction)", () => {
  it("post-compaction continuation contains exactly one hydration transcript after the summary", async () => {
    // Aggressive budget so the long history triggers compaction.
    const runtime = {
      ...RUNTIME,
      context: {
        compactionEnabled: true,
        maxInputTokens: 200,
        reserveTokens: 20,
        recentTurns: 3,
        summaryMaxChars: 10_000,
      },
    };
    const provider = new ScriptedProvider([
      // 1st call: summarizer (round 0) — returns a summary body.
      { text: "summary body with enough length to pass the quality gate ............" },
      // 2nd call: the resumed turn itself.
      { text: "ok after compact" },
    ]);
    const tools = new FakeToolGateway();
    const handler = new RunAgentTurnHandler(
      makeRegistry(provider), tools, "scripted", runtime,
      undefined, undefined, undefined, undefined, undefined, undefined, undefined,
      fakePromptLoader, undefined, undefined, undefined, undefined, undefined, undefined,
    );
    const longUser = "user message ".repeat(200).trim();
    const result = await handler.handle({
      kind: "run-agent-turn",
      traceId: "trace-compact",
      messages: [
        { role: "user", content: longUser },
        { role: "assistant", content: "part 1" },
        { role: "user", content: "continue" },
      ],
      pluginIds: [],
      conversationId: "conv-compact",
    });

    // Hidden checkpoint rows affect token pressure but not the durable message
    // offset reported to the desktop, and they are not summarizer material.
    expect(result.compaction?.compactedMessageCount).toBe(5);
    expect(provider.requests[0]?.messages.some((message) => (
      message.role === "tool" && message.toolCallId.startsWith("hydrate:")
    ))).toBe(false);

    // The resumed (last) request is the post-compaction continuation.
    const resumed = provider.requests.at(-1);
    if (!resumed) throw new Error("expected a resumed request");
    const assistantWithCalls = resumed.messages.filter(
      (m) => m.role === "assistant" && m.toolCalls && m.toolCalls.length > 0,
    );
    expect(assistantWithCalls.length).toBe(1);
    // The hydration exchange sits right after the summary (compact history)
    // and before the model's own output.
    const summaryIdx = resumed.messages.findIndex(
      (m) => m.role === "user" && String(m.content).includes("Conversation summary:") ||
            m.role === "user" && String(m.content).startsWith("Another language model started"),
    );
    expect(summaryIdx).toBeGreaterThan(-1);
    const afterSummary = resumed.messages.slice(summaryIdx + 1);
    // After the summary, the next roles are assistant(toolCalls) then tool results.
    expect(afterSummary[0]?.role).toBe("assistant");
    expect((afterSummary[0] as { toolCalls?: readonly unknown[] }).toolCalls?.length).toBe(5);
    const toolResultCount = afterSummary.filter((m) => m.role === "tool").length;
    expect(toolResultCount).toBe(5);
  });
});

describe("Legacy hidden runtime checkpoint is absent", () => {
  it("does not emit [NUSASHELL RUNTIME CONTEXT] user message anywhere in the request", async () => {
    const provider = new ScriptedProvider([{ text: "ok" }]);
    const tools = new FakeToolGateway();
    const handler = makeHandler(provider, tools);

    await handler.handle({
      kind: "run-agent-turn",
      traceId: "trace-nocheckpoint",
      messages: [{ role: "user", content: "hi" }],
      pluginIds: [],
    });

    const request = provider.requests[0];
    if (!request) throw new Error("expected a provider request");
    const hasLegacyCheckpoint = request.messages.some(
      (m) => m.role === "user" && typeof m.content === "string" && m.content.startsWith("[NUSASHELL RUNTIME CONTEXT]"),
    );
    expect(hasLegacyCheckpoint).toBe(false);
  });
});

describe("Hydration transcript carries real read-only snapshots when sources are wired", () => {
  it("includes memory, skills, and MCP live snapshot content (not stubs)", async () => {
    const provider = new ScriptedProvider([{ text: "ok" }]);
    class SnapshotGateway extends FakeToolGateway {
      override async getMcpLiveSnapshot(): Promise<McpLiveSnapshot> {
        return {
          running: [{ pluginId: "nusashell.notes" }],
          tools: [{
            providerName: "mcp_nusashell_notes_createNote",
            pluginId: "nusashell.notes",
            toolName: "createNote",
            description: "Create a note",
            inputSchema: { type: "object", properties: { text: { type: "string" } } },
          }],
        };
      }
    }
    const tools = new SnapshotGateway();
    const handler = new RunAgentTurnHandler(
      makeRegistry(provider), // providers
      tools,                  // toolGateway
      "scripted",             // defaultProviderId
      RUNTIME,                // runtime
      undefined,              // logger
      undefined,              // coordinator
      undefined,              // onTextDelta
      undefined,              // onReasoningDelta
      undefined,              // onToolCallStart
      undefined,              // onToolCallEnd
      undefined,              // onContextUpdate
      undefined,              // promptLoader
      undefined,              // userPrompt
      fakeMemoryStore,        // memoryStore
      (_result) => {},        // onTurnComplete
      undefined,              // onTurnEnd
      undefined,              // onTurnStarted
      undefined,              // onTurnSuperseded
      undefined,              // runtimeOsProbe
      undefined,              // activeTurns
      undefined,              // onTurnProgress
      undefined,              // subagentPort
      fakeTodoPort,           // todoPort
      fakeSkillRegistry,      // skillRegistry
    );

    await handler.handle({
      kind: "run-agent-turn",
      traceId: "trace-snapshot",
      messages: [{ role: "user", content: "hi" }],
      pluginIds: [],
      conversationId: "conv-snapshot",
    });

    const request = provider.requests[0];
    if (!request) throw new Error("expected a provider request");
    const toolResults = request.messages
      .filter((m) => m.role === "tool")
      .map((m) => String(m.content));
    const joined = toolResults.join("\n");
    // Memory snapshot real content.
    expect(joined).toContain("bug-fix workflow");
    expect(joined).toContain("Go developer");
    // Skills catalog real content.
    expect(joined).toContain("mcp-creator");
    expect(joined).toContain("gosite-project-map");
    // MCP live snapshot real content (tool name + schema).
    expect(joined).toContain("nusashell.notes");
    expect(joined).toContain("mcp_nusashell_notes_createNote");
    // runtime_context snapshot is present with real env/os values.
    const runtimeResult = request.messages.find(
      (m) => m.role === "tool" && m.name === "runtime_context",
    );
    expect(runtimeResult).toBeDefined();
    const runtimeParsed = JSON.parse(String(runtimeResult?.content));
    expect(runtimeParsed.environment).toBe("development");
    expect(typeof runtimeParsed.runtimeOs).toBe("string");
    expect(typeof runtimeParsed.currentDate).toBe("string");
    // It is NOT empty stubs.
    expect(joined).not.toBe("{}\n[]\n{}\n[]");
  });

  it("fully-empty install (no MCP running, no tools, no memory, no skills) still yields a valid 5-call transcript and the turn still completes", async () => {
    // Brand-new install: no plugins running, no memory, no skills.
    // FakeToolGateway.getMcpLiveSnapshot already returns { running: [], tools: [] },
    // and memory/skills are NOT wired (undefined) → builder falls back to
    // empty results without throwing.
    const provider = new ScriptedProvider([{ text: "ok" }]);
    const tools = new FakeToolGateway();
    const handler = makeHandler(provider, tools); // memoryStore/skillRegistry undefined

    const result = await handler.handle({
      kind: "run-agent-turn",
      traceId: "trace-fresh-empty",
      messages: [{ role: "user", content: "hai" }],
      pluginIds: [],
    });

    // The turn still completes with a normal response.
    expect(result.text).toBe("ok");
    const request = provider.requests[0];
    if (!request) throw new Error("expected a provider request");
    // Transcript is still emitted: one assistant with 4 toolCalls + 4 tool results.
    const assistant = request.messages.find((m) => m.role === "assistant");
    expect((assistant as { toolCalls?: readonly unknown[] } | undefined)?.toolCalls?.length).toBe(5);
    const toolResults = request.messages.filter((m) => m.role === "tool");
    expect(toolResults.length).toBe(5);
    // Empty snapshots are valid empty JSON, not malformed.
    for (const r of toolResults) {
      expect(() => JSON.parse(String(r.content))).not.toThrow();
    }
    // No legacy checkpoint.
    expect(request.messages.some((m) => m.role === "user" && String(m.content).startsWith("[NUSASHELL RUNTIME CONTEXT]"))).toBe(false);
  });

  it("runtime_context snapshot carries subagent routing + interpolated delegation guide (not a system prompt)", async () => {
    const provider = new ScriptedProvider([{ text: "ok" }]);
    const tools = new FakeToolGateway();
    const guide = "## Subagent delegation\nAvailable ACP agents: {{available_subagents}}\nDefault ACP agent: {{default_subagent}}";
    const promptLoader: PromptLoaderPort = {
      async loadPrompts() {
        return [
          { name: "system", content: "You are the NusaShell agent.", isTemplate: false },
          { name: "mcp-tools", content: "Use advertised tools.", isTemplate: false },
        ];
      },
      async loadSubagentPrompt() { return guide; },
      async loadCompactPrompt() { return ""; },
      async loadContinuePrompt() { return ""; },
      async loadReviewPrompt() { return ""; },
    };
    const subagentPort: {
      resolve(): Promise<{ tryOrder: string[]; candidates: Map<string, unknown> }>;
      getRoutingInfo(): Promise<{ availableSubagents: string; defaultSubagent: string } | null>;
      run(): Promise<{ ok: boolean }>;
      cancel(): Promise<void>;
    } = {
      async resolve() { return { tryOrder: [], candidates: new Map() }; },
      async getRoutingInfo() {
        return { availableSubagents: "gemini, cursor", defaultSubagent: "gemini" };
      },
      async run() { return { ok: true }; },
      async cancel() {},
    };
    const handler = new RunAgentTurnHandler(
      makeRegistry(provider), // providers
      tools,                  // toolGateway
      "scripted",             // defaultProviderId
      RUNTIME,                // runtime
      undefined,              // logger
      undefined,              // coordinator
      undefined,              // onTextDelta
      undefined,              // onReasoningDelta
      undefined,              // onToolCallStart
      undefined,              // onToolCallEnd
      undefined,              // onContextUpdate
      promptLoader,           // promptLoader
      undefined,              // userPrompt
      undefined,              // memoryStore
      (_result) => {},        // onTurnComplete
      undefined,              // onTurnEnd
      undefined,              // onTurnStarted
      undefined,              // onTurnSuperseded
      undefined,              // runtimeOsProbe
      undefined,              // activeTurns
      undefined,              // onTurnProgress
      subagentPort as never,  // subagentPort
    );

    await handler.handle({
      kind: "run-agent-turn",
      traceId: "trace-subagents",
      messages: [{ role: "user", content: "hi" }],
      pluginIds: [],
      conversationId: "conv-subagents",
    });

    const request = provider.requests[0];
    if (!request) throw new Error("expected a provider request");
    const runtimeResult = request.messages.find(
      (m) => m.role === "tool" && m.name === "runtime_context",
    );
    expect(runtimeResult).toBeDefined();
    const parsed = JSON.parse(String(runtimeResult?.content)) as {
      subagents?: { available: string; default: string; delegationGuide?: string };
    };
    expect(parsed.subagents).toBeDefined();
    expect(parsed.subagents?.available).toBe("gemini, cursor");
    expect(parsed.subagents?.default).toBe("gemini");
    expect(parsed.subagents?.delegationGuide).toContain("Available ACP agents: gemini, cursor");
    expect(parsed.subagents?.delegationGuide).toContain("Default ACP agent: gemini");
    // Fully interpolated — no leftover template vars.
    expect(parsed.subagents?.delegationGuide).not.toContain("{{available_subagents}}");
    expect(parsed.subagents?.delegationGuide).not.toContain("{{default_subagent}}");
    // The guide no longer appears as a system prompt injection.
    const systemContents = request.messages
      .filter((m) => m.role === "system")
      .map((m) => String(m.content));
    expect(systemContents.join("\n")).not.toContain("Available ACP agents");
  });
});
