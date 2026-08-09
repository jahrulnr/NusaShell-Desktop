import { describe, expect, it } from "vitest";
import {
  RecordSteeringHandler,
  type SteeringTelemetry,
  type TelemetryPort,
} from "../src/index.js";

class RecordingTelemetry implements TelemetryPort {
  readonly steerings: SteeringTelemetry[] = [];
  recordProviderRequest(): void {}
  recordTurn(): void {}
  recordSteering(record: SteeringTelemetry): void {
    this.steerings.push(record);
  }
}

describe("RecordSteeringHandler", () => {
  it("records a fired steering decision", async () => {
    const telemetry = new RecordingTelemetry();
    const handler = new RecordSteeringHandler(telemetry);
    const result = await handler.handle({
      kind: "telemetry.record-steering",
      conversationId: "conv-1",
      triggeredAt: "2026-08-08T10:00:00.000Z",
      jobCount: 2,
      outcome: "fired",
    });
    expect(result).toEqual({ ok: true });
    expect(telemetry.steerings).toHaveLength(1);
    expect(telemetry.steerings[0]).toMatchObject({
      kind: "steering",
      conversationId: "conv-1",
      jobCount: 2,
      outcome: "fired",
    });
    expect(typeof telemetry.steerings[0]?.traceId).toBe("string");
  });

  it("records a skipped steering with reason", async () => {
    const telemetry = new RecordingTelemetry();
    const handler = new RecordSteeringHandler(telemetry);
    await handler.handle({
      kind: "telemetry.record-steering",
      conversationId: "conv-2",
      triggeredAt: "2026-08-08T10:00:01.000Z",
      jobCount: 1,
      outcome: "skipped",
      reason: "not-idle",
    });
    expect(telemetry.steerings[0]).toMatchObject({ outcome: "skipped", reason: "not-idle" });
  });

  it("does not add reason for fired outcome", async () => {
    const telemetry = new RecordingTelemetry();
    const handler = new RecordSteeringHandler(telemetry);
    await handler.handle({
      kind: "telemetry.record-steering",
      triggeredAt: "2026-08-08T10:00:00.000Z",
      jobCount: 1,
      outcome: "fired",
    });
    expect(telemetry.steerings[0]?.reason).toBeUndefined();
  });

  it("never throws and is a no-op when telemetry sink is undefined", async () => {
    const handler = new RecordSteeringHandler(undefined);
    const result = await handler.handle({
      kind: "telemetry.record-steering",
      triggeredAt: "2026-08-08T10:00:00.000Z",
      jobCount: 1,
      outcome: "fired",
    });
    expect(result).toEqual({ ok: true });
  });

  it("cannot break when the sink throws", async () => {
    const throwing: TelemetryPort = {
      recordProviderRequest() {},
      recordTurn() {},
      recordSteering() { throw new Error("sink down"); },
    };
    const handler = new RecordSteeringHandler(throwing);
    const result = await handler.handle({
      kind: "telemetry.record-steering",
      triggeredAt: "2026-08-08T10:00:00.000Z",
      jobCount: 1,
      outcome: "fired",
    });
    expect(result).toEqual({ ok: true });
  });
});