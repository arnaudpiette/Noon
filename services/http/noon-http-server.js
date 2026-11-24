"use strict";

// V3-L7 — serveur HTTP local de Noon, sorti de server.js : authentification locale, blocage des
// accès externes en validation UI, aiguillage vers les modules de routes (ordre inchangé), puis
// démarrage (127.0.0.1 seulement, migration, reprise de session, diagnostic, travaux de fond) et arrêt.
// Domaine déplacé tel quel depuis server.js. Dépendances déjà déclarées quand server.js le
// construit : lues une fois ; les autres (`deps.x`) : lues à chaque usage, par accesseur.

const DEPENDENCIES = Object.freeze(["DEFAULT_HOST","DEFAULT_PORT","NOT_HANDLED","UI_VALIDATION_MODE","aiHttpRoutes","approvalsHttpRoutes","backgroundJobEngine","briefHttpRoutes","budgetHttpRoutes","captureHttpRoutes","configStatusHttpRoutes","conversationHttpRoutes","dataDirectoryLock","dayHttpRoutes","devHttpRoutes","figmaBridge","figmaBridgeEnabled","figmaBridgeHttpRoutes","goalModeDevLockMaintenance","goalsHttpRoutes","http","isUiValidationExternalRequest","jobsHttpRoutes","legacyMemoryHttpRoutes","localFilesHttpRoutes","mcpService","memoryHttpRoutes","nativeDevB3Facade","nativeDevCoordinator","personalIntelligenceHttpRoutes","projectsHttpRoutes","readJsonBody","reliabilityEngine","reportInterruptedNativeDevTasks","runLegacyMemoryMigrationOnce","runtimeStatusHttpRoutes","sessionContinuityEngine","setProviderKeyLoaders","staticAssets","systemHttpRoutes","toolAuditLog","transcriptionHttpRoutes","voiceHttpRoutes","workspaceHttpRoutes"]);

