// Pure domain tests for the assistant tool-message clamping policy
// (ticket #83, Klaster D): size caps for args/output/error and the
// truncation helpers used by the desktop message builder.

import { describe, expect, it } from "vitest";
import {
  boundToolArgs,
  boundedStructuredContent,
  clampText,
  formatToolOutput,
  TOOL_ARGS_MAX_CHARS,
  TOOL_ERROR_MAX_CHARS,
  TOOL_OUTPUT_MAX_CHARS,
} from "../src/index.js";

describe("tool-message policy constants", () => {
  it("pins the clamping caps", () => {
    expect(TOOL_ARGS_MAX_CHARS).toBe(8_000);
    expect(TOOL_OUTPUT_MAX_CHARS).toBe(12_000);
    expect(TOOL_ERROR_MAX_CHARS).toBe(4_000);
  });
});

describe("clampText", () => {
  it("keeps text under the cap", () => {
    expect(clampText("short", 100)).toBe("short");
  });

  it("truncates text over the cap", () => {
    expect(clampText("x".repeat(50), 10)).toBe("x".repeat(10));
  });

  it("stringifies non-string values", () => {
    expect(clampText(42, 100)).toBe("42");
    expect(clampText(null, 100)).toBe("");
  });
});

describe("formatToolOutput", () => {
  it("passes strings through", () => {
    expect(formatToolOutput("raw")).toBe("raw");
  });

  it("returns empty for nullish", () => {
    expect(formatToolOutput(undefined)).toBe("");
    expect(formatToolOutput(null)).toBe("");
  });

  it("pretty-prints objects", () => {
    expect(formatToolOutput({ a: 1 })).toBe(JSON.stringify({ a: 1 }, null, 2));
  });
});

describe("boundToolArgs", () => {
  it("returns the encoded args under the cap", () => {
    const result = boundToolArgs(JSON.stringify({ path: "/a" }), 100);
    expect(result).toEqual({ _truncated: JSON.stringify({ path: "/a" }) });
  });

  it("truncates encoded args into a _truncated marker that fits the cap", () => {
    const encoded = JSON.stringify({ big: "x".repeat(500) });
    const result = boundToolArgs(encoded, 200);
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(200);
    expect(typeof result._truncated).toBe("string");
  });

  it("returns an empty record when the truncated marker still overflows", () => {
    // A tiny cap cannot even hold the _truncated wrapper after 3 budget passes.
    const encoded = JSON.stringify({ big: "x".repeat(1000) });
    expect(boundToolArgs(encoded, 5)).toEqual({});
  });

  it("handles exact-fit payloads", () => {
    const payload = JSON.stringify({ ok: true });
    const result = boundToolArgs(payload, payload.length + 100);
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(payload.length + 100);
  });
});

describe("boundedStructuredContent", () => {
  it("returns an object that fits the cap", () => {
    const value = { a: 1 };
    expect(boundedStructuredContent(value, 100)).toEqual(value);
  });

  it("returns undefined for objects over the cap", () => {
    expect(boundedStructuredContent({ big: "x".repeat(500) }, 100)).toBeUndefined();
  });

  it("returns undefined for non-objects", () => {
    expect(boundedStructuredContent("str", 100)).toBeUndefined();
    expect(boundedStructuredContent([1, 2], 100)).toBeUndefined();
    expect(boundedStructuredContent(null, 100)).toBeUndefined();
  });
});
