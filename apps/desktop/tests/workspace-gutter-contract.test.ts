import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../src/renderer/styles/workbench.css", import.meta.url), "utf8");

describe("workspace gutter contract", () => {
  it("gives every full-height workspace one shared responsive inset", () => {
    expect(css).toContain("--workspace-gutter: clamp(12px, 2vw, 24px);");
    for (const view of ["agent", "skills", "learning", "jobs", "logs"]) {
      expect(css).toContain(`.content:has(.${view}-view.active)`);
    }
    expect(css).toMatch(/\.content:has\(\.agent-view\.active\),[\s\S]*?padding: var\(--workspace-gutter\);/);
  });

  it("contains every inset workspace inside one compact workbench boundary", () => {
    expect(css).toMatch(/\.view\.active\.agent-view,[\s\S]*?border-radius: var\(--radius-md\);/);
    expect(css).toMatch(/\.view\.active\.agent-view,[\s\S]*?overflow: hidden;/);
  });
});
