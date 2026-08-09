/**
 * Token-efficiency telemetry records (metadata-first).
 *
 * Ticket #84 (Klaster E): the record shapes moved to
 * `packages/domain/src/telemetry/telemetry-types.ts`; this module re-exports
 * them so existing application/infrastructure consumers keep a stable import
 * path and the telemetry contract has a single source of truth.
 */
export type {
  TelemetryTokenUsage,
  ProviderRequestTelemetry,
  AgentTurnTelemetry,
  SteeringTelemetry,
  TelemetryRecord,
} from "@nusashell/domain";
