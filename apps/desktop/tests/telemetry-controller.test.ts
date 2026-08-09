// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const sendRequest = vi.fn();

vi.mock("../src/renderer/ws-client.js", () => ({
  sendRequest: (...args) => sendRequest(...args),
  onEvent: () => () => {},
}));

import { TelemetryController } from "../src/renderer/telemetry-controller.js";

function mountDom() {
  document.body.innerHTML = `
    <section id="telemetry-view" aria-busy="false">
    <button id="telemetry-refresh-btn"><span id="telemetry-refresh-label">Refresh</span></button>
    <div id="telemetry-error" hidden><span id="telemetry-error-message"></span></div>
    <div id="telemetry-empty" hidden><strong></strong><span></span></div>
    <div id="telemetry-loading" hidden></div>
    <div id="telemetry-body" hidden>
      <div class="telemetry-cards">
        <div class="telemetry-card"><strong id="telemetry-turns"></strong></div>
        <div class="telemetry-card"><strong id="telemetry-success-rate"></strong></div>
        <div class="telemetry-card"><strong id="telemetry-cache-hit"></strong></div>
        <div class="telemetry-card"><strong id="telemetry-fresh-tokens"></strong></div>
        <div class="telemetry-card"><strong id="telemetry-req-per-turn"></strong></div>
        <div class="telemetry-card"><strong id="telemetry-rounds-median"></strong></div>
        <div class="telemetry-card"><strong id="telemetry-rounds-p95"></strong></div>
        <div class="telemetry-card"><strong id="telemetry-failure-waste"></strong></div>
        <div class="telemetry-card"><strong id="telemetry-cost"></strong></div>
      </div>
      <p><span id="telemetry-generated"></span></p>
      <div id="telemetry-spark"></div>
      <strong id="telemetry-steer-count"></strong>
      <strong id="telemetry-steer-fired"></strong>
      <strong id="telemetry-steer-skipped"></strong>
      <strong id="telemetry-steer-reasons"></strong>
      <table><tbody id="telemetry-turns-table-body"></tbody></table>
      <p id="telemetry-no-turns" hidden></p>
    </div>
    </section>
  `;
}

