// Shared primitives
export type { DomainEvent } from "./shared/domain-event.js";
export {
  DomainError,
  type DomainErrorCode,
} from "./shared/domain-error.js";
export { Entity } from "./shared/entity.js";
export {
  err,
  isErr,
  isOk,
  ok,
  type Result,
} from "./shared/result.js";

// Plugin value objects
export { PluginId, type PluginId as PluginIdType } from "./plugin/value-objects/plugin-id.js";
export {
  PluginVersion,
  type PluginVersion as PluginVersionType,
} from "./plugin/value-objects/plugin-version.js";
export {
  PLUGIN_RUNTIME_STATES,
  type PluginRuntimeState,
} from "./plugin/value-objects/runtime-state.js";
export {
  TRANSPORT_TYPES,
  type TransportType,
} from "./plugin/value-objects/transport-type.js";

// Plugin entities
export {
  PluginManifest,
  type PluginManifestInput,
  type PluginSource,
  type WindowMode,
  type AutomationConfig,
  type AutomationEmit,
  type AutomationPoll,
} from "./plugin/entities/plugin-manifest.js";
export { Plugin, type CreatePluginInput } from "./plugin/entities/plugin.js";
export { PluginRuntime } from "./plugin/entities/plugin-runtime.js";

// Plugin policies
export { RuntimeTransitionPolicy } from "./plugin/services/runtime-transition-policy.js";
export { PluginLifecyclePolicy } from "./plugin/services/plugin-lifecycle-policy.js";

// Plugin events
export { PluginInstalledEvent } from "./plugin/events/plugin-installed.event.js";
export { PluginUninstalledEvent } from "./plugin/events/plugin-uninstalled.event.js";
export { PluginStartedEvent } from "./plugin/events/plugin-started.event.js";
export { PluginStoppedEvent } from "./plugin/events/plugin-stopped.event.js";
export { PluginCrashedEvent } from "./plugin/events/plugin-crashed.event.js";
export { PluginStateChangedEvent } from "./plugin/events/plugin-state-changed.event.js";
export { ToolCallCompletedEvent } from "./plugin/events/tool-call-completed.event.js";

// Plugin errors
export { InvalidRuntimeTransitionError } from "./plugin/errors/invalid-runtime-transition.error.js";
export { PluginDisabledError } from "./plugin/errors/plugin-disabled.error.js";
export { PluginNotFoundError } from "./plugin/errors/plugin-not-found.error.js";

// Tool value objects
export { ToolName, type ToolName as ToolNameType } from "./tool/value-objects/tool-name.js";
export { RequestId, type RequestId as RequestIdType } from "./tool/value-objects/request-id.js";

// Tool entities
export {
  ToolCall,
  type CreateToolCallInput,
  type ToolCallStatus,
} from "./tool/entities/tool-call.js";

// Tool errors
export { ToolNotFoundError } from "./tool/errors/tool-not-found.error.js";
export { ToolCallTimeoutError } from "./tool/errors/tool-call-timeout.error.js";

// Memory domain (ticket #84, Klaster E)
export {
  MEMORY_LIMIT,
  USER_LIMIT,
  ENTRY_DELIMITER,
  MATCH_AMBIGUOUS,
  MATCH_NOT_FOUND,
  MATCH_EMPTY,
  limitFor,
  splitEntries,
  joinEntries,
  charsOf,
  usageOf,
  checkCapacity,
  findUniqueMatch,
  addEntry,
  replaceEntry,
  removeEntry,
  type MemoryEntry,
  type MemoryTarget,
  type MemoryUsage,
} from "./memory/memory-entries.js";

// Telemetry domain (ticket #84, Klaster E)
export {
  type TelemetryTokenUsage,
  type ProviderRequestTelemetry,
  type AgentTurnTelemetry,
  type SteeringTelemetry,
  type TelemetryRecord,
} from "./telemetry/telemetry-types.js";

// Skill domain (ticket #84, Klaster E)
export {
  DEFAULT_CURATOR_SETTINGS,
  decideSkillState,
  latestActivityAt,
  type SkillState,
  type ActivityTimestamps,
  type CuratorSettings,
  type CuratorDecisionInput,
} from "./skill/skill-curator-policy.js";

