"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { after, test } = require("node:test");

const {
  projectNativeDevEvidence,
} = require("../services/decision/dev-evidence-adapter");

const {
  normalizeDecisionRequestV2,
} = require("../services/decision/decision-schema");

const {
  evidenceEligibilityV2,
} = require("../services/decision/decision-support-engine");

const {
  adaptNativeDevResult,
} = require("../services/dev/native-dev-result-adapter");

const {
  createNativeDevOrchestrator,
} = require("../services/dev/native-dev-orchestrator");

const {
  createNativeDevImplementationEngine,
} = require("../services/dev/native-dev-implementation-engine");

const {
  createNativeReviewValidationAgent,
} = require("../services/dev/agents/native-review-validation-agent");

const {
  createDevTaskContract,
} = require("../services/delegation/dev-task-contract");

const {
  repositoryPreflight,
} = require("../services/delegation/repository-preflight");

const {
  createSkillRegistry,
} = require("../skills/registry");

function repository() {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "noon-decision-dev-evidence-")
  );

  execFileSync("git", ["init", "-q"], { cwd: root });
  execFileSync(
    "git",
    ["config", "user.email", "fixture@example.test"],
    { cwd: root }
  );
  execFileSync(
    "git",
    ["config", "user.name", "Fixture"],
    { cwd: root }
  );
  fs.writeFileSync(
    path.join(root, "a.js"),
    "module.exports = 1;\n"
  );
  execFileSync("git", ["add", "a.js"], { cwd: root });
  execFileSync("git", ["commit", "-qm", "fixture"], { cwd: root });

  return root;
}

function validation(command, status = "PASS") {
  return {
    command,
    status,
    exitCode: status === "PASS" ? 0 : 1,
    outputTail: "PRIVATE_OUTPUT",
    outputTruncated: false,
    cleanupConfirmed: true,
  };
}

async function buildFixture({
  functionalStatus = "PASS",
  mutateAfterFunctional = false,
} = {}) {
  const root = repository();
  const functionalCommand =
    "node --test test/fixture.test.js";
  const calls = [];
  const skillRegistry = createSkillRegistry();

  const orchestrator = createNativeDevOrchestrator({
    workspaceEngine: {
      context: () => ({
        roots: [
          {
            path: root,
            mode: "read-write",
          },
        ],
      }),
    },

    transactionalExecutionEngine: {
      async execute({ steps, executeStep }) {
        return {
          status: "SUCCEEDED",
          result: await executeStep(steps[0]),
        };
      },
    },

    operationalSecurityPolicy: {
      evaluate: () => ({
        outcome: "ALLOW",
        policyVersion: "fixture",
      }),
    },

    skillRegistry,

    reasoner: {
      async reason({ phase, files }) {
        if (phase === "PLAN") {
          return {
            files: ["a.js"],
          };
        }

        return {
          operations: [
            {
              type: "MODIFY",
              path: "a.js",
              expectedHash: files[0].hash,
              search: "module.exports = 1;",
              replacement: "module.exports = 2;",
            },
          ],
          validationCommands: [
            functionalCommand,
          ],
        };
      },
    },

    journal: {
      start() {},
      transition() {},
      finish() {},
      recordRead() {},
      recordFileOperation() {},
      recordCommand(_taskId, result, iteration) {
        if (
          mutateAfterFunctional
          && iteration === 1
          && result.command === functionalCommand
        ) {
          fs.writeFileSync(
            path.join(root, "a.js"),
            "module.exports = 3;\n"
          );
        }
      },
    },

    validationRunner: async (command) => {
      calls.push(command);

      return validation(
        command,
        command === functionalCommand
          ? functionalStatus
          : "PASS"
      );
    },
  });

  const task = await orchestrator.runTask({
    taskId: `task-${functionalStatus.toLowerCase()}-fixture`,
    sessionId: `session-${functionalStatus.toLowerCase()}-fixture`,
    workspaceId: `workspace-${functionalStatus.toLowerCase()}-fixture`,
    repositoryRoot: root,
    objective: "Modifier a.js",
    validationCommands: ["npm test"],
    maxIterations: 1,
  });

  return {
    root,
    task,
    calls,
    adapted: adaptNativeDevResult(task),
  };
}

