/**
 * Prompt-composition markers — pure domain rules (ticket #80, Klaster A).
 *
 * Moved from `packages/application/src/agent/services/prompt-injector.ts`.
 * The stable-prefix boundary marker and the deterministic time-var
 * formatters. The marker anchors the boundary between the byte-stable system
 * prefix (cacheable) and the dynamic tail; the time helpers produce the
 * stable date + machine clock/timezone used inside the dynamic tail.
 */

/**
 * Constant marker anchoring the boundary between the byte-stable system
 * prefix and the dynamic tail. Placed as the last line of the system block so
 * prefix bytes never change between runs.
 */
export const SYSTEM_PREFIX_END_MARKER =
  "=== STABLE SYSTEM PREFIX END / DYNAMIC TAIL BEGIN ===";

/** Stable calendar date (UTC-independent local) for the prompt, `YYYY-MM-DD`. */
export function stableCurrentDate(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

/** Local wall-clock time of the host machine, `HH:MM:SS`. */
export function machineCurrentTime(now: Date = new Date()): string {
  return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;
}

/** IANA timezone resolved from the host machine, e.g. `Asia/Jakarta`. */
export function machineTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "local machine time";
}
