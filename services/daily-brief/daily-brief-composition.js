"use strict";

// V3-L7 — assemblage du Brief quotidien, sorti de server.js : collecte des sources (service du
// matin), contexte personnel local, planification, composition distante bornée (préflight, budget,
// politique de confidentialité), journal d'usage et génération. Aucune écriture externe :
// `prepareDrafts` reste vide, les écritures passent par le circuit d'approbation.
// Domaine déplacé tel quel depuis server.js. Dépendances déjà déclarées quand server.js le
// construit : lues une fois ; les autres (`deps.x`) : lues à chaque usage, par accesseur.

const DEPENDENCIES = Object.freeze(["DATA_DIRECTORY","authorizeOpenAIPrivacy","buildMorningBriefPrompt","calendarConnector","contextBuilder","countWebSearchCalls","createBriefUsageLog","createDailyBriefEngine","createMorningBriefService","creativeBriefStore","dailyPlanningEngine","estimateModelCost","executionTrackingEngine","extractWebSources","fs","getBudgetStatus","gmailConnector","localIntelligenceRuntime","memoryEngine","noonObservability","normalizeGmailMessage","notesConnector","openAIProviderAdapter","path","personalBriefStore","planningPreferenceStore","priorityEngine","proactiveEngine","projectIntelligenceService","redactSecrets","registerWebSearchCalls","reliabilityEngine","remindersConnector","reviewLearningEngine","selectModelRoute","toolAuditLog","trackUsage"]);

