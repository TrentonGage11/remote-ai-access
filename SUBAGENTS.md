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
  "task": "Focused task with an explicit deliverable",
  "role": "research",
  "provider": "openai",
  "model": "gpt-5.5",
  "allowedTools": ["list_directory", "read_file", "search_internet"],
  "maxSteps": 12,
  "timeoutMs": 300000,
  "contextMode": "summary"
}
```

The server must intersect `allowedTools` with both the role policy and the authenticated parent's permissions. A child never receives API keys, admin tokens, upload codes, or the parent's raw request headers.

## Execution Model

1. Refactor the existing provider loops into a reusable `runAgentJob` function that accepts an explicit immutable authorization context, workspace context, tool allow-list, abort signal, step budget, and event callback.
2. Add a `subagentJobStore` with parent job ID, child job ID, workspace, role, status, timing, abort controller, events, and bounded result.
3. Run children asynchronously with the same workspace isolation as the parent.
4. Return a structured final result containing `summary`, `artifacts`, `executedTools`, and `error`; do not inject full child transcripts into parent context by default.
5. Emit child lifecycle events through the existing chat-job event stream so the UI can display running/completed/failed children.

## Required Limits

Start conservatively:

- Maximum depth: 1 (children cannot call `spawn_subagent`).
- Maximum concurrent children per parent: 2.
- Maximum children per parent request: 4.
- Maximum steps per child: 20.
- Maximum runtime per child: 10 minutes.
- Maximum returned summary: 12,000 characters.
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
5. Add explicitly approved `coding` children.
6. Add durable job persistence only if child jobs must survive service restarts.

## Validation

- Unauthorized parent requests cannot spawn or inspect children.
- A child cannot call tools outside the role/parent intersection.
- A child cannot spawn another child.
- Two children can run concurrently and return independent results.
- Parent cancellation aborts all children.
- Workspace access cannot cross the parent's workspace.
- Child context and output remain within configured bounds.
- Existing direct and queued agent behavior remains unchanged.
