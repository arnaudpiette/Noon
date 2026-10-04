"use strict";

const assert =
  require("node:assert/strict");

const fs =
  require("node:fs");

const path =
  require("node:path");

const test =
  require("node:test");

const vm =
  require("node:vm");

class Node {
  constructor() {
    this.value =
      "";

    this.disabled =
      false;

    this.textContent =
      "";

    this.title =
      "";

    this.dataset =
      {};

    this.listeners =
      new Map();
  }

  addEventListener(
    type,
    listener
  ) {
    this.listeners.set(
      type,
      listener
    );
  }

  emit(
    type
  ) {
    this.listeners
      .get(type)
      ?.({
        preventDefault() {},
      });
  }
}

async function flush() {
  for (
    let index = 0;
    index < 12;
    index += 1
  ) {
    await Promise.resolve();
  }
}

function fixture() {
  const window =
    {};

  vm.runInNewContext(
    fs.readFileSync(
      path.join(
        __dirname,
        "..",
        "public",
        "dev-terminal-profile-ui.js"
      ),
      "utf8"
    ),
    {
      window,
    }
  );

  const elements = {
    label:
      new Node(),

    select:
      new Node(),

    status:
      new Node(),
  };

  let rules =
    [];

  let version =
    1;

  const mutations =
    [];

  const bridge = {
    async getDevProjectRules() {
      return {
        project: {
          id:
            "project-a",

          name:
            "Projet A",
        },

        storage:
          "READ_WRITE",

        rules:
          structuredClone(
            rules
          ),
      };
    },

    async devProjectRule(
      payload
    ) {
      mutations.push(
        structuredClone(
          payload
        )
      );

      if (
        payload.action ===
        "create"
      ) {
        rules = [
          {
            ruleId:
              "terminal-profile",

            text:
              payload.text,

            status:
              "ACTIVE",

            version:
              version++,
          },
        ];
      }

      if (
        payload.action ===
        "update"
      ) {
        rules = rules.map(
          (rule) =>
            rule.ruleId ===
              payload.ruleId
              ? {
                  ...rule,
                  text:
                    payload.text,
                  version:
                    version++,
                }
              : rule
        );
      }

      if (
        payload.action ===
        "delete"
      ) {
        rules =
          rules.filter(
            (rule) =>
              rule.ruleId !==
              payload.ruleId
          );
      }

      return {
        ok: true,
      };
    },
  };

  const context = {
    workspaceId:
      "workspace-a",

    contextKey:
      "focus-a:/repo",

    projectName:
      "Projet A",
  };

  const controller =
    window
      .NoonDevTerminalProfileUi
      .createDevTerminalProfileController({
        elements,
        bridge,
        getContext:
          () => context,
      });

  return {
    controller,
    elements,
    mutations,
    getRules:
      () =>
        structuredClone(
          rules
        ),
  };
}

test(
  "le Terminal affiche AUTONOMOUS comme défaut global",
  async () => {
    const f =
      fixture();

    await f.controller
      .refresh();

    assert.equal(
      f.elements
        .select
        .value,
      "AUTONOMOUS"
    );

    assert.equal(
      f.elements
        .select
        .disabled,
      false
    );

    assert.equal(
      f.elements
        .status
        .textContent,
      "Défaut"
    );
  }
);

test(
  "STANDARD devient un override projet persistant puis AUTONOMOUS revient au défaut",
  async () => {
    const f =
      fixture();

    await f.controller
      .refresh();

    f.elements
      .select
      .value =
        "STANDARD";

    f.elements
      .select
      .emit(
        "change"
      );

    await flush();

    assert.equal(
      f.getRules()
        .length,
      1
    );

    assert.equal(
      f.getRules()[0]
        .text,
      "[NOON_TERMINAL_PROFILE:STANDARD]"
    );

    assert.equal(
      f.elements
        .status
        .textContent,
      "Projet"
    );

    f.elements
      .select
      .value =
        "AUTONOMOUS";

    f.elements
      .select
      .emit(
        "change"
      );

    await flush();

    assert.equal(
      f.getRules()
        .length,
      0
    );

    assert.equal(
      f.elements
        .status
        .textContent,
      "Défaut"
    );

    assert.equal(
      f.mutations
        .some(
          (item) =>
            item.action ===
              "delete"
        ),
      true
    );
  }
);
