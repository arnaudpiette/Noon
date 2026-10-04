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

test(
  "un changement de Focus recharge le profil propre à chaque workspace",
  async () => {
    const window = {};

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
      { window }
    );

    const elements = {
      label: new Node(),
      select: new Node(),
      status: new Node(),
    };

    let context = {
      workspaceId: "workspace-a",
      contextKey: "focus-a:/repo-a",
      projectName: "Projet A",
    };

    let version = 1;

    const rulesByWorkspace =
      new Map([
        ["workspace-a", []],
        ["workspace-b", []],
      ]);

    const projects = {
      "workspace-a": {
        id: "project-a",
        name: "Projet A",
      },
      "workspace-b": {
        id: "project-b",
        name: "Projet B",
      },
    };

    const bridge = {
      async getDevProjectRules(
        workspaceId
      ) {
        return {
          project:
            projects[workspaceId],

          storage:
            "READ_WRITE",

          rules:
            structuredClone(
              rulesByWorkspace.get(
                workspaceId
              ) || []
            ),
        };
      },

      async devProjectRule(
        payload
      ) {
        let rules =
          rulesByWorkspace.get(
            payload.workspaceId
          ) || [];

        if (
          payload.action ===
          "create"
        ) {
          rules = [
            {
              ruleId:
                `terminal-profile-${payload.workspaceId}`,
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
          rules =
            rules.map(
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

        rulesByWorkspace.set(
          payload.workspaceId,
          rules
        );

        return {
          ok: true,
        };
      },
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

    await controller.refresh();

    elements.select.value =
      "STANDARD";

    elements.select.emit(
      "change"
    );

    await flush();

    assert.equal(
      elements.select.value,
      "STANDARD"
    );

    context = {
      workspaceId:
        "workspace-b",
      contextKey:
        "focus-b:/repo-b",
      projectName:
        "Projet B",
    };

    await controller.refresh();

    assert.equal(
      elements.select.value,
      "AUTONOMOUS"
    );

    assert.equal(
      elements.status.textContent,
      "Défaut"
    );

    context = {
      workspaceId:
        "workspace-a",
      contextKey:
        "focus-a:/repo-a",
      projectName:
        "Projet A",
    };

    await controller.refresh();

    assert.equal(
      elements.select.value,
      "STANDARD"
    );

    assert.equal(
      elements.status.textContent,
      "Projet"
    );
  }
);


test(
  "le serveur expose le contrôleur Terminal Profile utilisé par l'interface",
  () => {
    const index =
      fs.readFileSync(
        path.join(
          __dirname,
          "..",
          "public",
          "index.html"
        ),
        "utf8"
      );

    const server =
      fs.readFileSync(
        path.join(
          __dirname,
          "..",
          "server.js"
        ),
        "utf8"
      );

    assert.match(
      index,
      /<script src="dev-terminal-profile-ui\.js"><\/script>/
    );

    assert.match(
      server,
      /req\.url === "\/dev-terminal-profile-ui\.js"/
    );

    assert.match(
      server,
      /"dev-terminal-profile-ui\.js"/
    );
  }
);


test(
  "le focus du menu Terminal ne relance pas un refresh bloquant",
  async () => {
    const f =
      fixture();

    await f.controller
      .refresh();

    const serialBeforeFocus =
      f.controller
        .state
        .serial;

    assert.equal(
      f.elements
        .select
        .disabled,
      false
    );

    f.elements
      .select
      .emit(
        "focus"
      );

    await flush();

    assert.equal(
      f.controller
        .state
        .serial,
      serialBeforeFocus
    );

    assert.equal(
      f.elements
        .select
        .disabled,
      false
    );
  }
);
