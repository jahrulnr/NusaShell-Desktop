/**
 * Assistant tool-message clamping policy (ticket #83, Klaster D).
 *
 * Size caps for persisted tool args/output/error and the truncation helpers
 * used by the desktop message builder (and mirrored by the renderer). Moved
 * from apps/desktop/src/shared/agent-message-builder.ts so the caps are
 * testable without Electron.
 */
export const TOOL_ARGS_MAX_CHARS = 8_000;
export const TOOL_OUTPUT_MAX_CHARS = 12_000;
export const TOOL_ERROR_MAX_CHARS = 4_000;

/** Clamp any value to a string of at most maxChars. */
export function clampText(value: unknown, maxChars: number): string {
  const text = typeof value === "string" ? value : String(value ?? "");
  return text.length > maxChars ? `${text.slice(0, maxChars)}` : text;
}

/** Canonical tool-output string used for persisted cards and provider turns. */
export function formatToolOutput(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/**
 * Bound a serialized args string to maxChars by storing the (possibly
 * truncated) payload under a `_truncated` marker whose JSON length fits the
 * cap. Budget is adjusted up to 3 passes; when the marker still overflows
 * (tiny caps) an empty record is returned so callers keep `{}`.
 */
export function boundToolArgs(encoded: string, maxChars: number): Record<string, unknown> {
  let budget = maxChars - JSON.stringify({ _truncated: "" }).length;
  let truncated: Record<string, unknown> = { _truncated: clampText(encoded, budget) };
  for (let attempt = 0; attempt < 3; attempt++) {
    truncated = { _truncated: clampText(encoded, budget) };
    const overflow = JSON.stringify(truncated).length - maxChars;
    if (overflow <= 0) break;
    budget -= overflow;
  }
  return JSON.stringify(truncated).length <= maxChars ? truncated : {};
}

/**
 * Pass through structured content only when it serializes within the cap;
 * otherwise drop it (undefined). Non-object values are never kept.
 */
export function boundedStructuredContent(
  value: unknown,
  maxChars: number,
): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  try {
    return JSON.stringify(value).length <= maxChars
      ? value as Record<string, unknown>
      : undefined;
  } catch {
    return undefined;
  }
}
