/**
 * Agent tool-result dual representation (ticket #80, Klaster A).
 *
 * The canonical model and projection/ingestion rules moved to
 * `packages/domain/src/agent/tool-result-policy.ts`; this module re-exports
 * them so application consumers keep a stable import path.
 */
export {
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
  MODEL_TOOL_OUTPUT_MAX_CHARS,
  type AgentToolResult,
  type AgentToolStatus,
  type AgentToolContent,
  type AgentToolResultMeta,
  type AgentToolResultError,
  type McpRawResult,
  type McpIngestedResult,
  type McpContentPart,
} from "@nusashell/domain";
