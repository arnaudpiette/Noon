"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawn, execFileSync } = require("node:child_process");

const { redactSecrets } = require("../security/redaction");
const { OUTCOMES } = require("../security/operational-security-policy");
const {
  COMMAND_CLASSES,
  classifyDevCommand,
} = require("../delegation/dev-command-policy");
const {
  inferDevProblemSource,
  parseDevProblems,
} = require("./dev-problems-service");

const {
  createDevGitDiffService,
} = require("./dev-git-diff-service");

const TERMINAL_STATUSES = Object.freeze([
  "IDLE",
  "RUNNING",
  "EXITED",
  "CLOSED",
]);

const TERMINAL_OWNERS = Object.freeze([
  "USER",
  "NOON",
]);

const MAX_COMMAND_LENGTH = 8_000;
const MAX_OUTPUT_CHUNK = 16_000;
const MAX_OUTPUT_EVENTS = 400;

class DevWorkspaceError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "DevWorkspaceError";
    this.code = code;
  }
}

function clean(value, max = 200) {
  return String(value || "")
    .replace(/[\0\r\n]+/g, " ")
    .trim()
    .slice(0, max);
}

function sanitizedTerminalEnvironment(source = process.env) {
  const allowed = [
    "PATH",
    "HOME",
    "LANG",
    "LC_ALL",
    "TERM",
  ];

  const environment = Object.fromEntries(
    allowed
      .filter((key) => source[key] != null)
      .map((key) => [key, source[key]])
  );

  environment.CI = "1";
  environment.NO_COLOR = "1";

  return environment;
}

function gitState(root) {
  try {
    return {
      branch:
        execFileSync(
          "git",
          ["-C", root, "branch", "--show-current"],
          {
            encoding: "utf8",
            timeout: 2_000,
            stdio: ["ignore", "pipe", "ignore"],
          }
        ).trim() || null,

      dirty: Boolean(
        execFileSync(
          "git",
          ["-C", root, "status", "--porcelain"],
          {
            encoding: "utf8",
            timeout: 2_000,
            stdio: ["ignore", "pipe", "ignore"],
          }
        ).trim()
      ),
    };
  } catch {
    return {
      branch: null,
      dirty: null,
    };
  }
}

function contractFor(classification) {
  return {
    SAFE_READ: "read",
    WORKSPACE_WRITE: "write",
    PACKAGE_INSTALL: "write",
    GIT_LOCAL: "write",
    REMOTE: "external",
    SYSTEM: "destructive",
    DESTRUCTIVE: "destructive",
  }[classification] || "external";
}

function actionFor(classification) {
  return `terminal_${String(classification || "").toLowerCase()}`;
}

