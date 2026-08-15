import { app, BrowserWindow, dialog, Menu } from "electron";
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { bootstrap, type BootstrapResult } from "@nusashell/backend";
import { LogTail, type ShellLogLevel, type ShellLogSource } from "./log-tail.js";
import { PROD_DATA_DIRNAME, resolveIsDev, resolveWsPort, resolveDataRoot } from "./runtime-mode.js";
import {
  createLauncherWindow,
  closeAllPluginWindows,
  closePluginWindow,
  isPluginWindowSender,
  registerWindowIpc,
  setLauncherClosePolicy,
  showLauncherWindow,
  toggleLauncherWindow,
} from "./window-manager.js";
import { LINUX_DESKTOP_APP_NAME } from "./window-assets.js";
import { AppUpdater } from "./updater.js";
import { extractLatestRuntimeHydration, loadConfig, type StartPluginCommand } from "@nusashell/application";
import { AiSettingsStore, type AiRegistrySettings } from "./ai-settings.js";
import { AcpProviderStore } from "./acp-provider-store.js";
import { AcpProviderResolverAdapter } from "./acp-provider-resolver-adapter.js";
import { refreshAcpAuthStatuses } from "./acp-auth.js";
import { flattenModelCatalog } from "./ai-provider-registry.js";
import { AgentConversationStore } from "./agent-conversation-store.js";
import { buildAssistantMessage, buildInterruptedMessage, buildSteeredInterruptedTranscript, buildSteeredTranscript } from "../shared/agent-message-builder.js";
import type { AgentRuntimeHydration } from "../shared/agent-conversation-contract.js";
import { migrateMailCredentials } from "./migrate-mail-credentials.js";
import {
  AppBehaviorStore,
  shouldHideOnClose,
  shouldQuitOnAllWindowsClosed,
  type AppBehaviorSettings,
} from "./app-behavior-settings.js";
import { createLoginAutostart, type LoginAutostart } from "./login-autostart.js";
import { TrayManager } from "./tray.js";
import { formatLogArguments } from "./log-format.js";
import { resolveRuntimePaths } from "./runtime-paths.js";
import { enrichProcessPathFromLoginShell } from "./shell-path.js";
import {
  registerSkillsIpc,
  registerAiIpc,
  registerAgentIpc,
  registerPluginsIpc,
  registerNativeMcpIpc,
  registerShellIpc,
  type IpcContext,
} from "./ipc/index.js";
import { IpcRequestBridge, IpcEventBridge } from "./ipc-bridge.js";

let backend: BootstrapResult | null = null;
let updater: AppUpdater | null = null;
let aiSettingsStore: AiSettingsStore | null = null;
let aiSettings: AiRegistrySettings | null = null;
let agentConversationStore: AgentConversationStore | null = null;
let acpProviderStore: AcpProviderStore | null = null;
let appBehaviorStore: AppBehaviorStore | null = null;
let appBehavior: AppBehaviorSettings | null = null;
let loginAutostart: LoginAutostart | null = null;
let trayManager: TrayManager | null = null;
let isQuitting = false;
const isDev = resolveIsDev({ isPackaged: app.isPackaged, argv: process.argv });
const startHidden = process.argv.includes("--hidden") || process.argv.includes("--background");
const logTail = new LogTail(1000);
const shellLogLevels = new Set<ShellLogLevel>(["debug", "info", "warn", "error"]);
const aiRuntimeConfig = loadConfig().ai;
const aiStubEnabled = app.isPackaged ? false : aiRuntimeConfig.stubEnabled;

// WS port is still resolved for config compatibility (AppConfig.port), but
// the server is no longer started in the desktop product path (Phase 3).
// NUSASHELL_PORT is no longer exported to the renderer — preload uses IPC.
const wsPort = resolveWsPort({ isDev, envPort: process.env.NUSASHELL_PORT });
process.env.NUSASHELL_IS_DEV = String(isDev);

// Linux desktop entry registration must happen before any userData override so
// the default appData/nusashell derivation is stable in prod.
if (process.platform === "linux") {
  app.setName(LINUX_DESKTOP_APP_NAME);
}

