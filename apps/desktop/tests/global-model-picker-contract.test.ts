import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const markup = readFileSync(new URL("../src/renderer/index.html", import.meta.url), "utf8");
const launcher = readFileSync(new URL("../src/renderer/launcher.js", import.meta.url), "utf8");

describe("global model picker", () => {
  it("uses the searchable model-picker interaction instead of exposing a long native select", () => {
    expect(markup).toMatch(/id="settings-global-model-trigger"[^>]*aria-controls="settings-global-model-menu"/);
    expect(markup).toMatch(/id="settings-global-model-menu"[^>]*role="dialog"[^>]*hidden/);
    expect(markup).toMatch(/id="settings-global-model-search"[^>]*type="search"/);
    expect(markup).toMatch(/id="settings-global-model-list"[^>]*role="listbox"/);
    expect(markup).not.toMatch(/<select id="settings-global-model"/);
  });

  it("filters the same catalog as the composer picker and preserves the staged selection for Save", () => {
    expect(launcher).toMatch(/const renderGlobalModelPicker = \(\) =>/);
    expect(launcher).toMatch(/searchModels\(aiSettings\.models, \$\("#settings-global-model-search"\)\.value\)/);
    expect(launcher).toMatch(/modelSelect\.value = modelKey/);
    expect(launcher).toMatch(/#settings-global-model`\)\.value \|\| undefined/);
  });
});
