import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const systemPrompt = readFileSync(new URL("../../../resources/agent/prompts/system.md", import.meta.url), "utf8");
const continuePrompt = readFileSync(new URL("../../../resources/agent/prompts/continue.md", import.meta.url), "utf8");
const mcpToolsPrompt = readFileSync(new URL("../../../resources/agent/prompts/mcp-tools.md", import.meta.url), "utf8");

describe("agent TODO stop and decision prompt contract", () => {
  it("requires TODO completion/reset as the agent's only self-directed stop path", () => {
    expect(systemPrompt).toMatch(/only way to end your own work is through the `todo` tool/i);
    expect(systemPrompt).toMatch(/mark every[\s\S]*TODO `completed`/i);
    expect(systemPrompt).toMatch(/reset\/remove the TODO list/i);
  });

  it("requires ask_question when continuation needs a user decision", () => {
    expect(systemPrompt).toMatch(/real user decision, call `ask_question`/i);
    expect(continuePrompt).toMatch(/material user decision, call the `ask_question` tool/i);
  });

  it("requires absolute paths when reporting paths through MCP tools", () => {
    expect(mcpToolsPrompt).toMatch(/absolute path/i);
    expect(mcpToolsPrompt).toMatch(/do not use relative path/i);
  });
});
