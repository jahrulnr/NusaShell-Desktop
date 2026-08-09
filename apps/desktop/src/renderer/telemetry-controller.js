// Usage (telemetry) view controller — a read-only projection of the local
// telemetry spine. It never writes telemetry or renders prompt/key content.

import { sendRequest } from "./ws-client.js";

function el(id) {
  return document.getElementById(id);
}

function setText(id, value) {
  const node = el(id);
  if (node) node.textContent = value;
}

function fmtNumber(value, digits = 1) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return value.toLocaleString(undefined, { maximumFractionDigits: digits });
}

function fmtPercent(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return `${(value * 100).toFixed(1)}%`;
}

function fmtDuration(ms) {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
}

function shortTrace(traceId) {
  const value = String(traceId ?? "—");
  return value.length > 9 ? `${value.slice(0, 9)}…` : value;
}

function fmtIso(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

function fmtDay(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? ""));
  if (!match) return String(value ?? "—");
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
}

function statusPresentation(status) {
  switch (status) {
    case "completed": return { label: "ok", tone: "ok" };
    case "failed": return { label: "failed", tone: "failed" };
    case "cancelled": return { label: "cancelled", tone: "cancelled" };
    case "superseded": return { label: "superseded", tone: "superseded" };
    default: return { label: String(status ?? "unknown"), tone: "unknown" };
  }
}

function appendCell(row, text, className) {
  const cell = document.createElement("td");
  if (className) cell.className = className;
  cell.textContent = text;
  row.appendChild(cell);
  return cell;
}

function hasTelemetry(report) {
  return (report?.turns ?? 0) > 0
    || (report?.providerRequests ?? 0) > 0
    || (report?.steering?.count ?? 0) > 0;
}

export class TelemetryController {
  constructor() {
    this.loading = false;
    this.hasRendered = false;
    this.refreshBtn = el("telemetry-refresh-btn");
    this.refreshBtn?.addEventListener("click", () => this.refresh());
  }

  initialize() {
    return this.refresh();
  }

  setLoading(loading) {
    this.loading = loading;
    if (this.refreshBtn) this.refreshBtn.disabled = loading;
    setText("telemetry-refresh-label", loading ? "Refreshing…" : "Refresh");
    const view = el("telemetry-view") ?? document.querySelector('[data-view="ai-usage"]');
    view?.setAttribute("aria-busy", String(loading));
  }

  async refresh() {
    if (this.loading) return;
    this.setLoading(true);
    const loading = el("telemetry-loading");
    if (loading && !this.hasRendered) loading.hidden = false;
    const error = el("telemetry-error");
    if (error) error.hidden = true;
    try {
      const report = await sendRequest("telemetry.get_report", { recentLimit: 50 }, 15000);
      if (!report || report.enabled === false) {
        this.renderEmpty(
          "Usage telemetry is disabled",
          "Enable telemetry to measure agent efficiency. NusaShell records numeric usage and timing only—never prompts or keys.",
        );
      } else if (!hasTelemetry(report)) {
        this.renderEmpty(
          "No usage recorded yet",
          "Complete an agent turn to establish the first efficiency signal. This view updates from local metadata only.",
        );
      } else {
        this.render(report);
      }
      this.hasRendered = true;
    } catch (err) {
      if (!this.hasRendered) {
        const body = el("telemetry-body");
        const empty = el("telemetry-empty");
        if (body) body.hidden = true;
        if (empty) empty.hidden = true;
      }
      if (error) error.hidden = false;
      setText("telemetry-error-message", err?.message || String(err));
    } finally {
      if (loading) loading.hidden = true;
      this.setLoading(false);
    }
  }

  renderEmpty(title, description) {
    const body = el("telemetry-body");
    const empty = el("telemetry-empty");
    const loading = el("telemetry-loading");
    if (loading) loading.hidden = true;
    if (body) body.hidden = true;
    if (empty) {
      empty.hidden = false;
      const heading = empty.querySelector("strong");
      const copy = empty.querySelector("span");
      if (heading) heading.textContent = title;
      if (copy) copy.textContent = description;
    }
  }

