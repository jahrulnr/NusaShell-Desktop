# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.7.3] - 2026-08-10

### Fixed

- Removed the local desktop postinstall rebuild of `better-sqlite3`; native dependencies are staged during packaging, so Windows source development no longer requires Visual Studio C++ build tools just to run `make dev`.
- Release metadata now includes Windows and macOS payloads so the platform installers can resolve their archives.
- Provider model selection now preserves the active provider's base URL and connection settings when reconfiguring the runtime.
- Built-in OpenAI-compatible provider IDs continue to infer their presets when the editor submits the generic provider type, preserving OmniRoute's default endpoint.
- OpenAI-compatible Responses API requests can fall back to Chat Completions only when the upstream endpoint reports that Responses is unsupported.

## [0.7.2] - 2026-08-10

### Added

- **Max auto-continues UI control.** Exposed `settings-ai-max-auto-continues` input field (0–10000) under Usage limits in the Settings UI modal to configure the auto-continue chain limit directly from desktop settings.

### Changed

- **Compaction boundary filtering.** `buildAgentContext` now uses `compactedThroughPosition` boundary checking to correctly preserve post-compaction residual messages when conversation store history has been truncated.
- **Application configuration defaults.** Harmonized `maxAutoContinues` default fallback in `loadConfig` to `10` across configuration schemas.

## [0.7.1] - 2026-08-10

### Added

- **Stable client-side prompt-cache identity.** Agent turns now derive a
  provider/model/conversation-scoped cache key and preserve it across normal,
  auto-continue, and resume requests. OpenAI-compatible adapters forward the
  key as `prompt_cache_key` when caching is enabled.
- **TODO continuation fallback.** Room-local TODO state can recover a missing
  auto-continue decision so open checklists do not become stranded.

### Changed

- **Context update token handling.** Live context badges can be refreshed from
  context-update events, keeping displayed token estimates aligned with the
  current request context.
- **Agent conversation and prompt contracts.** Conversation steering and
  continuation handling were simplified, while system and continuation
  prompts now clarify active user instructions, halt behavior, TODO completion,
  and path reporting.

### Fixed

- Prompt-cache routing now remains stable through the resume path instead of
  being dropped while the compactor rebuilds injected context.

## [0.7.0] - 2026-08-09

### Added

- **Usage dashboard (Usage view).** A new left-sidebar view surfaces token-efficiency
  telemetry from the local JSONL spine: summary cards (turns, success rate, cache hit
  rate, fresh tokens per completed turn, provider requests per turn, rounds median/p95,
  failure-waste ratio, cost — reported as `n/a` until cost passthrough lands), a 7-day
  sparkline, a recent-turns table, and a completion-steering summary (fired / skipped
  by reason). Metadata-only: no prompt content, keys, or cost is rendered, and the
  renderer never writes telemetry.
- **Telemetry read path.** A `telemetry.get-report` query (application `TelemetryQueryPort`
  + `JsonlTelemetryReader`) exposes aggregated reports to the renderer, fail-soft when
  the directory is missing or lines are corrupt.
- **Completion-steering observability.** A `steering` telemetry record (fired/skipped +
  reason) is written via the `telemetry.record-steering` command whenever the desktop
  auto-starts or skips a follow-up turn after a background job ends, and is aggregated
  into the Usage view.
- **Subagent delegation guide as runtime data.** `subagent-delegation.md` now ships inside
  the ephemeral `runtime_context` snapshot (`subagents.delegationGuide`) with fresh
  routing vars, instead of being injected as a system prompt.
- **Leaner tool-result projection for the model.** Tool results no longer wrap successful
  payloads in the gateway `{ ok, data, meta }` envelope, and error results surface the
  real error message directly; terminal-style `ask_question` answers (`via=` /
  `optionIds[]`) are parsed for option selections.
- **OpenRouter attribution headers.** Requests identify NusaShell (`user-agent`, plus
  `http-referer` / `x-openrouter-title` / `x-openrouter-categories`) only when talking to
  OpenRouter hosts; custom OpenAI-compatible proxies never receive router-specific
  headers.
