/**
 * Pure event-job matching policy (ticket #81, Klaster B).
 *
 * Moved from packages/application/src/job/services/event-job-matcher.ts:
 * glob matching, condition evaluation (incl. OR/NOT groups, Phase D), dot-path
 * resolution and the chain-depth guard. The stateful EventJobMatcher class
 * (event dispatcher subscription, throttle coalesce timers, hourly caps) stays
 * in application as an orchestrator; it delegates matching here.
 *
 * Order of application for an event-triggered job/pipeline:
 * pattern match → conditions → maxFiresPerHour → throttleMs coalesce.
 */
import type { Condition, ConditionNode, JobTrigger } from "./job-model.js";

/**
 * Minimal structural event shape the matcher needs. The application's
 * AutomationEvent (extends DomainEvent) satisfies this structurally, so the
 * domain stays free of application imports.
 */
export interface AutomationEventLike {
  readonly eventType: string;
  readonly pluginId?: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly originJobId?: string;
  readonly originPipelineId?: string;
  readonly chainDepth?: number;
}

/** Phase D: max chain depth to prevent infinite loops (second line of defense). */
export const MAX_CHAIN_DEPTH = 8;

/**
 * Glob matcher for event type patterns. Supports `*` (single segment) and
 * `**` (multi-segment). Uses a compiled regex for matching.
 *
 * Examples: "mail.new" (exact), "mail.*" (all mail), "**.updated" (any .updated).
 */
export function matchGlob(pattern: string, eventType: string): boolean {
  if (pattern === eventType) return true;
  if (!pattern.includes("*")) return false;
  const regex = globToRegex(pattern);
  return regex.test(eventType);
}

function globToRegex(pattern: string): RegExp {
  // Tokenize on ".", then rebuild. "**" spans zero-or-more whole segments,
  // "*" spans within a single segment. Building segment-wise lets "**"
  // collapse cleanly so both "**.updated"→"updated" and "a.**"→"a" match.
  const segs = pattern.split(".");
  let out = "^";
  for (let idx = 0; idx < segs.length; idx += 1) {
    const seg = segs[idx]!;
    if (seg === "**") {
      // Absorb the separator: zero segments means no dot is emitted.
      out += "(?:[^.]+(?:\\.[^.]+)*)?";
      if (idx < segs.length - 1) out += "\\.?";
      continue;
    }
    if (idx > 0 && segs[idx - 1] !== "**") out += "\\.";
    // Single-segment body: "*" -> any run of non-dot chars.
    let body = "";
    for (const ch of seg) {
      if (ch === "*") body += "[^.]*";
      else if (".+?^${}()|[]\\".includes(ch)) body += "\\" + ch;
      else body += ch;
    }
    out += body;
  }
  out += "$";
  return new RegExp(out);
}

/**
 * Evaluate a single condition against an event. A missing path means
 * no-match (distinct from template resolution where missing = literal).
 * Phase D adds `ne` (not-equal).
 */
export function evaluateCondition(cond: Condition, event: AutomationEventLike): boolean {
  const resolved = resolveDotPath(event, cond.path);
  if (resolved === undefined) return false;
  const str = String(resolved);
  switch (cond.op) {
    case "eq":
      return str === cond.value;
    case "ne":
      return str !== cond.value;
    case "contains":
      return str.includes(cond.value);
    case "regex":
      return safeRegexTest(cond.value, str);
  }
}

/**
 * Guard against catastrophic backtracking (ReDoS). A condition's regex comes
 * from job config and runs against attacker-influenced event payloads, so a
 * nested-quantifier source like `(a+)+` could stall the matcher. We reject
 * sources that apply a quantifier to a group that itself ends in a quantifier
 * (the classic exponential shape); invalid regexes evaluate to no-match.
 */
const REDOS_LIKE_RE = /([+*}]\s*[)\]])\s*[+*]/;
function safeRegexTest(source: string, str: string): boolean {
  if (REDOS_LIKE_RE.test(source)) return false;
  try {
    return new RegExp(source).test(str);
  } catch {
    return false;
  }
}

/**
 * Evaluate a condition node (leaf Condition or nested group with OR/NOT).
 * Phase D adds support for `{ op: "or", any: [...] }` and `{ op: "not", of: ... }`.
 */
export function evaluateConditionNode(node: ConditionNode, event: AutomationEventLike): boolean {
  if ("path" in node) return evaluateCondition(node, event);
  if (node.op === "or") return node.any.some((child) => evaluateConditionNode(child, event));
  if (node.op === "not") return !evaluateConditionNode(node.of, event);
  return false;
}

/**
 * Evaluate a leaf condition directly against a root object (e.g. pipeline
 * step context). Dotted paths traverse the object itself: `{ path: "a.b" }`
 * on `{ a: { b: 1 } }` (not on a synthetic event envelope's payload). Use
 * this overload for in-pipeline step conditions so `outputKey` references
 * resolve naturally.
 */
export function evaluateConditionAgainstObject(cond: Condition, root: unknown): boolean {
  const resolved = resolveDotPath(root, cond.path);
  if (resolved === undefined) return false;
  const str = String(resolved);
  switch (cond.op) {
    case "eq":
      return str === cond.value;
    case "ne":
      return str !== cond.value;
    case "contains":
      return str.includes(cond.value);
    case "regex":
      return safeRegexTest(cond.value, str);
  }
}

/**
 * Evaluate a condition node against a plain root object (pipeline context).
 */
export function evaluateConditionNodeAgainstObject(node: ConditionNode, root: unknown): boolean {
  if ("path" in node) return evaluateConditionAgainstObject(node, root);
  if (node.op === "or") return node.any.some((child) => evaluateConditionNodeAgainstObject(child, root));
  if (node.op === "not") return !evaluateConditionNodeAgainstObject(node.of, root);
  return false;
}

/** Resolve a dot-path like "payload.subject" against an object. */
export function resolveDotPath(obj: unknown, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/**
 * Pure matching policy for an event trigger: pluginId pre-filter → glob
 * pattern → AND conditions (in that order). Used by EventJobMatcher for both
 * jobs and pipelines.
 */
export function matchesEventTrigger(
  trigger: Extract<JobTrigger, { kind: "event" }>,
  event: AutomationEventLike,
): boolean {
  if (trigger.pluginId !== undefined && event.pluginId !== trigger.pluginId) return false;
  if (!matchGlob(trigger.pattern, event.eventType)) return false;
  if (trigger.conditions) {
    for (const node of trigger.conditions) {
      if (!evaluateConditionNode(node, event)) return false;
    }
  }
  return true;
}
