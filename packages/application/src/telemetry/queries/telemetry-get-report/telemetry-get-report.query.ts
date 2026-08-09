import type { Query } from "../../../messaging/query.js";
import type { TelemetryReport } from "../../telemetry-query.port.js";

export interface TelemetryGetReportQuery extends Query {
  readonly kind: "telemetry.get-report";
  /** Optional cap on recently-finished turns in the report. Default 50. */
  readonly recentLimit?: number;
}

export type TelemetryGetReportResult = TelemetryReport;