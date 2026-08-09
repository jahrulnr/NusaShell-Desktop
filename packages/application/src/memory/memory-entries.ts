/**
 * Memory-entries policy (ticket #84, Klaster E).
 *
 * The pure rules moved to `packages/domain/src/memory/memory-entries.ts`;
 * this module re-exports them so existing application/port consumers keep a
 * stable import path and the memory domain has a single source of truth.
 */
export {
  MEMORY_LIMIT,
  USER_LIMIT,
  ENTRY_DELIMITER,
  MATCH_AMBIGUOUS,
  MATCH_NOT_FOUND,
  MATCH_EMPTY,
  limitFor,
  splitEntries,
  joinEntries,
  charsOf,
  usageOf,
  checkCapacity,
  findUniqueMatch,
  addEntry,
  replaceEntry,
  removeEntry,
  type MemoryEntry,
  type MemoryTarget,
  type MemoryUsage,
} from "@nusashell/domain";
