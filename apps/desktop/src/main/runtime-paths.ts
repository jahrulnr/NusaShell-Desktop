import { resolve } from "node:path";

export interface RuntimePathOptions {
  readonly isPackaged: boolean;
  readonly moduleDir: string;
  readonly resourcesPath: string;
  readonly userDataPath?: string;
}

export interface RuntimePaths {
  readonly pluginsRoot: string;
  readonly bundledPluginsRoot: string;
  readonly userPluginsRoot: string;
  readonly builtinSkillsRoot: string;
  readonly promptsRoot: string;
  readonly docsRoot: string;
}

export function resolveRuntimePaths({
  isPackaged,
  moduleDir,
  resourcesPath,
  userDataPath,
}: RuntimePathOptions): RuntimePaths {
  const repositoryRoot = resolve(moduleDir, "..", "..", "..", "..");
  const agentRoot = isPackaged
    ? resolve(resourcesPath, "agent")
    : resolve(repositoryRoot, "resources", "agent");

  // Plugins are optional. The bundled root points at the resources plugins
  // dir when present; in dev we prefer an explicit NUSASHELL_PLUGINS_ROOT env
  // (the MCP repo is no longer a submodule) over a stale repo checkout.
  const bundledPluginsRoot = isPackaged
    ? resolve(resourcesPath, "plugins")
    : process.env.NUSASHELL_PLUGINS_ROOT
      ? resolve(repositoryRoot, process.env.NUSASHELL_PLUGINS_ROOT)
      : resolve(repositoryRoot, "plugins");
  const userPluginsRoot = userDataPath
    ? resolve(userDataPath, "plugins")
    : resolve(repositoryRoot, ".nusashell", "plugins");

  return {
    pluginsRoot: userPluginsRoot,
    bundledPluginsRoot,
    userPluginsRoot,
    builtinSkillsRoot: resolve(agentRoot, "skills"),
    promptsRoot: resolve(agentRoot, "prompts"),
    docsRoot: resolve(agentRoot, "docs"),
  };
}
