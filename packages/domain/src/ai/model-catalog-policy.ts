/**
 * Model catalog policy (ticket #83, Klaster D).
 *
 * Token defaults, chat-selectability heuristics, effort normalization and
 * local (Ollama/llamacpp) context-length heuristics. Moved from
 * apps/desktop/src/main/ai-provider-registry.ts; the registry keeps the
 * HTTP/import orchestration and calls these rules.
 */
import type { ReasoningEffort } from "./reasoning-effort.js";

const EFFORTS: readonly ReasoningEffort[] = [
  "auto", "none", "minimal", "low", "medium", "high", "xhigh", "max",
];

/**
 * Fresh-install / missing-key defaults for the compaction cost ceiling.
 * Existing saved `ai-settings.json` values are preserved by the registry
 * normalizer (the default only applies when the key is absent or invalid).
 * These defaults match the cheap-agentic p10 model window (200k) so long
 * tasks are usable out of the box.
 */
export const DEFAULT_MAX_INPUT_TOKENS = 200_000;
export const DEFAULT_RESERVE_TOKENS = 16_000;

/** Task names that never produce chat-selectable models. */
export const NON_CHAT_TASKS: ReadonlySet<string> = new Set([
  "embedding", "embeddings", "text-to-speech", "speech-to-text", "tts", "stt",
  "transcription", "translation", "image-generation", "video-generation",
  "moderation", "rerank", "reranking", "classification", "ocr",
]);

/** Substrings that mark a model id as non-chat. */
export const NON_CHAT_MARKERS: readonly string[] = [
  "embedding", "embed-", "-embed", "/embed", "rerank", "re-rank", "moderation",
  "transcribe", "transcription", "whisper", "text-to-speech", "speech-to-text",
  "-tts", "/tts", "tts-", "-stt", "/stt", "stt-", "gpt-image", "dall-e",
  "image-generation", "imagegen", "stable-diffusion", "sdxl", "video-generation",
];

/** Structural model-option shape the selectability policy needs. */
export interface ModelOptionLike {
  readonly id: string;
  readonly task: string;
  readonly outputModes: readonly string[];
}

/** A model is chat-selectable unless task/id markers or output modes say no. */
export function isChatSelectable(model: ModelOptionLike): boolean {
  const task = model.task.trim().toLowerCase();
  if (NON_CHAT_TASKS.has(task)) return false;
  if (model.outputModes.length > 0 && !model.outputModes.includes("text")) return false;
  const id = model.id.toLowerCase();
  return !NON_CHAT_MARKERS.some((marker) => id.includes(marker));
}

/** Normalize a task string; fall back to the type except for literal "model". */
export function normalizeTask(task: string, type: string): string {
  const normalized = task.trim().toLowerCase();
  if (normalized) return normalized;
  const fallback = type.trim().toLowerCase();
  return fallback === "model" ? "" : fallback;
}

/** Dedupe effort levels and drop "auto" (never advertised). */
export function normalizeEfforts(value: unknown): ReasoningEffort[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(normalizeEffort).filter((level) => level !== "auto"))];
}

/** Canonicalize an effort level, mapping catalog aliases; unknown → "auto". */
export function normalizeEffort(value: unknown): ReasoningEffort {
  const aliases: Record<string, ReasoningEffort> = {
    off: "none",
    min: "minimal",
    med: "medium",
    "x-high": "xhigh",
    extra: "xhigh",
    maximum: "max",
    // UI says "default"; catalogs sometimes use the same word.
    default: "auto",
  };
  const raw = text(value).toLowerCase();
  const normalized = (aliases[raw] ?? raw) as ReasoningEffort;
  return EFFORTS.includes(normalized) ? normalized : "auto";
}

/** Clamp an integer to [min, max], falling back when invalid. */
export function integerInRange(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max
    ? value
    : fallback;
}

/** Dedupe/trim/lowercase a modes list. */
export function modes(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => text(item).trim().toLowerCase()).filter(Boolean))];
}

/** Append a value to a list when absent. */
export function addUnique(values: string[], value: string): void {
  if (!values.includes(value)) values.push(value);
}

/** Positive-integer guard returning 0 for invalid input. */
export function positiveIntegerOrZero(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : 0;
}

/** Last path segment of a model id (for labels). */
export function basenameLabel(id: string): string {
  if (!id.includes("/") && !id.includes("\\")) return id;
  const parts = id.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts[parts.length - 1] || id;
}

/** Context window from Ollama /api/show meta fields (n_ctx, n_ctx_train, context_length). */
export function metaContextWindow(meta: unknown): number {
  const record = typeof meta === "object" && meta !== null && !Array.isArray(meta) ? meta as Record<string, unknown> : {};
  return positiveIntegerOrZero(record.n_ctx) || positiveIntegerOrZero(record.n_ctx_train) || positiveIntegerOrZero(record.context_length) || 0;
}

/**
 * Ollama model_info heuristic: scan string values for a context_length key
 * and extract the first 3+ digit number. Numeric values are skipped (they are
 * not length descriptors).
 */
export function findContextLength(modelInfo: Record<string, unknown>): number {
  for (const value of Object.values(modelInfo)) {
    if (typeof value === "number" && value > 0) continue;
    const str = text(value).toLowerCase();
    if (str.includes("context_length") || str.includes("context_length")) {
      const match = str.match(/(\d{3,})/);
      if (match) return positiveIntegerOrZero(Number(match[1]));
    }
  }
  return 0;
}

/** String-coerce helper: non-strings become "". */
export function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Object-coerce helper: non-plain-objects become {}. */
export function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}
