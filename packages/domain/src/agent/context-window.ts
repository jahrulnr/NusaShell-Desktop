/**
 * Context-window policy — pure domain rule (ticket #80, Klaster A).
 *
 * Moved from `packages/application/src/agent/services/agent-turn-utils.ts`.
 * Holds the model-family context defaults, the soft/hard compaction
 * thresholds, and the `tokenLimitReached` trigger. No I/O: model ids and
 * capability numbers arrive from the catalog; the decision is pure.
 */

/** Silent fallback max output when the catalog does not expose it. */
export const DEFAULT_UNKNOWN_MAX_OUTPUT = 32_768;

/** Silent fallback context window for unknown model families. */
export const DEFAULT_UNKNOWN_CONTEXT_WINDOW = 200_000;

/**
 * Minimum expected context window for modern cheap agentic models. Used as a
 * floor when applying soft thresholds elsewhere — only break this if the model
 * id clearly indicates a small model (e.g. 7B 32k).
 */
export const MIN_AGENTIC_CONTEXT_WINDOW = 131_072;

export interface ModelContextDefaults {
  readonly contextWindow: number;
  readonly maxOutput: number;
}

interface FamilyRule {
  readonly match: readonly (readonly string[])[];
  readonly contextWindow: number;
  readonly maxOutput: number;
}

// Order matters: first match wins. Case-insensitive substring on model id.
const FAMILY_RULES: readonly FamilyRule[] = [
  // DeepSeek V4 / Flash large → 1M
  { match: [["deepseek", "v4"], ["deepseek", "flash"]], contextWindow: 1_048_576, maxOutput: 65_536 },
  // DeepSeek chat / r1 / v3 → 164k
  { match: [["deepseek"]], contextWindow: 163_840, maxOutput: 32_768 },
  // GLM / Zhipu / Z-AI → 200k
  { match: [["glm"], ["z-ai"], ["zhipu"]], contextWindow: 200_000, maxOutput: 65_536 },
  // MiniMax → 205k
  { match: [["minimax"]], contextWindow: 204_800, maxOutput: 65_536 },
  // MiMo / Xiaomi → 1M
  { match: [["mimo"], ["xiaomi"]], contextWindow: 1_000_000, maxOutput: 131_072 },
  // Qwen / Kimi / Moonshot / StepFun / Doubao / Seed → 256k
  {
    match: [["qwen"], ["kimi"], ["moonshot"], ["stepfun"], ["step-"], ["doubao"], ["seed-"]],
    contextWindow: 262_144,
    maxOutput: 65_536,
  },
  // GPT-5 series → 400k
  { match: [["gpt-5"], ["gpt5"]], contextWindow: 400_000, maxOutput: 128_000 },
  // GPT-4o / 4.1 / o-series → 128k (must come before generic fallback)
  {
    match: [["gpt-4o"], ["gpt-4.1"], ["gpt-4-turbo"], ["o1"], ["o3"], ["o4"]],
    contextWindow: 128_000,
    maxOutput: 16_384,
  },
  // Claude Haiku → 200k
  { match: [["claude", "haiku"]], contextWindow: 200_000, maxOutput: 64_000 },
  // Claude Sonnet → 1M (OpenRouter listing) — fall back to 200k if not listed
  { match: [["claude", "sonnet"]], contextWindow: 1_000_000, maxOutput: 64_000 },
  // Claude Opus → 200k
  { match: [["claude", "opus"]], contextWindow: 200_000, maxOutput: 64_000 },
  // Claude generic → 200k
  { match: [["claude"]], contextWindow: 200_000, maxOutput: 64_000 },
  // Gemini → 1M
  { match: [["gemini"]], contextWindow: 1_000_000, maxOutput: 65_536 },
];

/**
 * Resolve default context window + max output for a model id when the catalog
 * or API does not expose them. Falls back to `DEFAULT_UNKNOWN_CONTEXT_WINDOW`
 * (200k) / `DEFAULT_UNKNOWN_MAX_OUTPUT` (32k) when no family matches.
 */