// Learning domain (ticket #84, Klaster E)
export {
  parseMemoryNodeId,
  parseRelatedSkills,
  extractFrontmatter,
  truncate,
  buildMemoryNode,
  categoryForSkillId,
  clusterNodes,
  buildGraphStats,
  MEMORY_NODE_ID_PATTERN,
  type MemoryNodeEntry,
  type LearningNode,
  type LearningEdge,
  type LearningCluster,
  type LearningGraphStats,
  type LearningGraph,
} from "./learning/learning-graph.js";

// Agent domain (ticket #80, Klaster A)
export {
  DEFAULT_UNKNOWN_CONTEXT_WINDOW,
  DEFAULT_UNKNOWN_MAX_OUTPUT,
  MIN_AGENTIC_CONTEXT_WINDOW,
  resolveModelContextDefaults,
  resolveContextThreshold,
  tokenLimitReached,
  positiveInteger,
  type ModelContextDefaults,
  type ContextWindowSettings,
  type ContextThreshold,
} from "./agent/context-window.js";
export {
  summarizeTodos,
  countOpenTodos,
  type AgentTodoStatus,
  type AgentTodoItem,
  type AgentTodoList,
  type AgentTodoSummary,
} from "./agent/todo-status.js";
export {
  MAX_AUTO_CONTINUES_CAP,
  DEFAULT_MAX_AUTO_CONTINUES,
  decideAutoContinue,
  normalizeMaxAutoContinues,
  type AutoContinueReason,
  type AutoContinueDecision,
  type AutoContinuePolicyInput,
} from "./agent/auto-continue-policy.js";
export {
  SYSTEM_PREFIX_END_MARKER,
  stableCurrentDate,
  machineCurrentTime,
  machineTimeZone,
} from "./agent/prompt-composition.js";
export type { AgentToolStatus } from "./agent/tool-result-policy.js";
export {
  type AgentToolResult,
  type AgentToolContent,
  type AgentToolResultMeta,
  type AgentToolResultError,
  type McpContentPart,
  type McpRawResult,
  type McpIngestedResult,
  MODEL_TOOL_OUTPUT_MAX_CHARS,
  successToolResult,
  errorToolResult,
  cancelledToolResult,
  timeoutToolResult,
  fromGatewayValue,
  fromThrownError,
  ingestMcpToolResult,
  fromIngestedMcp,
  projectModelToolResult,
  truncateToolResultText,
} from "./agent/tool-result-policy.js";
export {
  MAX_REPEATED_TOOL_CALLS,
  DEFAULT_MAX_TOOL_ROUNDS,
  MAX_TOOL_ROUNDS_CAP,
  DEFAULT_SOFT_RECOVER_ATTEMPTS,
  MAX_SOFT_RECOVER_ATTEMPTS,
  DEFAULT_MAX_CONCURRENT_TOOL_CALLS,
  MAX_CONCURRENT_TOOL_CALLS_CAP,
  BARRIER_TOOLS,
  AgentPolicyError,
  isToolAllowed,
  isLazyResolvableMcpToolName,
  unknownToolExecution,
  isUntrustedTool,
  neutralizeDelimiters,
  wrapUntrustedResult,
  wrapUntrustedCompact,
  unwrapUntrustedToolResult,
  clampToolText,
  clampToolResultContent,
  serializeToolResult,
  normalizeMaxRounds,
  normalizeSoftRecover,
  normalizeConcurrentToolCalls,
  isBarrierTool,
  segmentToolBatch,
  cancelledExecution,
  type AgentToolCallLike,
  type AgentToolExecutionLike,
  type ToolBatchSegment,
} from "./agent/tool-policy.js";
export {
  HYDRATE_TOOL_CALL_PREFIX,
  estimateMessageTokens,
  formatMessagesForSummary,
  withoutRuntimeHydration,
  shrinkToolContents,
  type AgentMessageLike,
  type AgentContentPartLike,
  type PolicyLogger,
} from "./agent/context-compaction-policy.js";
export { StreamSeqRegistry } from "./agent/stream-seq-registry.js";

// AI domain (ticket #82, Klaster C)
export type { ReasoningEffort } from "./ai/reasoning-effort.js";
export {
  resolveModelRuntimePolicy,
  heuristicModelSupportsEffort,
  heuristicModelSupportsVision,
  type ModelCapabilities,
  type ModelRuntimePolicy,
} from "./ai/model-capability-policy.js";
export {
  DEFAULT_AUTOMATION_RATE_LIMITS,
  refillAutomationBucket,
  type RateLimiterSettings,
  type AutomationBucket,
} from "./ai/automation-rate-limit.js";

