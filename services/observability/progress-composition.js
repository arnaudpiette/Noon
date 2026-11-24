"use strict";

// V3-L7 — assemblage de la progression utilisateur (contexte de requête du chat, moteur et
// adaptateur de progression, projection publique pour l'API DEV, observabilité de
// l'orchestrateur), sorti de server.js. Bloc déplacé tel quel. server.js l'appelle au même
// endroit qu'avant ; toutes les références à ces objets se trouvent plus loin.

const { AsyncLocalStorage } = require("node:async_hooks");
const { toChatProgressEvent } = require("./chat-progress-event");
const { createUserProgressEngine } = require("./user-progress-engine");
const { createUserProgressAdapter } = require("./user-progress-adapter");
const { createOrchestratorProgressObservability } = require("./orchestrator-progress-observability");

const DEPENDENCIES = Object.freeze(["noonObservability"]);

function createProgressComposition(deps) {
  for (const name of DEPENDENCIES) if (!(name in deps)) throw new TypeError(`Dépendance manquante : ${name}`);
  const { noonObservability } = deps;

  const chatProgressRequestContext =
    new AsyncLocalStorage();

  const userProgressEngine =
    createUserProgressEngine({
      onEvent(event) {
        const scope =
          chatProgressRequestContext
            .getStore();

        if (
          !scope ||
          typeof scope.writeProgress !==
            "function"
        ) {
          return;
        }

        try {
          scope.writeProgress(event);
        } catch {
          /*
           * L'affichage Progress ne doit jamais
           * casser l'exécution métier.
           */
        }
      },
    });

  const userProgressAdapter =
    createUserProgressAdapter({
      progressEngine:
        userProgressEngine,
    });

  function publicDevProgress(
    executionId
  ) {
    const id =
      String(
        executionId || ""
      ).trim();

    if (!id) {
      return null;
    }

    try {
      return toChatProgressEvent(
        userProgressEngine.latest(
          id
        )
      );
    } catch {
      /*
       * La projection de progression
       * ne doit jamais casser l'API DEV.
       */
      return null;
    }
  }

  const orchestratorObservability =
    createOrchestratorProgressObservability({
      observability:
        noonObservability,
      progressAdapter:
        userProgressAdapter,
    });

  return { chatProgressRequestContext, userProgressAdapter, publicDevProgress, orchestratorObservability };
}

module.exports = { DEPENDENCIES, createProgressComposition };
