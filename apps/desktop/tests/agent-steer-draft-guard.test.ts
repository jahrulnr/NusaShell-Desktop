// @vitest-environment jsdom
/**
 * Ticket #69 — Completion steering must not overwrite an unsent composer draft
 * (or steal the textarea during IME composition). Empty-composer auto-continue
 * remains unchanged.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentConversationController } from "../src/renderer/agent-conversation-controller.js";

function installDom() {
  document.body.innerHTML = `
    <section id="agent-steer-queue" hidden>
      <button id="agent-steer-queue-toggle" aria-expanded="true"></button>
      <span id="agent-steer-queue-title"></span>
      <span id="agent-steer-queue-text"></span>
      <span id="agent-steer-queue-state"></span>
      <div id="agent-steer-queue-list"></div>
      <button id="agent-steer-cancel"></button>
    </section>
    <main id="agent-thread"></main>
    <form id="agent-form">
      <textarea id="agent-input" rows="1"></textarea>
      <div id="agent-attachments"></div>
      <button id="agent-send-btn" type="submit"></button>
      <button id="agent-stop-btn" hidden></button>
      <span id="agent-provider-status"></span>
    </form>
  `;
  globalThis.$ = (selector: string) => document.querySelector(selector);
}

function makeController() {
  const log = vi.fn();
  const steerTurn = vi.fn(async ({ steerId }) => ({ accepted: true, steerId }));
  const cancelSteer = vi.fn(async ({ steerId }) => ({ accepted: true, steerId }));
  const controller = new AgentConversationController({
    shell: { agentConversations: {} },
    getActiveModel: () => null,
    steerTurn,
    cancelSteer,
    log,
  } as never);
  controller.conversation = { id: "c1", messages: [] } as never;
  controller.activeId = "c1";
  return { controller, log, steerTurn, cancelSteer };
}

describe("AgentConversationController — completion steer draft guard (ticket #69)", () => {
  beforeEach(() => installDom());

  it("preserves user draft and does not submit when composer has unsent content", async () => {
    const { controller, log } = makeController();
    const submit = vi.spyOn(controller, "submit").mockResolvedValue(undefined as never);
    const input = document.querySelector<HTMLTextAreaElement>("#agent-input")!;
    input.value = "user draft";

    await controller.steerTurn("[Background job completed]\n- tool: ok");

    expect(input.value).toBe("user draft");
    expect(submit).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(
      expect.stringMatching(/cancelled|draft|IME/i),
    );
  });

  it("submits a background completion through the steer entry without writing raw text to the composer", async () => {
    const { controller } = makeController();
    const summary = "[Background job completed]\n- tool: ok\n\nContinue.";
    const submit = vi.spyOn(controller, "submit").mockResolvedValue(undefined as never);
    const input = document.querySelector<HTMLTextAreaElement>("#agent-input")!;
    input.value = "";

    await controller.steerTurn(summary);

    expect(input.value).toBe("");
    expect(submit).toHaveBeenCalledExactlyOnceWith({
      steering: true,
      turnMessage: { text: summary, attachments: [], source: "background" },
    });
  });

  it("queues a background completion through the same backend steer FIFO when a turn starts during its wake", async () => {
    const { controller, steerTurn } = makeController();
    controller.markTurnRunning("c1");
    controller.activeTraceIds.set("c1", "trace-running");

    await controller.steerTurn("[Background job completed]\n- tool: ok");

    expect(steerTurn).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: "c1",
      traceId: "trace-running",
      message: { role: "user", content: "[Background job completed]\n- tool: ok" },
    }));
  });

  it("does not overwrite or submit while IME composition is in progress", async () => {
    const { controller, log } = makeController();
    const submit = vi.spyOn(controller, "submit").mockResolvedValue(undefined as never);
    const input = document.querySelector<HTMLTextAreaElement>("#agent-input")!;
    // Partial candidate may still be empty string; IME flag alone must block.
    input.value = "";
    controller.inputComposing = true;

    await controller.steerTurn("[Background job completed]");

    expect(input.value).toBe("");
    expect(submit).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(
      expect.stringMatching(/cancelled|draft|IME/i),
    );
  });

  it("isComposerBlockingSteer is true for draft or IME, false for empty idle composer", () => {
    const { controller } = makeController();
    const input = document.querySelector<HTMLTextAreaElement>("#agent-input")!;

    input.value = "";
    controller.inputComposing = false;
    expect(controller.isComposerBlockingSteer()).toBe(false);

    input.value = "  typed  ";
    expect(controller.isComposerBlockingSteer()).toBe(true);

    input.value = "";
    controller.inputComposing = true;
    expect(controller.isComposerBlockingSteer()).toBe(true);
  });

  it("allows a user to send a steering message while a turn owns the room", () => {
    const { controller } = makeController();
    const input = document.querySelector<HTMLTextAreaElement>("#agent-input")!;
    const send = document.querySelector<HTMLButtonElement>("#agent-send-btn")!;
    const stop = document.querySelector<HTMLButtonElement>("#agent-stop-btn")!;

    controller.markTurnRunning("c1");
    controller.steeringTurnConversations.add("c1");
    controller.activeTraceIds.set("c1", "trace-running");
    input.value = "I need to add one more thing";

    controller.resetComposerForConversation("c1");

    expect(input.disabled).toBe(false);
    expect(send.disabled).toBe(false);
    expect(stop.hidden).toBe(false);
    expect(input.value).toBe("I need to add one more thing");
  });

  it("routes Send through the active-turn steering path instead of dropping it", async () => {
    const { controller } = makeController();
    const input = document.querySelector<HTMLTextAreaElement>("#agent-input")!;
    input.value = "Use the smaller patch instead";
    controller.markTurnRunning("c1");
    controller.activeTraceIds.set("c1", "trace-old");
    const queueSteeringTurn = vi
      .spyOn(controller, "queueSteeringTurn")
      .mockResolvedValue(undefined);

    await controller.submit();

    expect(queueSteeringTurn).toHaveBeenCalledExactlyOnceWith("c1", "trace-old");
    expect(input.value).toBe("Use the smaller patch instead");
  });

  it("moves the submitted message into a visible same-turn steer without cancelling work", async () => {
    const { controller, steerTurn } = makeController();
    const input = document.querySelector<HTMLTextAreaElement>("#agent-input")!;
    input.value = "Stop editing the adjacent file";
    controller.cancelTurn = vi.fn(async () => undefined);
    const submit = vi.spyOn(controller, "submit").mockResolvedValue(undefined as never);

    await controller.queueSteeringTurn("c1", "trace-old");

    expect(controller.cancelTurn).not.toHaveBeenCalled();
    expect(steerTurn).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: "c1",
      traceId: "trace-old",
      displayText: "Stop editing the adjacent file",
      message: { role: "user", content: "Stop editing the adjacent file" },
    }));
    expect(submit).not.toHaveBeenCalled();
    expect(input.value).toBe("");
    expect(document.querySelector<HTMLElement>("#agent-steer-queue")!.hidden).toBe(false);
    expect(document.querySelector("#agent-steer-queue-text")?.textContent).toBe("Stop editing the adjacent file");
    // Steering is not Stop: it must never abort the room's TODO continuation.
    expect(controller.autoContinueAborted).toBe(false);
  });

  it("moves an applied steer from the composer status into the live transcript", () => {
    const { controller } = makeController();
    const pending = controller.createStreamingMessage();
    pending.append(document.createElement("div"));
    const entry = { text: "Check Windows too", attachments: [], status: "applied" };
    controller.queuedSteeringTurns.set("c1", entry);
    controller.liveStreamState = {
      conversationId: "c1",
      message: pending,
      textBubble: null,
      reasoningEl: null,
      toolCards: new Map(),
      streamedText: "",
      reasoningText: "",
      lastKind: null,
    };

    controller.promoteAppliedSteerToTranscript("c1", entry);
    controller.renderSteerQueue();

    expect(document.querySelector<HTMLElement>("#agent-steer-queue")!.hidden).toBe(true);
    expect([...document.querySelectorAll("#agent-thread article.agent-message")].map((message) => message.classList.contains("user"))).toEqual([false, true, false]);
    expect(document.querySelector("#agent-thread article.agent-message.user .agent-bubble")?.textContent).toBe("Check Windows too");
    expect(document.querySelector("#agent-thread .agent-message-steer-flag")?.textContent).toBe("Steer message");
  });

  it("keeps the steering queue expanded by default and lets the user collapse it", () => {
    const { controller } = makeController();
    controller.queuedSteeringTurns.set("c1", { text: "First direction", attachments: [], status: "queued" });
    controller.renderSteerQueue();
    const toggle = document.querySelector<HTMLButtonElement>("#agent-steer-queue-toggle")!;
    const list = document.querySelector<HTMLElement>("#agent-steer-queue-list")!;

    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(list.hidden).toBe(false);
    controller.toggleSteerQueue();
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(list.hidden).toBe(true);
  });

  it("disables duplicate sends while one steer is waiting at the safe boundary", async () => {
    let accept!: (value: { accepted: boolean; steerId: string }) => void;
    const { controller, steerTurn } = makeController();
    steerTurn.mockImplementation(({ steerId }) => new Promise((resolve) => { accept = resolve; }).then(() => ({ accepted: true, steerId })));
    const input = document.querySelector<HTMLTextAreaElement>("#agent-input")!;
    const send = document.querySelector<HTMLButtonElement>("#agent-send-btn")!;
    input.value = "Change direction";
    controller.cancelTurn = vi.fn(async () => undefined);
    const submit = vi.spyOn(controller, "submit").mockResolvedValue(undefined as never);

    const first = controller.queueSteeringTurn("c1", "trace-old");
    expect(send.disabled).toBe(true);
    expect(controller.cancelTurn).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
    expect(steerTurn).toHaveBeenCalledOnce();
    const steerId = controller.queuedSteeringTurns.get("c1")!.id;
    accept({ accepted: true, steerId });
    await first;
    expect(submit).not.toHaveBeenCalled();
  });

  it("keeps a second steer and its attachment in the local queue until the active steer applies", async () => {
    const { controller, steerTurn } = makeController();
    const input = document.querySelector<HTMLTextAreaElement>("#agent-input")!;
    controller.queuedSteeringTurns.set("c1", {
      id: "steer-1", traceId: "trace-old", text: "First direction", attachments: [], status: "applied", request: Promise.resolve({ accepted: true }),
    });
    controller.attachments = [{ name: "diagram.png", type: "image", dataUrl: "data:image/png;base64,AA==" }];
    input.value = "Second direction";

    await controller.queueSteeringTurn("c1", "trace-old");

    expect(steerTurn).not.toHaveBeenCalled();
    expect(input.value).toBe("");
    expect(controller.steerBacklogs.get("c1")).toEqual([
      expect.objectContaining({ text: "Second direction", attachments: [{ name: "diagram.png", type: "image", dataUrl: "data:image/png;base64,AA==" }] }),
    ]);
  });

  it("cancels a pending steer and restores it to the composer for editing", async () => {
    const { controller, cancelSteer } = makeController();
    const input = document.querySelector<HTMLTextAreaElement>("#agent-input")!;
    input.value = "Keep this draft for later";
    await controller.queueSteeringTurn("c1", "trace-old");
    const steerId = controller.queuedSteeringTurns.get("c1")!.id;

    await controller.cancelQueuedSteer();

    expect(cancelSteer).toHaveBeenCalledExactlyOnceWith({ conversationId: "c1", traceId: "trace-old", steerId });
    expect(controller.queuedSteeringTurns.has("c1")).toBe(false);
    expect(input.value).toBe("Keep this draft for later");
    expect(document.querySelector<HTMLElement>("#agent-steer-queue")!.hidden).toBe(true);
  });

  it("does not leak an unhandled cancel error when steer acceptance fails", async () => {
    const { controller, steerTurn } = makeController();
    steerTurn.mockRejectedValue(new Error("turn already settled"));
    const input = document.querySelector<HTMLTextAreaElement>("#agent-input")!;
    input.value = "Keep this correction";

    const submit = controller.queueSteeringTurn("c1", "trace-old");
    await expect(controller.cancelQueuedSteer()).resolves.toBeUndefined();
    await submit;

    expect(input.value).toBe("Keep this correction");
    expect(controller.queuedSteeringTurns.has("c1")).toBe(false);
  });
});
