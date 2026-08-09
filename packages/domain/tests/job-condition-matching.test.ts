// Pure domain tests for event-job matching: glob, condition evaluation,
// dot-path resolution and the chain-depth guard (ticket #81, Klaster B).
// Ported from packages/application/tests/event-job-matcher.test.ts (pure
// parts) and packages/application/tests/job-condition-nodes.test.ts.

import { describe, expect, it } from "vitest";
import {
  evaluateCondition,
  evaluateConditionAgainstObject,
  evaluateConditionNode,
  evaluateConditionNodeAgainstObject,
  matchGlob,
  matchesEventTrigger,
  MAX_CHAIN_DEPTH,
  resolveDotPath,
  type Condition,
  type ConditionNode,
} from "../src/index.js";

describe("matchGlob", () => {
  it("matches exact patterns", () => {
    expect(matchGlob("mail.new", "mail.new")).toBe(true);
    expect(matchGlob("mail.new", "mail.old")).toBe(false);
  });

  it("matches single-segment wildcards", () => {
    expect(matchGlob("mail.*", "mail.new")).toBe(true);
    expect(matchGlob("mail.*", "mail.sent")).toBe(true);
    expect(matchGlob("mail.*", "resource.updated")).toBe(false);
  });

  it("matches multi-segment wildcards", () => {
    expect(matchGlob("**.updated", "resource.updated")).toBe(true);
    expect(matchGlob("**.updated", "mail.folder.updated")).toBe(true);
    expect(matchGlob("**.updated", "mail.new")).toBe(false);
  });

  it("does not match across segments with single *", () => {
    expect(matchGlob("mail.*", "mail.folder.new")).toBe(false);
  });
});

describe("resolveDotPath", () => {
  it("resolves nested paths", () => {
    expect(resolveDotPath({ payload: { subject: "hello" } }, "payload.subject")).toBe("hello");
  });

  it("returns undefined for missing paths", () => {
    expect(resolveDotPath({ payload: {} }, "payload.missing")).toBeUndefined();
    expect(resolveDotPath(null, "payload.x")).toBeUndefined();
  });

  it("stringifies non-string values", () => {
    expect(String(resolveDotPath({ a: { b: 3 } }, "a.b"))).toBe("3");
  });
});

describe("evaluateCondition", () => {
  const event = {
    eventType: "test.event",
    pluginId: "test.plugin",
    payload: { status: "ok", count: 3, label: "important-update" },
  } as const;

  it("eq matches exact string", () => {
    const cond: Condition = { path: "payload.status", op: "eq", value: "ok" };
    expect(evaluateCondition(cond, event)).toBe(true);
    expect(evaluateCondition({ ...cond, value: "error" }, event)).toBe(false);
  });

  it("contains matches substring", () => {
    const cond: Condition = { path: "payload.label", op: "contains", value: "important" };
    expect(evaluateCondition(cond, event)).toBe(true);
  });

  it("regex matches pattern", () => {
    const cond: Condition = { path: "payload.status", op: "regex", value: "^o[k]$" };
    expect(evaluateCondition(cond, event)).toBe(true);
  });

  it("returns false for missing path", () => {
    const cond: Condition = { path: "payload.missing", op: "eq", value: "ok" };
    expect(evaluateCondition(cond, event)).toBe(false);
  });

  it("ne matches when value differs and no-match on missing path", () => {
    const cond: Condition = { path: "payload.status", op: "ne", value: "error" };
    expect(evaluateCondition(cond, event)).toBe(true);
    expect(evaluateCondition({ ...cond, value: "ok" }, event)).toBe(false);
    expect(evaluateCondition({ path: "payload.missing", op: "ne", value: "ok" }, event)).toBe(false);
  });

  it("rejects ReDoS-shaped regex sources (nested quantifier)", () => {
    const cond: Condition = { path: "payload.status", op: "regex", value: "(a+)+" };
    expect(evaluateCondition(cond, event)).toBe(false);
  });
});