let passFixturePromise;
let failFixturePromise;

function passFixture() {
  passFixturePromise ||= buildFixture({
    functionalStatus: "PASS",
    mutateAfterFunctional: true,
  });

  return passFixturePromise;
}

function failFixture() {
  failFixturePromise ||= buildFixture({
    functionalStatus: "FAIL",
    mutateAfterFunctional: false,
  });

  return failFixturePromise;
}

after(async () => {
  for (const promise of [passFixturePromise, failFixturePromise]) {
    if (!promise) continue;

    const fixture = await promise;
    fs.rmSync(fixture.root, {
      recursive: true,
      force: true,
    });
  }
});

function decisionRequest(workspaceId, overrides = {}) {
  const base = {
    schemaVersion: 2,
    decisionId: "decision-dev-evidence",
    decisionType: "COMPARE",
    evaluationAt: "2026-10-10T20:00:00.000Z",
    scope: {
      profileScope: "owner",
      workspaceId,
      projectId: null,
      purpose: "LOCAL_ANALYSIS",
    },
    options: [
      {
        optionId: "option-a",
        label: "A",
        source: "CURRENT_STATE",
        assumptions: [],
        values: {},
      },
      {
        optionId: "option-b",
        label: "B",
        source: "USER_PROVIDED",
        assumptions: [],
        values: {},
      },
    ],
    criteria: [
      {
        criterionId: "terminal-check",
        label: "Terminal validation",
        type: "QUALITY",
        importance: "HIGH",
        direction: "MAXIMIZE",
        requiredEvidence: "VERIFIED",
        range: null,
      },
      {
        criterionId: "historical-check",
        label: "Historical validation",
        type: "QUALITY",
        importance: "MEDIUM",
        direction: "MAXIMIZE",
        requiredEvidence: "VERIFIED",
        range: null,
      },
      {
        criterionId: "current-check",
        label: "Current implementation validation",
        type: "QUALITY",
        importance: "HIGH",
        direction: "MAXIMIZE",
        requiredEvidence: "VERIFIED",
        range: null,
      },
      {
        criterionId: "failure-check",
        label: "Failure validation",
        type: "RISK",
        importance: "HIGH",
        direction: "MINIMIZE",
        requiredEvidence: "VERIFIED",
        range: null,
      },
    ],
    constraints: [],
    evidence: [],
    verificationProposals: [],
    recommendationRequested: true,
    outputMode: "BALANCED",
    contextVersion: "dev-evidence-v1",
  };

  return {
    ...base,
    ...overrides,
  };
}

function project(task, mappings, requestOverrides = {}) {
  const workspaceId =
    task.analysis.contract.workspaceId;

  return projectNativeDevEvidence({
    devResult: task,
    mappings,
    context: {
      decisionRequest:
        decisionRequest(
          workspaceId,
          requestOverrides
        ),
    },
  });
}

test(
  "terminal et validation d'implémentation MATCH deviennent des observations SYSTEM vérifiées et attestées",
  async () => {
    const fixture = await passFixture();

    const current =
      fixture.adapted
        .implementationValidationSnapshots
        .find(
          (item) =>
            item.terminalSnapshotMatch === "MATCH"
        );

    assert.ok(current);

    const result = project(
      fixture.task,
      [
        {
          source: "TERMINAL",
          optionId: "option-a",
          criterionId: "terminal-check",
        },
        {
          source: "IMPLEMENTATION",
          observationRef: current.observationRef,
          optionId: "option-a",
          criterionId: "current-check",
        },
      ]
    );

    assert.equal(result.evidence.length, 2);
    assert.equal(result.attestedEvidenceIds.length, 2);

    for (const item of result.evidence) {
      assert.equal(item.kind, "SYSTEM_OBSERVATION");
      assert.equal(item.authority, "SYSTEM");
      assert.equal(item.verificationStatus, "VERIFIED");
      assert.equal(item.stance, "SUPPORTS");
      assert.equal(item.value, true);
      assert.equal(item.localOnly, true);
      assert.equal(item.allowedForRemoteModel, false);
      assert.equal(item.untrustedContent, false);
      assert.equal(item.observedAt, null);
      assert.equal(item.validUntil, null);
      assert.equal(item.freshnessRequirement, "HISTORICAL");
    }

    const normalized =
      normalizeDecisionRequestV2({
        ...decisionRequest(
          fixture.task.analysis.contract.workspaceId
        ),
        evidence: result.evidence,
      });

    assert.equal(normalized.evidence.length, 2);

    for (const item of result.evidence) {
      const eligibility =
        evidenceEligibilityV2(
          item,
          normalized,
          {
            attestedEvidenceIds:
              result.attestedEvidenceIds,
          }
        );

      assert.equal(eligibility.eligible, true);
      assert.equal(eligibility.reasonCode, null);
    }
  }
);

