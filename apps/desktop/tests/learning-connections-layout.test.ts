import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../src/renderer/styles/learning-detail.css", import.meta.url), "utf8");

describe("Learning Connections layout", () => {
  it("stretches the graph panel so the time-range scrubber stays at the workspace footer", () => {
    expect(css).toMatch(/\.learning-connections-panel\s*\{[^}]*display:\s*flex;/);
    expect(css).toMatch(/\.learning-connections-panel\s*>\s*\.learning-constellation\s*\{[^}]*width:\s*100%;/);
    expect(css).toMatch(/\.learning-constellation-svg-wrap\s*\{[^}]*flex:\s*1 1 auto;/);
    expect(css).toMatch(/\.learning-scrubber-wrap\s*\{[^}]*flex:\s*none;/);
  });
});