describe("evaluateConditionNode — OR/NOT/nested", () => {
  const event = {
    eventType: "test.event",
    pluginId: "test.plugin",
    payload: { status: "ok", priority: "high", label: "important-update" },
  } as const;

  it("OR: matches when any child matches", () => {
    const node: ConditionNode = {
      op: "or",
      any: [
        { path: "payload.status", op: "eq", value: "error" },
        { path: "payload.priority", op: "eq", value: "high" },
      ],
    };
    expect(evaluateConditionNode(node, event)).toBe(true);
  });

  it("OR: does not match when no child matches", () => {
    const node: ConditionNode = {
      op: "or",
      any: [
        { path: "payload.status", op: "eq", value: "error" },
        { path: "payload.priority", op: "eq", value: "low" },
      ],
    };
    expect(evaluateConditionNode(node, event)).toBe(false);
  });

  it("NOT: inverts a matching condition", () => {
    const node: ConditionNode = {
      op: "not",
      of: { path: "payload.status", op: "eq", value: "error" },
    };
    expect(evaluateConditionNode(node, event)).toBe(true);
  });

  it("NOT: inverts a non-matching condition", () => {
    const node: ConditionNode = {
      op: "not",
      of: { path: "payload.status", op: "eq", value: "ok" },
    };
    expect(evaluateConditionNode(node, event)).toBe(false);
  });

  it("nested: NOT(OR(...))", () => {
    const node: ConditionNode = {
      op: "not",
      of: {
        op: "or",
        any: [
          { path: "payload.status", op: "eq", value: "error" },
          { path: "payload.priority", op: "eq", value: "low" },
        ],
      },
    };
    expect(evaluateConditionNode(node, event)).toBe(true);
  });

  it("nested: OR with NOT child", () => {
    const node: ConditionNode = {
      op: "or",
      any: [
        { path: "payload.status", op: "eq", value: "error" },
        { op: "not", of: { path: "payload.priority", op: "eq", value: "low" } },
      ],
    };
    expect(evaluateConditionNode(node, event)).toBe(true);
  });

  it("leaf condition passes through evaluateConditionNode", () => {
    const node: ConditionNode = { path: "payload.status", op: "eq", value: "ok" };
    expect(evaluateConditionNode(node, event)).toBe(true);
  });
});

describe("evaluateConditionNodeAgainstObject (pipeline step context)", () => {
  it("resolves outputKey references against the root object", () => {
    const root = { classify: { sentiment: "urgent" }, count: 2 };
    const node: ConditionNode = {
      op: "or",
      any: [
        { path: "classify.sentiment", op: "eq", value: "urgent" },
        { path: "count", op: "eq", value: "3" },
      ],
    };
    expect(evaluateConditionNodeAgainstObject(node, root)).toBe(true);
  });

  it("leaf against object uses evaluateConditionAgainstObject", () => {
    const cond: Condition = { path: "a.b", op: "eq", value: "1" };
    expect(evaluateConditionAgainstObject(cond, { a: { b: 1 } })).toBe(true);
    expect(evaluateConditionAgainstObject(cond, { a: { b: 2 } })).toBe(false);
  });
});

describe("matchesEventTrigger", () => {
  const event = {
    eventType: "mail.new",
    pluginId: "mail.plugin",
    payload: { subject: "hello" },
    chainDepth: 0,
  };

  it("matches on pattern alone", () => {
    expect(matchesEventTrigger({ kind: "event", pattern: "mail.*" } as const, event)).toBe(true);
  });

  it("filters by pluginId when set", () => {
    expect(matchesEventTrigger({ kind: "event", pattern: "mail.*", pluginId: "mail.plugin" } as const, event)).toBe(true);
    expect(matchesEventTrigger({ kind: "event", pattern: "mail.*", pluginId: "other.plugin" } as const, event)).toBe(false);
  });

  it("evaluates AND conditions", () => {
    const trigger = {
      kind: "event",
      pattern: "mail.*",
      conditions: [{ path: "payload.subject", op: "eq", value: "hello" } as Condition],
    } as const;
    expect(matchesEventTrigger(trigger, event)).toBe(true);
    expect(matchesEventTrigger({
      ...trigger,
      conditions: [{ path: "payload.subject", op: "eq", value: "nope" }],
    }, event)).toBe(false);
  });
});

describe("MAX_CHAIN_DEPTH guard", () => {
  it("pins the chain-depth cap at 8 (second line of defense against infinite loops)", () => {
    expect(MAX_CHAIN_DEPTH).toBe(8);
  });
});
