import { describe, expect, it } from "vitest";
import { injectPrompts, type PromptVars } from "../src/agent/services/prompt-injector.js";
import type { AgentPrompt } from "../src/agent/ports/prompt-loader.port.js";
import type { AgentMessage } from "../src/agent/ports/agent-provider.port.js";

function inject(...args: Parameters<typeof injectPrompts>): AgentMessage[] {
  return injectPrompts(...args).messages;
}

describe("injectPrompts — subagent prompt", () => {
  const vars: PromptVars = {
    currentDate: "2026-08-03",
    environment: "test",
    runtimeOs: "linux (ubuntu)",
    availableTools: "mcp_list, subagent",
    workspace: "/tmp",
  };

  const staticPrompts: AgentPrompt[] = [
    { name: "system", content: "System prompt", isTemplate: false },
    { name: "mcp-tools", content: "MCP tools prompt", isTemplate: false },
  ];

  it("subagent delegation guide is not injected as a system prompt (snapshot-only now)", () => {
    const messages: AgentMessage[] = [{ role: "user", content: "Hello" }];
    const result = inject(
      staticPrompts,
      vars,
      messages,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    );
    const systemContents = result.filter((m) => m.role === "system").map((m) => m.content as string);
    expect(systemContents).not.toContain("Subagent delegation guide");
    // The delegation guide now ships inside the runtime_context JSON snapshot,
    // not as a system-prompt injection (see runtime-hydration tests).
    expect(systemContents).not.toContain("Available ACP agents");
  });

  it("does not inject a subagent prompt when undefined", () => {
    const messages: AgentMessage[] = [{ role: "user", content: "Hello" }];
    const result = inject(staticPrompts, vars, messages);
    const systemContents = result.filter((m) => m.role === "system").map((m) => m.content as string);
    expect(systemContents).not.toContain("Subagent delegation guide");
  });

  it("does not inject subagent delegation guide into system prompts (moved to runtime_context snapshot)", () => {
    const messages: AgentMessage[] = [{ role: "user", content: "Hello" }];
    const result = inject(staticPrompts, vars, messages, "User custom prompt");
    const systemContents = result.filter((m) => m.role === "system").map((m) => m.content as string);
    // No delegation guide in any system message; it now lives in the
    // runtime_context JSON snapshot instead.
    expect(systemContents).not.toContain("Subagent delegation guide");
    expect(systemContents).not.toContain("Subagent guide");
    // User prompt still there.
    expect(systemContents).toContain("User custom prompt");
  });
});