function createNoonHttpServer(deps) {
  for (const name of DEPENDENCIES) if (!(name in deps)) throw new TypeError(`Dépendance manquante : ${name}`);
  const {
    DEFAULT_HOST,
    DEFAULT_PORT,
    NOT_HANDLED,
    UI_VALIDATION_MODE,
    aiHttpRoutes,
    approvalsHttpRoutes,
    backgroundJobEngine,
    briefHttpRoutes,
    budgetHttpRoutes,
    captureHttpRoutes,
    configStatusHttpRoutes,
    conversationHttpRoutes,
    dataDirectoryLock,
    dayHttpRoutes,
    devHttpRoutes,
    figmaBridge,
    figmaBridgeEnabled,
    figmaBridgeHttpRoutes,
    goalModeDevLockMaintenance,
    goalsHttpRoutes,
    http,
    isUiValidationExternalRequest,
    jobsHttpRoutes,
    legacyMemoryHttpRoutes,
    localFilesHttpRoutes,
    mcpService,
    memoryHttpRoutes,
    nativeDevB3Facade,
    nativeDevCoordinator,
    personalIntelligenceHttpRoutes,
    projectsHttpRoutes,
    readJsonBody,
    reliabilityEngine,
    reportInterruptedNativeDevTasks,
    runLegacyMemoryMigrationOnce,
    runtimeStatusHttpRoutes,
    sessionContinuityEngine,
    setProviderKeyLoaders,
    staticAssets,
    systemHttpRoutes,
    toolAuditLog,
    transcriptionHttpRoutes,
    voiceHttpRoutes,
    workspaceHttpRoutes,
  } = deps;

  // Drapeaux de démarrage : chaque étape ne s’exécute qu’une fois par processus.
  let sessionRecoveryCompleted = false;

  let nativeDevInterruptedReported = false;

  let goalModeDevReconcileScanDone = false;

  let localAuthSecret = process.env.NOON_LOCAL_AUTH_SECRET || null;

  const PUBLIC_ROUTES = new Set([
    "/",
    "/app",
    "/style.css",
    "/app.js",
    "/ui-utils.js",
    "/control-center.js",
    "/live-voice-core.js",
    "/live-voice.js",
    "/noon-particles.js",
    "/assets/noon-icon-attachment.svg",
    "/health",
    "/integrations/google/callback",
  ]);

  async function handleNoonRequest(req, res) {
    res.setHeader("Content-Type", "application/json; charset=utf-8");

    const requestPath = new URL(req.url, "http://127.0.0.1").pathname;
    if (
      localAuthSecret &&
      !PUBLIC_ROUTES.has(requestPath) &&
      req.headers["x-noon-local-auth"] !== localAuthSecret
    ) {
      res.writeHead(401, { "Cache-Control": "no-store" });
      return res.end(JSON.stringify({
        status: "error",
        message: "Authentification locale requise.",
      }));
    }

    // Le serveur HTTP local reste utilisable pour la validation de l'UI. Les
    // points d'entrée qui initialisent un connecteur ou une session distante
    // sont arrêtés avant toute lecture de jeton ou appel réseau.
    if (UI_VALIDATION_MODE && isUiValidationExternalRequest(requestPath)) {
      res.writeHead(503, { "Cache-Control": "no-store" });
      return res.end(JSON.stringify({
        status: "unavailable",
        code: "UI_VALIDATION_EXTERNAL_DISABLED",
        message: "Cette capacité externe est désactivée pendant la validation UI isolée.",
      }));
    }

    if (req.url === "/") {
      res.writeHead(200);
      return res.end(
        JSON.stringify(
          {
            status: "ok",
            assistant: "Noon",
            message: "Le serveur local de Noon fonctionne.",
          },
          null,
          2
        )
      );
    }

  {
    const routed = await workspaceHttpRoutes(req, res, requestPath);
    if (routed !== NOT_HANDLED) return routed;
  }

  {
    const routed = await localFilesHttpRoutes(req, res, requestPath);
    if (routed !== NOT_HANDLED) return routed;
  }

  {
    const routed = await aiHttpRoutes(req, res, requestPath);
    if (routed !== NOT_HANDLED) return routed;
  }

  {
    const routed = await budgetHttpRoutes(req, res, requestPath);
    if (routed !== NOT_HANDLED) return routed;
  }

  {
    const routed = await captureHttpRoutes(req, res, requestPath);
    if (routed !== NOT_HANDLED) return routed;
  }

  // V3-L7 : fichiers de l'interface (table exacte dans services/http/static-assets.js).
  if (staticAssets.matches(req)) {
    return staticAssets.handle(req, res);
  }

  {
    const routed = await projectsHttpRoutes(req, res, requestPath);
    if (routed !== NOT_HANDLED) return routed;
  }

  {
    const routed = await conversationHttpRoutes(req, res, requestPath);
    if (routed !== NOT_HANDLED) return routed;
  }

  {
    const routed = await voiceHttpRoutes(req, res, requestPath);
    if (routed !== NOT_HANDLED) return routed;
  }

  if (figmaBridgeHttpRoutes.matches(requestPath)) {
    return figmaBridgeHttpRoutes.handle(req, res, { requestPath });
  }

  {
    const routed = await systemHttpRoutes(req, res, requestPath);
    if (routed !== NOT_HANDLED) return routed;
  }

  {
    const routed = await goalsHttpRoutes(req, res, requestPath);
    if (routed !== NOT_HANDLED) return routed;
  }

  {
    const routed = await transcriptionHttpRoutes(req, res, requestPath);
    if (routed !== NOT_HANDLED) return routed;
  }

  {
    const routed = await dayHttpRoutes(req, res, requestPath);
    if (routed !== NOT_HANDLED) return routed;
  }

  // Intelligence personnelle : les routes HTTP ne contiennent que la validation
  // et délèguent toute logique aux services dédiés.
  if (memoryHttpRoutes.matches(req)) {
    return memoryHttpRoutes.handle(req, res, { readJsonBody });
  }

  {
    const routed = await personalIntelligenceHttpRoutes(req, res, requestPath);
    if (routed !== NOT_HANDLED) return routed;
  }

  {
    const routed = await jobsHttpRoutes(req, res, requestPath);
    if (routed !== NOT_HANDLED) return routed;
  }

  {
    const routed = await legacyMemoryHttpRoutes(req, res, requestPath);
    if (routed !== NOT_HANDLED) return routed;
  }

  {
    const routed = await briefHttpRoutes(req, res, requestPath);
    if (routed !== NOT_HANDLED) return routed;
  }

  {
    const routed = await approvalsHttpRoutes(req, res, requestPath);
    if (routed !== NOT_HANDLED) return routed;
  }

  {
    const routed = await configStatusHttpRoutes(req, res, requestPath);
    if (routed !== NOT_HANDLED) return routed;
  }

  {
    const routed = await devHttpRoutes(req, res, requestPath);
    if (routed !== NOT_HANDLED) return routed;
  }

  {
    const routed = await runtimeStatusHttpRoutes(req, res, requestPath);
    if (routed !== NOT_HANDLED) return routed;
  }

    res.writeHead(404);
    return res.end(
      JSON.stringify(
        {
          status: "error",
          message: "Route inconnue.",
        },
        null,
        2
      )
    );
  }

  // Une exception non rattrapée par une route (ex. disque plein) donne une réponse 500
  // explicite au lieu d'une requête laissée sans réponse (interface bloquée en chargement).
  // Le journal ne contient que la méthode, le chemin et le code d'erreur.
  function respondInternalError(req, res, error) {
    const code = String(error?.code || error?.name || "ERROR").slice(0, 80);
    let requestPath = "?";
    try { requestPath = new URL(req.url, "http://127.0.0.1").pathname.slice(0, 200); } catch {}
    try { console.error(`[http] erreur interne ${req.method} ${requestPath} (${code})`); } catch {}
    try {
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
        res.end(JSON.stringify({ status: "error", code: "INTERNAL_ERROR", message: "Erreur interne de Noon." }));
      } else if (!res.writableEnded) {
        res.end();
      }
    } catch {}
  }

  const server = http.createServer(async (req, res) => {
    try {
      return await handleNoonRequest(req, res);
    } catch (error) {
      respondInternalError(req, res, error);
    }
  });

  async function startNoonServer({
    host = DEFAULT_HOST,
    port = DEFAULT_PORT,
    authSecret = null,
    loadOpenAIKey = null,
    loadGeminiKey = null,
  } = {}) {
    if (host !== DEFAULT_HOST) {
      return Promise.reject(
        new Error("Noon doit écouter uniquement sur 127.0.0.1.")
      );
    }

    localAuthSecret = authSecret || null;
    setProviderKeyLoaders(loadOpenAIKey, loadGeminiKey);

    // La migration est locale, sauvegardée et idempotente. Elle est exécutée
    // avant l'écoute HTTP afin qu'aucune requête ne lise un état intermédiaire.
    try { runLegacyMemoryMigrationOnce(); }
    catch (error) {
      toolAuditLog.append("memory-migration.failed", { code: String(error.code || error.name || "ERROR").slice(0, 80) });
    }

    if (!sessionRecoveryCompleted) {
      const recoveredSessionIds =
        sessionContinuityEngine
          .startupRecover();

      sessionRecoveryCompleted = true;

      toolAuditLog.append("session-startup-recovery.completed", {
        recoveredCount: recoveredSessionIds.length,
      });
    }

    await reliabilityEngine.diagnose();

    // Branchement B1 : tâches Native DEV interrompues signalées une fois au
    // démarrage (audit sans contenu, aucune action). Pas en safe mode, qui
    // suspend aussi les travaux de fond.
    if (!nativeDevInterruptedReported && process.env.NOON_SAFE_MODE !== "1") {
      nativeDevInterruptedReported = true;
      reportInterruptedNativeDevTasks({
        sources: [
          { name: "b3", recover: () => nativeDevB3Facade.recoverInterrupted() },
          { name: "coordinator", recover: () => nativeDevCoordinator.recoverInterrupted() },
        ],
        audit: (event, metadata) => toolAuditLog.append(event, metadata),
      });
    }

    // 4C-2 / B3b : réconciliation au démarrage, seulement avec le verrou exclusif
    // sur DATA_DIRECTORY (un seul processus Noon par dossier). Périmé sur la même
    // machine (ESRCH) : repris sous mutex puis scan. Détenu, autre machine ou
    // illisible : aucun scan, audit RECONCILE_SCAN_SKIPPED_LOCK.
    if (goalModeDevLockMaintenance && !goalModeDevReconcileScanDone && process.env.NOON_SAFE_MODE !== "1") {
      goalModeDevReconcileScanDone = true;
      goalModeDevLockMaintenance.startup();
    }

    // Le safe mode conserve le serveur local mais suspend les travaux autonomes.
    if (process.env.NOON_SAFE_MODE !== "1") backgroundJobEngine?.start();

    // Reconnexion silencieuse des serveurs MCP déjà autorisés (flag connectors.mcp).
    if (process.env.NOON_SAFE_MODE !== "1") void mcpService.startup().catch(() => {});

    // Plugin Figma déjà jumelé : la passerelle locale écoute pour qu'il se reconnecte seul.
    if (figmaBridgeEnabled() && figmaBridge.isPaired()) void figmaBridge.start().catch((error) => toolAuditLog.append("figma-bridge.start_failed", { code: error.code || "ERROR" }));

    if (server.listening) return Promise.resolve(server);

    return new Promise((resolve, reject) => {
      const handleError = (error) => {
        server.off("listening", handleListening);
        reject(error);
      };
      const handleListening = () => {
        server.off("error", handleError);
        console.log(`Noon est actif sur http://${host}:${port}`);
        resolve(server);
      };

      server.once("error", handleError);
      server.once("listening", handleListening);
      server.listen(port, host);
    });
  }

  function stopNoonServer() {
    backgroundJobEngine?.stop();
    try { dataDirectoryLock.release(); } catch {}
    void mcpService.closeAll().catch(() => {});
    void figmaBridge.stop().catch(() => {});
    if (!server.listening) return Promise.resolve();

    return new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
      server.closeIdleConnections?.();
    });
  }

  return { server, startNoonServer, stopNoonServer };
}

module.exports = { DEPENDENCIES, createNoonHttpServer };