function createDevWorkspaceTerminalService({
  workspaceEngine,
  operationalSecurityPolicy,
  gitDiffService =
    createDevGitDiffService(),
  observability = null,
  now = () => Date.now(),
  spawnProcess = spawn,
  environment = process.env,
} = {}) {
  if (!workspaceEngine?.context) {
    throw new TypeError("WorkspaceEngine requis.");
  }

  if (!operationalSecurityPolicy?.evaluate) {
    throw new TypeError("OperationalSecurityPolicy requise.");
  }

  if (
    !gitDiffService?.inspect ||
    !gitDiffService?.readDiff
  ) {
    throw new TypeError(
      "DevGitDiffService requis."
    );
  }

  const sessions = new Map();

  const emit = (event, metadata = {}) => {
    try {
      observability?.(event, metadata);
    } catch {}
  };

  const iso = () => new Date(now()).toISOString();

  function rootFor(workspaceId, requestedRoot = null) {
    const context = workspaceEngine.context(
      clean(workspaceId, 160)
    );

    const roots = (context.roots || [])
      .filter((root) => root?.path)
      .map((root) => {
        try {
          return {
            ...root,
            path: fs.realpathSync(root.path),
          };
        } catch {
          return null;
        }
      })
      .filter(Boolean);

    if (!roots.length) {
      throw new DevWorkspaceError(
        "WORKSPACE_ROOT_REQUIRED",
        "Cet espace DEV n’a aucun dépôt autorisé."
      );
    }

    let selected;

    if (requestedRoot) {
      let requestedReal;

      try {
        requestedReal = fs.realpathSync(
          String(requestedRoot)
        );
      } catch {
        throw new DevWorkspaceError(
          "WORKSPACE_ROOT_UNAVAILABLE",
          "Le dépôt demandé est indisponible."
        );
      }

      selected = roots.find(
        (root) => root.path === requestedReal
      );
    } else {
      selected = roots[0];
    }

    if (!selected) {
      throw new DevWorkspaceError(
        "WORKSPACE_ROOT_DENIED",
        "Le dépôt demandé n’est pas lié à cet espace autorisé."
      );
    }

    return {
      context,
      root: selected,
    };
  }

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
      pid: terminal.child?.pid || null,
      cwd: terminal.cwd,
      status: terminal.status,
      createdAt: terminal.createdAt,
      lastActivityAt: terminal.lastActivityAt,
      exitCode: terminal.exitCode,
      signal: terminal.signal,
      running: Boolean(terminal.child),
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
    ].some((terminal) => Boolean(terminal.child))
      ? "RUNNING"
      : "READY";
  }

  function createSession(input = {}) {
    const { context, root } = rootFor(
      input.workspaceId,
      input.repositoryRoot
    );

    const id =
      `dev-workspace-${crypto.randomUUID()}`;

    const git = gitState(root.path);

    const session = {
      id,
      workspaceId: context.workspaceId,
      repositoryRoot: root.path,
      rootMode: root.mode,
      projectName:
        context.activeProject?.name ||
        context.displayName,
      branch: git.branch,
      dirty: git.dirty,
      terminals: new Map(),
      activeTerminalId: null,
      gitDiff:
        emptyGitDiff(),
      activeGitDiffRunId: null,
      problems:
        emptyProblems(),
      activeProblemsRunId: null,
      lastValidationState: null,
      executionState: "READY",
      createdAt: iso(),
    };

    sessions.set(id, session);

    emit("dev_workspace_created", {
      workspaceId: session.workspaceId,
    });

    return publicSession(session);
  }

  function requireSession(id) {
    const session = sessions.get(
      clean(id, 160)
    );

    if (!session) {
      throw new DevWorkspaceError(
        "DEV_WORKSPACE_NOT_FOUND",
        "Session DEV introuvable."
      );
    }

    return session;
  }

  function createTerminal(input = {}) {
    const session = requireSession(
      input.sessionId
    );

    const owner = String(
      input.owner || "USER"
    ).toUpperCase();

    if (!TERMINAL_OWNERS.includes(owner)) {
      throw new DevWorkspaceError(
        "TERMINAL_OWNER_INVALID",
        "Propriétaire de terminal invalide."
      );
    }

    const terminal = {
      id: `terminal-${crypto.randomUUID()}`,
      title: clean(
        input.title ||
          `Terminal ${session.terminals.size + 1}`,
        80
      ),
      owner,
      cwd: session.repositoryRoot,
      status: "IDLE",
      createdAt: iso(),
      lastActivityAt: iso(),
      exitCode: null,
      signal: null,
      cancelReason: null,
      child: null,
      output: [],
      outputCursor: 0,
    };

    session.terminals.set(
      terminal.id,
      terminal
    );

    session.activeTerminalId =
      terminal.id;

    emit("dev_terminal_created", {
      workspaceId: session.workspaceId,
      terminalId: terminal.id,
      owner,
    });

    return publicTerminal(terminal);
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

  function append(terminal, type, text) {
    const value = redactSecrets(
      String(text || "")
    ).slice(0, MAX_OUTPUT_CHUNK);

    if (!value) {
      return;
    }

    terminal.outputCursor += 1;

    terminal.output.push({
      sequence: terminal.outputCursor,
      type,
      text: value,
      at: iso(),
    });

    if (
      terminal.output.length >
      MAX_OUTPUT_EVENTS
    ) {
      terminal.output.splice(
        0,
        terminal.output.length -
          MAX_OUTPUT_EVENTS
      );
    }

    terminal.lastActivityAt = iso();
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

  function policyFor(
    session,
    classification
  ) {
    const readOnly =
      session.rootMode !== "read-write";

    const mutating =
      classification !== "SAFE_READ";

    if (readOnly && mutating) {
      throw new DevWorkspaceError(
        "WORKSPACE_READ_ONLY",
        "Ce workspace est en lecture seule."
      );
    }

    const decision =
      operationalSecurityPolicy.evaluate({
        actionRequest: {
          origin: "trusted_ui",
          skillId: "terminal",
          operation:
            actionFor(classification),
          args: {
            path:
              session.repositoryRoot,
          },
          workspaceId:
            session.workspaceId,
          explicitOrder: true,
          localOnly: true,
        },

        skillPolicy: {
          level:
            contractFor(classification),
          networkAccess:
            classification === "REMOTE",
          destructive:
            classification ===
            "DESTRUCTIVE",
        },

        currentPermissions: {
          allowed:
            classification ===
              "SAFE_READ" ||
            session.rootMode ===
              "read-write",

          code:
            session.rootMode ===
            "read-write"
              ? "READ_WRITE_WORKSPACE"
              : "READ_ONLY_WORKSPACE",
        },
      });

    if (
      ![
        OUTCOMES.ALLOW,
        OUTCOMES.ALLOW_WITH_CONSTRAINTS,
      ].includes(decision.outcome)
    ) {
      throw new DevWorkspaceError(
        decision.requiredApproval
          ? "TERMINAL_APPROVAL_REQUIRED"
          : "TERMINAL_COMMAND_DENIED",

        decision.requiredApproval
          ? "Cette commande exige une approbation Noon."
          : "Cette commande est refusée par la politique Noon."
      );
    }

    return decision;
  }

  function runCommand(input = {}) {
    const session = requireSession(
      input.sessionId
    );

    const terminal = terminalFor(
      session,
      input.terminalId
    );

    if (terminal.child) {
      throw new DevWorkspaceError(
        "TERMINAL_BUSY",
        "Ce terminal exécute déjà une commande."
      );
    }

    assertTerminalOrigin(
      terminal,
      input.origin
    );

    const command = String(
      input.command || ""
    ).trim();

    if (
      !command ||
      command.length >
        MAX_COMMAND_LENGTH
    ) {
      throw new DevWorkspaceError(
        "COMMAND_INVALID",
        "Commande terminal invalide."
      );
    }

    const commandDecision =
      classifyDevCommand(command);

    if (
      commandDecision.allowed !== true ||
      !Array.isArray(
        commandDecision.execution
      ) ||
      typeof
        commandDecision.execution[0] !==
        "string" ||
      !Array.isArray(
        commandDecision.execution[1]
      )
    ) {
      throw new DevWorkspaceError(
        commandDecision.reasonCode ||
          "COMMAND_NOT_ALLOWLISTED",
        "Cette commande n’est pas autorisée dans le terminal DEV."
      );
    }

    policyFor(
      session,
      commandDecision.classification
    );

    const [
      executable,
      args,
    ] = commandDecision.execution;

    const startedAt = now();

    const outputStartCursor =
      terminal.outputCursor;

    const problemRunId =
      commandDecision.classification ===
      "SAFE_READ"
        ? crypto.randomUUID()
        : null;

    terminal.status = "RUNNING";
    terminal.exitCode = null;
    terminal.signal = null;

    append(
      terminal,
      "input",
      `$ ${command}`
    );

    let child;

    try {
      child = spawnProcess(
        executable,
        [...args],
        {
          cwd: terminal.cwd,
          env:
            sanitizedTerminalEnvironment(
              environment
            ),
          stdio: [
            "ignore",
            "pipe",
            "pipe",
          ],
          detached: false,
          shell: false,
        }
      );
    } catch (error) {
      terminal.status = "EXITED";

      append(
        terminal,
        "stderr",
        error?.message ||
          "Impossible de démarrer la commande."
      );

      throw new DevWorkspaceError(
        "TERMINAL_SPAWN_FAILED",
        "Impossible de démarrer la commande."
      );
    }

    terminal.child = child;

    if (
      commandDecision.classification ===
      "SAFE_READ"
    ) {
      session.activeProblemsRunId =
        problemRunId;

      session.problems = {
        status: "RUNNING",
        source:
          inferDevProblemSource(
            command
          ),
        command,
        terminalId:
          terminal.id,
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

    refreshExecutionState(session);

    let finalized = false;

    const finalize = (
      code,
      signal,
      error = null
    ) => {
      if (finalized) return;
      finalized = true;

      terminal.child = null;

      if (
        terminal.status !== "CLOSED"
      ) {
        terminal.status = "EXITED";
      }

      terminal.exitCode =
        Number.isInteger(code)
          ? code
          : null;

      terminal.signal =
        signal || null;

      terminal.lastActivityAt =
        iso();

      if (
        commandDecision.classification ===
          "SAFE_READ" &&
        session.activeProblemsRunId ===
          problemRunId
      ) {
        const commandOutput =
          terminal.output.filter(
            (event) =>
              event.sequence >
              outputStartCursor
          );

        const parsedProblems =
          parseDevProblems({
            command,
            repositoryRoot:
              session.repositoryRoot,
            exitCode:
              terminal.exitCode,
            output:
              commandOutput,
          });

        if (terminal.cancelReason === "USER_CANCELLED") {
          parsedProblems.status = "CANCELLED";
        } else if ((error || terminal.signal) && parsedProblems.status === "EMPTY") {
          parsedProblems.status =
            "UNRESOLVED";
        }

        session.problems = {
          ...parsedProblems,
          terminalId:
            terminal.id,
        };

        session.activeProblemsRunId =
          null;
      }

      session.lastValidationState = {
        command:
          commandDecision.classification ===
          "SAFE_READ"
            ? command
            : null,

        classification:
          commandDecision.classification,

        reasonCode:
          commandDecision.reasonCode,

        exitCode:
          terminal.exitCode,

        signal:
          terminal.signal,

        durationMs:
          now() - startedAt,

        status:
          terminal.cancelReason === "USER_CANCELLED"
            ? "CANCELLED"
            : error
            ? "FAILED"
            : terminal.exitCode === 0
              ? "PASS"
              : "FAIL",
      };

      refreshExecutionState(session);

      emit("dev_terminal_exited", {
        workspaceId:
          session.workspaceId,
        terminalId:
          terminal.id,
        owner:
          terminal.owner,
        classification:
          commandDecision.classification,
        exitCode:
          terminal.exitCode,
        signal:
          terminal.signal,
        durationMs:
          now() - startedAt,
      });
    };

    child.stdout?.on(
      "data",
      (chunk) =>
        append(
          terminal,
          "stdout",
          chunk
        )
    );

    child.stderr?.on(
      "data",
      (chunk) =>
        append(
          terminal,
          "stderr",
          chunk
        )
    );

    child.once?.(
      "error",
      (error) => {
        append(
          terminal,
          "stderr",
          error?.message ||
            "Erreur terminal."
        );

        finalize(
          null,
          null,
          error
        );
      }
    );

    child.once?.(
      "close",
      (code, signal) => {
        finalize(
          code,
          signal
        );
      }
    );

    return {
      terminal:
        publicTerminal(terminal),

      classification:
        commandDecision.classification,

      reasonCode:
        commandDecision.reasonCode,

      execution: {
        executable,
        args: [...args],
      },
    };
  }

  function poll(input = {}) {
    const terminal = terminalFor(
      requireSession(input.sessionId),
      input.terminalId
    );

    const from = Math.max(
      0,
      Number(input.from) || 0
    );

    const output = terminal.output
      .filter(
        (event) =>
          event.sequence > from
      )
      .map(
        ({
          sequence: _sequence,
          ...event
        }) => event
      );

    return {
      terminal: publicTerminal(terminal),
      output,
      next: terminal.outputCursor,
    };
  }

  function closeTerminal(
    input = {}
  ) {
    const session = requireSession(
      input.sessionId
    );

    const terminal = terminalFor(
      session,
      input.terminalId
    );

    const child =
      terminal.child;

    terminal.status = "CLOSED";
    terminal.cancelReason = input.reason === "USER_CANCELLED" ? "USER_CANCELLED" : null;
    terminal.child = null;
    terminal.lastActivityAt = iso();

    if (
      child &&
      !child.killed
    ) {
      try {
        child.kill("SIGTERM");
      } catch {}
    }

    if (
      session.activeTerminalId ===
      terminal.id
    ) {
      session.activeTerminalId = [
        ...session.terminals.values(),
      ].find(
        (item) =>
          item.status !== "CLOSED"
      )?.id || null;
    }

    refreshExecutionState(session);

    emit("dev_terminal_closed", {
      workspaceId:
        session.workspaceId,
      terminalId:
        terminal.id,
      owner:
        terminal.owner,
    });

    return {
      closed: true,
      activeTerminalId:
        session.activeTerminalId,
    };
  }

  async function inspectGitDiff(
    input = {}
  ) {
    const session =
      requireSession(
        input.sessionId
      );

    const runId =
      crypto.randomUUID();

    session.activeGitDiffRunId =
      runId;

    try {
      const result =
        await gitDiffService.inspect({
          repositoryRoot:
            session.repositoryRoot,
        });

      const counts = {
        total:
          Number(
            result.counts?.total
          ) || 0,
        staged:
          Number(
            result.counts?.staged
          ) || 0,
        unstaged:
          Number(
            result.counts?.unstaged
          ) || 0,
        untracked:
          Number(
            result.counts?.untracked
          ) || 0,
        conflicted:
          Number(
            result.counts?.conflicted
          ) || 0,
      };

      const unsafeOmitted =
        Math.max(
          0,
          Number(
            result.unsafeOmitted
          ) || 0
        );

      const nextGitDiff = {
        status:
          counts.total > 0 ||
          unsafeOmitted > 0
            ? "READY"
            : "EMPTY",
        branch:
          result.branch || null,
        detached:
          Boolean(
            result.detached
          ),
        counts,
        truncated:
          Boolean(
            result.truncated
          ),
        unsafeOmitted,
        files:
          Array.isArray(
            result.files
          )
            ? result.files
            : [],
      };

      if (
        session.activeGitDiffRunId ===
        runId
      ) {
        session.activeGitDiffRunId =
          null;

        session.gitDiff =
          nextGitDiff;

        session.branch =
          result.branch || null;

        session.dirty =
          counts.total > 0 ||
          unsafeOmitted > 0;

        emit(
          "dev_git_diff_inspected",
          {
            workspaceId:
              session.workspaceId,
            changedFiles:
              counts.total,
            truncated:
              nextGitDiff.truncated,
            unsafeOmitted,
          }
        );
      } else {
        emit(
          "dev_git_diff_stale_ignored",
          {
            workspaceId:
              session.workspaceId,
          }
        );
      }

      return publicGitDiff(
        session.gitDiff
      );
    } catch (error) {
      if (
        session.activeGitDiffRunId ===
        runId
      ) {
        session.activeGitDiffRunId =
          null;

        session.gitDiff = {
          ...emptyGitDiff(),
          status: "UNAVAILABLE",
        };

        emit(
          "dev_git_diff_failed",
          {
            workspaceId:
              session.workspaceId,
            code:
              error?.code ||
              "GIT_READ_FAILED",
          }
        );
      } else {
        emit(
          "dev_git_diff_stale_ignored",
          {
            workspaceId:
              session.workspaceId,
          }
        );
      }

      throw error;
    }
  }

  async function readGitDiff(
    input = {}
  ) {
    const session =
      requireSession(
        input.sessionId
      );

    const result =
      await gitDiffService.readDiff({
        repositoryRoot:
          session.repositoryRoot,
        file:
          input.file,
        scope:
          input.scope,
      });

    emit(
      "dev_git_diff_file_read",
      {
        workspaceId:
          session.workspaceId,
        status:
          result?.status ||
          null,
        scope:
          result?.scope ||
          null,
        sensitive:
          Boolean(
            result?.sensitive
          ),
        truncated:
          Boolean(
            result?.truncated
          ),
      }
    );

    return result;
  }

  function completionEntryAllowed(
    name
  ) {
    const value =
      String(name || "");

    if (!value) {
      return false;
    }

    if (
      value === ".git" ||
      value === "node_modules" ||
      value === ".DS_Store"
    ) {
      return false;
    }

    if (
      /^\.env(?:\.|$)/i.test(value) ||
      /^(?:id_rsa|id_ed25519)$/i.test(value) ||
      /\.(?:pem|key|p12|pfx)$/i.test(value)
    ) {
      return false;
    }

    if (
      /(?:^|[._-])(?:secret|secrets|credential|credentials|token|tokens)(?:[._-]|$)/i.test(
        value
      )
    ) {
      return false;
    }

    return true;
  }

  function realPathInsideRepository(
    repositoryRoot,
    requestedPath
  ) {
    const rootReal =
      fs.realpathSync(
        repositoryRoot
      );

    const resolved =
      path.resolve(
        rootReal,
        requestedPath || "."
      );

    if (
      resolved !== rootReal &&
      !resolved.startsWith(
        rootReal + path.sep
      )
    ) {
      return null;
    }

    let real;

    try {
      real =
        fs.realpathSync(
          resolved
        );
    } catch {
      return null;
    }

    if (
      real !== rootReal &&
      !real.startsWith(
        rootReal + path.sep
      )
    ) {
      return null;
    }

    return real;
  }

  function readPackageScripts(
    repositoryRoot
  ) {
    const packagePath =
      realPathInsideRepository(
        repositoryRoot,
        "package.json"
      );

    if (!packagePath) {
      return [];
    }

    try {
      const stat =
        fs.statSync(
          packagePath
        );

      if (
        !stat.isFile() ||
        stat.size > 512 * 1024
      ) {
        return [];
      }

      const parsed =
        JSON.parse(
          fs.readFileSync(
            packagePath,
            "utf8"
          )
        );

      if (
        !parsed?.scripts ||
        typeof parsed.scripts !==
          "object"
      ) {
        return [];
      }

      return Object.keys(
        parsed.scripts
      )
        .filter(
          (name) =>
            typeof name === "string" &&
            name.trim()
        )
        .slice(0, 80);
    } catch {
      return [];
    }
  }

  function listRepositoryCompletions({
    repositoryRoot,
    query,
  }) {
    const value =
      String(query || "")
        .slice(0, 1000);

    const trimmed =
      value.trim();

    if (!trimmed) {
      return [];
    }

    const suggestions = [];
    const seen = new Set();

    const add = (candidate) => {
      const item =
        String(candidate || "");

      if (
        !item ||
        seen.has(item)
      ) {
        return;
      }

      seen.add(item);
      suggestions.push(item);
    };

    // ------------------------------------------
    // npm run <script>
    // ------------------------------------------

    const lower =
      trimmed.toLowerCase();

    for (
      const script of
      readPackageScripts(
        repositoryRoot
      )
    ) {
      const candidate =
        `npm run ${script}`;

      if (
        candidate
          .toLowerCase()
          .startsWith(lower)
      ) {
        add(candidate);
      }
    }

    // npm test est une forme spéciale courante.
    if (
      "npm test".startsWith(lower)
    ) {
      add("npm test");
    }

    // ------------------------------------------
    // Fichiers / dossiers repo-only
    // ------------------------------------------

    const pathCommand =
      /^(?:cd|ls|cat|less|head|tail|node|python|python3|open|code|vim|nano)\s+/i.test(
        trimmed
      );

    const tokenMatch =
      value.match(
        /([^\s]+)$/
      );

    const token =
      tokenMatch
        ? tokenMatch[1]
        : "";

    const standalonePath =
      token === trimmed &&
      (
        token.startsWith(".") ||
        token.includes("/")
      );

    if (
      token &&
      (
        pathCommand ||
        standalonePath
      )
    ) {
      const slashIndex =
        token.lastIndexOf("/");

      const directoryToken =
        slashIndex >= 0
          ? token.slice(
              0,
              slashIndex + 1
            )
          : "";

      const basename =
        slashIndex >= 0
          ? token.slice(
              slashIndex + 1
            )
          : token;

      const directory =
        realPathInsideRepository(
          repositoryRoot,
          directoryToken || "."
        );

      if (directory) {
        try {
          const entries =
            fs.readdirSync(
              directory,
              {
                withFileTypes: true,
              }
            )
              .filter((entry) =>
                completionEntryAllowed(
                  entry.name
                )
              )
              .sort(
                (a, b) => {
                  const ad =
                    a.isDirectory()
                      ? 0
                      : 1;

                  const bd =
                    b.isDirectory()
                      ? 0
                      : 1;

                  if (ad !== bd) {
                    return ad - bd;
                  }

                  return a.name.localeCompare(
                    b.name
                  );
                }
              )
              .slice(0, 120);

          const commandPrefix =
            value.slice(
              0,
              value.length -
                token.length
            );

          for (
            const entry of entries
          ) {
            if (
              basename &&
              !entry.name
                .toLowerCase()
                .startsWith(
                  basename.toLowerCase()
                )
            ) {
              continue;
            }

            const lexicalChild =
              path.join(
                directory,
                entry.name
              );

            const realChild =
              realPathInsideRepository(
                repositoryRoot,
                path.relative(
                  repositoryRoot,
                  lexicalChild
                )
              );

            // Symlink hors repo = ignoré.
            if (!realChild) {
              continue;
            }

            let directoryEntry =
              entry.isDirectory();

            if (
              entry.isSymbolicLink()
            ) {
              try {
                directoryEntry =
                  fs.statSync(
                    realChild
                  ).isDirectory();
              } catch {
                continue;
              }
            }

            const completedToken =
              `${directoryToken}${entry.name}${
                directoryEntry
                  ? "/"
                  : ""
              }`;

            add(
              commandPrefix +
                completedToken
            );

            if (
              suggestions.length >= 40
            ) {
              break;
            }
          }
        } catch {
          // Completion ergonomique seulement :
          // une lecture impossible ne bloque pas le terminal.
        }
      }
    }

    return suggestions.slice(
      0,
      40
    );
  }

  function getCompletions(
    input = {}
  ) {
    const session =
      requireSession(
        input.sessionId
      );

    const completions =
      listRepositoryCompletions({
        repositoryRoot:
          session.repositoryRoot,
        query:
          input.query,
      });

    emit(
      "dev_terminal_completion_read",
      {
        workspaceId:
          session.workspaceId,
        count:
          completions.length,
      }
    );

    return {
      completions,
    };
  }

  function closeSession(id) {
    const session =
      requireSession(id);

    for (
      const terminal of
      session.terminals.values()
    ) {
      const child =
        terminal.child;

      terminal.status =
        "CLOSED";

      terminal.child = null;

      if (
        child &&
        !child.killed
      ) {
        try {
          child.kill("SIGTERM");
        } catch {}
      }
    }

    sessions.delete(
      session.id
    );

    return {
      closed: true,
    };
  }

  return {
    createSession,
    getSession: (id) =>
      publicSession(
        requireSession(id)
      ),
    inspectGitDiff,
    readGitDiff,
    getCompletions,
    createTerminal,
    runCommand,
    poll,
    closeTerminal,
    closeSession,
    commandClasses:
      COMMAND_CLASSES,
    terminalOwners:
      TERMINAL_OWNERS,
  };
}

module.exports = {
  COMMAND_CLASSES,
  DevWorkspaceError,
  TERMINAL_OWNERS,
  TERMINAL_STATUSES,
  createDevWorkspaceTerminalService,
  sanitizedTerminalEnvironment,
};