test(
  "une validation historique DIFFERENT reste projetée mais ne devient jamais une preuve attestée",
  async () => {
    const fixture = await passFixture();

    const historical =
      fixture.adapted
        .implementationValidationSnapshots
        .find(
          (item) =>
            item.terminalSnapshotMatch === "DIFFERENT"
        );

    assert.ok(historical);

    const result = project(
      fixture.task,
      [
        {
          source: "IMPLEMENTATION",
          observationRef: historical.observationRef,
          optionId: "option-a",
          criterionId: "historical-check",
        },
      ]
    );

    assert.equal(result.evidence.length, 1);
    assert.equal(result.evidence[0].stance, "SUPPORTS");
    assert.equal(result.evidence[0].value, true);
    assert.equal(
      result.evidence[0].verificationStatus,
      "UNVERIFIED"
    );
    assert.deepEqual(result.attestedEvidenceIds, []);

    const normalized =
      normalizeDecisionRequestV2({
        ...decisionRequest(
          fixture.task.analysis.contract.workspaceId
        ),
        evidence: result.evidence,
      });

    const eligibility =
      evidenceEligibilityV2(
        result.evidence[0],
        normalized,
        {
          attestedEvidenceIds:
            result.attestedEvidenceIds,
        }
      );

    assert.equal(eligibility.eligible, false);
    assert.equal(
      eligibility.reasonCode,
      "EVIDENCE_NOT_ATTESTED"
    );
  }
);

