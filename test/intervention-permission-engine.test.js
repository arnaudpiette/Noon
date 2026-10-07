"use strict";

const assert =
  require("node:assert/strict");

const test =
  require("node:test");

const {
  DECISIONS,
  fingerprintAction,
  createInterventionPermissionEngine,
} = require(
  "../services/security/intervention-permission-engine"
);

function engine() {
  return createInterventionPermissionEngine();
}

function allowed(
  actionRequest,
  extra = {}
) {
  return engine().evaluate({
    actionRequest,

    securityDecision: {
      outcome: "ALLOW",
      reasons: [],
    },

    profileScope: "arnaud",
    workspaceId: "workspace-a",

    ...extra,
  });
}

test(
  "DENY sécurité reste DENY",
  () => {
    const result =
      engine().evaluate({
        actionRequest: {
          actionClass: "EXECUTE",
          confirmationRequired: true,
        },

        securityDecision: {
          outcome: "DENY",
          reasons: [
            "TARGET_OUT_OF_SCOPE",
          ],
        },
      });

    assert.equal(
      result.decision,
      DECISIONS.DENY
    );

    assert.equal(
      result.executable,
      false
    );

    assert.equal(
      result.requiresApproval,
      false
    );

    assert.ok(
      result.reasons.includes(
        "TARGET_OUT_OF_SCOPE"
      )
    );
  }
);

test(
  "absence décision sécurité fail closed",
  () => {
    const result =
      engine().evaluate({
        actionRequest: {
          actionClass: "READ",
        },
      });

    assert.equal(
      result.decision,
      DECISIONS.DENY
    );

    assert.ok(
      result.reasons.includes(
        "SECURITY_DECISION_REQUIRED"
      )
    );
  }
);

test(
  "READ autorisé -> PROCEED",
  () => {
    const result =
      allowed({
        actionClass: "READ",
        operation:
          "read local file",
      });

    assert.equal(
      result.decision,
      DECISIONS.PROCEED
    );

    assert.equal(
      result.executable,
      true
    );
  }
);

test(
  "WRITE local autorisé -> PROCEED",
  () => {
    const result =
      allowed({
        actionClass: "WRITE",
        skillId:
          "noon_dev_apply_edit",

        operation:
          "update local file",

        target: {
          scope: "LOCAL",
          targetType: "file",
        },
      });

    assert.equal(
      result.decision,
      DECISIONS.PROCEED
    );
  }
);

test(
  "effet externe -> CONFIRM",
  () => {
    const result =
      allowed({
        actionClass: "EXECUTE",
        operation: "send email",
        externalSideEffect: true,
      });

    assert.equal(
      result.decision,
      DECISIONS.CONFIRM
    );

    assert.equal(
      result.requiresApproval,
      true
    );

    assert.equal(
      result.executable,
      false
    );
  }
);

test(
  "irréversible -> CONFIRM",
  () => {
    const result =
      allowed({
        actionClass: "EXECUTE",
        operation: "publish",
        irreversible: true,
      });

    assert.equal(
      result.decision,
      DECISIONS.CONFIRM
    );
  }
);

test(
  "confirmationRequired -> CONFIRM",
  () => {
    const result =
      allowed({
        actionClass: "EXECUTE",
        operation: "git push",
        confirmationRequired: true,
      });

    assert.equal(
      result.decision,
      DECISIONS.CONFIRM
    );
  }
);

test(
  "HIGH sensitivity -> CONFIRM",
  () => {
    const result =
      allowed({
        actionClass: "WRITE",
        sensitivity: "HIGH",
      });

    assert.equal(
      result.decision,
      DECISIONS.CONFIRM
    );
  }
);

test(
  "GUIDE ne donne aucune autorité",
  () => {
    const result =
      allowed({
        actionClass: "EXECUTE",
        executionSupported: false,
      });

    assert.equal(
      result.decision,
      DECISIONS.GUIDE
    );

    assert.equal(
      result.guidanceOnly,
      true
    );

    assert.equal(
      result.executable,
      false
    );
  }
);

test(
  "classe inconnue -> DENY",
  () => {
    const result =
      allowed({
        actionClass: "MAGIC",
      });

    assert.equal(
      result.decision,
      DECISIONS.DENY
    );
  }
);

