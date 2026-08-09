import { randomUUID } from "node:crypto";
import type { CommandHandler } from "../../../messaging/command-handler.js";
import type { TelemetryPort } from "../../telemetry.port.js";
import type { RecordSteeringCommand } from "./record-steering.command.js";

/**
 * Records a completion-steering decision (fired/skipped) into the telemetry
 * sink. Metadata-only — never carries prompt or job content. Fire-and-forget
 * by contract: the sink never throws, and this handler never fails a request.
 */
export class RecordSteeringHandler implements CommandHandler<RecordSteeringCommand, { ok: true }> {
  constructor(private readonly telemetry?: TelemetryPort) {}

  async handle(command: RecordSteeringCommand): Promise<{ ok: true }> {
    try {
      this.telemetry?.recordSteering({
        kind: "steering",
        schemaVersion: 1,
        traceId: randomUUID(),
        ...(command.conversationId ? { conversationId: command.conversationId } : {}),
        triggeredAt: command.triggeredAt,
        jobCount: command.jobCount,
        outcome: command.outcome,
        ...(command.outcome === "skipped" && command.reason ? { reason: command.reason } : {}),
      });
    } catch {
      // Telemetry must never break steering or the requesting UI.
    }
    return { ok: true };
  }
}