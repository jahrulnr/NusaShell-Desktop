import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  TelemetryQueryPort,
  TelemetryReadOptions,
  TelemetryRecord,
} from "@nusashell/application";

const TELEMETRY_FILE_PATTERN = /\.jsonl$/;

export interface JsonlTelemetryReaderOptions {
  /** Directory that holds the daily JSONL telemetry files. */
  readonly dir: string;
  /** Optional observer for otherwise-swallowed read failures (debugging). */
  readonly onError?: (error: unknown) => void;
}

/**
 * Fail-soft reader for the JSONL telemetry spine (`{dir}/*.jsonl`).
 *
 * Implements the application-layer `TelemetryQueryPort`: reads provider
 * requests, agent turns, and steering JSONL, skips blank/corrupt records, and
 * never throws — a missing directory, a partial trailing line, or an I/O
 * failure yields an empty/partial result so a UI query can never break.
 * Read-only: the renderer must never write telemetry.
 */
export class JsonlTelemetryReader implements TelemetryQueryPort {
  readonly enabled: boolean;
  readonly telemetryDir: string | null;

  constructor(private readonly options: JsonlTelemetryReaderOptions) {
    this.enabled = true;
    this.telemetryDir = options.dir;
  }

  async readRecords(options: TelemetryReadOptions = {}): Promise<readonly TelemetryRecord[]> {
    const records: TelemetryRecord[] = [];
    const sinceMs = options.since === undefined ? null : Date.parse(options.since);
    if (sinceMs !== null && Number.isNaN(sinceMs)) {
      this.options.onError?.(new Error("telemetry read: invalid since timestamp"));
    }
    let names: string[];
    try {
      names = await readdir(this.options.dir);
    } catch {
      // Missing dir / permission error — empty result is the fail-soft contract.
      this.options.onError?.(
        new Error(`telemetry read: no directory at ${this.options.dir}`),
      );
      return records;
    }
    const files = names.filter((name) => TELEMETRY_FILE_PATTERN.test(name));
    // Stable file order is only a tie-breaker; records are sorted globally by
    // their canonical event timestamp after parsing.
    files.sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
    for (const name of files) {
      let text: string;
      try {
        text = await readFile(join(this.options.dir, name), "utf8");
      } catch {
        this.options.onError?.(new Error(`telemetry read: unreadable ${name}`));
        continue;
      }
      // Split on CRLF or LF so files edited on Windows are read identically.
      for (const rawLine of text.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line) continue;
        try {
          const parsed = JSON.parse(line) as unknown;
          if (isTelemetryRecord(parsed)) {
            const timestamp = recordTimestamp(parsed);
            if (sinceMs === null || Number.isNaN(sinceMs) || Date.parse(timestamp) > sinceMs) {
              records.push(parsed);
            }
          } else {
            this.options.onError?.(new Error(`telemetry read: invalid record in ${name}`));
          }
        } catch {
          // Skip partial/corrupt trailing lines rather than failing the query.
          this.options.onError?.(new Error(`telemetry read: malformed line in ${name}`));
        }
      }
    }
    records.sort((a, b) => Date.parse(recordTimestamp(b)) - Date.parse(recordTimestamp(a)));
    return options.limit === undefined
      ? records
      : records.slice(0, Math.max(0, options.limit));
  }
}

function recordTimestamp(record: TelemetryRecord): string {
  switch (record.kind) {
    case "provider_request": return record.timestamp;
    case "agent_turn": return record.completedAt;
    case "steering": return record.triggeredAt;
  }
}

function isTelemetryRecord(value: unknown): value is TelemetryRecord {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== 1 || typeof record.traceId !== "string" || record.traceId.length === 0) {
    return false;
  }
  const timestamp = record.kind === "provider_request"
    ? record.timestamp
    : record.kind === "agent_turn"
      ? record.completedAt
      : record.kind === "steering"
        ? record.triggeredAt
        : undefined;
  return typeof timestamp === "string" && Number.isFinite(Date.parse(timestamp));
}
