// Pure domain tests for the model catalog policy (ticket #83, Klaster D):
// token defaults, chat-selectability heuristics, effort normalization and
// local (Ollama/llamacpp) context heuristics. No Electron, no HTTP.

import { describe, expect, it } from "vitest";
import {
  basenameLabel,
  DEFAULT_MAX_INPUT_TOKENS,
  DEFAULT_RESERVE_TOKENS,
  findContextLength,
  integerInRange,
  isChatSelectable,
  metaContextWindow,
  modes,
  normalizeEffort,
  normalizeEfforts,
  normalizeTask,
  positiveIntegerOrZero,
  type ModelOptionLike,
} from "../src/index.js";

describe("model catalog policy defaults", () => {
  it("pins the compaction cost ceiling defaults", () => {
    expect(DEFAULT_MAX_INPUT_TOKENS).toBe(200_000);
    expect(DEFAULT_RESERVE_TOKENS).toBe(16_000);
  });
});

describe("integerInRange / positiveIntegerOrZero", () => {
  it("clamps values outside the range to the fallback", () => {
    expect(integerInRange(1500, 1000, 2_000_000, 200_000)).toBe(1500);
    expect(integerInRange(500, 1000, 2_000_000, 200_000)).toBe(200_000);
    expect(integerInRange(1.5, 1, 10, 1)).toBe(1);
    expect(integerInRange("9", 1, 10, 1)).toBe(1);
  });

  it("positiveIntegerOrZero returns 0 for non-positive input", () => {
    expect(positiveIntegerOrZero(0)).toBe(0);
    expect(positiveIntegerOrZero(-5)).toBe(0);
    expect(positiveIntegerOrZero(3.5)).toBe(0);
    expect(positiveIntegerOrZero("4")).toBe(0);
    expect(positiveIntegerOrZero(4)).toBe(4);
  });
});

describe("normalizeEffort / normalizeEfforts", () => {
  it("maps aliases to canonical levels", () => {
    expect(normalizeEffort("off")).toBe("none");
    expect(normalizeEffort("min")).toBe("minimal");
    expect(normalizeEffort("med")).toBe("medium");
    expect(normalizeEffort("x-high")).toBe("xhigh");
    expect(normalizeEffort("extra")).toBe("xhigh");
    expect(normalizeEffort("maximum")).toBe("max");
    expect(normalizeEffort("default")).toBe("auto");
  });

  it("falls back to auto for unknown levels", () => {
    expect(normalizeEffort("banana")).toBe("auto");
    expect(normalizeEffort(undefined)).toBe("auto");
  });

  it("normalizeEfforts dedupes and drops auto", () => {
    expect(normalizeEfforts(["low", "low", "auto", "medium"])).toEqual(["low", "medium"]);
    expect(normalizeEfforts(undefined)).toEqual([]);
  });
});

describe("normalizeTask", () => {
  it("uses the task when present", () => {
    expect(normalizeTask("  Chat  ", "model")).toBe("chat");
  });

  it("falls back to type except for the literal 'model'", () => {
    expect(normalizeTask("", "embedding")).toBe("embedding");
    expect(normalizeTask("", "model")).toBe("");
  });
});

describe("isChatSelectable", () => {
  function model(overrides: Partial<ModelOptionLike>): ModelOptionLike {
    return { id: "vendor/model", task: "chat", outputModes: ["text"], ...overrides };
  }

  it("excludes known non-chat tasks", () => {
    expect(isChatSelectable(model({ task: "embedding" }))).toBe(false);
    expect(isChatSelectable(model({ task: "text-to-speech" }))).toBe(false);
    expect(isChatSelectable(model({ task: "rerank" }))).toBe(false);
  });

  it("excludes models without text output modes", () => {
    expect(isChatSelectable(model({ outputModes: ["image"] }))).toBe(false);
    expect(isChatSelectable(model({ outputModes: [] }))).toBe(true);
  });

  it("excludes ids carrying non-chat markers", () => {
    expect(isChatSelectable(model({ id: "vendor/embed-v3" }))).toBe(false);
    expect(isChatSelectable(model({ id: "vendor/whisper-large" }))).toBe(false);
    expect(isChatSelectable(model({ id: "vendor/dall-e-3" }))).toBe(false);
  });

  it("includes ordinary chat models", () => {
    expect(isChatSelectable(model({ id: "vendor/gpt-5" }))).toBe(true);
  });
});

describe("local model context heuristics", () => {
  it("metaContextWindow reads n_ctx / n_ctx_train / context_length", () => {
    expect(metaContextWindow({ n_ctx: 4096 })).toBe(4096);
    expect(metaContextWindow({ n_ctx_train: 8192 })).toBe(8192);
    expect(metaContextWindow({ context_length: 16_384 })).toBe(16_384);
    expect(metaContextWindow({})).toBe(0);
    expect(metaContextWindow("nope")).toBe(0);
  });

  it("findContextLength extracts the number from context_length keys", () => {
    expect(findContextLength({ llama: "context_length 131072" })).toBe(131072);
    expect(findContextLength({ llama: "other" })).toBe(0);
    expect(findContextLength({ numeric: 131072 })).toBe(0);
    expect(findContextLength({})).toBe(0);
  });
});

describe("basenameLabel", () => {
  it("returns the last path segment", () => {
    expect(basenameLabel("vendor/model-name")).toBe("model-name");
    expect(basenameLabel("vendor\\model-name")).toBe("model-name");
  });

  it("returns the id unchanged when there is no separator", () => {
    expect(basenameLabel("model-name")).toBe("model-name");
  });
});

describe("modes", () => {
  it("dedupes, trims and lowercases", () => {
    expect(modes(["text", "Text", " image ", "text"])).toEqual(["text", "image"]);
    expect(modes(undefined)).toEqual([]);
  });
});
