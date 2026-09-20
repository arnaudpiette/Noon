# Specialist Agent Delegation — V2.5

V2.5 extends the existing `DelegationEngine` without changing `ModelRouter`.
Model providers remain responsible for inference. Specialist agents are bounded
repository actors selected and supervised by delegation.

## Canonical components

- `SpecialistAgentAdapter` defines availability, capabilities, execution,
  cancellation and status independently of Codex.
- `DevTaskContract` requires an explicitly authorized workspace, canonical Git
  root, scoped paths, DEV quality metadata, permissions, duration, iteration and
  optional cost ceilings.
- `RepositoryPreflight` captures branch, Git status, pre-existing file
  fingerprints, package manager, validation commands and applicable `AGENTS.md`
  files before execution.
- `DevDelegationRunner` owns the controlled DEV lifecycle and the final Noon
  verdict. An agent reporting success is never sufficient.
- `CodexSpecialistAgent` is the only real V2.5 adapter. It uses `codex exec` in
  ephemeral, non-interactive, workspace-write sandbox mode. It receives a
  minimal task contract and a secret-free environment.

## Safety and authority

Default permissions are `READ_WRITE_WORKSPACE` and `TERMINAL_SAFE`. Package
installation requires future approval wiring. Git remote mutations, push,
destructive Git, sudo, system mutation and secret-store access are denied.
Commits are forbidden by the task contract and detected by comparing Git HEAD
before and after the mission.

Noon records pre-existing dirty files and their fingerprints, then computes
agent changes separately. Out-of-scope files, private paths, secrets, weakened
tests, deleted tests, removed assertions, disabled lint/type checks, silent
catches, debug leftovers and unexpectedly large diffs prevent a PASS verdict.

Cancellation and timeout stop the adapter process without resetting the
workspace. Crash recovery is inspection-only and requires a user decision;
write execution never resumes automatically.

## Privacy and observability

The specialist receives the objective, scoped paths, constraints and applicable
project instruction file references. It does not receive Noon memory, personal
connectors, conversation history or provider credentials. The child process
environment is allowlisted and excludes provider keys, OAuth values and other
application secrets.

General observability contains only task and agent identifiers, DEV metadata,
durations, iteration and command counts, changed-file count, validation status,
known cost values, success and failure category. Prompt, response and file
contents are excluded.

`specialistAgentDelegation` defaults to `OFF`, supports a `LIMITED` rollout and
is an immediate kill switch. The canonical runtime injects the Codex runner into
`DelegationEngine`, but `runDevTask` refuses execution unless the effective mode
passed by its caller is exactly `LIMITED`. No automatic conversational route or
user endpoint is enabled in V2.5. Disabling the flag restores the previous Noon
path with no migration and no effect on V2.4 routing.

## Current limitations

Codex CLI does not expose a reliable monetary cost for this local invocation,
so `estimatedCost` and `actualCost` remain `null` rather than a fabricated zero.
The sandbox and task policy forbid secret access, but OS-level per-file read
denial is not provided by this CLI integration; repositories delegated to a
remote agent must therefore remain explicitly scoped and free of required
plaintext secrets. Cursor has no verified specialist interface in this V2.5
implementation and remains future-only.
