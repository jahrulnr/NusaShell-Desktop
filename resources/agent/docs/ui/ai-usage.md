# Usage

Read-only token-efficiency and completion-steering analytics derived from the complete retained local telemetry spine. Shows prioritized efficiency signals, a seven-calendar-day activity chart, and a recent-turn trace log without prompt content or keys.

**How to open:** Click the Usage item in the left sidebar.

## Efficiency signals

The primary instrument highlights prompt-cache reuse, fresh tokens per completed turn, successful-turn rate, and provider request amplification. A secondary strip keeps total turns, rounds median and p95, failure-waste ratio, and cost per turn visible without giving every metric equal visual weight. Cost remains n/a until cost passthrough lands.

Refresh reports an explicit loading state and coalesces repeated clicks. Existing metrics remain visible if a later refresh fails; disabled, enabled-but-empty, and first-load error states are distinct.

- **Refresh usage** (`#telemetry-refresh-btn`):
  - Section: Usage efficiency signals
  - Type: button
  - Action: Reloads the retained telemetry report, coalescing repeat clicks while a request is active.

- **Total turns** (`#telemetry-turns`):
  - Section: Usage efficiency signals
  - Type: metric
  - Action: Displays the number of retained agent-turn records.

- **Successful turns** (`#telemetry-success-rate`):
  - Section: Usage efficiency signals
  - Type: metric
  - Action: Displays completed turns as a percentage of all retained turns.

- **Prompt cache reuse** (`#telemetry-cache-hit`):
  - Section: Usage efficiency signals
  - Type: metric
  - Action: Displays cached provider input tokens as a percentage of total provider input tokens.

- **Fresh input per completed turn** (`#telemetry-fresh-tokens`):
  - Section: Usage efficiency signals
  - Type: metric
  - Action: Displays average uncached provider input tokens for completed turns.

- **Provider amplification** (`#telemetry-req-per-turn`):
  - Section: Usage efficiency signals
  - Type: metric
  - Action: Displays provider requests divided by retained turns.

- **Median rounds** (`#telemetry-rounds-median`):
  - Section: Usage operational strip
  - Type: metric
  - Action: Displays the median provider-round count per turn.

- **P95 rounds** (`#telemetry-rounds-p95`):
  - Section: Usage operational strip
  - Type: metric
  - Action: Displays the 95th-percentile provider-round count per turn.

- **Failure waste** (`#telemetry-failure-waste`):
  - Section: Usage operational strip
  - Type: metric
  - Action: Displays the share of turn tokens consumed by non-completed turns.

- **Cost per turn** (`#telemetry-cost`):
  - Section: Usage operational strip
  - Type: metric
  - Action: Displays cost per completed turn when provider cost passthrough becomes available; currently n/a.

- **Report timestamp** (`#telemetry-generated`):
  - Section: Usage report status
  - Type: text
  - Action: Displays when the current telemetry report was generated.

- **Usage error** (`#telemetry-error`):
  - Section: Usage report status
  - Type: alert
  - Action: Reports a telemetry query failure without clearing a previously rendered report.

## Seven-day activity and completion steering

A zero-filled activity chart covers the seven UTC calendar days ending at report generation and distinguishes completed, failed, and other turn outcomes. It is aggregated from every retained turn, independent of the recent-turn limit. Completion steering shows fired and skipped follow-up decisions plus skip reasons.

- **Daily turn activity** (`#telemetry-spark`):
  - Section: Seven-day activity
  - Type: chart
  - Action: Plots completed, failed, and other turns across seven zero-filled UTC calendar days.

- **Steering decisions** (`#telemetry-steer-count`):
  - Section: Completion steering
  - Type: metric
  - Action: Displays all retained completion-steering decisions.

- **Steering fired** (`#telemetry-steer-fired`):
  - Section: Completion steering
  - Type: metric
  - Action: Displays decisions that started an agent follow-up turn.

- **Steering skipped** (`#telemetry-steer-skipped`):
  - Section: Completion steering
  - Type: metric
  - Action: Displays decisions that did not start a follow-up turn.

- **Steering skip reasons** (`#telemetry-steer-reasons`):
  - Section: Completion steering
  - Type: text
  - Action: Breaks skipped decisions down by not-idle, composer-busy, or other.

## Recent turns

A table of the newest 50 turns: short trace id, allowlisted status badge, completion time, duration, rounds, tool calls, input tokens, cache percentage, fresh input tokens, and output tokens. Rows are created with safe DOM text nodes rather than telemetry-derived HTML.

- **Recent turn rows** (`#telemetry-turns-table-body`):
  - Section: Recent turns
  - Type: table
  - Action: Displays the newest 50 turns with status, timing, tool, cache, and token metadata.

- **No recent turns** (`#telemetry-no-turns`):
  - Section: Recent turns
  - Type: status
  - Action: Explains when retained telemetry exists but contains no agent-turn records.

- **Usage empty state** (`#telemetry-empty`):
  - Section: Usage report status
  - Type: status
  - Action: Explains whether telemetry is disabled or enabled without recorded usage.