// Isolate dev durable state under <repo>/.nusashell (gitignored) so concurrent
// prod + unpackaged-dev runs don't fight on userData or the WS port. Prod uses
// the explicit appData/nusashell path on every platform.
const repositoryRoot = resolve(__dirname, "..", "..", "..", "..");
if (!isDev) {
  app.setPath("userData", join(app.getPath("appData"), PROD_DATA_DIRNAME));
}
if (isDev) {
  const devDataRoot = resolveDataRoot({ isDev: true, repositoryRoot, appDataPath: app.getPath("appData") });
  app.setPath("userData", devDataRoot);
  mkdirSync(devDataRoot, { recursive: true });
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    showLauncherWindow();
  });
}

function toShellLogLevel(level: string): ShellLogLevel {
  if (level === "error" || level === "fatal") return "error";
  if (level === "warn") return "warn";
  if (level === "debug" || level === "trace") return "debug";
  return "info";
}

function captureMainConsole(): void {
  for (const level of ["debug", "info", "warn", "error"] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      logTail.add("main", level, formatLogArguments(args));
      original(...args);
    };
  }
}

captureMainConsole();

if (isDev) {
  app.commandLine.appendSwitch("no-sandbox");
}

function getDataRoot(): string {
  // Durable app state always lives under Electron userData — both packaged and
  // unpackaged. Previously unpackaged used the repo root, which mixed durable
  // state (docs-index cache) into the git checkout. Bundled read-only assets
  // (prompts, docs, plugins) stay on the runtime/bundle path via getRuntimeRoot.
  return app.getPath("userData");
}

function configureProvider(target: BootstrapResult, provider: AiRegistrySettings["providers"][number]): void {
  if (!provider.enabled || !provider.baseUrl) return;
  if (!provider.apiKeyOptional && !provider.apiKey) return;
  target.container.configureAi({
    providerId: provider.id,
    api: provider.api,
    baseUrl: provider.baseUrl,
    ...(provider.apiKey ? { apiKey: provider.apiKey } : {}),
    ...(provider.defaultModel ? { model: provider.defaultModel } : {}),
    timeoutMs: provider.timeoutMs,
    maxAttempts: provider.maxAttempts,
    omitToolChoice: provider.type === "ollama" || provider.type === "llamacpp",
  });
}