test(
  "un FAIL canoniquement lié au snapshot terminal devient une observation SYSTEM vérifiée opposante",
  async () => {
    const root = repository();

    try {
      const contract = createDevTaskContract({
        taskId: "task-fail-match-fixture",
        sessionId: "session-fail-match-fixture",
        workspaceAuthorized: true,
        workspaceId: "workspace-fail-match-fixture",
        workspaceRoots: [root],
        repositoryRoot: root,
        objective: "Observer un FAIL stable",
      });

      const preflight = repositoryPreflight(contract);

      const implementationSnapshots = [];

      const implementationEngine =
        createNativeDevImplementationEngine({
          transactionalExecutionEngine: {
            async execute({ steps, executeStep }) {
              return {
                status: "SUCCEEDED",
                result: await executeStep(steps[0]),
              };
            },
          },

          operationalSecurityPolicy: {
            evaluate: () => ({
              outcome: "ALLOW",
              policyVersion: "fixture",
            }),
          },

          skillRegistry: {
            executeSkill: (_skillId, _args, context) =>
              context.handlers.runValidation(),
          },

          reasoner: {
            reason: async () => ({}),
          },

          journal: {
            start() {},
            recordCommand() {},
          },

          validationRunner: async (command) =>
            validation(command, "FAIL"),
        });

      const failedValidation =
        await implementationEngine.validate(
          contract,
          contract.taskId,
          "node --test test/fixture.test.js",
          1,
          null,
          {
            enabled: true,
            input: {
              taskId: contract.taskId,
              workspaceId: contract.workspaceId,
              sessionId: contract.sessionId,
            },
            ordinal: 1,
            record: (snapshot) =>
              implementationSnapshots.push(snapshot),
          }
        );

      assert.equal(failedValidation.status, "FAIL");
      assert.equal(implementationSnapshots.length, 1);
      assert.equal(
        implementationSnapshots[0].bindingState,
        "LINKED"
      );
      assert.equal(
        implementationSnapshots[0].validationStatus,
        "FAIL"
      );

      const implementation = {
        solved: true,
        touched: [],
        iterations: [
          {
            iteration: 1,
            changedFiles: [],
            validations: [failedValidation],
            validationSnapshots:
              implementationSnapshots,
          },
        ],
        validations: [failedValidation],
        providerCalls: [],
      };

      let terminalCalls = 0;

      const reviewAgent =
        createNativeReviewValidationAgent({
          journal: {
            start() {},
            transition() {},
            finish() {},
          },

          implementationEngine: {
            async validate(
              _contract,
              _taskId,
              command
            ) {
              terminalCalls += 1;

              assert.equal(
                command,
                "git diff --check"
              );

              return validation(
                command,
                "PASS"
              );
            },
          },
        });

      const review =
        await reviewAgent.reviewTask({
          taskId: contract.taskId,
          workspaceId: contract.workspaceId,
          sessionId: contract.sessionId,
          analysis: {
            contract,
            preflight,
          },
          implementation,
          baseline: [],
        });

      assert.equal(terminalCalls, 1);
      assert.equal(
        review.validationSnapshot.bindingState,
        "LINKED"
      );

      const devResult = {
        taskId: contract.taskId,
        finalVerdict: review.finalVerdict,
        analysis: {
          contract,
          preflight,
        },
        implementation,
        review,
      };

      const adapted =
        adaptNativeDevResult(devResult);

      const failed =
        adapted
          .implementationValidationSnapshots
          .find(
            (item) =>
              item.validationStatus === "FAIL"
              && item.bindingState === "LINKED"
              && item.terminalSnapshotMatch === "MATCH"
          );

      assert.ok(failed);

      const result = project(
        devResult,
        [
          {
            source: "IMPLEMENTATION",
            observationRef:
              failed.observationRef,
            optionId: "option-a",
            criterionId: "failure-check",
          },
        ]
      );

      assert.equal(result.evidence.length, 1);
      assert.equal(
        result.evidence[0].kind,
        "SYSTEM_OBSERVATION"
      );
      assert.equal(
        result.evidence[0].authority,
        "SYSTEM"
      );
      assert.equal(
        result.evidence[0].stance,
        "OPPOSES"
      );
      assert.equal(
        result.evidence[0].value,
        false
      );
      assert.equal(
        result.evidence[0].verificationStatus,
        "VERIFIED"
      );
      assert.deepEqual(
        result.attestedEvidenceIds,
        [result.evidence[0].evidenceId]
      );
    } finally {
      fs.rmSync(root, {
        recursive: true,
        force: true,
      });
    }
  }
);

test(
  "une enveloppe DEV forgée ne peut pas créer une attestation Decision",
  async () => {
    const fixture = await passFixture();
    const forged = structuredClone(fixture.task);

    forged.review.validationSnapshot.validationStatus =
      "FAIL";

    const result = project(
      forged,
      [
        {
          source: "TERMINAL",
          optionId: "option-a",
          criterionId: "terminal-check",
        },
      ]
    );

    assert.equal(result.evidence.length, 1);
    assert.equal(
      result.evidence[0].verificationStatus,
      "UNVERIFIED"
    );
    assert.equal(result.evidence[0].stance, "NEUTRAL");
    assert.equal(result.evidence[0].value, null);
    assert.deepEqual(result.attestedEvidenceIds, []);
  }
);

test(
  "scope distant, workspace divergent et références Decision invalides sont refusés",
  async () => {
    const fixture = await passFixture();

    assert.throws(
      () =>
        project(
          fixture.task,
          [
            {
              source: "TERMINAL",
              optionId: "option-a",
              criterionId: "terminal-check",
            },
          ],
          {
            scope: {
              ...decisionRequest(
                fixture.task.analysis.contract.workspaceId
              ).scope,
              purpose: "REMOTE_MODEL_CONTEXT",
            },
          }
        ),
      /limitée à LOCAL_ANALYSIS/
    );

    assert.throws(
      () =>
        projectNativeDevEvidence({
          devResult: fixture.task,
          mappings: [
            {
              source: "TERMINAL",
              optionId: "option-a",
              criterionId: "terminal-check",
            },
          ],
          context: {
            decisionRequest:
              decisionRequest("other-workspace"),
          },
        }),
      /workspace Native DEV ne correspond pas/
    );

    assert.throws(
      () =>
        project(
          fixture.task,
          [
            {
              source: "TERMINAL",
              optionId: "missing-option",
              criterionId: "terminal-check",
            },
          ]
        ),
      /aucune option Decision V2/
    );

    assert.throws(
      () =>
        project(
          fixture.task,
          [
            {
              source: "TERMINAL",
              optionId: "option-a",
              criterionId: "missing-criterion",
            },
          ]
        ),
      /aucun critère Decision V2/
    );
  }
);

