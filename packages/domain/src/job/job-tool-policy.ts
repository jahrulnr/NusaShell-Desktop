/**
 * Job/pipeline tool denylist policy (ticket #81, Klaster B).
 *
 * Tools a scheduled job/pipeline may NOT touch. Jobs must not mutate the
 * learning stores (memory/skills) — they are automation, not learning — and
 * must not manage other jobs/pipelines (recursion guard), spawn subagents
 * (headless ACP turns can stall on tool-approval), or start/stop MCP plugins
 * (failure-complexity reducer: avoid unapproved runtime changes).
 *
 * This is a failure-complexity reducer, NOT a security boundary — the single
 * source of truth shared by the job and pipeline gateways.
 */
export const JOB_DENYLIST: ReadonlySet<string> = new Set([
  "memory",
  "skill_manage",
  "skill_list",
  "skill_search",
  "skill_read",
  "ask_question",
  "job",
  "pipeline",
  "subagent",
  "mcp_register",
  "mcp_unregister",
  "mcp_enable",
  "mcp_disable",
]);

export function isJobToolDenied(name: string): boolean {
  return JOB_DENYLIST.has(name);
}