async function startBackend(): Promise<BootstrapResult> {
  const dataRoot = getDataRoot();
  mkdirSync(resolve(dataRoot, "plugins"), { recursive: true });
  const { pluginsRoot, bundledPluginsRoot, userPluginsRoot, builtinSkillsRoot, promptsRoot, docsRoot } = resolveRuntimePaths({
    isPackaged: app.isPackaged,
    moduleDir: __dirname,
    resourcesPath: process.resourcesPath,
    userDataPath: dataRoot,
  });
  const docsIndexStorageRoot = resolve(dataRoot, "agent", "docs-index");
  const skillsRoot = resolve(dataRoot, "skills");
  const memoryRoot = resolve(dataRoot, "memories");
  const jobsRoot = resolve(dataRoot, "agent", "jobs");

  // One-time migration: decrypt legacy safeStorage mail credentials and
  // write them to the plugin-managed store. Temporary — remove after one
  // release cycle once existing users have migrated.
  const mailStoreDir = resolve(dataRoot, "plugins-data", "nusashell.mail");
  await migrateMailCredentials(
    resolve(mailStoreDir, "mail-settings.json"),
    resolve(mailStoreDir, "accounts.dat"),
  );
  await migrateMailCredentials(
    resolve(dataRoot, "mail-settings.json"),
    resolve(mailStoreDir, "accounts.dat"),
  );

  const dbPath = process.env.NUSASHELL_DB_PATH || undefined;
  aiSettingsStore = new AiSettingsStore(
    resolve(dataRoot, "ai-settings.json"),
    resolve(dataRoot, "user-prompt.md"),
  );
  aiSettings = await aiSettingsStore.load();
  const activeProvider = aiSettings.providers.find((provider) => provider.id === aiSettings?.activeProviderId);
  const activeModel = flattenModelCatalog(aiSettings.providers).find((model) => model.key === aiSettings?.activeModelKey);
  const result = await bootstrap({
    appVersion: app.getVersion(),
    promptsRoot,
    docsRoot,
    docsIndexStorageRoot,
    skillsRoot,
    memoryRoot,
    jobsRoot,
    logFile: resolve(dataRoot, "logs", "nusashell.log"),
    telemetryDir: resolve(dataRoot, "telemetry"),
    // Phase 3: desktop uses IPC, not the loopback WebSocket. Keep the WS
    // server off the product path so there is no listening TCP socket.
    startWsServer: false,
    resolvePluginRuntimeEnvironment: () => ({
      NUSASHELL_USER_DATA: dataRoot,
    }),
    config: { port: wsPort, host: "127.0.0.1", pluginsRoot, bundledPluginsRoot, userPluginsRoot, builtinSkillsRoot, dbPath, logLevel: isDev ? "debug" : "info", ai: {
      providerId: activeProvider?.id ?? (aiStubEnabled ? "stub" : ""),
      stubEnabled: aiStubEnabled,
      api: activeProvider?.api,
      model: activeModel?.id,
      baseUrl: activeProvider?.baseUrl || undefined,
      apiKey: activeProvider?.apiKey,
      maxToolRounds: aiSettings.maxToolRounds,
      maxRepeatedToolCalls: aiSettings.maxRepeatedToolCalls,
      maxAutoContinues: aiSettings.maxAutoContinues,
      jobMaxToolRounds: aiRuntimeConfig.jobMaxToolRounds,
      softRecoverAttempts: aiRuntimeConfig.softRecoverAttempts,
      maxConcurrentToolCalls: aiRuntimeConfig.maxConcurrentToolCalls,
      strategy: aiSettings.strategy,
      totalAttemptBudget: aiSettings.totalAttemptBudget,
      stream: aiSettings.stream,
      vision: aiSettings.vision,
      userPrompt: aiSettings.userPrompt,
      timeoutMs: activeProvider?.timeoutMs ?? aiRuntimeConfig.timeoutMs,
      retry: {
        ...aiRuntimeConfig.retry,
        attemptBudget: activeProvider?.maxAttempts ?? aiRuntimeConfig.retry.attemptBudget,
      },
      context: {
        compactionEnabled: aiSettings.compactionEnabled,
        maxInputTokens: aiSettings.maxInputTokens,
        reserveTokens: aiSettings.reserveTokens,
        recentTurns: aiSettings.recentTurns,
        summaryMaxChars: aiSettings.summaryMaxChars,
      },
    } },
    loggerObserver: ({ level, args }) => {
      const message = formatLogArguments(args);
      const source: ShellLogSource = /\bmcp\b|stdio/i.test(message) ? "mcp" : "backend";
      logTail.add(source, toShellLogLevel(level), message);
    },
    acpProviderResolver: new AcpProviderResolverAdapter(acpProviderStore!),
    sealAgentTurn: async (conversationId, result, _options) => {
      const store = agentConversationStore;
      if (!store) {
        logTail.add("main", "warn", `sealAgentTurn: store not ready for conversation ${conversationId}`);
        return;
      }
      try {
        // Capture the durable boundary before this turn is sealed. A
        // compaction result describes provider input covered by the summary;
        // it must never advance past the assistant transcript produced by
        // this turn. If we derive the boundary from the post-seal message
        // count, the just-completed answer is compacted away and the next
        // user turn can resurrect an older TODO/checkpoint state.
        const beforeSeal = await store.get(conversationId);
        const beforeSealMessages = beforeSeal?.messages ?? [];
        const beforeSealCount = beforeSealMessages.length;
        const beforeSealPosition = beforeSealMessages.at(-1)?.position;
        const contextUpdated = await hasFreshRuntimeHydration(store, conversationId, result.messages);
        if (result.steerBoundaries?.length) {
          const transcript = buildSteeredTranscript(result);
          const last = transcript.at(-1);
          if (last && contextUpdated) transcript[transcript.length - 1] = { ...last, contextUpdated: true };
          await store.sealAssistantTranscript(conversationId, result.traceId, transcript);
        } else {
          const message = buildAssistantMessage(result, { contextUpdated });
          await store.sealAssistant(conversationId, result.traceId, message);
        }
        await persistRuntimeHydration(store, conversationId, result.traceId, result.messages);
        if (result.compaction?.summary) {
          const updated = await store.get(conversationId);
          const previous = updated?.checkpoint;
          const previousOffset = previous?.compactedMessageCount ?? 0;
          const summaryMessageCount = previous?.summary ? 1 : 0;
          await store.saveCheckpoint(conversationId, {
            summary: result.compaction.summary,
            compactedMessageCount: Math.min(
              beforeSealCount,
              previousOffset + Math.max(0, result.compaction.compactedMessageCount - summaryMessageCount),
            ),
            ...(beforeSealPosition !== undefined ? { compactedThroughPosition: beforeSealPosition } : {}),
            via: result.compaction.via,
            compactionCount: (previous?.compactionCount ?? (previous?.summary ? 1 : 0)) + 1,
          });
        }
        logTail.add("main", "debug", `Sealed assistant turn for ${conversationId} trace=${result.traceId}`);
      } catch (error) {
        logTail.add("main", "error", `sealAgentTurn failed for ${conversationId}: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
    sealAgentInterrupted: async (conversationId, partial, options) => {
      const store = agentConversationStore;
      if (!store) {
        logTail.add("main", "warn", `sealAgentInterrupted: store not ready for conversation ${conversationId}`);
        return;
      }
      try {
        const contextUpdated = await hasFreshRuntimeHydration(store, conversationId, partial.messages);
        if (partial.steerBoundaries?.length) {
          const transcript = buildSteeredInterruptedTranscript(partial, options.interruptReason);
          const last = transcript.at(-1);
          if (last && contextUpdated) transcript[transcript.length - 1] = { ...last, contextUpdated: true };
          await store.sealAssistantTranscript(conversationId, partial.traceId, transcript);
        } else {
          const message = {
            ...buildInterruptedMessage(partial, { interruptReason: options.interruptReason }),
            ...(contextUpdated ? { contextUpdated: true } : {}),
          };
          await store.sealAssistant(conversationId, partial.traceId, message);
        }
        await persistRuntimeHydration(store, conversationId, partial.traceId, partial.messages);
        logTail.add(
          "main",
          "info",
          `Sealed interrupted turn for ${conversationId} trace=${partial.traceId} reason=${options.interruptReason} rounds=${partial.rounds}`,
        );
      } catch (error) {
        logTail.add(
          "main",
          "error",
          `sealAgentInterrupted failed for ${conversationId}: ${error instanceof Error ? error.message : String(error)}`,
        );
        throw error;
      }
    },
  });
  for (const provider of aiSettings.providers) configureProvider(result, provider);
  return result;
}

async function persistRuntimeHydration(
  store: AgentConversationStore,
  conversationId: string,
  traceId: string,
  messages: Parameters<typeof extractLatestRuntimeHydration>[0] | undefined,
): Promise<void> {
  if (!messages) return;
  const extracted = extractLatestRuntimeHydration(messages);
  if (extracted.length === 0) return;
  const conversation = await store.get(conversationId);
  const snapshotWorkspace = hydrationWorkspace(extracted);
  if (!snapshotWorkspace.valid || snapshotWorkspace.workspace !== conversation?.workspace) {
    logTail.add("main", "debug", `Ignored stale runtime hydration for ${conversationId} trace=${traceId}`);
    return;
  }
  if (JSON.stringify(conversation?.runtimeHydration?.messages) === JSON.stringify(extracted)) return;
  await store.saveRuntimeHydration(conversationId, {
    traceId,
    updatedAt: new Date().toISOString(),
    messages: extracted as AgentRuntimeHydration["messages"],
  });
  logTail.add("main", "debug", `Saved runtime hydration for ${conversationId} trace=${traceId}`);
}

/**
 * A replayed sidecar appears in every later provider request, but only a
 * changed graph denotes an actual hydration boundary worth surfacing in UI.
 */
async function hasFreshRuntimeHydration(
  store: AgentConversationStore,
  conversationId: string,
  messages: Parameters<typeof extractLatestRuntimeHydration>[0] | undefined,
): Promise<boolean> {
  if (!messages) return false;
  const extracted = extractLatestRuntimeHydration(messages);
  if (extracted.length === 0) return false;
  const conversation = await store.get(conversationId);
  const snapshotWorkspace = hydrationWorkspace(extracted);
  if (!snapshotWorkspace.valid || snapshotWorkspace.workspace !== conversation?.workspace) return false;
  return JSON.stringify(conversation?.runtimeHydration?.messages) !== JSON.stringify(extracted);
}

function hydrationWorkspace(messages: Parameters<typeof extractLatestRuntimeHydration>[0]): {
  readonly valid: boolean;
  readonly workspace?: string;
} {
  const runtimeContext = messages.find(
    (message) => message.role === "tool" && message.name === "runtime_context",
  );
  if (runtimeContext?.role !== "tool") return { valid: false };
  try {
    const parsed: unknown = JSON.parse(runtimeContext.content);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return { valid: false };
    const workspace = (parsed as Record<string, unknown>).workspace;
    if (workspace === undefined) return { valid: true };
    return typeof workspace === "string" ? { valid: true, workspace } : { valid: false };
  } catch {
    return { valid: false };
  }
}

function requireBackend(): BootstrapResult {
  if (!backend) throw new Error("Backend not ready");
  return backend;
}

function createIpcContext(): IpcContext {
  const b = requireBackend();
  const c = b.container;
  return {
    app,
    dialog,
    BrowserWindow,
    getBackend: () => requireBackend(),
    getAiSettingsStore: () => { if (!aiSettingsStore) throw new Error("AI settings are not ready"); return aiSettingsStore; },
    getAgentConversationStore: () => { if (!agentConversationStore) throw new Error("Agent conversations are not ready"); return agentConversationStore; },
    getAcpProviderStore: () => { if (!acpProviderStore) throw new Error("ACP provider store is not ready"); return acpProviderStore; },
    getAppBehaviorStore: () => { if (!appBehaviorStore) throw new Error("App behavior settings are not ready"); return appBehaviorStore; },
    getLoginAutostart: () => { if (!loginAutostart) throw new Error("Login autostart is not ready"); return loginAutostart; },
    getUpdater: () => updater,
    logTail,
    shellLogLevels,
    commandBus: c.commandBus,
    queryBus: c.queryBus,
    syncPlugins: c.syncPlugins,
    skillRegistry: c.skillRegistry,
    skillProvenance: c.skillProvenance,
    skillUsage: c.skillUsage,
    skillApprovalStaging: c.skillApprovalStaging,
    skillCurator: c.skillCurator,
    skillCuratorScheduler: c.skillCuratorScheduler,
    backgroundReviewScheduler: c.backgroundReviewScheduler,
    learningGraph: c.learningGraph,
    agentToolGateway: c.agentToolGateway,
    updateAgentWorkspace: (...args) => c.updateAgentWorkspace(...args),
    conversationTodos: c.conversationTodos,
    configureBackgroundReview: (...args) => c.configureBackgroundReview(...args),
    configureCurator: (...args) => c.configureCurator(...args),
    configureCuratorScheduler: (...args) => c.configureCuratorScheduler(...args),
    getAppBehavior: () => appBehavior,
    setAppBehavior: (settings) => { appBehavior = settings; },
    isPluginWindowSender,
  };
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  agentConversationStore = new AgentConversationStore(resolve(app.getPath("userData"), "agent-conversations.json"));
  acpProviderStore = new AcpProviderStore(
    resolve(app.getPath("userData"), "acp-providers.json"),
    resolve(app.getPath("userData"), "acp-routing.json"),
    {
      info: (msg, ...args) => logTail.add("acp", "info", args.length ? `${msg} ${args.join(" ")}` : msg),
      warn: (msg, ...args) => logTail.add("acp", "warn", args.length ? `${msg} ${args.join(" ")}` : msg),
      error: (msg, ...args) => logTail.add("acp", "error", args.length ? `${msg} ${args.join(" ")}` : msg),
      debug: (msg, ...args) => logTail.add("acp", "debug", args.length ? `${msg} ${args.join(" ")}` : msg),
    },
  );
  appBehaviorStore = new AppBehaviorStore(resolve(app.getPath("userData"), "app-behavior.json"));
  appBehavior = await appBehaviorStore.load();
  loginAutostart = createLoginAutostart({
    platform: process.platform,
    isPackaged: app.isPackaged,
    exePath: app.getPath("exe"),
    homeDir: app.getPath("home"),
    ...(process.env.XDG_CONFIG_HOME ? { xdgConfigHome: process.env.XDG_CONFIG_HOME } : {}),
    setLoginItemSettings: (settings) => app.setLoginItemSettings(settings),
    getLoginItemSettings: () => app.getLoginItemSettings(),
    log: (message) => logTail.add("main", "info", message),
  });
  // A packaged install has a separate userData root from --dev. On first
  // launch, preserve an existing OS login entry instead of interpreting the
  // missing prod app-behavior file as an explicit user disable.
  if (app.isPackaged && !(await appBehaviorStore.hasPersistedSettings()) && await loginAutostart.get()) {
    appBehavior = await appBehaviorStore.set({ launchAtLogin: true });
  }
  await loginAutostart.reconcile(appBehavior);
  setLauncherClosePolicy({
    shouldHide: () => shouldHideOnClose({
      keepInBackground: appBehavior?.keepInBackground ?? true,
      isQuitting,
    }),
  });
  registerWindowIpc(
    (level, message) => logTail.add("ipc", level, message),
    async (pluginId) => {
      if (!backend) throw new Error("Backend not ready");
      const command: StartPluginCommand = { kind: "start-plugin", pluginId };
      await backend.container.commandBus.execute(command);
    },
  );
  logTail.add("main", "info", "Electron main process ready");
  logTail.add("ipc", "debug", "Shell IPC handlers registered");

  // GUI launches inherit a stripped PATH; merge login-shell PATH so nvm/fnm
  // tools (npx, node, agent, …) resolve for MCP stdio and ACP spawns.
  const pathEnrichment = await enrichProcessPathFromLoginShell();
  if (pathEnrichment.enriched) {
    logTail.add("main", "info", "Merged login-shell PATH into process environment");
  }

  try {
    backend = await startBackend();
    logTail.add("backend", "info", "Backend ready (in-process, IPC only)");

    backend.container.eventDispatcher.on("plugin.uninstalled", {
      handle: (event) => {
        const pluginId = (event as { aggregateId: string }).aggregateId;
        logTail.add("main", "info", `plugin.uninstalled closing window for ${pluginId}`);
        closePluginWindow(pluginId);
      },
    });
  } catch (err) {
    console.error("[main] startBackend failed:", err);
  }

  // Register all IPC handlers through focused modules (no container.* in IPC)
  const ctx = createIpcContext();
  registerSkillsIpc(ctx);
  registerAiIpc(ctx);
  registerAgentIpc(ctx);
  registerPluginsIpc(ctx);
  registerNativeMcpIpc(ctx);
  registerShellIpc(ctx);

  // Phase 1: register the generic IPC request + event bridges so the
  // renderer can talk to the bus without the loopback WebSocket.
  if (backend) {
    const ipcRequestBridge = new IpcRequestBridge(backend, backend.container.logger);
    ipcRequestBridge.register();
    const ipcEventBridge = new IpcEventBridge(backend, backend.container.logger);
    ipcEventBridge.register();
  }

  // Restore Connected badges from CLI file auth (no browser). Runs after the
  // command bus is up; failures stay silent and never downgrade a prior status.
  if (backend) {
    void refreshAcpAuthStatuses(
      acpProviderStore,
      backend.container.commandBus,
      (message) => logTail.add("main", "info", message),
    );
  }

  logTail.subscribe((entry) => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send("logs:entry", entry);
    }
  });

  trayManager = new TrayManager({
    isPackaged: app.isPackaged,
    moduleDir: __dirname,
    resourcesPath: process.resourcesPath,
    getStatusLabel: () => backend ? "NusaShell — running" : "NusaShell — starting",
    onOpen: () => { showLauncherWindow(); },
    onQuit: () => { isQuitting = true; app.quit(); },
    onToggle: () => { toggleLauncherWindow(); },
  });
  trayManager.create();

  if (!startHidden) {
    createLauncherWindow();
  } else {
    logTail.add("main", "info", "Started hidden in tray (--hidden)");
  }

  if (app.isPackaged) {
    updater = new AppUpdater();
    void updater.checkForUpdates();
  }

  app.on("activate", () => {
    showLauncherWindow();
  });
});

app.on("window-all-closed", () => {
  closeAllPluginWindows();
  if (shouldQuitOnAllWindowsClosed({
    keepInBackground: appBehavior?.keepInBackground ?? true,
    platform: process.platform,
  })) {
    app.quit();
  }
});

app.on("before-quit", async (e) => {
  isQuitting = true;
  trayManager?.destroy();
  trayManager = null;
  if (backend) {
    e.preventDefault();
    try {
      await backend.shutdown.shutdown();
    } catch {
      // best-effort
    }
    backend = null;
    app.quit();
  }
});