- **Mid-turn agent steering.** A running agent turn can be steered mid-flight: queue a
  fresh user direction (or cancel a queued steer) from the agent UI or over the WS
  protocol (`agent.steer` / `agent.steer_cancel`); the runner folds the update in at the
  next safe boundary and re-compacts when the added context crosses the budget.
- **Drag & drop / paste file attach in the shell.** The launcher window now intercepts
  OS file drags — a drop overlay appears, and dropping no longer triggers Chromium's
  default navigate/error. Files are routed to the active surface (agent composer
  attach; other views get a clear "not supported here" toast), and pasted files attach
  the same way.
- **Global model picker.** A workbench-level picker switches the active model used by
  the agent UI; conversation model bindings follow the global selection.
- **Files plugin upload & drop.** The Files workspace can upload files via the toolbar
  or drag & drop, with progress/toast feedback.

### Changed

- **Prompt contract for user messages during task execution.** `system.md` now states that
  the latest user message is an active instruction (answer questions, weigh suggestions,
  then continue per open TODOs), background-completion notices are information only, and
  typed "stop" / "berhenti" is a real halt that cancels unfinished TODOs. `continue.md`
  honors a typed halt and defers to a newer user message. The completion-steering summary
  header is now `[Background job completed — information only, not a user instruction]`.
- **`runtime_context.subagents` snapshot shape.** `availableSubagents` / `defaultSubagent`
  are folded into a `subagents` object with `available`, `default`, and an interpolated
  `delegationGuide`; system-prompt subagent delegation injection is removed.
- **Interrupted-message resume UX.** Resuming an interrupted assistant message reuses the
  existing interrupted card (re-labels it as pending) instead of painting a duplicate;
  the visible failure message is cleared consistently on new turns.
- **Sidebar navigation order** — a new **Usage** item sits between Pipelines and Logs.
- **Learning Connections graph polish.** Isolated nodes (memory entries and skills
  without `related_skills`) now stay visible at every zoom level with a stable
  compact-orphan placement instead of being culled at far zoom; the connections panel
  stretches so the time-range scrubber stays at the workspace footer, and the graph
  instance is torn down when the tab is hidden so it cannot mount stale.
- **Shared workspace gutter.** Every full-height workspace (agent, skills, learning,
  jobs, logs) now shares one responsive inset (`--workspace-gutter`) and one compact
  workbench boundary (bordered, rounded, clipped panel) instead of per-view padding,
  with a tighter radius on small screens.
- **Agent context-update marker.** The transcript shows a compact "Context updated"
  footer marker beside rounds only at a fresh hydration boundary, so a mid-turn
  runtime refresh is visible in the conversation.
- **Skill-review rules as a single source.** The skill-curation rules now live in one
  `skill-review-rules.md` file interpolated into both `skill-review.md` and
  `combined-review.md`, removing duplicated guidance and pinning the prompt contract
  with a dedicated test.
- **Domain-first architecture (Clean Architecture conformance).** Agent/tool policy,
  the job & pipeline domain model, memory limits/entries, skill curation, learning-graph
  primitives, telemetry record shapes, and model-capability rules moved from the
  application/infrastructure/desktop layers into `packages/domain` sub-domains (`agent`,
  `ai`, `job`, `learning`, `memory`, `skill`, `telemetry`). Infrastructure is
  adapters-only again and desktop business limits/eviction/clamping now call domain
  policies; every rule has a single source of truth with no behavior change.

### Fixed

- **Late context compaction rollback.** Runtime updates that push a turn over
  the context budget are compacted before the next provider request, and the
  completed assistant turn is no longer included in the sealed checkpoint
  boundary. New messages therefore cannot resurrect stale TODOs or continuation
  prompts from before the completed turn.
- **OpenAI-compatible provider headers** — `user-agent` and attribution headers are scoped
  to OpenRouter hosts so custom proxies are not sent router-specific metadata.
- **Tool-result rendering noise** — successful structured tool results no longer emit
  `status=success`/`truncated=false` scaffolding in the model-visible projection.
- **Pre-sample compaction gate.** Mid-turn pre-sample compaction now only fires when a
  runtime update actually arrived between rounds, removing a redundant extra provider
  summarizer call on over-budget resumes (fixes a flaky scripted-provider test).

## [more](./docs/changelog)
