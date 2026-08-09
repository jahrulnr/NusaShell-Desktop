import type { AgentMessage, AgentToolCall } from "../ports/agent-provider.port.js";
import type { MemoryStorePort } from "../../memory/ports/memory-store.port.js";
import type { SkillRegistryPort } from "../../skill/ports/skill-registry.port.js";
import type { McpLiveSnapshot } from "./mcp-live-prompt-formatter.js";
import { formatMemoryPrompt } from "./memory-prompt-formatter.js";
import { buildSkillsCatalogPrompt } from "./skills-catalog-formatter.js";
import { HYDRATE_TOOL_CALL_PREFIX } from "@nusashell/domain";

/**
 * Ephemeral synthetic tool transcript representing a current read-only
 * snapshot of the shell runtime (runtime context, memory, skills catalog,
 * MCP catalog/tools).
 *
 * Emits ordinary `AgentMessage[]` — one assistant message with N parallel
 * toolCalls followed by N matching tool results that provider adapters
 * already serialize correctly (verified against mapMessages / buildBody in
 * openai-chat / openai-responses / openai-messages strategies).
 *
 * The tool set is deliberately NOT fixed at 4: it is an assembly of read-only
 * snapshot slots that can grow with the product (runtime_context, memory,
 * skill_list, mcp_list, tool_list, and future capability snapshots).
 *
 * This builder NEVER executes the gateway: it precomputes results from the
 * read-only sources of truth. Callers keep the latest complete exchange as a
 * hidden provider checkpoint, separate from visible conversation history and
 * excluded from compaction summaries.
 *
 * Option B ordering: callers place this transcript AFTER a real user message
 * (or compaction summary) and BEFORE the model's own output.
 */
export class RuntimeHydrationBuilder {
  constructor(
    private readonly source: {
      readonly memory?: MemoryStorePort;
      readonly skills?: SkillRegistryPort;
      readonly mcpLive: McpLiveSnapshot;
      readonly runtimeContext?: RuntimeContextSnapshot;
      /** Fresh incomplete TODO snapshot for the owning conversation. */
      readonly todoPrompt?: string;
    },
  ) {}

  /**
   * Build the transcript. Reads happen through callbacks so the builder can
   * stay fail-soft: a throwing source yields a structured read error for that
   * one tool result while the other results still contribute.
   */
  async build(options: { readonly nonce?: string } = {}): Promise<{ readonly messages: AgentMessage[]; readonly meta: { readonly nonce: string; readonly callCount: number } }> {
    const nonce = options.nonce ?? cryptoRandomNonce();
    const slots = [
      this.readRuntimeContext(),
      await this.readMemory(),
      await this.readSkills(),
      { name: "mcp_list", args: {}, content: formatMcpList(this.source.mcpLive) },
      { name: "tool_list", args: {}, content: formatToolList(this.source.mcpLive) },
      ...(this.source.todoPrompt ? [{ name: "todo_list", args: {}, content: this.source.todoPrompt }] : []),
    ];

    const calls: AgentToolCall[] = slots.map((slot, index) => ({
      id: `${HYDRATE_ID_PREFIX}${nonce}:${index}`,
      name: slot.name,
      args: slot.args,
    }));

    const messages: AgentMessage[] = [
      { role: "assistant", content: "", toolCalls: calls },
      ...slots.map((slot, index) => ({
        role: "tool" as const,
        toolCallId: `${HYDRATE_ID_PREFIX}${nonce}:${index}`,
        name: slot.name,
        content: slot.content,
      })),
    ];

    return {
      messages,
      meta: { nonce, callCount: calls.length },
    };
  }

  private readRuntimeContext() {
    const ctx = this.source.runtimeContext;
    const content = ctx ? JSON.stringify(ctx) : "{}";
    return { name: "runtime_context", args: {}, content };
  }

  private async readMemory() {
    const store = this.source.memory;
    let content = "{}";
    if (store) {
      try {
        const snapshot = await store.loadSnapshot();
        content = formatMemoryPrompt(snapshot) ?? "{}";
      } catch (error) {
        content = JSON.stringify({ error: "memory read failed", message: error instanceof Error ? error.message : String(error) });
      }
    }
    return { name: "memory", args: { action: "list" }, content };
  }

  private async readSkills() {
    const registry = this.source.skills;
    let content = "[]";
    if (registry) {
      try {
        const summaries = await registry.list();
        content = buildSkillsCatalogPrompt(summaries) ?? "[]";
      } catch (error) {
        content = JSON.stringify({ error: "skill_list failed", message: error instanceof Error ? error.message : String(error) });
      }
    }
    return { name: "skill_list", args: { limit: 100 }, content };
  }
}

/** Reserved call-ID namespace for the hidden hydration transcript. */
export const HYDRATE_ID_PREFIX = HYDRATE_TOOL_CALL_PREFIX;

/**
 * Return the latest complete hydration exchange from a provider transcript.
 * A partial graph is never persisted because providers require every
 * assistant tool call to have exactly one matching tool result.
 */
export function extractLatestRuntimeHydration(messages: readonly AgentMessage[]): readonly AgentMessage[] {
  for (let assistantIndex = messages.length - 1; assistantIndex >= 0; assistantIndex -= 1) {
    const assistant = messages[assistantIndex];
    if (assistant?.role !== "assistant" || !assistant.toolCalls?.length) continue;
    if (!assistant.toolCalls.every((call) => call.id.startsWith(HYDRATE_ID_PREFIX))) continue;

    const expectedIds = new Set(assistant.toolCalls.map((call) => call.id));
    if (expectedIds.size !== assistant.toolCalls.length) continue;
    const exchange: AgentMessage[] = [assistant];
    for (let index = assistantIndex + 1; index < messages.length; index += 1) {
      const message = messages[index];
      if (message?.role !== "tool" || !expectedIds.has(message.toolCallId)) break;
      expectedIds.delete(message.toolCallId);
      exchange.push(message);
      if (expectedIds.size === 0) return exchange;
    }
  }
  return [];
}

/** Read-only runtime context snapshot for the `runtime_context` synthetic call. */
export interface RuntimeContextSnapshot {
  readonly currentDate: string;
  readonly environment: string;
  readonly runtimeOs: string;
  readonly workspace?: string;
  /** Subagent routing + delegation guide, resolved fresh per snapshot. */
  readonly subagents?: SubagentSnapshot;
}

/**
 * Subagent capability snapshot embedded in the `runtime_context` JSON.
 * `available`/`default` mirror the routing prompt vars; `delegationGuide`
 * carries the (interpolated) delegation guide loaded from disk — data, not a
 * system-prompt injection.
 */
export interface SubagentSnapshot {
  readonly available: string;
  readonly default: string;
  readonly delegationGuide?: string;
}

function formatMcpList(snapshot: McpLiveSnapshot): string {
  const running = snapshot.running.map((p) => p.pluginId);
  return JSON.stringify({ running });
}

function formatToolList(snapshot: McpLiveSnapshot): string {
  const tools = snapshot.tools.map((t) => ({
    name: t.providerName,
    pluginId: t.pluginId,
    toolName: t.toolName,
    ...(t.description ? { description: t.description } : {}),
    inputSchema: t.inputSchema,
  }));
  return JSON.stringify({ count: tools.length, tools });
}

function cryptoRandomNonce(): string {
  const bytes = new Uint8Array(8);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
