// Entity/value types are domain-owned (ticket #84, Klaster E) so the memory
// policy and the persistence port share one source of truth.
import type { MemoryTarget, MemoryEntry, MemoryUsage } from "@nusashell/domain";
export type { MemoryTarget, MemoryEntry, MemoryUsage } from "@nusashell/domain";

export interface MemorySnapshot {
  readonly memory: readonly MemoryEntry[];
  readonly user: readonly MemoryEntry[];
  readonly usage: {
    readonly memory: MemoryUsage;
    readonly user: MemoryUsage;
  };
}

export interface MemoryMutationResult {
  readonly ok: true;
  readonly data: {
    readonly entries: readonly MemoryEntry[];
    readonly usage: MemoryUsage;
  };
}

export interface MemoryStorePort {
  loadSnapshot(): Promise<MemorySnapshot>;
  add(target: MemoryTarget, content: string): Promise<MemoryMutationResult>;
  replace(target: MemoryTarget, oldText: string, content: string): Promise<MemoryMutationResult>;
  remove(target: MemoryTarget, oldText: string): Promise<MemoryMutationResult>;
}
