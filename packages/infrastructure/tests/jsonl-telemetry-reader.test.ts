import { describe, expect, it } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JsonlTelemetryReader } from "../src/telemetry/jsonl-telemetry-reader.js";

function sampleLine(kind: "provider_request" | "agent_turn", seed: string, timestamp = "2026-08-08T10:00:00.000Z"): string {
  if (kind === "provider_request") {
    return JSON.stringify({
      kind,
      schemaVersion: 1,
      traceId: `trace-${seed}`,
      timestamp,
      round: 1,
      timing: { startedAt: "2026-08-08T10:00:00.000Z", completedAt: "2026-08-08T10:00:01.000Z", latencyMs: 1000 },
      outcome: { status: "completed", finishReason: "stop" },
    });
  }
  return JSON.stringify({
    kind,
    schemaVersion: 1,
    traceId: `trace-${seed}`,
    conversationId: `conv-${seed}`,
    startedAt: "2026-08-08T10:00:00.000Z",
    completedAt: timestamp,
    durationMs: 5000,
    status: "completed",
    rounds: 1,
    tools: { calls: 1, succeeded: 1, failed: 0 },
    compaction: { count: 0 },
  });
}

async function makeDir(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "nusashell-telemetry-"));
  for (const [name, content] of Object.entries(files)) {
    await writeFile(join(dir, name), content, "utf8");
  }
  return dir;
}

describe("JsonlTelemetryReader", () => {
  it("reads provider-requests and agent-turns from all jsonl files", async () => {
    const dir = await makeDir({
      "provider-requests-2026-08-08.jsonl": `${sampleLine("provider_request", "a")}\n`,
      "agent-turns-2026-08-08.jsonl": `${sampleLine("agent_turn", "b")}\n`,
    });
    const reader = new JsonlTelemetryReader({ dir });
    const records = await reader.readRecords();
    expect(records).toHaveLength(2);
    expect(records[0]?.kind).toBe("provider_request");
    expect(records[1]?.kind).toBe("agent_turn");
    expect(reader.enabled).toBe(true);
    expect(reader.telemetryDir).toBe(dir);
  });

  it("skips malformed and non-telemetry lines without throwing", async () => {
    const dir = await makeDir({
      "agent-turns-2026-08-08.jsonl": [
        sampleLine("agent_turn", "ok"),
        "this is not json",
        "",
        '{"kind":"unknown"}',
        "{\"kind\":\"agent_turn\"}",
      ].join("\n"),
    });
    const reader = new JsonlTelemetryReader({ dir });
    const records = await reader.readRecords();
    expect(records).toHaveLength(1);
    expect(records[0]?.traceId).toBe("trace-ok");
    expect(records.every((record) => record.kind === "agent_turn")).toBe(true);
  });

  it("returns empty when the directory does not exist (fail-soft)", async () => {
    const reader = new JsonlTelemetryReader({ dir: join(tmpdir(), "does-not-exist-telemetry-xyz") });
    const records = await reader.readRecords();
    expect(records).toEqual([]);
  });

  it("ignores non-.jsonl files", async () => {
    const dir = await makeDir({
      "notes.txt": "hello",
      "agent-turns-2026-08-08.jsonl": `${sampleLine("agent_turn", "c")}\n`,
    });
    const reader = new JsonlTelemetryReader({ dir });
    const records = await reader.readRecords();
    expect(records).toHaveLength(1);
  });

  it("respects limit (newest file first)", async () => {
    const dir = await makeDir({
      "agent-turns-2026-08-07.jsonl": `${sampleLine("agent_turn", "old")}\n`,
      "agent-turns-2026-08-08.jsonl": `${sampleLine("agent_turn", "new")}\n`,
    });
    const reader = new JsonlTelemetryReader({ dir });
    const records = await reader.readRecords({ limit: 1 });
    expect(records).toHaveLength(1);
    expect(records[0]?.traceId).toBe("trace-new");
  });

  it("limits globally to the newest records, including within one file", async () => {
    const dir = await makeDir({
      "agent-turns-2026-08-08.jsonl": [
        sampleLine("agent_turn", "old", "2026-08-08T09:00:00.000Z"),
        sampleLine("agent_turn", "new", "2026-08-08T11:00:00.000Z"),
      ].join("\n"),
      "provider-requests-2026-08-08.jsonl": sampleLine("provider_request", "middle", "2026-08-08T10:00:00.000Z"),
    });

    const records = await new JsonlTelemetryReader({ dir }).readRecords({ limit: 2 });

    expect(records.map((record) => record.traceId)).toEqual(["trace-new", "trace-middle"]);
  });

  it("filters records at or before the exclusive since boundary", async () => {
    const dir = await makeDir({
      "agent-turns-2026-08-08.jsonl": [
        sampleLine("agent_turn", "before", "2026-08-08T09:59:59.000Z"),
        sampleLine("agent_turn", "boundary", "2026-08-08T10:00:00.000Z"),
        sampleLine("agent_turn", "after", "2026-08-08T10:00:01.000Z"),
      ].join("\n"),
    });

    const records = await new JsonlTelemetryReader({ dir }).readRecords({
      since: "2026-08-08T10:00:00.000Z",
    });

    expect(records.map((record) => record.traceId)).toEqual(["trace-after"]);
  });

  it("reports onError for unreadable dir", async () => {
    const errors: unknown[] = [];
    const reader = new JsonlTelemetryReader({
      dir: join(tmpdir(), "missing-telemetry-dir-abc"),
      onError: (error) => errors.push(error),
    });
    await reader.readRecords();
    expect(errors.length).toBeGreaterThan(0);
  });

  it("parses CRLF line endings (Windows-edited files)", async () => {
    const dir = await makeDir({
      "agent-turns-2026-08-08.jsonl": [
        sampleLine("agent_turn", "crlf-a"),
        sampleLine("agent_turn", "crlf-b"),
      ].join("\r\n"),
    });
    const records = await new JsonlTelemetryReader({ dir }).readRecords();
    // Both CRLF-terminated records must parse; sort is stable when timestamps
    // tie, so assert on the set rather than an artificial order.
    expect(records.map((record) => record.traceId).sort()).toEqual(["trace-crlf-a", "trace-crlf-b"]);
  });

  it("fails open for an invalid since timestamp and reports onError", async () => {
    const dir = await makeDir({
      "agent-turns-2026-08-08.jsonl": `${sampleLine("agent_turn", "all")}\n`,
    });
    const errors: unknown[] = [];
    const reader = new JsonlTelemetryReader({ dir, onError: (error) => errors.push(error) });
    const records = await reader.readRecords({ since: "not-a-date" });
    // Fail-open: garbage since must not throw nor silently drop everything.
    expect(records).toHaveLength(1);
    expect(errors.some((error) => String(error).includes("invalid since"))).toBe(true);
  });
});
