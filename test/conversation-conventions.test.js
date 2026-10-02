"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  classifyConversationConvention,
  normalizeCue,
} = require(
  "../services/intents/conversation-conventions"
);

const {
  createIntentCommandEngine,
} = require(
  "../services/intents/intent-command-engine"
);

const {
  ARNAUD_CONVERSATION_PROFILE,
  renderConversationStyleInstruction,
} = require(
  "../services/personal-assistant/" +
  "conversation-style-profile"
);

function createEngine() {
  return createIntentCommandEngine({
    semanticClassifier: null,
  });
}

async function parse(
  text,
  {
    channel = "chat",
    continuationAvailable = true,
    pendingApprovalIds = [],
  } = {},
) {
  const engine = createEngine();

  return engine.parse(
    channel,
    {
      text,
      transcript: channel === "voice"
        ? text
        : undefined,
      conversationId: "conversation-test",
      sessionId: "session-test",
      workspaceId: null,
    },
    {
      activeWorkspaceId: null,
      activeProjectId: null,
      activeConversationId:
        "conversation-test",
      activeExecutionId: null,
      continuationAvailable,
      pendingApprovalIds,
      ttsActive: false,
    },
  );
}

test(
  "normalise accents, ponctuation et apostrophes",
  () => {
    assert.equal(
      normalizeCue("  Et après ? "),
      "et apres",
    );

    assert.equal(
      normalizeCue("D’accord."),
      "d accord",
    );
  },
);

test(
  "les relances usuelles deviennent CONTINUE avec contexte",
  async () => {
    const cues = [
      "la suite",
      "continue",
      "on continue",
      "reprends",
      "vas-y",
      "ok vas-y",
      "prochaine étape",
      "et après ?",
      "après ?",
    ];

    for (const cue of cues) {
      const result = await parse(cue);

      assert.equal(
        result.type,
        "CONTINUE",
        cue,
      );

      assert.equal(
        result.action,
        "previous_task",
        cue,
      );

      assert.equal(
        result.confidence,
        "high",
        cue,
      );

      assert.deepEqual(
        result.ambiguity,
        [],
        cue,
      );
    }
  },
);

test(
  "la voix utilise les mêmes conventions de continuation",
  async () => {
    const result = await parse(
      "la suite",
      {
        channel: "voice",
      },
    );

    assert.equal(
      result.type,
      "CONTINUE",
    );

    assert.equal(
      result.action,
      "previous_task",
    );
  },
);

test(
  "une continuation sans contexte reste explicite mais ambiguë",
  async () => {
    const result = await parse(
      "la suite",
      {
        continuationAvailable: false,
      },
    );

    assert.equal(
      result.type,
      "CONTINUE",
    );

    assert.equal(
      result.confidence,
      "low",
    );

    assert.equal(
      result.ambiguity.length,
      1,
    );

    assert.equal(
      result.ambiguity[0].field,
      "continuation",
    );
  },
);

test(
  "vas-y n'approuve jamais implicitement une approval",
  async () => {
    const result = await parse(
      "vas-y",
      {
        pendingApprovalIds: [
          "approval-sensitive",
        ],
      },
    );

    assert.equal(
      result.type,
      "CONTINUE",
    );

    assert.notEqual(
      result.type,
      "CONFIRM",
    );

    assert.notEqual(
      result.target?.approvalId,
      "approval-sensitive",
    );
  },
);

test(
  "une confirmation explicite conserve le mécanisme approval existant",
  async () => {
    const result = await parse(
      "confirme",
      {
        pendingApprovalIds: [
          "approval-explicit",
        ],
      },
    );

    assert.equal(
      result.type,
      "CONFIRM",
    );

    assert.equal(
      result.action,
      "approval",
    );
  },
);

test(
  "attends est une pause conversationnelle et non une annulation",
  async () => {
    for (
      const cue of [
        "attends",
        "deux secondes",
        "pause",
      ]
    ) {
      const result = await parse(cue);

      assert.equal(
        result.type,
        "CONTROL",
        cue,
      );

      assert.equal(
        result.action,
        "pause_conversation",
        cue,
      );

      assert.notEqual(
        result.type,
        "CANCEL",
        cue,
      );
    }
  },
);

test(
  "ok seul reste un acknowledgement sans action implicite",
  async () => {
    const result = await parse("ok");

    assert.equal(
      result.type,
      "ASK",
    );

    assert.equal(
      result.action,
      "acknowledgement",
    );
  },
);

test(
  "le profil DEV conserve les préférences explicites de collaboration",
  () => {
    assert.equal(
      ARNAUD_CONVERSATION_PROFILE
        .response
        .summaryFirst,
      true,
    );

    assert.equal(
      ARNAUD_CONVERSATION_PROFILE
        .development
        .largeTerminalBlocks,
      true,
    );

    assert.equal(
      ARNAUD_CONVERSATION_PROFILE
        .development
        .pushRequiresExplicitRequest,
      true,
    );

    const instruction =
      renderConversationStyleInstruction({
        mode: "DEV",
      });

    assert.match(
      instruction,
      /gros blocs/i,
    );

    assert.match(
      instruction,
      /push Git/i,
    );

    assert.match(
      instruction,
      /Terra/i,
    );

    assert.match(
      instruction,
      /Sol/i,
    );
  },
);

test(
  "le classifier pur ne confond pas une instruction longue avec vas-y",
  () => {
    assert.equal(
      classifyConversationConvention(
        "vas-y pour faire le push",
      ),
      null,
    );

    assert.equal(
      classifyConversationConvention(
        "oui vas-y supprime le fichier",
      ),
      null,
    );
  },
);

test(
  "continue et pause ne valident jamais une approval en attente",
  async () => {
    const pending = {
      pendingApprovalIds: [
        "approval-sensitive",
      ],
    };

    const continuation =
      await parse(
        "la suite",
        pending,
      );

    assert.equal(
      continuation.type,
      "CONTINUE",
    );

    assert.notEqual(
      continuation.type,
      "CONFIRM",
    );

    const go =
      await parse(
        "vas-y",
        pending,
      );

    assert.equal(
      go.type,
      "CONTINUE",
    );

    assert.notEqual(
      go.type,
      "CONFIRM",
    );

    /*
     * Le contrat "ok + approval -> CONFIRM"
     * appartient au corpus IntentCommandEngine existant.
     * Ce test cible uniquement les nouvelles conventions
     * CONTINUE et PAUSE.
     */

    const pause =
      await parse(
        "attends",
        pending,
      );

    assert.equal(
      pause.type,
      "CONTROL",
    );

    assert.equal(
      pause.action,
      "pause_conversation",
    );

    assert.notEqual(
      pause.type,
      "CONFIRM",
    );
  },
);
