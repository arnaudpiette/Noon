"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  createNativeDevReasoner,
  createNativeDevStructuredExecutor,
} = require("../services/dev/native-dev-reasoner");

test("5.0D-4A le Structured Executor transmet maxProviderCalls au ledger DEV", async () => {
  const reservations = [];

  const executor = createNativeDevStructuredExecutor({
    featureFlags: {
      evaluate() {
        return { enabled: false };
      },
    },
    budgetService: {
      snapshot() {
        return { task: { remaining: 1 } };
      },
      effectiveRemaining() {
        return 1;
      },
      reserve(input) {
        reservations.push(structuredClone(input));
        return { reservationId: "reservation-1" };
      },
      reconcile() {},
      markUnknown() {},
    },
    selectModelRoute() {
      return {
        provider: "openai",
        model: "fixture-model",
        effort: "low",
        verbosity: "low",
        reasonCodes: [],
        estimatedCost: { status: "available", total: 0.1 },
      };
    },
    estimateCost() {
      return { status: "available", total: 0.1 };
    },
    authorizePrivacy() {
      return {};
    },
    providerAdapter: {
      async execute() {
        return {
          text: JSON.stringify({ ok: true }),
          provider: "openai",
          model: "fixture-model",
          usage: {
            inputTokens: 10,
            cachedInputTokens: 0,
            outputTokens: 5,
            totalTokens: 15,
          },
        };
      },
    },
  });

  const result = await executor({
    taskDomain: "DEV",
    requiredQuality: "NORMAL",
    maxEstimatedCost: 1,
    maxProviderCalls: 2,
    enforceTaskBudget: true,
    schema: {
      type: "object",
      properties: { ok: { type: "boolean" } },
      required: ["ok"],
      additionalProperties: false,
    },
    schemaName: "quota_fixture",
    system: "fixture",
    payload: {
      taskId: "task-quota",
      phase: "PLAN",
      objective: "Fixture",
      workspaceId: "workspace-noon",
    },
  });

  assert.equal(result.result.ok, true);
  assert.equal(reservations.length, 1);
  assert.equal(reservations[0].maxProviderCalls, 2);
});

test("5.0D-4A NativeDevReasoner propage la quota du contrat sans l'élargir", async () => {
  const received = [];

  const reasoner = createNativeDevReasoner({
    async executeStructured(input) {
      received.push(structuredClone(input));
      return {
        result: {
          summary: "ok",
          files: [],
          searchTerms: [],
          operations: [],
          validationCommands: [],
        },
        metadata: null,
      };
    },
  });

  await reasoner.reason({
    phase: "PLAN",
    contract: {
      taskId: "task-quota",
      objective: "Fixture",
      workspaceId: "workspace-noon",
      repositoryRoot: "/tmp/repository",
      constraints: [],
      projectInstructions: [],
      allowedPaths: ["/tmp/repository"],
      localOnly: false,
      maxEstimatedCost: 1,
      maxProviderCalls: 2,
      requiredQuality: "NORMAL",
      enforceTaskBudget: true,
    },
    preflight: {},
    files: [],
    searchResults: [],
  });

  assert.equal(received.length, 1);
  assert.equal(received[0].maxProviderCalls, 2);
});
