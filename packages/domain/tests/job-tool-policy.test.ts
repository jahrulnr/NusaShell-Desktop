// Pure domain tests for the job/pipeline tool denylist policy (ticket #81,
// Klaster B). The denylist is a failure-complexity reducer — not a security
// boundary — and must be a single source of truth shared by jobs + pipelines.

import { describe, expect, it } from "vitest";
import { isJobToolDenied, JOB_DENYLIST } from "../src/index.js";

describe("job tool policy (JOB_DENYLIST)", () => {
  it("pins the exact 13 denylisted tools", () => {
    expect([...JOB_DENYLIST].sort()).toEqual([
      "ask_question",
      "job",
      "mcp_disable",
      "mcp_enable",
      "mcp_register",
      "mcp_unregister",
      "memory",
      "pipeline",
      "skill_list",
      "skill_manage",
      "skill_read",
      "skill_search",
      "subagent",
    ].sort());
  });

  it("denies meta/learning/recursion tools", () => {
    for (const name of ["memory", "skill_read", "skill_manage", "ask_question"]) {
      expect(isJobToolDenied(name)).toBe(true);
    }
  });

  it("denies job/pipeline management (recursion guard) and subagents", () => {
    for (const name of ["job", "pipeline", "subagent"]) {
      expect(isJobToolDenied(name)).toBe(true);
    }
  });

  it("denies MCP lifecycle tools (failure-complexity reducer)", () => {
    for (const name of ["mcp_register", "mcp_unregister", "mcp_enable", "mcp_disable"]) {
      expect(isJobToolDenied(name)).toBe(true);
    }
  });

  it("allows MCP plugin tools, docs, files and terminal", () => {
    for (const name of ["files.read", "terminal.exec", "docs_read", "kanban.list_tickets", "searchwire_search"]) {
      expect(isJobToolDenied(name)).toBe(false);
    }
  });
});
