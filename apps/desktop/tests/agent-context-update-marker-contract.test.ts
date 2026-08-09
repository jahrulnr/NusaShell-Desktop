import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const controller = readFileSync(new URL("../src/renderer/agent-conversation-controller.js", import.meta.url), "utf8");

describe("agent context-update marker", () => {
  it("shows a compact footer marker beside rounds only for a fresh hydration boundary", () => {
    expect(controller).toMatch(/meta\.contextUpdated/);
    expect(controller).toMatch(/Context updated/);
    const rounds = controller.indexOf("round${meta.rounds === 1 ? \"\" : \"s\"}");
    const marker = controller.indexOf("Context updated");
    expect(rounds).toBeGreaterThanOrEqual(0);
    expect(marker).toBeGreaterThan(rounds);
  });
});
