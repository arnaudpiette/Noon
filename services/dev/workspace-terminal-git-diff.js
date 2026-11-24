"use strict";

// V3-L7 — inspection et lecture du diff git d'une session de workspace DEV, sorties telles
// quelles de workspace-terminal-service.js. Le service construit ces opérations avec ses propres
// `emit`, `gitDiffService` et `requireSession` : même comportement, mêmes événements.

const crypto = require("node:crypto");
const { emptyGitDiff, publicGitDiff } = require("./workspace-terminal-projections");

function createWorkspaceGitDiffOperations({ emit, gitDiffService, requireSession }) {
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

  return { inspectGitDiff, readGitDiff };
}

module.exports = { createWorkspaceGitDiffOperations };