// Job & pipeline domain (ticket #81, Klaster B)
export {
  ONCE_GRACE_SECONDS,
  normalizeTrigger,
  scheduleOf,
  recurringCatchupGraceSeconds,
  isRecurring,
  type Job,
  type JobSchedule,
  type JobTrigger,
  type JobMode,
  type JobStatus,
  type JobOutputEntry,
  type Condition,
  type ConditionNode,
  type OnCompleteEmit,
} from "./job/job-model.js";
export {
  parseSchedule,
  computeNextRun,
  describeSchedule,
  ScheduleParseError,
} from "./job/schedule-parser.js";
export {
  detectCycle,
  topologicalSort,
  validatePipeline,
  validatePipelineTrigger,
  isPipelineSelfEventPattern,
  nextRunAtForPipelineTrigger,
  scheduleOfPipeline,
  isTerminalPipelineRunStatus,
  TERMINAL_PIPELINE_RUN_STATUSES,
  type Pipeline,
  type PipelineStep,
  type PipelineStepAction,
  type PipelineSettings,
  type PipelineContext,
  type PipelineStepResult,
  type PipelineRunResult,
  type PipelineStatus,
  type PipelineRun,
  type PipelineStepRun,
  type PipelineRunStatus,
  type PipelineStepRunStatus,
  type PipelineTriggerSource,
} from "./job/pipeline-model.js";
export {
  MAX_CHAIN_DEPTH,
  matchGlob,
  evaluateCondition,
  evaluateConditionNode,
  evaluateConditionAgainstObject,
  evaluateConditionNodeAgainstObject,
  resolveDotPath,
  matchesEventTrigger,
  type AutomationEventLike,
} from "./job/event-job-matching.js";
export {
  resolveTemplates,
  resolveTemplatesInRecord,
  templateContextFromEvent,
  type TemplateContext,
} from "./job/job-template-resolver.js";
export {
  JOB_DENYLIST,
  isJobToolDenied,
} from "./job/job-tool-policy.js";

// Conversation & tool-message policies (ticket #83, Klaster D)
export {
  DEFAULT_MAX_BYTES,
  HISTORY_SOFT_CAP_RATIO,
  CANVAS_ARTIFACT_MAX_COUNT,
  CANVAS_ARTIFACT_MAX_TOTAL_BYTES,
  CANVAS_ARTIFACT_MAX_SOURCE_BYTES,
  SUBAGENT_RUN_MAX_COUNT,
  RUNTIME_HYDRATION_MAX_MESSAGES,
  RUNTIME_HYDRATION_MAX_BYTES,
  softTrimTargetBytes,
  conversationTitle,
  evictCanvasArtifacts,
  maxMessagePosition,
  normalizeMessageSequence,
  normalizeAssistantMessageOrder,
  mergeResumedAssistantMessage,
  type CanvasArtifactLike,
  type ConversationMessageLike,
  type ConversationToolCallLike,
  type ConversationStepLike,
} from "./agent/conversation-policy.js";
export {
  TOOL_ARGS_MAX_CHARS,
  TOOL_OUTPUT_MAX_CHARS,
  TOOL_ERROR_MAX_CHARS,
  clampText,
  formatToolOutput,
  boundToolArgs,
  boundedStructuredContent,
} from "./agent/tool-message-policy.js";
export {
  SKEW_THRESHOLD_MS,
  FLOOD_WINDOW_MS,
  checkEventSkew,
  type EventSkewFrame,
  type EventSkewContext,
  type EventSkewResult,
} from "./agent/event-skew-policy.js";
export {
  DEFAULT_MAX_INPUT_TOKENS,
  DEFAULT_RESERVE_TOKENS,
  NON_CHAT_TASKS,
  NON_CHAT_MARKERS,
  isChatSelectable,
  normalizeTask,
  normalizeEfforts,
  normalizeEffort,
  integerInRange,
  modes,
  addUnique,
  positiveIntegerOrZero,
  basenameLabel,
  metaContextWindow,
  findContextLength,
  text,
  record,
  type ModelOptionLike,
} from "./ai/model-catalog-policy.js";
