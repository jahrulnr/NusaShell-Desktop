import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveRuntimePaths } from "../src/main/runtime-paths.js";

describe("desktop runtime paths", () => {
  it("resolves packaged plugins and agent resources from Electron resources", () => {
    const resourcesPath = resolve("/opt/NusaShell/resources");

    expect(resolveRuntimePaths({
      isPackaged: true,
      moduleDir: "/unused",
      resourcesPath,
      userDataPath: "/home/user/.config/nusashell-desktop",
    })).toEqual({
      pluginsRoot: resolve("/home/user/.config/nusashell-desktop", "plugins"),
      bundledPluginsRoot: join(resourcesPath, "plugins"),
      userPluginsRoot: resolve("/home/user/.config/nusashell-desktop", "plugins"),
      builtinSkillsRoot: join(resourcesPath, "agent", "skills"),
      promptsRoot: join(resourcesPath, "agent", "prompts"),
      docsRoot: join(resourcesPath, "agent", "docs"),
    });
  });

  it("resolves development resources from the repository root (plugins optional)", () => {
    const moduleDir = resolve("/repo/apps/desktop/.vite/build");
    expect(resolveRuntimePaths({
      isPackaged: false,
      moduleDir,
      resourcesPath: "/unused",
    })).toEqual({
      pluginsRoot: resolve(moduleDir, "..", "..", "..", "..", ".nusashell", "plugins"),
      bundledPluginsRoot: resolve(moduleDir, "..", "..", "..", "..", "plugins"),
      userPluginsRoot: resolve(moduleDir, "..", "..", "..", "..", ".nusashell", "plugins"),
      builtinSkillsRoot: resolve(moduleDir, "..", "..", "..", "..", "resources", "agent", "skills"),
      promptsRoot: resolve(moduleDir, "..", "..", "..", "..", "resources", "agent", "prompts"),
      docsRoot: resolve(moduleDir, "..", "..", "..", "..", "resources", "agent", "docs"),
    });
  });

  it("honors NUSASHELL_PLUGINS_ROOT for optional bundled plugins in dev", () => {
    const previous = process.env.NUSASHELL_PLUGINS_ROOT;
    process.env.NUSASHELL_PLUGINS_ROOT = "external-mcp";
    try {
      const moduleDir = resolve("/repo/apps/desktop/.vite/build");
      const paths = resolveRuntimePaths({
        isPackaged: false,
        moduleDir,
        resourcesPath: "/unused",
      });
      expect(paths.bundledPluginsRoot).toBe(resolve("/repo", "external-mcp"));
    } finally {
      if (previous === undefined) delete process.env.NUSASHELL_PLUGINS_ROOT;
      else process.env.NUSASHELL_PLUGINS_ROOT = previous;
    }
  });
});