export function resolveModelContextDefaults(modelId: string | undefined): ModelContextDefaults {
  if (!modelId) return { contextWindow: DEFAULT_UNKNOWN_CONTEXT_WINDOW, maxOutput: DEFAULT_UNKNOWN_MAX_OUTPUT };
  const model = modelId.trim().toLowerCase();
  for (const rule of FAMILY_RULES) {
    if (rule.match.some((tokens) => tokens.every((token) => model.includes(token)))) {
      return { contextWindow: rule.contextWindow, maxOutput: rule.maxOutput };
    }
  }
  return { contextWindow: DEFAULT_UNKNOWN_CONTEXT_WINDOW, maxOutput: DEFAULT_UNKNOWN_MAX_OUTPUT };
}

/** Structural view of the context settings the threshold needs. */
export interface ContextWindowSettings {
  readonly maxInputTokens?: number;
  readonly reserveTokens?: number;
}

export interface ContextThreshold {
  readonly window: number;
  readonly soft: number;
}

/**
 * Codex-style threshold resolution. The soft limit is the primary auto-compact
 * trigger; the hard window is a safety net that forces compaction even if the
 * soft calculation somehow produces a higher value.
 *
 * Algorithm (locked to Codex production defaults):
 * 1. modelWindow = model.contextWindow ?? resolveModelContextDefaults(modelId).contextWindow
 * 2. window = min(settings.maxInputTokens, modelWindow)   // user cost ceiling applies
 * 3. soft = floor(window * 0.90)                    // Codex auto_compact default
 * 4. if window > 10_000: soft = min(soft, window - 10_000)  // keep ≥10k free
 * 5. if reserveTokens > 0: soft = min(soft, max(1_000, window - reserveTokens))
 */
export function resolveContextThreshold(
  options: ContextWindowSettings,
  modelCapabilities: { readonly contextWindow?: number; readonly maxOutput?: number } | undefined,
  modelId?: string,
): ContextThreshold {
  // Validate maxInputTokens — a 0/negative setting would collapse the window
  // and force compaction every turn. Clamp to a sane minimum instead.
  const maxInputTokens = positiveInteger(options.maxInputTokens)
    ? options.maxInputTokens
    : DEFAULT_UNKNOWN_CONTEXT_WINDOW;
  const modelWindow = positiveInteger(modelCapabilities?.contextWindow)
    ? (modelCapabilities!.contextWindow as number)
    : resolveModelContextDefaults(modelId).contextWindow;
  // Floor the model window at MIN_AGENTIC_CONTEXT_WINDOW when it comes from the
  // heuristic table (no real capability data) so a misconfigured family rule
  // cannot collapse the assumed window below the cheap-agentic p10.
  const effectiveModelWindow = positiveInteger(modelCapabilities?.contextWindow)
    ? modelWindow
    : Math.max(MIN_AGENTIC_CONTEXT_WINDOW, modelWindow);
  const window = Math.min(maxInputTokens, effectiveModelWindow);
  const reserveTokens = options.reserveTokens ?? 0;
  let soft = Math.floor(window * 0.9);
  // Codex keeps ≥10k tokens free for the model's response, but only on
  // roomy windows. On a 12k window, a 10k free floor would clamp soft to 2k
  // and force compaction every turn. Only apply the floor when the window is
  // large enough that 10k is a reasonable reserve (≤33% of window).
  if (window >= 30_000) soft = Math.min(soft, window - 10_000);
  if (reserveTokens > 0) soft = Math.min(soft, Math.max(1_000, window - reserveTokens));
  return { window, soft: Math.max(1, soft) };
}

/**
 * Codex `token_limit_reached`: force compaction when estimated tokens reach
 * the soft limit OR the full window (hard safety net).
 */
export function tokenLimitReached(estimated: number, threshold: ContextThreshold): boolean {
  return estimated >= threshold.soft || estimated >= threshold.window;
}

export function positiveInteger(value: number | undefined): value is number {
  return Number.isInteger(value) && (value ?? 0) > 0;
}
