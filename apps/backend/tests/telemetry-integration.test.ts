import { describe, expect, it, afterEach } from "vitest";
import { mkdtemp, rm, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createContainer } from "../src/container.js";

/**
 * End-to-end wiring test: a real container built with the stub provider and a
 * telemetry directory must persist one turn aggregate and at least one provider
 * request record through the JSONL writer when a turn runs.
 */
describe("telemetry wiring (createContainer + stub provider)", () => {
  let container: ReturnType<typeof createContainer> | undefined;
  let dir: string;

  afterEach(async () => {
    try { await container?.wsServer.stop(); } catch { /* not started */ }
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it("writes provider-request and agent-turn JSONL for a completed turn", async () => {
    dir = await mkdtemp(join(tmpdir(), "telemetry-e2e-"));
    container = createContainer({
      port: 9199,
      startWsServer: false,
      telemetryDir: dir,
      telemetry: { enabled: true },
      ai: { providerId: "stub", stubEnabled: true, maxToolRounds: 1 },
    });

    const result = await container.commandBus.execute({
      kind: "run-agent-turn",
      traceId: "trace-e2e",
      conversationId: "conv-e2e",
      messages: [{ role: "user", content: "hello telemetry" }],
      pluginIds: [],
    }) as { text: string };
    expect(result.text).toContain("stub");

    const turnsFile = await waitForFile(dir, /^agent-turns-.*\.jsonl$/);
    const requestsFile = await waitForFile(dir, /^provider-requests-.*\.jsonl$/);

    const turns = parseLines(await readFile(turnsFile, "utf8"));
    expect(turns).toHaveLength(1);
    expect(turns[0]).toMatchObject({
      kind: "agent_turn",
      traceId: "trace-e2e",
      conversationId: "conv-e2e",
      status: "completed",
      rounds: 1,
    });

    const requests = parseLines(await readFile(requestsFile, "utf8"));
    expect(requests.length).toBeGreaterThanOrEqual(1);
    expect(requests[0]).toMatchObject({
      kind: "provider_request",
      traceId: "trace-e2e",
      providerId: "stub",
      outcome: { status: "completed" },
    });
  });

  it("query telemetry.get-report returns a readable aggregate (fail-soft read path)", async () => {
    dir = await mkdtemp(join(tmpdir(), "telemetry-e2e-q-"));
    container = createContainer({
      port: 9198,
      startWsServer: false,
      telemetryDir: dir,
      telemetry: { enabled: true },
      ai: { providerId: "stub", stubEnabled: true, maxToolRounds: 1 },
    });

    await container.commandBus.execute({
      kind: "run-agent-turn",
      traceId: "trace-e2e-q",
      conversationId: "conv-e2e-q",
      messages: [{ role: "user", content: "hello telemetry query" }],
      pluginIds: [],
    }) as { text: string };
    await waitForFile(dir, /^agent-turns-.*\.jsonl$/);

    const report = await container.queryBus.execute({ kind: "telemetry.get-report", recentLimit: 10 }) as {
      enabled: boolean;
      telemetryDir: string | null;
      turns: number;
      costPerCompletedTurn: number | null;
      recentTurns: readonly { traceId: string }[];
    };
    expect(report.enabled).toBe(true);
    expect(report.telemetryDir).toBe(dir);
    expect(report.turns).toBeGreaterThanOrEqual(1);
    expect(report.costPerCompletedTurn).toBeNull();
    expect(report.recentTurns.some((turn) => turn.traceId === "trace-e2e-q")).toBe(true);
  });

  it("query telemetry.get-report fails soft when no telemetry dir is configured", async () => {
    container = createContainer({
      port: 9197,
      startWsServer: false,
      ai: { providerId: "stub", stubEnabled: true, maxToolRounds: 1 },
    });
    const report = await container.queryBus.execute({ kind: "telemetry.get-report" }) as {
      enabled: boolean;
      telemetryDir: string | null;
      turns: number;
    };
    expect(report.enabled).toBe(false);
    expect(report.telemetryDir).toBeNull();
    expect(report.turns).toBe(0);
  });

  it("telemetry.record-steering writes a steering record surfaced in the report", async () => {
    dir = await mkdtemp(join(tmpdir(), "telemetry-e2e-s-"));
    container = createContainer({
      port: 9196,
      startWsServer: false,
      telemetryDir: dir,
      telemetry: { enabled: true },
      ai: { providerId: "stub", stubEnabled: true, maxToolRounds: 1 },
    });

    await container.commandBus.execute({
      kind: "telemetry.record-steering",
      conversationId: "conv-steer",
      triggeredAt: new Date().toISOString(),
      jobCount: 1,
      outcome: "skipped",
      reason: "not-idle",
    }) as { ok: boolean };
    await waitForFile(dir, /^steering-.*\.jsonl$/);

    const report = await container.queryBus.execute({ kind: "telemetry.get-report" }) as {
      enabled: boolean;
      steering: { count: number; fired: number; skipped: number; skippedByReason: Record<string, number> };
    };
    expect(report.enabled).toBe(true);
    expect(report.steering.count).toBeGreaterThanOrEqual(1);
    expect(report.steering.skipped).toBeGreaterThanOrEqual(1);
    expect(report.steering.skippedByReason["not-idle"]).toBeGreaterThanOrEqual(1);
  });
});

function parseLines(text: string): unknown[] {
  return text.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

async function waitForFile(dir: string, pattern: RegExp, timeoutMs = 2000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const entries = await readdir(dir).catch(() => [] as string[]);
    const match = entries.find((name) => pattern.test(name));
    if (match) return join(dir, match);
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${pattern} in ${dir}; saw: ${entries.join(", ")}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}
