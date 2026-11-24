"use strict";

// V3-L7 — assemblage des extensions (runtime, registre, extension de démonstration) et du
// client MCP, sorti de server.js. Bloc déplacé tel quel ; seul le chemin de package.json est
// réécrit depuis ce dossier (même module, même cache). server.js l'appelle au même endroit
// qu'avant. Toutes les dépendances sont déjà initialisées à l'appel : elles sont lues une fois.

const { createExtensionRegistry, createExtensionRuntime } = require("./index");
const { createMcpService } = require("../mcp");
const noonExampleSearchExtension = require("./sample/noon-example-search");

const DEPENDENCIES = Object.freeze(["DATA_DIRECTORY","UI_VALIDATION_MODE","featureFlags","getAllowedDirectories","integrationTokenStore","localIntelligenceRuntime","operationalSecurityPolicy","reliabilityEngine","skillRegistry","toolAuditLog","transactionalExecutionEngine"]);

function createExtensionsComposition(deps) {
  for (const name of DEPENDENCIES) if (!(name in deps)) throw new TypeError(`Dépendance manquante : ${name}`);
  const {
    DATA_DIRECTORY,
    UI_VALIDATION_MODE,
    featureFlags,
    getAllowedDirectories,
    integrationTokenStore,
    localIntelligenceRuntime,
    operationalSecurityPolicy,
    reliabilityEngine,
    skillRegistry,
    toolAuditLog,
    transactionalExecutionEngine,
  } = deps;

  // Les extensions enrichissent les registries existants ; elles ne reçoivent jamais les services internes bruts.
  const extensionRuntime = createExtensionRuntime({
    securityPolicy: operationalSecurityPolicy,
    allowedRoots: getAllowedDirectories(),
    observability: (event, metadata) => toolAuditLog.append(`extensions.${event}`, metadata),
    transactionalExecutor: async ({ skill, input, actionRequest, decision, operation, execution }) => {
      const result = await transactionalExecutionEngine.executeSingleStep({
        executionId: execution.executionId,
        actionRequest,
        policyDecision: decision,
        approvalRequired: decision.requiredApproval === true,
        approvalRef: execution.approval || null,
        workspaceId: execution.workspaceId || null,
        profileScope: execution.profileScope || "arnaud",
        step: { skillId: skill.id, operation: skill.id, args: input, actionClass: skill.permissionLevel, verificationLevel: "BASIC" },
        executeStep: operation,
        revalidate: () => operationalSecurityPolicy.evaluate({ actionRequest, skillPolicy: { level: skill.permissionLevel.toLowerCase() }, pendingApproval: execution.approval || null }),
        verifyStep: async () => ({ verified: true, reasonCode: "EXTENSION_SCHEMA_VALIDATED" }),
      });
      if (result.status !== "SUCCEEDED") throw Object.assign(new Error("Exécution transactionnelle incomplète."), { code: `EXTENSION_TRANSACTION_${result.status}` });
      return result.result;
    },
  });
  const extensionRegistry = createExtensionRegistry({
    noonVersion: require("../../package.json").version,
    skillRegistry,
    runtime: extensionRuntime,
    reliability: reliabilityEngine,
    enabled: featureFlags.evaluate("extensions.sdk").enabled,
    developerMode: process.env.NOON_EXTENSION_DEV_MODE === "true",
    observability: (event, metadata) => toolAuditLog.append(`extensions.${event}`, metadata),
  });
  extensionRuntime.bindRegistry(extensionRegistry);
  // Client MCP (flag connectors.mcp, OFF par défaut) : outils en lecture seule
  // validés par l'utilisateur, jetons dans le coffre safeStorage existant.
  const mcpService = createMcpService({
    enabled: featureFlags.evaluate("connectors.mcp").enabled && !UI_VALIDATION_MODE && process.env.NOON_SMOKE_TEST !== "1",
    dataDirectory: DATA_DIRECTORY,
    tokenStore: integrationTokenStore,
    skillRegistry,
    clientVersion: require("../../package.json").version,
    // Mode local uniquement / hors ligne : aucun serveur MCP distant (Figma = REMOTE_FIGMA).
    isRemoteAllowed: (capabilityId) => localIntelligenceRuntime.preflight({ requiredCapabilities: [capabilityId] }).status === "AVAILABLE",
    observability: (event, metadata) => toolAuditLog.append(event, metadata),
  });
  // L'extension de démonstration reste disponible pour les tests de développement,
  // mais ne doit jamais concurrencer la vraie recherche publique en production.
  if (process.env.NOON_ENABLE_EXAMPLE_SEARCH_EXTENSION === "true") {
    extensionRegistry.discover({ manifest: noonExampleSearchExtension.manifest, module: noonExampleSearchExtension, provenance: "BUNDLED", trust: "TRUSTED", signed: true });
    extensionRegistry.install(noonExampleSearchExtension.manifest.id, { approvedPermissions: noonExampleSearchExtension.manifest.permissions });
    void extensionRegistry.enable(noonExampleSearchExtension.manifest.id).catch((error) => {
      toolAuditLog.append("extensions.extension_failed", { extensionId: noonExampleSearchExtension.manifest.id, errorCode: String(error.code || "ACTIVATION_FAILED") });
    });
  }

  return { extensionRegistry, mcpService };
}

module.exports = { DEPENDENCIES, createExtensionsComposition };
