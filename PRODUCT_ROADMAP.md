# Product Roadmap

This roadmap tracks the requested operational features. Work should preserve workspace isolation, existing authorization checks, bounded resource use, auditability, and mobile width containment.

Status labels below mean: **deployed** is implemented and verified in production,
**partial** is a working foundation with an explicit integration or UI gap,
and **planned** has not been implemented yet.

## Next recommended slice

Finish the opt-in TDD workflow in the live coding-job runner by preserving its
explicit commit gate, then feed workspace code-map results into agent context so
edits can target relevant symbols without loading the whole tree.

## Current Delivery Batch

1. Scheduled Agent Recipes: deployed and verified
2. Share Analytics: deployed and verified
3. Git Change Center: deployed and verified
4. Live Resource Monitor: deployed and verified
5. Usage and Cost Dashboard: deployed and verified

## Priority Sequence

### 1. Agent Run Queue

Status: deployed

- Priority ordering: urgent, high, normal, low
- Bounded concurrent execution
- Workspace pause and resume
- Reprioritize or cancel queued runs
- Inspect completed output and errors
- Durable queue persistence: queued work and completed results survive restarts; interrupted active runs remain visible without unsafe replay
- Optional per-workspace concurrency limits: deployed

### 2. Scheduled Agent Recipes

Status: deployed

- Run saved recipes once, on an interval, or daily
- Time zone aware scheduling
- Missed-run policy and overlap prevention
- Queue integration, notifications, evidence, and audit records
- Next: optional Git-change triggers

### 3. File Lab Workspace Search

Status: deployed

- Embed existing workspace search in File Lab
- Filename, text, hybrid, and regular-expression modes
- Click a result to open the file and line
- Replace preview with explicit per-file acceptance

### 4. Git Change Center

Status: deployed

- Status, staged and unstaged changes, and branch switching
- Selective staging and commits
- Side-by-side diff integration
- Conflict detection and guided resolution

### 5. Workspace Activity Timeline

Status: deployed

- Unified edits, uploads, shares, snapshots, Git actions, agent jobs, tools, and failures
- Filters by workspace, trace, event type, and date
- Links to evidence, files, snapshots, and restore actions

### 6. Live Resource Monitor

Status: deployed

- CPU, memory, disk, process, Docker, queue, upload, and provider latency health
- Current and recent values with bounded history
- Threshold notifications and degraded-state summaries

### 7. Usage and Cost Dashboard

Status: deployed

- Provider/model tokens, estimated cost, latency, failures, and tool calls
- Daily and monthly views
- Per-workspace and per-trace breakdowns
- Configurable budget warnings and hard limits

### 8. Portable Workspace Bundles

Status: deployed; metadata restore remains intentionally selective

- Export selected files, context, recipes, settings, snapshots, and audit history
- Password-encrypted bundles
- Import preview, conflict policy, and selective file restore
- Optional recipe and audit-history restore, with imported recipes disabled by default
- Git snapshot references are previewable but are not treated as portable commits
- Bundle payloads are capped at 25 MiB with a bundle-only 40 MiB JSON request ceiling

## Follow-up Features

### Interactive Human-in-the-Loop Flows

Status: implemented foundation; expansion remains

Agent workflows may pause in a durable `needs_input` state when they need a
choice, clarification, or explicit approval. The server will create a
workspace-scoped notification containing the question, optional choices, and a
stable response token. The user can answer from the notification or from the
originating chat; the answer resumes the exact workflow rather than starting a
new unrelated run. Expired questions, cancellation, and duplicate answers are
handled idempotently and every transition is audit logged. This is also the
mechanism for TDD commit approval, chaos-review findings, deployment gates, and
long-running scheduled recipes.

The durable question state, workspace notifications, inline chat answers, and
resume path are implemented and deployed. Remaining expansion includes richer
choice/approval surfaces and additional expiry/notification polish.

### Phase 1: Agent Verification Workflows

Status: in progress

- TDD state machine: tests-first, bounded execution/repair attempts, captured
  stdout/stderr, and a commit-ready state only after a passing test result.
  **Deployed:** an opt-in coding-child loop executes the configured test profile,
  captures output, feeds failures back for bounded repair attempts, exposes
  `commitReady` only after a pass, and provides an explicit commit-approval UI.
- Optimizer/reviewer graph: **deployed** implementation pass followed by
  independent edge-case and security review, with explicit artifact acceptance.
- Workspace code map v1: **deployed** as a workspace-scoped cached `/api/files/code-map`
  index of symbols/imports with bounded regex fallback when a language parser is
  unavailable. It skips dependency/build folders and large files.
- No automatic commit or deployment: **done guardrail**; the existing write and Git approval gates
  remain authoritative.

### Image Search and Generation

Status: deployed

Wikimedia Commons search returns source/license metadata. Configured OpenAI, xAI, and Google image models can generate bounded workspace assets directly or through the `image` subagent role.

### Command Palette

Status: planned

Search and launch chats, files, tools, pages, snapshots, recipes, and queue actions from one keyboard-first surface.

### Provider Comparison Mode

Status: planned

Run one prompt against selected providers and compare output, latency, token use, estimated cost, and tool evidence.

### PWA and Offline Shell

Status: planned

Installable UI, cached local history, reconnect recovery, and safe deferred uploads or queue submissions.

### Share Analytics

Status: deployed

Views, downloads, last access, expiration warnings, revocation, and one-click expiry extension.

## Related Platform Work

- Bounded research, review, image, and approval-gated coding subagents are implemented with workspace-scoped operations, role/parent tool intersection, explicit file/directory write scopes, usage/evidence results, active cancellation, and selective artifact/context acceptance. Accepted coding artifacts hand off to Git Change Center for explicit review.
- Declarative deployment preview, action-bound one-time approvals, and root-owned static activation/rollback are deployed and verified in production. Activation uses immutable releases, fixed Apache templates, a root-owned registry, SPKI-pinned health checks, and automatic failure restoration. Next add similarly bounded Node services; do not grant agents unrestricted SSH or Cloudflare credentials. See [AGENT_DEPLOYMENT_PROFILE.md](AGENT_DEPLOYMENT_PROFILE.md).
- Queue state and Saved Recipe schedules are durable across service restarts.
- Add retention controls for metrics, activity, queue results, and exported evidence.

## Recommended follow-on order

1. Finish the Portable Workspace Bundles UI with encrypted export, import preview,
   conflict handling, and selective restore.
2. Expand human-in-the-loop questions into richer approval, clarification, and
   scheduled-recipe interactions.
3. Add the Command Palette, Provider Comparison Mode, and PWA/offline shell.
