import type { TelemetryQueryPort, TelemetryReadOptions } from "./telemetry-query.port.js";

/** No-op telemetry reader used when telemetry is disabled or no dir is set. */
export class NullTelemetryQueryPort implements TelemetryQueryPort {
  readonly enabled = false;
  readonly telemetryDir: string | null = null;

  async readRecords(_options?: TelemetryReadOptions): Promise<readonly []> {
    return [];
  }
}