// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

import { CompletionSteerer } from "../src/renderer/completion-steerer.js";

describe("CompletionSteerer", () => {
  let startedTurns: string[];
  let idleState: boolean;
  let logs: string[];

  beforeEach(() => {
    startedTurns = [];
    idleState = true;
    logs = [];
  });

  function makeSteerer() {
    return new CompletionSteerer({
      conversationId: "conv-1",
      isIdle: () => idleState,
      startTurn: async (message) => { startedTurns.push(message); },
      log: (msg) => logs.push(msg),
    });
  }

  it("does nothing when no jobs end", () => {
    const steerer = makeSteerer();
    steerer.dispose();
    expect(startedTurns).toHaveLength(0);
  });

  it("auto-starts a turn when a job ends and conversation is idle", async () => {
    const steerer = makeSteerer();
    steerer.onJobEnded({ handleId: "h1", conversationId: "conv-1", ok: true, reason: "completed", toolName: "run_command" });
    // Wait for debounce + fire.
    await new Promise((r) => setTimeout(r, 600));
    expect(startedTurns).toHaveLength(1);
    expect(startedTurns[0]).toContain("Background job completed — information only");
    expect(startedTurns[0]).toContain("run_command");
    steerer.dispose();
  });

  it("coalesces multiple job completions into one turn", async () => {
    const steerer = makeSteerer();
    steerer.onJobEnded({ handleId: "h1", conversationId: "conv-1", ok: true, reason: "completed", toolName: "tool_a" });
    steerer.onJobEnded({ handleId: "h2", conversationId: "conv-1", ok: false, reason: "failed", toolName: "tool_b", error: "boom" });
    await new Promise((r) => setTimeout(r, 600));
    expect(startedTurns).toHaveLength(1);
    expect(startedTurns[0]).toContain("tool_a");
    expect(startedTurns[0]).toContain("tool_b");
    steerer.dispose();
  });

  it("keeps a completion that arrives during an active turn and wakes once idle", async () => {
    idleState = false;
    const steerer = makeSteerer();
    steerer.onJobEnded({ handleId: "h1", conversationId: "conv-1", ok: true, reason: "completed", toolName: "t" });
    await new Promise((r) => setTimeout(r, 600));
    expect(startedTurns).toHaveLength(0);
    expect(logs.some((l) => l.includes("skipped"))).toBe(true);

    idleState = true;
    steerer.notifyIdle();
    await new Promise((r) => setTimeout(r, 600));
    expect(startedTurns).toHaveLength(1);
    steerer.dispose();
  });

  it("keeps a completion while composer draft/IME blocks a wake (#69)", async () => {
    // Caller wires isIdle to include composer busy; steerer must defer, not overwrite.
    idleState = false;
    const steerer = makeSteerer();
    steerer.onJobEnded({ handleId: "h1", conversationId: "conv-1", ok: true, reason: "completed", toolName: "t" });
    await new Promise((r) => setTimeout(r, 600));
    expect(startedTurns).toHaveLength(0);
    expect(logs.some((l) => l.includes("composer busy") || l.includes("not idle"))).toBe(true);
    steerer.dispose();
  });

  it("drains every completion across sequential wakes instead of dropping jobs over the batch cap", async () => {
    const steerer = makeSteerer();
    for (let index = 0; index < 11; index += 1) {
      steerer.onJobEnded({
        handleId: `h${index}`,
        conversationId: "conv-1",
        ok: true,
        reason: "completed",
        toolName: `tool_${index}`,
      });
    }
    await new Promise((r) => setTimeout(r, 1_250));
    expect(startedTurns).toHaveLength(2);
    expect(startedTurns.join("\n")).toContain("tool_10");
    steerer.dispose();
  });

  it("ignores events for other conversations", async () => {
    const steerer = makeSteerer();
    steerer.onJobEnded({ handleId: "h1", conversationId: "conv-other", ok: true, reason: "completed", toolName: "t" });
    await new Promise((r) => setTimeout(r, 600));
    expect(startedTurns).toHaveLength(0);
    steerer.dispose();
  });

  it("dispose cancels pending wake", async () => {
    const steerer = makeSteerer();
    steerer.onJobEnded({ handleId: "h1", conversationId: "conv-1", ok: true, reason: "completed", toolName: "t" });
    steerer.dispose();
    await new Promise((r) => setTimeout(r, 600));
    expect(startedTurns).toHaveLength(0);
  });

  it("discards pending completions after the user stops the owning turn", async () => {
    const steerer = makeSteerer();
    steerer.onJobEnded({ handleId: "h1", conversationId: "conv-1", ok: true, reason: "completed", toolName: "t" });
    steerer.discard();

    await new Promise((r) => setTimeout(r, 600));

    expect(startedTurns).toHaveLength(0);
    steerer.dispose();
  });

  it("includes error and output in the summary", async () => {
    const steerer = makeSteerer();
    steerer.onJobEnded({
      handleId: "h1",
      conversationId: "conv-1",
      ok: false,
      reason: "failed",
      toolName: "build",
      error: "exit code 1",
      output: { stdout: "error: syntax error" },
    });
    await new Promise((r) => setTimeout(r, 600));
    expect(startedTurns[0]).toContain("exit code 1");
    expect(startedTurns[0]).toContain("stdout");
    steerer.dispose();
  });

  it("emits steering fired with job count when a turn is started", async () => {
    const steerings = [];
    const steerer = new CompletionSteerer({
      conversationId: "conv-1",
      isIdle: () => true,
      startTurn: async () => {},
      log: () => {},
      onSteering: (s) => steerings.push(s),
    });
    steerer.onJobEnded({ handleId: "h1", conversationId: "conv-1", ok: true, reason: "completed", toolName: "t" });
    steerer.onJobEnded({ handleId: "h2", conversationId: "conv-1", ok: true, reason: "completed", toolName: "t2" });
    await new Promise((r) => setTimeout(r, 600));
    expect(steerings).toHaveLength(1);
    expect(steerings[0]).toMatchObject({ outcome: "fired", jobCount: 2, conversationId: "conv-1" });
    expect(typeof steerings[0].triggeredAt).toBe("string");
    steerer.dispose();
  });

  it("emits steering skipped with reason when not idle", async () => {
    const steerings = [];
    const steerer = new CompletionSteerer({
      conversationId: "conv-1",
      isIdle: () => false,
      startTurn: async () => {},
      log: () => {},
      onSteering: (s) => steerings.push(s),
    });
    steerer.onJobEnded({ handleId: "h1", conversationId: "conv-1", ok: true, reason: "completed", toolName: "t" });
    await new Promise((r) => setTimeout(r, 600));
    expect(steerings).toHaveLength(1);
    expect(steerings[0]).toMatchObject({ outcome: "skipped", reason: "not-idle", jobCount: 1 });
    steerer.dispose();
  });

  it("never throws when the observer fails", async () => {
    const steerer = new CompletionSteerer({
      conversationId: "conv-1",
      isIdle: () => true,
      startTurn: async () => {},
      log: () => {},
      onSteering: () => { throw new Error("observe down"); },
    });
    steerer.onJobEnded({ handleId: "h1", conversationId: "conv-1", ok: true, reason: "completed", toolName: "t" });
    await new Promise((r) => setTimeout(r, 600));
    // No throw; steering still happens.
    steerer.dispose();
  });
});
