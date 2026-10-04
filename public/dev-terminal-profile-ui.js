(function attachDevTerminalProfileUi(
  global
) {
  const PROFILE_MARKER =
    /^\[NOON_TERMINAL_PROFILE:(AUTONOMOUS|STANDARD|STEP_BY_STEP)\]$/;

  const DEFAULT_PROFILE =
    "AUTONOMOUS";

  function profileFromRule(
    rule
  ) {
    if (
      rule?.status !==
      "ACTIVE"
    ) {
      return null;
    }

    const match =
      String(
        rule?.text || ""
      )
        .trim()
        .match(
          PROFILE_MARKER
        );

    return match
      ? match[1]
      : null;
  }

  function markerFor(
    profile
  ) {
    if (
      ![
        "AUTONOMOUS",
        "STANDARD",
        "STEP_BY_STEP",
      ].includes(profile)
    ) {
      throw new Error(
        "Profil terminal invalide."
      );
    }

    return `[NOON_TERMINAL_PROFILE:${profile}]`;
  }

  function createDevTerminalProfileController({
    elements,
    bridge,
    getContext,
  } = {}) {
    const state = {
      serial: 0,
      workspaceId: null,
      contextKey: null,
      projectId: null,
      readOnly: true,
      rule: null,
      profile:
        DEFAULT_PROFILE,
    };

    function contextValid(
      context
    ) {
      const current =
        getContext?.();

      return Boolean(
        context &&
          current &&
          context.workspaceId ===
            current.workspaceId &&
          context.contextKey ===
            current.contextKey
      );
    }

    function canUseBridge() {
      return (
        typeof bridge
          ?.getDevProjectRules ===
          "function" &&
        typeof bridge
          ?.devProjectRule ===
          "function"
      );
    }

    function render() {
      if (!elements?.select) {
        return;
      }

      elements.select.value =
        state.profile;

      elements.select.disabled =
        state.readOnly ||
        !state.workspaceId;

      if (elements.status) {
        elements.status.textContent =
          state.rule
            ? "Projet"
            : "Défaut";

        elements.status.dataset.source =
          state.rule
            ? "project"
            : "default";
      }

      if (elements.label) {
        elements.label.title =
          state.rule
            ? "Profil terminal spécifique à ce projet."
            : "Profil terminal par défaut : Autonome.";
      }
    }

    async function refresh(
      context =
        getContext?.()
    ) {
      state.serial += 1;

      const serial =
        state.serial;

      state.workspaceId =
        context?.workspaceId ||
        null;

      state.contextKey =
        context?.contextKey ||
        null;

      state.projectId =
        null;

      state.rule =
        null;

      state.profile =
        DEFAULT_PROFILE;

      if (
        !state.workspaceId ||
        !canUseBridge()
      ) {
        state.readOnly =
          true;

        render();

        return state;
      }

      state.readOnly =
        true;

      render();

      const result =
        await bridge
          .getDevProjectRules(
            state.workspaceId
          );

      if (
        serial !==
          state.serial ||
        !contextValid(
          context
        )
      ) {
        return state;
      }

      state.projectId =
        typeof result
          ?.project
          ?.id === "string"
          ? result.project.id
          : null;

      state.readOnly =
        result?.storage !==
          "READ_WRITE" ||
        !state.projectId;

      const rules =
        Array.isArray(
          result?.rules
        )
          ? result.rules
          : [];

      state.rule =
        rules.find(
          (rule) =>
            Boolean(
              profileFromRule(
                rule
              )
            )
        ) ||
        null;

      state.profile =
        profileFromRule(
          state.rule
        ) ||
        DEFAULT_PROFILE;

      render();

      return state;
    }

    async function save(
      profile
    ) {
      const context =
        getContext?.();

      if (
        !context?.workspaceId
      ) {
        await refresh(
          context
        );

        return;
      }

      if (
        state.workspaceId !==
          context.workspaceId ||
        state.contextKey !==
          context.contextKey
      ) {
        await refresh(
          context
        );
      }

      if (
        state.readOnly ||
        !state.projectId
      ) {
        render();

        return;
      }

      const normalized =
        String(
          profile || ""
        )
          .trim()
          .toUpperCase();

      if (
        ![
          "AUTONOMOUS",
          "STANDARD",
          "STEP_BY_STEP",
        ].includes(
          normalized
        )
      ) {
        render();

        return;
      }

      elements.select.disabled =
        true;

      try {
        if (
          normalized ===
          DEFAULT_PROFILE
        ) {
          if (
            state.rule
          ) {
            await bridge
              .devProjectRule({
                action:
                  "delete",

                workspaceId:
                  context.workspaceId,

                expectedProjectId:
                  state.projectId,

                ruleId:
                  state.rule
                    .ruleId,

                expectedVersion:
                  state.rule
                    .version,
              });
          }
        } else {
          const text =
            markerFor(
              normalized
            );

          if (
            state.rule
          ) {
            await bridge
              .devProjectRule({
                action:
                  "update",

                workspaceId:
                  context.workspaceId,

                expectedProjectId:
                  state.projectId,

                ruleId:
                  state.rule
                    .ruleId,

                expectedVersion:
                  state.rule
                    .version,

                text,
              });
          } else {
            await bridge
              .devProjectRule({
                action:
                  "create",

                workspaceId:
                  context.workspaceId,

                expectedProjectId:
                  state.projectId,

                text,
              });
          }
        }

        if (
          contextValid(
            context
          )
        ) {
          await refresh(
            context
          );
        }
      } finally {
        render();
      }
    }

    elements
      ?.select
      ?.addEventListener(
        "focus",
        () => {
          void refresh();
        }
      );

    elements
      ?.select
      ?.addEventListener(
        "change",
        () => {
          void save(
            elements.select
              .value
          );
        }
      );

    render();

    return {
      refresh,
      save,
      state,
    };
  }

  global.NoonDevTerminalProfileUi =
    {
      createDevTerminalProfileController,
      profileFromRule,
      markerFor,
    };
})(window);