describe("TelemetryController", () => {
  beforeEach(() => {
    sendRequest.mockReset();
    mountDom();
  });

  it("renders summary cards, steering and recent turns from the report", async () => {
    sendRequest.mockResolvedValue({
      enabled: true,
      telemetryDir: "/tmp/t",
      providerRequests: 4,
      turns: 3,
      turnsByStatus: { completed: 2, failed: 1, cancelled: 0, superseded: 0 },
      steering: { count: 2, fired: 1, skipped: 1, skippedByReason: { "not-idle": 1 } },
      cacheHitRate: 0.8,
      freshTokenRatio: 0.2,
      providerRequestsPerTurn: 4 / 3,
      providerRequestsPerCompletedTurn: 2,
      providerRequestsPerTraceMedian: 1,
      providerRequestsPerTraceP95: 2,
      roundsPerTurnMedian: 1,
      roundsPerTurnP95: 2,
      freshTokensPerCompletedTurn: 700,
      costPerCompletedTurn: null,
      failureWasteRatio: 0.1,
      generatedAt: "2026-08-09T12:00:00.000Z",
      dailyTurns: [
        { date: "2026-08-03", total: 0, completed: 0, failed: 0 },
        { date: "2026-08-04", total: 1, completed: 1, failed: 0 },
        { date: "2026-08-05", total: 2, completed: 1, failed: 1 },
        { date: "2026-08-06", total: 0, completed: 0, failed: 0 },
        { date: "2026-08-07", total: 3, completed: 3, failed: 0 },
        { date: "2026-08-08", total: 1, completed: 1, failed: 0 },
        { date: "2026-08-09", total: 4, completed: 4, failed: 0 },
      ],
      recentTurns: [
        {
          traceId: "trace-abc", status: "completed", completedAt: "2026-08-08T10:00:00.000Z",
          durationMs: 4500, rounds: 2, toolCalls: 3, inputTokens: 1000, freshInputTokens: 700, outputTokens: 200,
        },
      ],
    });

    const controller = new TelemetryController();
    await controller.refresh();

    expect(document.getElementById("telemetry-turns").textContent).toBe("3");
    expect(document.getElementById("telemetry-success-rate").textContent).toBe("66.7%");
    expect(document.getElementById("telemetry-cache-hit").textContent).toBe("80.0%");
    expect(document.getElementById("telemetry-fresh-tokens").textContent).toBe("700");
    expect(document.getElementById("telemetry-cost").textContent).toBe("n/a");
    expect(document.getElementById("telemetry-steer-count").textContent).toBe("2");
    expect(document.getElementById("telemetry-steer-fired").textContent).toBe("1");
    expect(document.getElementById("telemetry-steer-skipped").textContent).toBe("1");
    expect(document.getElementById("telemetry-steer-reasons").textContent).toContain("not-idle: 1");

    const rows = document.querySelectorAll("#telemetry-turns-table-body tr");
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain("trace-abc");
    expect(rows[0].textContent).toContain("ok");
    expect(document.getElementById("telemetry-no-turns").hidden).toBe(true);
    expect(document.querySelectorAll("#telemetry-spark .telemetry-day")).toHaveLength(7);
    expect(document.getElementById("telemetry-spark").textContent).toContain("Aug 3");
    expect(document.getElementById("telemetry-spark").textContent).toContain("Aug 9");
  });

  it("shows the active empty state and hides metrics when no records exist", async () => {
    sendRequest.mockResolvedValue({
      enabled: true,
      turns: 0,
      providerRequests: 0,
      steering: { count: 0, fired: 0, skipped: 0, skippedByReason: {} },
      dailyTurns: [],
      recentTurns: [],
    });

    await new TelemetryController().refresh();

    expect(document.getElementById("telemetry-body").hidden).toBe(true);
    expect(document.getElementById("telemetry-empty").hidden).toBe(false);
    expect(document.getElementById("telemetry-empty").querySelector("strong").textContent).toBe("No usage recorded yet");
  });

  it("does not turn an unknown telemetry status into markup or a CSS class", async () => {
    sendRequest.mockResolvedValue({
      enabled: true,
      turns: 1,
      providerRequests: 1,
      turnsByStatus: {},
      steering: {},
      dailyTurns: [],
      recentTurns: [{
        traceId: "trace-safe",
        status: '\"><img src=x onerror=alert(1)>',
        completedAt: "2026-08-09T10:00:00.000Z",
        durationMs: 1,
        rounds: 1,
        toolCalls: 0,
      }],
    });

    await new TelemetryController().refresh();

    const status = document.querySelector(".telemetry-status");
    expect(status.textContent).toContain("<img");
    expect(status.className).toBe("telemetry-status telemetry-status-unknown");
    expect(document.querySelector("img")).toBeNull();
  });

  it("exposes loading state and coalesces concurrent refreshes", async () => {
    let resolveReport;
    sendRequest.mockReturnValue(new Promise((resolve) => { resolveReport = resolve; }));
    const controller = new TelemetryController();

    const first = controller.refresh();
    const second = controller.refresh();

    expect(sendRequest).toHaveBeenCalledTimes(1);
    expect(document.getElementById("telemetry-refresh-btn").disabled).toBe(true);
    expect(document.getElementById("telemetry-view").getAttribute("aria-busy")).toBe("true");
    expect(document.getElementById("telemetry-refresh-label").textContent).toBe("Refreshing…");
    expect(document.getElementById("telemetry-loading").hidden).toBe(false);

    resolveReport({ enabled: true, turns: 0, providerRequests: 0, steering: {}, dailyTurns: [], recentTurns: [] });
    await Promise.all([first, second]);

    expect(document.getElementById("telemetry-refresh-btn").disabled).toBe(false);
    expect(document.getElementById("telemetry-view").getAttribute("aria-busy")).toBe("false");
    expect(document.getElementById("telemetry-refresh-label").textContent).toBe("Refresh");
    expect(document.getElementById("telemetry-loading").hidden).toBe(true);
  });

  it("renders disabled state when report.enabled is false", async () => {
    sendRequest.mockResolvedValue({ enabled: false, telemetryDir: null, steering: {}, recentTurns: [] });
    const controller = new TelemetryController();
    await controller.refresh();
    expect(document.getElementById("telemetry-body").hidden).toBe(true);
    expect(document.getElementById("telemetry-empty").hidden).toBe(false);
    expect(document.getElementById("telemetry-empty").querySelector("strong").textContent).toContain("disabled");
  });

  it("shows error state when the query fails", async () => {
    sendRequest.mockRejectedValue(new Error("boom"));
    const controller = new TelemetryController();
    await controller.refresh();
    expect(document.getElementById("telemetry-error").hidden).toBe(false);
    expect(document.getElementById("telemetry-error-message").textContent).toContain("boom");
  });

  it("bind refresh button to refresh", async () => {
    sendRequest.mockResolvedValue({ enabled: true, steering: {}, recentTurns: [] });
    const controller = new TelemetryController();
    await controller.refresh();
    sendRequest.mockClear();
    document.getElementById("telemetry-refresh-btn").click();
    expect(sendRequest).toHaveBeenCalledWith("telemetry.get_report", { recentLimit: 50 }, 15000);
  });
});
