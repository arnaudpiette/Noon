"use strict";

// V3-L7 — projections publiques du service de terminal du workspace DEV (problèmes, diff git,
// terminal, session), état d'exécution et contrôles de terminal, sortis tels quels de
// workspace-terminal-service.js. Fonctions pures : aucune dépendance à l'état du service.

const { DevWorkspaceError, clean } = require("./workspace-terminal-shared");

function emptyProblems() {
  return {
    status: "EMPTY",
    source: null,
    command: null,
    terminalId: null,
    exitCode: null,
    counts: {
      total: 0,
      error: 0,
      warning: 0,
      info: 0,
    },
    truncated: false,
    problems: [],
  };
}

function publicProblems(value) {
  const problems =
    value || emptyProblems();

  return {
    status:
      problems.status,
    source:
      problems.source,
    command:
      problems.command,
    terminalId:
      problems.terminalId,
    exitCode:
      problems.exitCode,
    counts: {
      total:
        Number(
          problems.counts?.total
        ) || 0,
      error:
        Number(
          problems.counts?.error
        ) || 0,
      warning:
        Number(
          problems.counts?.warning
        ) || 0,
      info:
        Number(
          problems.counts?.info
        ) || 0,
    },
    truncated:
      Boolean(
        problems.truncated
      ),
    problems:
      Array.isArray(
        problems.problems
      )
        ? problems.problems.map(
            (problem) => ({
              ...problem,
            })
          )
        : [],
  };
}

function emptyGitDiff() {
  return {
    status: "UNCONFIGURED",
    branch: null,
    detached: false,
    counts: {
      total: 0,
      staged: 0,
      unstaged: 0,
      untracked: 0,
      conflicted: 0,
    },
    truncated: false,
    unsafeOmitted: 0,
    files: [],
  };
}

function publicGitDiff(value) {
  const gitDiff =
    value || emptyGitDiff();

  return {
    status:
      gitDiff.status,
    branch:
      gitDiff.branch || null,
    detached:
      Boolean(
        gitDiff.detached
      ),
    counts: {
      total:
        Number(
          gitDiff.counts?.total
        ) || 0,
      staged:
        Number(
          gitDiff.counts?.staged
        ) || 0,
      unstaged:
        Number(
          gitDiff.counts?.unstaged
        ) || 0,
      untracked:
        Number(
          gitDiff.counts?.untracked
        ) || 0,
      conflicted:
        Number(
          gitDiff.counts?.conflicted
        ) || 0,
    },
    truncated:
      Boolean(
        gitDiff.truncated
      ),
    unsafeOmitted:
      Math.max(
        0,
        Number(
          gitDiff.unsafeOmitted
        ) || 0
      ),
    files:
      Array.isArray(
        gitDiff.files
      )
        ? gitDiff.files.map(
            (file) => ({
              file:
                file.file,
              originalFile:
                file.originalFile ||
                null,
              indexStatus:
                file.indexStatus,
              worktreeStatus:
                file.worktreeStatus,
              changeType:
                file.changeType,
              status:
                file.status,
              staged:
                Boolean(
                  file.staged
                ),
              unstaged:
                Boolean(
                  file.unstaged
                ),
              untracked:
                Boolean(
                  file.untracked
                ),
              conflicted:
                Boolean(
                  file.conflicted
                ),
              sensitive:
                Boolean(
                  file.sensitive
                ),
            })
          )
        : [],
  };
}

function publicTerminal(terminal) {
  return {
    id: terminal.id,
    title: terminal.title,
    owner: terminal.owner,
    pid:
      terminal.child?.pid ||
      terminal.runner?.pid ||
      null,
    cwd: terminal.cwd,
    status: terminal.status,
    createdAt: terminal.createdAt,
    lastActivityAt: terminal.lastActivityAt,
    exitCode: terminal.exitCode,
    signal: terminal.signal,
    running: Boolean(
      terminal.child ||
      terminal.runner
    ),
    cleanupStatus:
      terminal.cleanupStatus ||
      null,
  };
}

function publicSession(session) {
  return {
    id: session.id,
    workspaceId: session.workspaceId,
    repositoryRoot: session.repositoryRoot,
    projectName: session.projectName,
    branch: session.branch,
    dirty: session.dirty,

    terminalSessions: [
      ...session.terminals.values(),
    ].map(publicTerminal),

    activeTerminalId: session.activeTerminalId,

    preview: {
      target: null,
      status: "UNCONFIGURED",
    },

    gitDiff:
      publicGitDiff(
        session.gitDiff
      ),

    problems:
      publicProblems(
        session.problems
      ),

    output: {
      status: "READY",
    },

    lastValidationState:
      session.lastValidationState,

    executionState:
      session.executionState,

    createdAt:
      session.createdAt,
  };
}

function refreshExecutionState(session) {
  session.executionState = [
    ...session.terminals.values(),
  ].some(
    (terminal) =>
      Boolean(
        terminal.child ||
        terminal.runner
      )
  )
    ? "RUNNING"
    : "READY";
}

function terminalFor(
  session,
  terminalId
) {
  const terminal = session.terminals.get(
    clean(terminalId, 160)
  );

  if (
    !terminal ||
    terminal.status === "CLOSED"
  ) {
    throw new DevWorkspaceError(
      "TERMINAL_NOT_FOUND",
      "Terminal introuvable."
    );
  }

  return terminal;
}

function assertTerminalOrigin(
  terminal,
  origin
) {
  const normalized = String(
    origin || terminal.owner
  ).toUpperCase();

  if (
    terminal.owner === "USER" &&
    normalized !== "USER"
  ) {
    throw new DevWorkspaceError(
      "USER_TERMINAL_AUTOMATION_DENIED",
      "Un terminal utilisateur ne peut pas recevoir une commande automatique."
    );
  }

  if (
    terminal.owner === "NOON" &&
    normalized !== "NOON"
  ) {
    throw new DevWorkspaceError(
      "NOON_TERMINAL_ORIGIN_DENIED",
      "Ce terminal est réservé à Noon."
    );
  }

  return normalized;
}

module.exports = {
  emptyProblems,
  publicProblems,
  emptyGitDiff,
  publicGitDiff,
  publicTerminal,
  publicSession,
  refreshExecutionState,
  terminalFor,
  assertTerminalOrigin,
};
