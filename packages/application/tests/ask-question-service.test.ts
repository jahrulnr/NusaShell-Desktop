import { describe, expect, it } from "vitest";
import { AskQuestionService } from "../src/agent/services/ask-question-service.js";

describe("AskQuestionService", () => {
  it("resolves an option answer into joined labels", async () => {
    const asks = new AskQuestionService();
    const pending = asks.ask("turn-1", "call-1", {
      question: "Pick",
      options: [
        { id: "a", label: "Alpha" },
        { id: "b", label: "Beta" },
      ],
      allowFreeText: true,
      multiSelect: true,
    });
    const result = asks.answer("turn-1", "call-1", { via: "option", optionIds: ["a", "b"] });
    expect(result.data).toEqual({ via: "option", answer: "Alpha, Beta", optionIds: ["a", "b"] });
    await expect(pending).resolves.toEqual(result);
  });

  it("rejects free text when not allowed", async () => {
    const asks = new AskQuestionService();
    const pending = asks.ask("turn-1", "call-1", {
      question: "Pick",
      options: [{ id: "a", label: "Alpha" }],
      allowFreeText: false,
      multiSelect: false,
    });
    expect(() => asks.answer("turn-1", "call-1", { via: "text", text: "other" })).toThrow(/not allowed/i);
    await expect(pending).rejects.toThrow(/not allowed/i);
  });

  it("combines selected options and custom text into one answer (multi-select + free text)", () => {
    const asks = new AskQuestionService();
    void asks.ask("turn-1", "call-1", {
      question: "Pick and elaborate",
      options: [
        { id: "a", label: "Alpha" },
        { id: "b", label: "Beta" },
      ],
      allowFreeText: true,
      multiSelect: true,
    });
    const result = asks.answer("turn-1", "call-1", {
      via: "option",
      optionIds: ["a", "b"],
      text: "also consider Gamma",
    });
    expect(result.data.answer).toBe("Alpha, Beta — also consider Gamma");
    expect(result.data.optionIds).toEqual(["a", "b"]);
    expect(result.data.text).toBe("also consider Gamma");
  });

  it("rejects supplementary text on option answers when free text is not allowed", async () => {
    const asks = new AskQuestionService();
    const pending = asks.ask("turn-1", "call-1", {
      question: "Pick",
      options: [{ id: "a", label: "Alpha" }],
      allowFreeText: false,
      multiSelect: true,
    });
    expect(() =>
      asks.answer("turn-1", "call-1", { via: "option", optionIds: ["a"], text: "extra" }),
    ).toThrow(/not allowed/i);
    await expect(pending).rejects.toThrow(/not allowed/i);
  });

  it("notifies onAsk when a question becomes pending", async () => {
    const notices: Array<{ turnId: string; callId: string; question: string }> = [];
    const asks = new AskQuestionService({
      onAsk: (pending) => {
        notices.push({ turnId: pending.turnId, callId: pending.callId, question: pending.request.question });
      },
    });
    const pending = asks.ask("turn-1", "call-1", {
      question: "Register the MCP plugin?",
      options: [
        { id: "confirm", label: "Register", default: true },
        { id: "cancel", label: "Cancel" },
      ],
      allowFreeText: false,
      multiSelect: false,
    });
    expect(notices).toEqual([{
      turnId: "turn-1",
      callId: "call-1",
      question: "Register the MCP plugin?",
    }]);
    asks.answer("turn-1", "call-1", { via: "option", optionIds: ["confirm"] });
    await expect(pending).resolves.toMatchObject({ data: { answer: "Register" } });
  });

  // BH-ASK-01: an invalid answer (unknown option id, empty free text, free
  // text not allowed, multi-select violation) must not leak the pending entry.
  // Previously buildResult() threw before pending.delete + pending.resolve,
  // leaving the tool call hanging forever and the turn stuck.
  describe("BH-ASK-01 — invalid answer must not leak the pending entry", () => {
    it("clears the pending entry and rejects the tool when an option id is unknown", async () => {
      const asks = new AskQuestionService();
      const pending = asks.ask("turn-1", "call-1", {
        question: "Pick",
        options: [{ id: "a", label: "Alpha" }],
        allowFreeText: true,
        multiSelect: false,
      });
      expect(() => asks.answer("turn-1", "call-1", { via: "option", optionIds: ["missing"] })).toThrow(/unknown option id/i);
      // The pending entry must be gone so a later answer/cancel is a clean no-op.
      expect(asks.hasPending("turn-1", "call-1")).toBe(false);
      // The tool promise must reject so the turn fails instead of hanging.
      await expect(pending).rejects.toThrow(/unknown option id/i);
    });

    it("clears the pending entry and rejects the tool when free text is empty", async () => {
      const asks = new AskQuestionService();
      const pending = asks.ask("turn-1", "call-1", {
        question: "Pick",
        options: [{ id: "a", label: "Alpha" }],
        allowFreeText: true,
        multiSelect: false,
      });
      expect(() => asks.answer("turn-1", "call-1", { via: "text", text: "   " })).toThrow(/must not be empty/i);
      expect(asks.hasPending("turn-1", "call-1")).toBe(false);
      await expect(pending).rejects.toThrow(/must not be empty/i);
    });

    it("clears the pending entry and rejects the tool when free text is not allowed", async () => {
      const asks = new AskQuestionService();
      const pending = asks.ask("turn-1", "call-1", {
        question: "Pick",
        options: [{ id: "a", label: "Alpha" }],
        allowFreeText: false,
        multiSelect: false,
      });
      expect(() => asks.answer("turn-1", "call-1", { via: "text", text: "other" })).toThrow(/not allowed/i);
      expect(asks.hasPending("turn-1", "call-1")).toBe(false);
      await expect(pending).rejects.toThrow(/not allowed/i);
    });
  });
});
