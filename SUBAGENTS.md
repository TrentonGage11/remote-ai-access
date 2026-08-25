# Subagent Design

## Goal

Allow an authorized parent agent to delegate bounded research, review, or implementation tasks to child agents and collect structured results without sharing credentials or creating unbounded recursion.

## First Release

Add four API-key-gated agent tools:

- `spawn_subagent`: starts a child job and returns its ID immediately.
- `get_subagent`: returns status, bounded events, and the final result.
- `wait_subagents`: waits for one or more child jobs with a server-side timeout.
- `cancel_subagent`: cancels a child job and its active provider request.

Initial child roles:

- `research`: read, list, search, fetch, and status tools.
- `review`: research tools plus diff, lint, and test tools.
- `coding`: explicitly approved workspace write tools in addition to review tools.

## Request Contract

`spawn_subagent` should accept:

```json
{
  "idempotencyKey": "parent-job-id:research-1",
  "task": "Focused task with an explicit deliverable",
  "role": "research",
  "provider": "openai",
  "model": "gpt-5.5",
  "allowedTools": ["list_directory", "read_file", "search_internet"],
  "maxSteps": 12,
  "maxInputTokens": 60000,
  "maxOutputTokens": 12000,
  "maxCostUsd": 0.50,
  "timeoutMs": 300000,
  "contextMode": "summary"
}
```

The server must intersect `allowedTools` with both the role policy and the authenticated parent's permissions. A child never receives API keys, admin tokens, upload codes, or the parent's raw request headers.

## Execution Model

1. Refactor the existing provider loops into a reusable `runAgentJob` function that accepts an explicit immutable authorization context, workspace context, tool allow-list, abort signal, step budget, and event callback.
2. Add a `subagentJobStore` with parent job ID, child job ID, workspace, role, status, timing, abort controller, events, and bounded result.
3. Run children asynchronously with the same workspace isolation as the parent.
4. Return the structured result defined under Results and Evidence; do not inject full child transcripts into parent context by default.
5. Emit child lifecycle events through the existing chat-job event stream so the UI can display running/completed/failed children.

## Results and Evidence

Child results should be structured rather than free-form only:

- `summary`: concise answer for the parent.
- `findings`: severity-ranked observations or decisions.
- `artifacts`: workspace-relative files created or changed.
- `evidence`: file paths, line references, URLs, command names, and test results supporting the summary.
- `executedTools`: bounded tool execution list.
- `usage`: input/output tokens, elapsed time, and estimated cost.
- `proposedContextMutations`: optional context changes requiring parent acceptance.
- `error`: null on success or a bounded structured failure.

The parent should be able to accept, reject, or selectively merge proposed artifacts and context changes. Child output must never silently become trusted context.

## Model and Budget Policy

- Configure provider/model defaults per role instead of letting every child inherit the parent's most expensive model.
- Enforce input-token, output-token, runtime, step, and estimated-cost ceilings server-side.
- Reserve a portion of the parent's total budget before starting each child so parallel jobs cannot collectively exceed it.
- Stop cleanly at a budget boundary and return a partial result marked `budget_exhausted`.
- Include usage in audit events and the parent-visible child status.

## Progress and Reliability

- Emit queued, running, tool-start, tool-end, retrying, completed, failed, cancelled, and budget-exhausted events.
- Show each child as one compact row in the parent UI with role, model, elapsed time, latest action, and cancel control.
- Give every spawn request an idempotency key so a parent retry cannot duplicate the child job.
- Retry transient provider failures with bounded exponential backoff; do not automatically retry write tools.
- Add a short child heartbeat and mark jobs abandoned when their worker disappears.
- Keep partial results from failed siblings available to the parent.

## Required Limits

Start conservatively:

- Maximum depth: 1 (children cannot call `spawn_subagent`).
- Maximum concurrent children per parent: 2.
- Maximum children per parent request: 4.
- Maximum steps per child: 20.
- Maximum runtime per child: 10 minutes.
- Maximum returned summary: 12,000 characters.
- Maximum input/output tokens and estimated cost: required role-level defaults with per-request lower overrides.
- Maximum event history: use the existing bounded chat-job event policy.

The parent cancellation path must abort every active child. Child failures should be returned independently and should not automatically fail sibling jobs.

## Context

Each child receives a snapshot of the parent's active chat/global context plus a focused task prompt. Child context mutations should not be applied automatically. A child may return proposed context mutations, but the parent must explicitly apply them through the existing context tools.

## Security

- Reuse `assertAgentToolAuthorized` at parent creation time, then bind the validated principal and workspace into an immutable internal authorization object.
- Revalidate mutable permissions immediately before every child tool dispatch.
- Never authorize children by constructing a synthetic Express request.
- Exclude `spawn_subagent`, scheduling, admin, Git push/revert, delete, terminal, and write tools from default roles.
- Require the existing approval mechanism before enabling destructive tools for a coding child.
- Audit parent ID, child ID, role, model, normalized task, allowed tools, each tool call, cancellation, duration, and result status.

## Rollout

1. Extract and test the reusable agent runner without changing current chat behavior.
2. Implement in-memory child jobs, lifecycle tools, limits, cancellation, and audit logging.
3. Add read-only `research` children and parent UI status.
4. Add parallel `wait_subagents` and the `review` role.
5. Add parent UI progress, usage, evidence, and selective result acceptance.
6. Add explicitly approved `coding` children.
7. Add durable job persistence only if child jobs must survive service restarts.

## Validation

- Unauthorized parent requests cannot spawn or inspect children.
- A child cannot call tools outside the role/parent intersection.
- A child cannot spawn another child.
- Two children can run concurrently and return independent results.
- Parent cancellation aborts all children.
- Workspace access cannot cross the parent's workspace.
- Child context and output remain within configured bounds.
- Parallel children cannot exceed the reserved parent token/cost budget.
- Reusing a spawn idempotency key returns the original child rather than starting another.
- Evidence references and artifacts are constrained to the inherited workspace.
- Existing direct and queued agent behavior remains unchanged.