test(
  "fingerprint stable malgré ordre des clés",
  () => {
    const first =
      fingerprintAction({
        profileScope: "arnaud",
        workspaceId: "workspace-a",

        actionRequest: {
          skillId: "send_email",
          actionClass: "EXECUTE",

          args: {
            subject: "Bonjour",
            to: "test@example.test",
          },

          target: {
            targetType: "email",
            targetCount: 1,
          },
        },
      });

    const second =
      fingerprintAction({
        workspaceId: "workspace-a",
        profileScope: "arnaud",

        actionRequest: {
          target: {
            targetCount: 1,
            targetType: "email",
          },

          args: {
            to: "test@example.test",
            subject: "Bonjour",
          },

          actionClass: "EXECUTE",
          skillId: "send_email",
        },
      });

    assert.equal(first, second);
  }
);

test(
  "changer la cible change le fingerprint",
  () => {
    const base = {
      profileScope: "arnaud",
      workspaceId: "workspace-a",

      actionRequest: {
        skillId: "send_email",
        actionClass: "EXECUTE",

        args: {
          to: "a@example.test",
        },
      },
    };

    const first =
      fingerprintAction(base);

    const second =
      fingerprintAction({
        ...base,

        actionRequest: {
          ...base.actionRequest,

          args: {
            to: "b@example.test",
          },
        },
      });

    assert.notEqual(first, second);
  }
);

test(
  "changer de workspace change le fingerprint",
  () => {
    const actionRequest = {
      skillId:
        "noon_dev_apply_edit",

      actionClass: "WRITE",

      args: {
        path: "src/app.js",
      },
    };

    const first =
      fingerprintAction({
        profileScope: "arnaud",
        workspaceId: "a",
        actionRequest,
      });

    const second =
      fingerprintAction({
        profileScope: "arnaud",
        workspaceId: "b",
        actionRequest,
      });

    assert.notEqual(first, second);
  }
);

test(
  "REQUIRE_APPROVAL natif -> CONFIRM",
  () => {
    const result =
      engine().evaluate({
        actionRequest: {
          actionClass: "EXECUTE",
          operation: "send email",
        },

        securityDecision: {
          outcome:
            "REQUIRE_APPROVAL",

          reasons: [
            "REMOTE_SIDE_EFFECT",
          ],
        },

        profileScope:
          "arnaud",

        workspaceId:
          "workspace-a",
      });

    assert.equal(
      result.decision,
      DECISIONS.CONFIRM
    );

    assert.equal(
      result.requiresApproval,
      true
    );
  }
);

test(
  "ALLOW_WITH_CONSTRAINTS natif peut PROCEED",
  () => {
    const result =
      engine().evaluate({
        actionRequest: {
          actionClass:
            "PREPARE",

          operation:
            "prepare draft",
        },

        securityDecision: {
          outcome:
            "ALLOW_WITH_CONSTRAINTS",

          reasons: [
            "PRESERVE_ORIGINALS",
          ],
        },
      });

    assert.equal(
      result.decision,
      DECISIONS.PROCEED
    );

    assert.ok(
      result.reasons.includes(
        "SECURITY_ALLOWED_WITH_CONSTRAINTS"
      )
    );
  }
);

test(
  "UNAVAILABLE natif -> GUIDE sans autorité d'exécution",
  () => {
    const result =
      engine().evaluate({
        actionRequest: {
          actionClass:
            "EXECUTE",
        },

        securityDecision: {
          outcome:
            "UNAVAILABLE",

          reasons: [
            "SERVICE_UNAVAILABLE",
          ],
        },
      });

    assert.equal(
      result.decision,
      DECISIONS.GUIDE
    );

    assert.equal(
      result.executable,
      false
    );
  }
);

test(
  "DESTRUCTIVE autorisé sous contraintes reste soumis à CONFIRM",
  () => {
    const result =
      engine().evaluate({
        actionRequest: {
          actionClass:
            "DESTRUCTIVE",

          operation:
            "delete resource",
        },

        securityDecision: {
          outcome:
            "ALLOW_WITH_CONSTRAINTS",
        },
      });

    assert.equal(
      result.decision,
      DECISIONS.CONFIRM
    );
  }
);

test(
  "SUGGEST et PREPARE sont des classes natives reconnues",
  () => {
    for (
      const actionClass
      of [
        "SUGGEST",
        "PREPARE",
      ]
    ) {
      const result =
        engine().evaluate({
          actionRequest: {
            actionClass,
          },

          securityDecision: {
            outcome: "ALLOW",
          },
        });

      assert.equal(
        result.decision,
        DECISIONS.PROCEED
      );
    }
  }
);