  render(report) {
    const body = el("telemetry-body");
    if (body) body.hidden = false;
    const empty = el("telemetry-empty");
    const loading = el("telemetry-loading");
    if (loading) loading.hidden = true;
    if (empty) empty.hidden = true;
    const error = el("telemetry-error");
    if (error) error.hidden = true;

    setText("telemetry-turns", fmtNumber(report.turns, 0));
    const completed = report.turnsByStatus?.completed ?? 0;
    const successRate = report.turns > 0 ? completed / report.turns : 0;
    setText("telemetry-success-rate", fmtPercent(successRate));
    setText("telemetry-cache-hit", fmtPercent(report.cacheHitRate));
    const cacheRate = Number.isFinite(report.cacheHitRate)
      ? Math.min(1, Math.max(0, report.cacheHitRate))
      : 0;
    const cacheMeter = el("telemetry-cache-meter");
    cacheMeter?.setAttribute("aria-valuenow", String(Math.round(cacheRate * 100)));
    const cacheMeterFill = el("telemetry-cache-meter-fill");
    if (cacheMeterFill) cacheMeterFill.style.width = `${cacheRate * 100}%`;
    setText("telemetry-fresh-tokens", fmtNumber(report.freshTokensPerCompletedTurn, 0));
    setText("telemetry-req-per-turn", fmtNumber(report.providerRequestsPerTurn, 2));
    setText("telemetry-rounds-median", fmtNumber(report.roundsPerTurnMedian, 1));
    setText("telemetry-rounds-p95", fmtNumber(report.roundsPerTurnP95, 1));
    setText("telemetry-failure-waste", fmtPercent(report.failureWasteRatio));
    setText("telemetry-cost", report.costPerCompletedTurn == null ? "n/a" : fmtNumber(report.costPerCompletedTurn, 4));
    setText("telemetry-generated", fmtIso(report.generatedAt));

    setText("telemetry-steer-count", fmtNumber(report.steering?.count ?? 0, 0));
    setText("telemetry-steer-fired", fmtNumber(report.steering?.fired ?? 0, 0));
    setText("telemetry-steer-skipped", fmtNumber(report.steering?.skipped ?? 0, 0));
    const reasons = report.steering?.skippedByReason ?? {};
    setText("telemetry-steer-reasons", Object.keys(reasons).length === 0
      ? "No skips recorded"
      : Object.entries(reasons).map(([reason, count]) => `${reason}: ${count}`).join(" · "));

    this.renderRecentTurns(report.recentTurns ?? []);
    this.renderDailyTurns(report.dailyTurns ?? []);
  }

  renderRecentTurns(turns) {
    const rows = el("telemetry-turns-table-body");
    if (rows) {
      rows.replaceChildren();
      for (const turn of turns) {
        const row = document.createElement("tr");
        const traceCell = document.createElement("td");
        const trace = document.createElement("code");
        trace.title = String(turn.traceId ?? "");
        trace.textContent = shortTrace(turn.traceId);
        traceCell.appendChild(trace);
        row.appendChild(traceCell);

        const statusCell = document.createElement("td");
        const status = document.createElement("span");
        const presentation = statusPresentation(turn.status);
        status.className = `telemetry-status telemetry-status-${presentation.tone}`;
        status.textContent = presentation.label;
        statusCell.appendChild(status);
        row.appendChild(statusCell);

        appendCell(row, fmtIso(turn.completedAt));
        appendCell(row, fmtDuration(turn.durationMs), "telemetry-number");
        appendCell(row, fmtNumber(turn.rounds, 0), "telemetry-number");
        appendCell(row, fmtNumber(turn.toolCalls, 0), "telemetry-number");
        appendCell(row, fmtNumber(turn.inputTokens, 0), "telemetry-number");
        const cacheRate = (turn.inputTokens ?? 0) > 0
          ? (turn.cachedInputTokens ?? 0) / turn.inputTokens
          : null;
        appendCell(row, cacheRate === null ? "—" : fmtPercent(cacheRate), "telemetry-number");
        appendCell(row, fmtNumber(turn.freshInputTokens, 0), "telemetry-number telemetry-fresh");
        appendCell(row, fmtNumber(turn.outputTokens, 0), "telemetry-number");
        rows.appendChild(row);
      }
    }
    const noTurns = el("telemetry-no-turns");
    if (noTurns) noTurns.hidden = turns.length > 0;
  }

  renderDailyTurns(days) {
    const chart = el("telemetry-spark");
    if (!chart) return;
    chart.replaceChildren();
    if (days.length === 0) {
      const empty = document.createElement("p");
      empty.className = "telemetry-chart-empty";
      empty.textContent = "No daily activity yet.";
      chart.appendChild(empty);
      return;
    }

    const max = Math.max(1, ...days.map((day) => Number(day.total) || 0));
    for (const day of days) {
      const total = Math.max(0, Number(day.total) || 0);
      const completed = Math.min(total, Math.max(0, Number(day.completed) || 0));
      const failed = Math.min(total - completed, Math.max(0, Number(day.failed) || 0));
      const other = Math.max(0, total - completed - failed);
      const column = document.createElement("div");
      column.className = "telemetry-day";
      column.setAttribute("role", "listitem");
      column.setAttribute("aria-label", `${fmtDay(day.date)}: ${total} turns, ${completed} completed, ${failed} failed`);

      const count = document.createElement("span");
      count.className = "telemetry-day-count";
      count.textContent = fmtNumber(total, 0);
      const track = document.createElement("div");
      track.className = "telemetry-day-track";
      const volume = document.createElement("div");
      volume.className = "telemetry-day-volume";
      volume.style.height = `${Math.max(total > 0 ? 8 : 0, (total / max) * 100)}%`;
      for (const [tone, amount] of [["completed", completed], ["failed", failed], ["other", other]]) {
        if (amount <= 0) continue;
        const segment = document.createElement("span");
        segment.className = `telemetry-day-segment telemetry-day-${tone}`;
        segment.style.flexGrow = String(amount);
        volume.appendChild(segment);
      }
      track.appendChild(volume);
      const label = document.createElement("span");
      label.className = "telemetry-day-label";
      label.textContent = fmtDay(day.date);
      column.append(count, track, label);
      chart.appendChild(column);
    }
  }
}
