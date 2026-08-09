/**
 * Reasoning effort levels understood by the model capability policy
 * (ticket #82, Klaster C). Moved from the application layer port so the
 * policy can live purely in domain; application ports re-export this type.
 */
export type ReasoningEffort =
  | "auto"
  | "none"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max";
