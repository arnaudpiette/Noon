"use strict";

const {
  createCodebaseAnalyst,
} = require("./codebase-analyst");

const {
  createDevTaskContract,
} = require("../../delegation/dev-task-contract");

const {
  repositoryPreflight,
} = require("../../delegation/repository-preflight");

function workspaceInput(
  workspaceEngine,
  input
) {
  if (
    input.workspaceAuthorized === true &&
    Array.isArray(input.workspaceRoots) &&
    input.workspaceRoots.length
  ) {
    return input;
  }

  const workspace =
    workspaceEngine.context(
      input.workspaceId
    );

  const roots = (
    workspace.relevantRoots ||
    workspace.roots ||
    []
  )
    .filter(
      (item) =>
        item.mode === "read-write"
    )
    .map(
      (item) => item.path
    );

  return {
    ...input,
    workspaceAuthorized:
      roots.length > 0,
    workspaceRoots: roots,
  };
}

function unique(items) {
  return [
    ...new Set(
      items.filter(Boolean)
    ),
  ];
}

function createNativeCodebaseAnalyst({
  workspaceEngine,
  now = () => Date.now(),
} = {}) {
  if (
    !workspaceEngine?.context
  ) {
    throw new TypeError(
      "WorkspaceEngine requis."
    );
  }

  return createCodebaseAnalyst({
    analyze: async (
      input = {}
    ) => {
      const started =
        now();

      const contract =
        createDevTaskContract(
          workspaceInput(
            workspaceEngine,
            input
          )
        );

      const preflight =
        repositoryPreflight(
          contract,
          {
            now,
          }
        );

      const defaultCommands =
        unique(
          contract
            .validationCommands
            .length
            ? contract
                .validationCommands
            : Object.values(
                preflight.commands
              ).filter(Boolean)
        );

      return {
        contract,
        preflight,
        defaultCommands,
        deadline:
          started +
          contract.maxDuration,
      };
    },
  });
}

module.exports = {
  createNativeCodebaseAnalyst,
};
