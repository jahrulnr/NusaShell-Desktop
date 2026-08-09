/**
 * Job automation waist — domain model. Moved to @nusashell/domain
 * (ticket #81, Klaster B); this file is a re-export shim so existing
 * application imports keep resolving.
 */
export {
  ONCE_GRACE_SECONDS,
  normalizeTrigger,
  scheduleOf,
  recurringCatchupGraceSeconds,
  isRecurring,
  type Job,
  type JobSchedule,
  type JobTrigger,
  type JobMode,
  type JobStatus,
  type JobOutputEntry,
  type Condition,
  type ConditionNode,
  type OnCompleteEmit,
} from "@nusashell/domain";
