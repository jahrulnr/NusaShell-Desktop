/**
 * Stream sequence registry (ticket #80, Klaster A).
 *
 * The monotonic `streamSeq` counter moved to
 * `packages/domain/src/agent/stream-seq-registry.ts`; this module re-exports
 * it so application consumers keep a stable import path.
 */
export { StreamSeqRegistry } from "@nusashell/domain";
