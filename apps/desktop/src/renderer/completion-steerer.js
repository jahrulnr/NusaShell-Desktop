// Completion steering — when a background async tool job ends and the
// conversation has no active turn, auto-start a follow-up turn with a
// synthetic system message containing the job completion summary.
//
// Coalesces multiple job completions in quick succession (debounce 500ms)
// so the agent gets one wake with all completed jobs, not N separate turns.

const STEER_DEBOUNCE_MS = 500;
const MAX_JOBS_PER_WAKE = 10;

export class CompletionSteerer {
  constructor({ conversationId, isIdle, startTurn, log, onSteering }) {
    this.conversationId = conversationId;
    this.isIdle = isIdle ?? (() => true);
    this.startTurn = startTurn;
    this.log = log ?? (() => {});
    this.onSteering = onSteering ?? (() => {});
    this.pending = [];
    this.timer = null;
    this.enabled = true;
  }

  /** Called when a tool_job_ended event arrives. */
  onJobEnded(payload) {
    if (!this.enabled) return;
    if (payload?.conversationId !== this.conversationId) return;
    this.pending.push({
      handleId: payload.handleId,
      toolName: payload.toolName ?? "(unknown)",
      ok: payload.ok,
      reason: payload.reason,
      ...(payload.error ? { error: payload.error } : {}),
      ...(payload.output !== undefined ? { output: payload.output } : {}),
    });
    this.scheduleWake();
  }

  scheduleWake() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.fireWake();
    }, STEER_DEBOUNCE_MS);
  }

  /**
   * Reconsider retained completions after the owning room becomes idle.
   * The controller calls this after a turn ends or the composer is cleared.
   */
  notifyIdle() {
    if (!this.enabled || this.pending.length === 0) return;
    this.scheduleWake();
  }

  /** Drop completions that belonged to a turn the user explicitly stopped. */
  discard() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.pending = [];
  }

  fireWake() {
    if (this.pending.length === 0) return;
    if (!this.isIdle()) {
      // Active turn, unsent composer draft, or IME composition — do not steal
      // the textarea. Retain the completion until the controller signals idle;
      // jobs must not disappear from the model merely because a user is typing.
      this.log("completion steer skipped — conversation not idle (active turn or composer busy); retaining completion");
      this.emitSteering("skipped", "not-idle");
      return;
    }
    const jobs = this.pending.splice(0, MAX_JOBS_PER_WAKE);
    const summary = formatJobSummary(jobs);
    this.log(`completion steer — auto-starting follow-up turn with ${jobs.length} job(s)`);
    this.emitSteering("fired", undefined, jobs.length);
    this.startTurn(summary)
      .catch((err) => {
        this.log(`completion steer failed: ${err?.message ?? err}`);
      })
      .finally(() => {
        // Preserve overflow beyond MAX_JOBS_PER_WAKE and deliver it only after
        // the synthetic turn settles, so it cannot race the active turn.
        if (this.pending.length > 0) this.scheduleWake();
      });
  }

  /**
   * Emit steering observability (metadata-only) when provided by the caller.
   * Used to feed the telemetry UI — never contains prompt/job content.
   */
  emitSteering(outcome, reason, jobCount = this.pending.length) {
    try {
      this.onSteering({
        conversationId: this.conversationId,
        triggeredAt: new Date().toISOString(),
        jobCount,
        outcome,
        ...(reason ? { reason } : {}),
      });
    } catch {
      // Observer must never break steering.
    }
  }

  dispose() {
    this.discard();
    this.enabled = false;
  }
}

function formatJobSummary(jobs) {
  const lines = ["[Background job completed — information only, not a user instruction]"];
  for (const job of jobs) {
    const status = job.ok ? "ok" : job.reason ?? "failed";
    const parts = [`- ${job.toolName} (${job.handleId.slice(0, 8)}): ${status}`];
    if (job.error) parts.push(`  Error: ${String(job.error).slice(0, 500)}`);
    if (job.output !== undefined && job.output !== null) {
      const out = typeof job.output === "string" ? job.output : JSON.stringify(job.output);
      parts.push(`  Output: ${out.slice(0, 1000)}`);
    }
    lines.push(parts.join("\n"));
  }
  lines.push("");
  lines.push("The background job(s) above finished. Check the result and continue the task if needed.");
  return lines.join("\n");
}