function createDailyBriefComposition(deps) {
  for (const name of DEPENDENCIES) if (!(name in deps)) throw new TypeError(`Dépendance manquante : ${name}`);
  const {
    DATA_DIRECTORY,
    authorizeOpenAIPrivacy,
    buildMorningBriefPrompt,
    calendarConnector,
    contextBuilder,
    countWebSearchCalls,
    createBriefUsageLog,
    createDailyBriefEngine,
    createMorningBriefService,
    creativeBriefStore,
    dailyPlanningEngine,
    estimateModelCost,
    executionTrackingEngine,
    extractWebSources,
    fs,
    getBudgetStatus,
    gmailConnector,
    localIntelligenceRuntime,
    memoryEngine,
    noonObservability,
    normalizeGmailMessage,
    notesConnector,
    openAIProviderAdapter,
    path,
    personalBriefStore,
    planningPreferenceStore,
    priorityEngine,
    proactiveEngine,
    projectIntelligenceService,
    redactSecrets,
    registerWebSearchCalls,
    reliabilityEngine,
    remindersConnector,
    reviewLearningEngine,
    selectModelRoute,
    toolAuditLog,
    trackUsage,
  } = deps;

  const morningBriefService = createMorningBriefService({
    calendar: calendarConnector, gmail: gmailConnector, reminders: remindersConnector, notes: notesConnector,
    normalizeGmailMessage, localContext: buildPersonalBriefContext, reliability: reliabilityEngine,
  });

  function buildPersonalBriefContext() {
    let journals = {};
    try {
      const saved = JSON.parse(fs.readFileSync(path.join(DATA_DIRECTORY, "project-journals.json"), "utf8"));
      journals = saved?.projects && typeof saved.projects === "object" ? saved.projects : {};
    } catch {}

    const projects = Object.values(journals).slice(0, 20).map((journal) => ({
      project: journal.projectName || journal.projectId || "Projet",
      status: journal.status || "inconnu",
      nextAction: journal.nextAction || null,
      blockers: Array.isArray(journal.blockers) ? journal.blockers.slice(0, 5) : [],
      decisions: Array.isArray(journal.decisions) ? journal.decisions.slice(-3) : [],
    }));
    const memories = memoryEngine.getRelevantContext({
      query: "priorités objectifs projets préférences de travail",
      channel: "brief",
      purpose: "local",
      includeConversation: false,
      maxItems: 20,
      maxCharacters: 8000,
    }).relevantMemories.map((memory) => memory.value);

    // Conserver une représentation structurée pour que le moteur de priorisation
    // puisse exploiter les prochaines actions sans relire les fichiers bruts.
    const safeContext = JSON.parse(redactSecrets(JSON.stringify({ projects, memories })));
    return { ...safeContext, localContext: JSON.stringify(safeContext) };
  }

  // Le stockage personnel devient le stockage canonique du Daily Brief. Les
  // anciennes routes restent disponibles plus bas comme adaptateurs temporaires.
  const dailyBriefEngine = createDailyBriefEngine({
    store: personalBriefStore,
    collect: async (at, settings) => {
      const context = await morningBriefService.collectSources(at, settings);
      return { ...context, actions: morningBriefService.buildActionCandidates(context) };
    },
    schedule: async (actions, context, _settings, at) => {
      const plan = await dailyPlanningEngine.buildPlan({
        actions,
        events: context.calendarEvents || [],
        calendarStatus: context.sources?.find((source) => source.id === "google-calendar")?.status || "unknown",
        calendarComplete: context.calendarComplete,
        at,
        trigger: "daily_brief",
      });
      executionTrackingEngine.ingestPlan(plan);
      return { plan, blocks: [...plan.plannedBlocks, ...plan.proposedBlocks] };
    },
    // Brief generation proposes work; external writes require the explicit approval pipeline.
    prepareDrafts: () => [],
    contextBuilder,
    priorityEngine,
    proactiveEngine,
    trackingProvider: ({ at, date }) => {
      const yesterday = new Date(at.getTime() - 24 * 60 * 60 * 1000);
      const fromDate = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit",
      }).format(yesterday);
      const items = executionTrackingEngine.list({ subjectScope: "arnaud" });
      return {
        carryOver: executionTrackingEngine.rollover({ fromDate, toDate: date, at }),
        blockers: items.filter((item) => item.status === "blocked"),
        deferred: items.filter((item) => item.status === "deferred"),
      };
    },
    reviewProvider: ({ at }) => {
      const yesterday = new Date(at.getTime() - 24 * 60 * 60 * 1000);
      const weekday = new Intl.DateTimeFormat("en-US", {
        timeZone: "Europe/Paris", weekday: "short",
      }).format(at);
      return weekday === "Mon"
        ? reviewLearningEngine.generateWeekly({ at: yesterday, subjectScope: "arnaud" })
        : reviewLearningEngine.generateDaily({
          date: new Intl.DateTimeFormat("en-CA", {
            timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit",
          }).format(yesterday),
          subjectScope: "arnaud",
        });
    },
    settingsProvider: () => planningPreferenceStore.load().settings,
    projectProvider: () => projectIntelligenceService.listWithSignals(),
    creativeProvider: () => [],
    audit: (event, metadata) => toolAuditLog.append(event, metadata),
    observability: noonObservability,
    compose: async ({ structured, personalContext }) => {
      const runtimeDecision = localIntelligenceRuntime.preflight({ requiredCapabilities: ["REMOTE_REASONING"] });
      if (runtimeDecision.status !== "AVAILABLE") throw Object.assign(new Error("Composition distante bloquée par la politique locale ou le réseau."), { code: "REMOTE_COMPOSITION_BLOCKED" });
      if (getBudgetStatus().mode === "BLOCKED") {
        const error = new Error("Budget mensuel Noon atteint.");
        error.code = "BUDGET_BLOCKED";
        throw error;
      }
      const recentTopics = creativeBriefStore.load().topics || [];
      const creativeInstruction = [
        "Ajoute une section VEILLE CRÉATIVE uniquement si une évolution récente et conséquente est trouvée.",
        "Utilise au maximum deux recherches Web, cite les sources directes et évite les sujets déjà traités sans évolution.",
        `Sujets récents à éviter : ${JSON.stringify(recentTopics.slice(0, 30))}`,
      ].join(" ");
      const prompt = buildMorningBriefPrompt({
        ...structured,
        contextPersonnelAutorise: personalContext.remoteModelContext,
        mondayVision: new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Paris", weekday: "short" }).format(new Date(`${structured.date}T12:00:00Z`)) === "Mon",
        creativeWatch: creativeInstruction,
      });
      const route = selectModelRoute({
        question: "Composer le brief quotidien, hiérarchiser les priorités et synthétiser les sources.",
        profile: "balanced",
        budgetMode: getBudgetStatus().mode,
        context: {
          estimatedTokens: personalContext.metadata?.estimatedTokens || 0,
          sourceCount: structured.sources?.length || 0,
          memoryRequired: (personalContext.metadata?.memoryIds?.length || 0) > 0,
          truncated: personalContext.metadata?.truncated === true,
        },
        tools: { hasTools: true, expectedCount: 1 },
        output: { expectedLength: "long" },
        risk: { level: "medium" },
      });
      const privacyDecisionToken = authorizeOpenAIPrivacy([
        { source: "daily_brief_prompt", classification: "PRIVATE", content: [prompt.system, prompt.user] },
      ]);
      const response = await openAIProviderAdapter.execute({
        model: route.model, store: false,
        reasoning: { effort: route.effort, context: "current_turn" },
        text: { verbosity: route.verbosity },
        tools: [{ type: "web_search" }], toolChoice: "auto", maxToolCalls: 2,
        input: [{ role: "system", content: prompt.system }, { role: "user", content: prompt.user }],
      }, { privacyDecisionToken });
      trackUsage(response);
      const webCalls = countWebSearchCalls(response);
      registerWebSearchCalls(webCalls);
      const sources = extractWebSources(response);
      return {
        content: response.text?.trim(), modelCalls: 1, models: [route.model], routing: route,
        inputTokens: response.usage?.inputTokens || 0, outputTokens: response.usage?.outputTokens || 0,
        costEstimate: estimateModelCost(route.model, response.usage || {}),
        sources, topics: sources.map((source) => ({ date: structured.date, title: source.title, url: source.url, theme: "veille créative" })),
      };
    },
  });

  // V3-L2d : journal local d'usage du Brief (horodatages seulement, aucun contenu).
  const briefUsageLog = createBriefUsageLog({ filePath: path.join(DATA_DIRECTORY, "brief-usage-log.json") });

  function briefScheduledTime() {
    try { return JSON.parse(fs.readFileSync(path.join(DATA_DIRECTORY, "preferences.json"), "utf8")).creativeBriefTime || "07:00"; } catch { return "07:00"; }
  }

  const safeUsageLog = (fn) => { try { fn(); } catch (error) { toolAuditLog.append("brief_usage.write_failed", { code: error?.code || "WRITE_FAILED" }); } };

  async function generateDailyBrief({ force = false } = {}) {
    return dailyBriefEngine.generate({ force, at: new Date() });
  }

  return { dailyBriefEngine, briefUsageLog, briefScheduledTime, safeUsageLog, generateDailyBrief };
}

module.exports = { DEPENDENCIES, createDailyBriefComposition };
