import type { EventDispatcher } from "../../events/event-dispatcher.js";
import type { AutomationEvent } from "../../events/automation-event.js";
import type { JobStorePort } from "../ports/job-store.port.js";
import type { JobScheduler } from "./job-scheduler.js";
import type { Job, JobTrigger } from "../job-model.js";
import type { LoggerPort } from "../../plugin/ports/logger.port.js";
import { templateContextFromEvent, type TemplateContext } from "./job-template-resolver.js";

import { MAX_CHAIN_DEPTH, matchesEventTrigger } from "@nusashell/domain";

// Pure matching policy moved to @nusashell/domain (ticket #81, Klaster B);
// re-exported here so the public API stays stable.
export {
  MAX_CHAIN_DEPTH,
  matchGlob,
  evaluateCondition,
  evaluateConditionNode,
  evaluateConditionAgainstObject,
  evaluateConditionNodeAgainstObject,
  resolveDotPath,
} from "@nusashell/domain";

/**
 * EventJobMatcher subscribes to `AutomationEvent`s on the existing
 * `EventDispatcher`, matches them against enabled event-triggered Jobs, and
 * fires matching jobs via `JobScheduler.runOneNow`.
 *
 * Throttle semantics (see 02-job-triggers.md §7):
 * - `throttleMs`: coalesce — within the throttle window, the latest matching
 *   event's payload is retained and scheduled to fire at window end. An even
 *   newer event replaces the retained one.
 * - `maxFiresPerHour`: hard cap — once hit, events are dropped until the
 *   rolling window frees up.
 *
 * Order of application: pattern match → conditions → maxFiresPerHour →
 * throttleMs coalesce → dispatch.
 */


export class EventJobMatcher {
  private readonly fireTimestamps = new Map<string, number[]>(); // jobId → rolling hour
  private readonly lastFireAt = new Map<string, number>(); // jobId → ms
  private readonly pendingCoalesce = new Map<string, { event: AutomationEvent; fireAt: number }>();
  private readonly coalesceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private started = false;

  constructor(
    private readonly deps: {
      readonly store: JobStorePort;
      readonly scheduler: JobScheduler;
      readonly eventDispatcher: EventDispatcher;
      readonly logger?: LoggerPort;
      readonly now?: () => Date;
      /** Phase E: optional pipeline store + scheduler for event-triggered pipelines. */
      readonly pipelineStore?: import("../ports/pipeline-store.port.js").PipelineStorePort;
      readonly pipelineScheduler?: import("./pipeline-scheduler.js").PipelineScheduler;
    },
  ) {}

  start(): void {
    if (this.started) return;
    this.started = true;
    this.deps.eventDispatcher.on("automation.event", {
      handle: (event) => this.handleEvent(event as AutomationEvent),
    });
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;
    for (const timer of this.coalesceTimers.values()) clearTimeout(timer);
    this.coalesceTimers.clear();
    this.pendingCoalesce.clear();
  }

