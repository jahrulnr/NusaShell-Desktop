import type { Command } from "../../../messaging/command.js";

export interface RecordSteeringCommand extends Command {
  readonly kind: "telemetry.record-steering";
  readonly conversationId?: string;
  /** ISO timestamp when the steering decision was made. */
  readonly triggeredAt: string;
  readonly jobCount: number;
  readonly outcome: "fired" | "skipped";
  readonly reason?: "not-idle" | "composer-busy" | "other";
}