test(
  "une validation ne peut pas être réutilisée, une cellule ne peut pas être doublée et les mappings sont bornés",
  async () => {
    const fixture = await passFixture();

    const current =
      fixture.adapted
        .implementationValidationSnapshots
        .find(
          (item) =>
            item.terminalSnapshotMatch === "MATCH"
        );

    assert.ok(current);

    assert.throws(
      () =>
        project(
          fixture.task,
          [
            {
              source: "TERMINAL",
              optionId: "option-a",
              criterionId: "terminal-check",
            },
            {
              source: "TERMINAL",
              optionId: "option-a",
              criterionId: "current-check",
            },
          ]
        ),
      /réutilise une même validation DEV/
    );

    assert.throws(
      () =>
        project(
          fixture.task,
          [
            {
              source: "TERMINAL",
              optionId: "option-a",
              criterionId: "terminal-check",
            },
            {
              source: "IMPLEMENTATION",
              observationRef: current.observationRef,
              optionId: "option-a",
              criterionId: "terminal-check",
            },
          ]
        ),
      /cellule Decision V2 déjà liée/
    );

    assert.throws(
      () =>
        project(
          fixture.task,
          [
            {
              source: "IMPLEMENTATION",
              observationRef:
                "native_dev_validation_00000000000000000000000000000000",
              optionId: "option-a",
              criterionId: "current-check",
            },
          ]
        ),
      /observation DEV inexistante/
    );

    assert.throws(
      () =>
        project(
          fixture.task,
          Array.from(
            { length: 101 },
            () => ({
              source: "TERMINAL",
              optionId: "option-a",
              criterionId: "terminal-check",
            })
          )
        ),
      /entre 1 et 100/
    );
  }
);

test(
  "la projection est déterministe par permutation, pure et sans contenu DEV brut",
  async () => {
    const fixture = await passFixture();

    const historical =
      fixture.adapted
        .implementationValidationSnapshots
        .find(
          (item) =>
            item.terminalSnapshotMatch === "DIFFERENT"
        );

    const current =
      fixture.adapted
        .implementationValidationSnapshots
        .find(
          (item) =>
            item.terminalSnapshotMatch === "MATCH"
        );

    assert.ok(historical);
    assert.ok(current);

    const mappings = [
      {
        source: "TERMINAL",
        optionId: "option-a",
        criterionId: "terminal-check",
      },
      {
        source: "IMPLEMENTATION",
        observationRef: historical.observationRef,
        optionId: "option-a",
        criterionId: "historical-check",
      },
      {
        source: "IMPLEMENTATION",
        observationRef: current.observationRef,
        optionId: "option-a",
        criterionId: "current-check",
      },
    ];

    const before = JSON.stringify(fixture.task);
    const first = project(fixture.task, mappings);
    const second = project(
      fixture.task,
      [...mappings].reverse()
    );

    assert.deepEqual(first, second);
    assert.equal(JSON.stringify(fixture.task), before);

    const serialized = JSON.stringify(first);

    for (const privateValue of [
      fixture.root,
      fixture.task.taskId,
      fixture.task.analysis.contract.sessionId,
      "PRIVATE_OUTPUT",
      "node --test",
      "a.js",
      "provenanceTag",
    ]) {
      assert.equal(
        serialized.includes(privateValue),
        false
      );
    }

    assert.equal(
      Object.hasOwn(first, "verdict"),
      false
    );
    assert.equal(
      Object.hasOwn(first, "actionAuthorized"),
      false
    );
    assert.equal(
      Object.hasOwn(first, "verificationAuthorized"),
      false
    );

    assert.ok(
      first.evidence.every(
        (item) =>
          item.localOnly === true
          && item.allowedForRemoteModel === false
      )
    );
  }
);
