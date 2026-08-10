import { describe, expect, it } from "vitest";

import { buildConfigureAiCommand } from "../src/main/ipc/ai.js";

describe("AI provider selection command", () => {
  it("preserves the selected provider connection when changing models", () => {
    expect(buildConfigureAiCommand({
      id: "omniroute",
      api: "responses",
      baseUrl: "http://127.0.0.1:20128/v1",
      apiKey: "secret",
      timeoutMs: 60000,
      maxAttempts: 3,
    }, "openai/gpt-oss")).toEqual({
      kind: "configure-ai",
      providerId: "omniroute",
      api: "responses",
      model: "openai/gpt-oss",
      baseUrl: "http://127.0.0.1:20128/v1",
      apiKey: "secret",
      timeoutMs: 60000,
      maxAttempts: 3,
    });
  });
});
