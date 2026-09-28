"use strict";

const {
  createNativeCodebaseAnalyst,
} = require("./agents/native-codebase-analyst");

const {
  createNativeImplementationAgent,
} = require("./agents/native-implementation-agent");

const {
  createNativeReviewValidationAgent,
} = require("./agents/native-review-validation-agent");

const {
  createNativeDevImplementationEngine,
} = require("./native-dev-implementation-engine");

const {
  createDevOrchestrator,
} = require("./dev-orchestrator");

const {
  runSafeCommand,
} = require("./native-repository-tools");

function createNativeDevOrchestrator({
  workspaceEngine,
  transactionalExecutionEngine,
  operationalSecurityPolicy,
  skillRegistry,
  reasoner,
  journal,
  qualityEscalationMode = () =>
    "OFF",
  sameTierRepairAttempts = () =>
    2,
  observability = null,
  now = () => Date.now(),
  validationRunner = runSafeCommand,
  createTaskId,
} = {}) {
  if (!workspaceEngine?.context) {
    throw new TypeError(
      "WorkspaceEngine requis."
    );
  }

  if (
    !transactionalExecutionEngine
      ?.execute
  ) {
    throw new TypeError(
      "TransactionalExecutionEngine requis."
    );
  }

  if (
    !operationalSecurityPolicy
      ?.evaluate
  ) {
    throw new TypeError(
      "OperationalSecurityPolicy requise."
    );
  }

  if (
    !skillRegistry?.executeSkill
  ) {
    throw new TypeError(
      "SkillRegistry requis."
    );
  }

  if (!reasoner?.reason) {
    throw new TypeError(
      "Reasoner DEV requis."
    );
  }

  if (
    !journal?.start ||
    !journal?.transition ||
    !journal?.finish
  ) {
    throw new TypeError(
      "Journal DEV requis."
    );
  }

  const implementationEngine =
    createNativeDevImplementationEngine({
      transactionalExecutionEngine,
      operationalSecurityPolicy,
      skillRegistry,
      reasoner,
      journal,
      qualityEscalationMode,
      sameTierRepairAttempts,
      now,
      validationRunner,
    });

  const codebaseAnalyst =
    createNativeCodebaseAnalyst({
      workspaceEngine,
      now,
    });

  const implementationAgent =
    createNativeImplementationAgent({
      implementationEngine,
    });

  const reviewValidationAgent =
    createNativeReviewValidationAgent({
      implementationEngine,
      journal,
    });

  return createDevOrchestrator({
    codebaseAnalyst,
    implementationAgent,
    reviewValidationAgent,
    observability,
    now,
    ...(typeof createTaskId ===
    "function"
      ? {
          createTaskId,
        }
      : {}),
  });
}

module.exports = {
  createNativeDevOrchestrator,
};