  private async handleEvent(event: AutomationEvent): Promise<void> {
    try {
      const jobs = await this.deps.store.list();
      const now = (this.deps.now ?? (() => new Date()))().getTime();
      const chainDepth = event.chainDepth ?? 0;
      for (const job of jobs) {
        if (!job.enabled) continue;
        if (job.trigger.kind !== "event") continue;
        if (!this.matches(job.trigger, event)) continue;
        // Cycle guard (Phase D): block self-trigger and deep chains.
        if (event.originJobId === job.id) {
          this.deps.logger?.warn(
            "event-job %s blocked: self-trigger cycle (event origin = this job)",
            job.id,
          );
          continue;
        }
        if (chainDepth >= MAX_CHAIN_DEPTH) {
          this.deps.logger?.warn(
            "event-job %s blocked: chain depth %d exceeds max %d",
            job.id,
            chainDepth,
            MAX_CHAIN_DEPTH,
          );
          continue;
        }
        await this.considerFire(job, event, now);
      }
      // Phase E: match event-triggered pipelines.
      if (this.deps.pipelineStore && this.deps.pipelineScheduler) {
        await this.matchPipelines(event);
      }
    } catch (error) {
      this.deps.logger?.error(
        "event-job-matcher error: %s",
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  /** Test whether a trigger matches an event (pattern + pluginId + conditions). */
  matches(trigger: Extract<JobTrigger, { kind: "event" }>, event: AutomationEvent): boolean {
    return matchesEventTrigger(trigger, event);
  }

  /** Phase E: match event-triggered pipelines and dispatch without blocking event intake. */
  private async matchPipelines(event: AutomationEvent): Promise<void> {
    if (!this.deps.pipelineStore || !this.deps.pipelineScheduler) return;
    const pipelines = await this.deps.pipelineStore.list();
    const now = (this.deps.now ?? (() => new Date()))().getTime();
    const ctx = templateContextFromEvent(event);
    const chainDepth = event.chainDepth ?? 0;

    for (const pipeline of pipelines) {
      if (!pipeline.enabled) continue;
      if (pipeline.trigger.kind !== "event") continue;
      if (!this.matches(pipeline.trigger, event)) continue;

      // Cycle guard: block self-trigger and chains that crossed the max depth.
      // We compare against the event's origin (job or pipeline) by aggregate id.
      const originAggregate = event.originJobId ?? event.originPipelineId;
      if (originAggregate === pipeline.id) {
        this.deps.logger?.warn(
          "pipeline %s blocked: self-trigger cycle (event origin = this pipeline)",
          pipeline.id,
        );
        continue;
      }
      if (chainDepth >= MAX_CHAIN_DEPTH) {
        this.deps.logger?.warn(
          "pipeline %s blocked: chain depth %d exceeds max %d",
          pipeline.id,
          chainDepth,
          MAX_CHAIN_DEPTH,
        );
        continue;
      }

      const trigger = pipeline.trigger;
      if (trigger.maxFiresPerHour !== undefined) {
        if (!this.withinHourlyCap(`pipeline:${pipeline.id}`, trigger.maxFiresPerHour, now)) {
          this.deps.logger?.debug(
            "pipeline %s dropped: maxFiresPerHour (%d) reached",
            pipeline.id,
            trigger.maxFiresPerHour,
          );
          continue;
        }
      }
      if (trigger.throttleMs !== undefined && trigger.throttleMs > 0) {
        const key = `pipeline:${pipeline.id}`;
        const lastFire = this.lastFireAt.get(key) ?? 0;
        if (now - lastFire < trigger.throttleMs) {
          // Coalesce (latest wins) — schedule a single fire at window end,
          // rather than dropping the event silently. Same semantics as jobs.
          this.scheduleCoalesced(`pipeline:${pipeline.id}`, event, lastFire + trigger.throttleMs);
          this.deps.logger?.debug(
            "pipeline %s throttled: coalesced in %dms",
            pipeline.id,
            trigger.throttleMs - (now - lastFire),
          );
          continue;
        }
      }

      this.lastFireAt.set(`pipeline:${pipeline.id}`, now);
      this.recordFire(`pipeline:${pipeline.id}`, now);
      this.deps.logger?.info(
        "pipeline %s firing for event %s",
        pipeline.id,
        event.eventType,
      );

      // Admit then dispatch asynchronously so a slow pipeline cannot block later events.
      void this.deps.pipelineScheduler
        .runPipeline(pipeline.id, ctx, { source: "event" })
        .then((result) => {
          if (!result.ok) {
            this.deps.logger?.debug(
              "pipeline %s run failed: %s",
              pipeline.id,
              result.error ?? "unknown",
            );
          }
        })
        .catch((error) => {
          this.deps.logger?.error(
            "pipeline %s dispatch error: %s",
            pipeline.id,
            error instanceof Error ? error.message : String(error),
          );
        });
    }
  }

  private async considerFire(job: Job, event: AutomationEvent, now: number): Promise<void> {
    const trigger = job.trigger as Extract<JobTrigger, { kind: "event" }>;

    // maxFiresPerHour check (drop, not coalesce)
    if (trigger.maxFiresPerHour !== undefined) {
      if (!this.withinHourlyCap(job.id, trigger.maxFiresPerHour, now)) {
        this.deps.logger?.debug(
          "event-job %s dropped: maxFiresPerHour (%d) reached",
          job.id,
          trigger.maxFiresPerHour,
        );
        return;
      }
    }

    // throttleMs coalesce
    if (trigger.throttleMs !== undefined && trigger.throttleMs > 0) {
      const lastFire = this.lastFireAt.get(job.id) ?? 0;
      const elapsed = now - lastFire;
      if (elapsed < trigger.throttleMs) {
        const fireAt = lastFire + trigger.throttleMs;
        this.scheduleCoalesced(job, event, fireAt);
        return;
      }
    }

    await this.fire(job, event, now);
  }

  private async fire(job: Job, event: AutomationEvent, now: number): Promise<void> {
    this.lastFireAt.set(job.id, now);
    this.recordFire(job.id, now);
    this.deps.logger?.info(
      "event-job %s firing for event %s (plugin=%s)",
      job.id,
      event.eventType,
      event.pluginId ?? "any",
    );
    const ctx: TemplateContext = templateContextFromEvent(event);
    const chainOrigin = event.originJobId !== undefined
      ? { originJobId: event.originJobId, chainDepth: event.chainDepth ?? 0 }
      : undefined;
    // Fire-and-track: startJobNow returns immediately and runs the job in the
    // background, so a long-running event-job cannot block subsequent events.
    const result = await this.deps.scheduler.startJobNow(job.id, ctx, chainOrigin);
    if (!result.ok) {
      this.deps.logger?.debug("event-job %s fire skipped: %s", job.id, result.error ?? "unknown");
    }
  }

  private scheduleCoalesced(jobOrKey: Job | string, event: AutomationEvent, fireAt: number): void {
    // Accept a Job object (job path) or a string key (e.g. "pipeline:<id>").
    // Latest event wins for the key.
    const key = typeof jobOrKey === "string" ? jobOrKey : jobOrKey.id;
    this.pendingCoalesce.set(key, { event, fireAt });
    const existing = this.coalesceTimers.get(key);
    if (existing) clearTimeout(existing);
    const delay = Math.max(0, fireAt - (this.deps.now ?? (() => new Date()))().getTime());
    const timer = setTimeout(() => {
      void this.flushCoalesced(key);
    }, delay);
    this.coalesceTimers.set(key, timer);
  }

  private async flushCoalesced(key: string): Promise<void> {
    this.coalesceTimers.delete(key);
    const pending = this.pendingCoalesce.get(key);
    if (!pending) return;
    this.pendingCoalesce.delete(key);
    const now = (this.deps.now ?? (() => new Date()))().getTime();
    if (key.startsWith("pipeline:")) {
      const pipelineId = key.slice("pipeline:".length);
      const pipeline = this.deps.pipelineStore
        ? await this.deps.pipelineStore.get(pipelineId)
        : null;
      if (!pipeline || !pipeline.enabled || !this.deps.pipelineScheduler) return;
      this.lastFireAt.set(key, now);
      this.recordFire(key, now);
      void this.deps.pipelineScheduler
        .runPipeline(
          pipelineId,
          templateContextFromEvent(pending.event),
          { source: "event" },
        )
        .catch((error) => {
          this.deps.logger?.error(
            "pipeline %s coalesced dispatch error: %s",
            pipelineId,
            error instanceof Error ? error.message : String(error),
          );
        });
      return;
    }
    const job = await this.deps.store.get(key);
    if (!job || !job.enabled) return;
    await this.fire(job, pending.event, now);
  }

  private withinHourlyCap(jobId: string, max: number, now: number): boolean {
    const windowMs = 60 * 60 * 1000;
    const stamps = this.fireTimestamps.get(jobId) ?? [];
    const recent = stamps.filter((t) => now - t < windowMs);
    this.fireTimestamps.set(jobId, recent);
    return recent.length < max;
  }

  private recordFire(jobId: string, now: number): void {
    const stamps = this.fireTimestamps.get(jobId) ?? [];
    stamps.push(now);
    this.fireTimestamps.set(jobId, stamps);
  }
}
