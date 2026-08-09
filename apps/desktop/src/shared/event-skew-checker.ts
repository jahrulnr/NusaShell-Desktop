// Event skew checker — measures IPC event delivery latency.
// When the main process emits a shell:event frame, it stamps `emittedAt`
// (ms epoch). The receiver checks skew on receive to detect event bus
// stalls or main-process blocking that delays delivery.
//
// Policy moved to @nusashell/domain (ticket #83, Klaster D); this file is a
// re-export shim. Pure module: no DOM, no Electron.
export {
  SKEW_THRESHOLD_MS,
  FLOOD_WINDOW_MS,
  checkEventSkew,
  type EventSkewFrame,
  type EventSkewContext,
  type EventSkewResult,
} from "@nusashell/domain";
