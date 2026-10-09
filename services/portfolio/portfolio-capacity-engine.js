"use strict";

const { createCapacityService, fingerprint } = require("./capacity-service");
const { CAPACITY_HORIZONS, OVERLOAD_STATES, enumValue, id, iso, normalizeGuardrail, normalizePortfolioItem } = require("./portfolio-schema");

const ACTIVE = new Set(["ACTIVE"]);
function sumKnown(items, key, capacityType = "USER_TIME") {
  return items.filter((item) => item.capacityDemand.capacityType === capacityType && item.capacityDemand[key] !== null)
    .reduce((sum, item) => sum + item.capacityDemand[key] + (item.capacityDemand.buffer?.minutes || 0), 0);
}
function assessOverload(capacity, items, { tightRatio = 0.85 } = {}) {
  const userItems = items.filter((item) => item.capacityDemand.capacityType === "USER_TIME");
  const unknown = userItems.filter((item) => item.capacityDemand.expectedEstimate === null);
  const minimumDemand = sumKnown(userItems, "minimumEstimate");
  const expectedDemand = sumKnown(userItems, "expectedEstimate");
  const maximumDemand = sumKnown(userItems, "maximumEstimate");
  const available = capacity.flexibleCapacity;
  let state = "UNKNOWN";
  if (available !== null) {
    if (minimumDemand > available) state = minimumDemand > available * 1.25 ? "SEVERELY_OVERLOADED" : "OVERLOADED";
    else if (!unknown.length) state = expectedDemand > available * 1.25 ? "SEVERELY_OVERLOADED"
      : expectedDemand > available ? "OVERLOADED" : expectedDemand >= available * tightRatio ? "TIGHT" : "HEALTHY";
  }
  return Object.freeze({ overloadId: id("overload", [capacity.capacitySnapshotId, items.map((item) => item.portfolioItemId)]),
    horizon: capacity.horizon, state, minimumDemand, expectedDemand: unknown.length ? null : expectedDemand,
    maximumDemand: unknown.length ? null : maximumDemand, knownExpectedDemand: expectedDemand, availableCapacity: available,
    minimumGap: available === null ? null : available - minimumDemand,
    expectedGap: available === null || unknown.length ? null : available - expectedDemand,
    worstCaseGap: available === null || unknown.length ? null : available - maximumDemand,
    confidence: capacity.availabilityState === "KNOWN" && !unknown.length && userItems.every((item) => ["HIGH", "MEDIUM"].includes(item.capacityDemand.confidence)) ? "HIGH" : unknown.length || available === null ? "UNKNOWN" : "LOW",
    unknownEstimateRefs: unknown.map((item) => item.itemRef), drivers: [], impactedGoals: [...new Set(items.flatMap((item) => item.goalRefs))],
    impactedProjects: [...new Set(items.map((item) => item.projectRef).filter(Boolean))], utilization: available && !unknown.length ? expectedDemand / available : null });
}
function deadlineClusters(items, windowDays = 4) {
  const dated = items.filter((item) => item.deadline).sort((a, b) => Date.parse(a.deadline) - Date.parse(b.deadline));
  const clusters = [];
  for (let index = 0; index < dated.length; index += 1) {
    const group = dated.slice(index).filter((item) => Date.parse(item.deadline) - Date.parse(dated[index].deadline) <= windowDays * 86_400_000);
    if (group.length >= 2) clusters.push({ clusterId: id("deadline", group.map((item) => item.itemRef)), startAt: dated[index].deadline,
      endAt: group.at(-1).deadline, itemRefs: group.map((item) => item.itemRef), demandKnown: group.every((item) => item.capacityDemand.expectedEstimate !== null),
      overloadClaimed: false });
  }
  return clusters.filter((cluster, index, all) => !all.slice(0, index).some((entry) => cluster.itemRefs.every((ref) => entry.itemRefs.includes(ref))));
}
function allocation(items, goals = [], guardrails = []) {
  const planned = items.reduce((sum, item) => sum + (item.capacityDemand.expectedEstimate || 0), 0);
  const byGoal = new Map();
  for (const item of items) for (const goalRef of item.goalRefs) byGoal.set(goalRef, (byGoal.get(goalRef) || 0) + (item.capacityDemand.expectedEstimate || 0));
  const rows = goals.map((goal) => ({ goalRef: String(goal.goalId || goal.goalRef), importance: goal.importance ?? null,
    allocatedMinutes: byGoal.get(String(goal.goalId || goal.goalRef)) || 0,
    capacityShare: planned ? (byGoal.get(String(goal.goalId || goal.goalRef)) || 0) / planned : null,
    intentionalZero: items.some((item) => item.goalRefs.includes(String(goal.goalId || goal.goalRef)) && item.intentionalZeroAllocation) }));
  const gaps = rows.filter((row) => row.allocatedMinutes === 0 && !row.intentionalZero && ["HIGH", "CRITICAL", 4, 5].includes(row.importance))
    .map((row) => ({ type: "STRATEGIC_ALLOCATION_GAP", goalRef: row.goalRef, automaticReprioritization: false }));
  for (const raw of guardrails) {
    const guardrail = normalizeGuardrail(raw); const row = rows.find((entry) => entry.goalRef === guardrail.targetRef);
    const actual = row?.allocatedMinutes || 0;
    if (guardrail.minimumCapacity !== null && actual < guardrail.minimumCapacity) gaps.push({ type: "MINIMUM_GUARDRAIL_GAP", targetRef: guardrail.targetRef, gapMinutes: guardrail.minimumCapacity - actual, strength: guardrail.strength });
    if (guardrail.maximumCapacity !== null && actual > guardrail.maximumCapacity) gaps.push({ type: "MAXIMUM_GUARDRAIL_GAP", targetRef: guardrail.targetRef, gapMinutes: actual - guardrail.maximumCapacity, strength: guardrail.strength });
  }
  return { strategicAllocation: rows, allocationGaps: gaps };
}

function createPortfolioCapacityEngine({ capacityService = createCapacityService(), decisionSupportEngine = null, now = () => new Date(), audit = null, metrics = null, featureMode = "SHADOW" } = {}) {
  const snapshots = new Map(); const scenarios = new Map();
  function createSnapshot(raw = {}) {
    const started = performance.now(); const horizon = enumValue(raw.horizon, CAPACITY_HORIZONS, "WEEK");
    const workspaceRef = raw.workspaceRef ? String(raw.workspaceRef) : null; const profileScope = String(raw.profileScope || "owner");
    const items = (raw.items || []).map(normalizePortfolioItem).filter((item) => ACTIVE.has(item.status))
      .filter((item) => (!workspaceRef || item.workspaceRef === workspaceRef) && item.profileScope === profileScope);
    const capacity = raw.capacitySnapshot || capacityService.snapshot({ ...(raw.capacity || {}), horizon, workspaceRef, profileScope });
    const overload = assessOverload(capacity, items, raw.thresholds);
    const clusters = deadlineClusters(items, raw.deadlineClusterDays);
    const blockers = items.filter((item) => item.dependencies.length || item.blockedUntil).map((item) => ({ itemRef: item.itemRef,
      dependencyRefs: item.dependencies, blockedUntil: item.blockedUntil, futureCompression: Boolean(item.blockedUntil && item.deadline && Date.parse(item.deadline) > Date.parse(item.blockedUntil)) }));
    const goalView = allocation(items, raw.goals || [], raw.guardrails || []);
    const human = items.filter((item) => item.capacityDemand.capacityType === "USER_TIME");
    const noon = items.filter((item) => item.capacityDemand.capacityType === "NOON_BACKGROUND");
    const fragments = human.filter((item) => item.capacityDemand.expectedEstimate !== null && item.capacityDemand.expectedEstimate < 60);
    const snapshotId = id("portfolio_snapshot", [capacity.capacitySnapshotId, items.map((item) => item.portfolioItemId), raw.portfolioRevision]);
    const result = Object.freeze({ portfolioSnapshotId: snapshotId, horizon, workspaceRef, profileScope, items, availableCapacity: capacity,
      expectedDemand: overload.expectedDemand, knownExpectedDemand: overload.knownExpectedDemand, overloads: [overload],
      strategicAllocation: goalView.strategicAllocation, allocationGaps: goalView.allocationGaps, deadlineClusters: clusters, blockers,
      scenariosSuggested: overload.state === "UNKNOWN" ? ["ESTIMATE_UNKNOWN_ITEMS"] : ["OVERLOADED", "SEVERELY_OVERLOADED"].includes(overload.state) ? ["REDUCE_SCOPE", "MOVE_SOFT_TARGET", "PAUSE_ITEM"] : [],
      confidence: overload.confidence, estimateQuality: Object.fromEntries(["HIGH", "MEDIUM", "LOW", "UNKNOWN"].map((level) => [level, items.filter((item) => item.capacityDemand.confidence === level).length])),
      wip: { activeProjects: items.filter((item) => item.itemType === "PROJECT").length, activeMajorCommitments: items.filter((item) => item.itemType === "MAJOR_COMMITMENT").length },
      fragmentation: { detected: fragments.length >= 4, itemCount: fragments.length, evidenceBased: fragments.length >= 4 },
      capacityByType: { userExpectedMinutes: sumKnown(items, "expectedEstimate", "USER_TIME"), noonBackgroundExpectedMinutes: sumKnown(items, "expectedEstimate", "NOON_BACKGROUND"), externalDependencyMinutes: sumKnown(items, "expectedEstimate", "EXTERNAL_DEPENDENCY"), combined: null },
      readOnly: true, planningAuthority: false, priorityAuthority: false, actionAuthorized: false, generatedAt: now().toISOString(),
      metrics: { active_portfolio_items: items.length, unknown_estimate_count: overload.unknownEstimateRefs.length,
        known_capacity_demand_ratio: items.length ? (items.length - overload.unknownEstimateRefs.length) / items.length : 1,
        overload_count: ["OVERLOADED", "SEVERELY_OVERLOADED"].includes(overload.state) ? 1 : 0,
        portfolio_snapshot_ms: performance.now() - started } });
    snapshots.set(snapshotId, result); audit?.("portfolio_snapshot_created", { horizon, itemCount: items.length, state: overload.state, durationMs: result.metrics.portfolio_snapshot_ms });
    metrics?.record?.("active_portfolio_items", items.length); metrics?.record?.("unknown_estimate_count", overload.unknownEstimateRefs.length);
    if (["OVERLOADED", "SEVERELY_OVERLOADED"].includes(overload.state)) audit?.("portfolio_overload_detected", { horizon, state: overload.state });
    if (clusters.length) audit?.("deadline_cluster_detected", { horizon, count: clusters.length });
    if (goalView.allocationGaps.length) audit?.("allocation_gap_detected", { horizon, count: goalView.allocationGaps.length });
    return structuredClone(result);
  }
  function simulate({ baseSnapshot, changes = [] } = {}) {
    const started = performance.now(); const base = baseSnapshot || null;
    if (!base?.portfolioSnapshotId) throw new TypeError("PortfolioSnapshot de base requis.");
    const changed = base.items.map((item) => ({ ...item, capacityDemand: { ...item.capacityDemand } }));
    for (const change of changes.slice(0, 20)) {
      const item = changed.find((entry) => entry.itemRef === change.itemRef); if (!item) continue;
      if (change.type === "PAUSE_ITEM") item.status = "PAUSED";
      if (change.type === "MOVE_DEADLINE") item.deadline = iso(change.deadline);
      if (change.type === "REDUCE_DEMAND") {
        const expected = Math.max(0, Number(change.expectedEstimate)); item.capacityDemand.expectedEstimate = Number.isFinite(expected) ? expected : item.capacityDemand.expectedEstimate;
        item.capacityDemand.minimumEstimate = Math.min(item.capacityDemand.minimumEstimate ?? expected, expected);
        item.capacityDemand.maximumEstimate = Math.max(item.capacityDemand.maximumEstimate ?? expected, expected);
      }
    }
    const resultSnapshot = createSnapshot({ horizon: base.horizon, workspaceRef: base.workspaceRef, profileScope: base.profileScope,
      items: changed, capacitySnapshot: base.availableCapacity, goals: base.strategicAllocation.map((row) => ({ goalId: row.goalRef, importance: row.importance })) });
    const scenario = Object.freeze({ scenarioId: id("capacity_scenario", [base.portfolioSnapshotId, changes]), baseSnapshotId: base.portfolioSnapshotId,
      changes: structuredClone(changes), resultingCapacity: resultSnapshot.availableCapacity, overloads: resultSnapshot.overloads,
      affectedGoals: [...new Set(changed.filter((item) => changes.some((change) => change.itemRef === item.itemRef)).flatMap((item) => item.goalRefs))],
      tradeoffs: changes.map((change) => ({ itemRef: change.itemRef, changeType: change.type, requiresUserChoice: true })),
      demandDeltaMinutes: base.knownExpectedDemand - resultSnapshot.knownExpectedDemand, simulationOnly: true,
      calendarWrites: 0, projectWrites: 0, goalWrites: 0, actionAuthorized: false, durationMs: performance.now() - started });
    scenarios.set(scenario.scenarioId, scenario); audit?.("capacity_scenario_evaluated", { changeCount: changes.length, durationMs: scenario.durationMs });
    return structuredClone(scenario);
  }
  function forecast({ periods = [] } = {}) {
    return periods.slice(0, 12).map((period, index) => { const snapshot = createSnapshot(period); return {
      period: period.label || `${snapshot.horizon}-${index + 1}`, available: snapshot.availableCapacity.flexibleCapacity,
      expectedDemand: snapshot.expectedDemand, confidence: index > 3 && snapshot.confidence === "HIGH" ? "MEDIUM" : index > 7 ? "LOW" : snapshot.confidence,
      state: snapshot.overloads[0].state, granularity: index > 3 ? "COARSE" : "DETAILED" }; });
  }
  function decisionRequest(snapshot, options = []) {
    if (!snapshot?.portfolioSnapshotId) {
      throw new TypeError("PortfolioSnapshot requis.");
    }

    const alternatives =
      Array.isArray(options)
        ? options.slice(0, 19)
        : [];

    if (!alternatives.length) {
      throw Object.assign(
        new Error(
          "Au moins une alternative est nécessaire pour comparer avec l'état courant."
        ),
        {
          code: "PORTFOLIO_DECISION_OPTIONS_INSUFFICIENT",
        }
      );
    }

    const scope = {
      profileScope: String(
        snapshot.profileScope || "owner"
      ),
      workspaceId:
        snapshot.workspaceRef ?? null,
      projectId: null,
      purpose: "LOCAL_ANALYSIS",
    };

    const criterionIds = Object.freeze({
      timeDemand: "portfolio-time-demand",
      capacityGap: "portfolio-capacity-gap",
      deadlineRisk: "portfolio-deadline-risk",
    });

    const criteria = [
      {
        criterionId: criterionIds.timeDemand,
        label: "Charge temporelle",
        type: "TIME",
        importance: "HIGH",
        direction: "MINIMIZE",
        requiredEvidence: "VERIFIED",
        range: null,
      },
      {
        criterionId: criterionIds.capacityGap,
        label: "Marge de capacité",
        type: "TIME",
        importance: "CRITICAL",
        direction: "MAXIMIZE",
        requiredEvidence: "VERIFIED",
        range: null,
      },
      {
        criterionId: criterionIds.deadlineRisk,
        label: "Risque échéance",
        type: "RISK",
        importance: "HIGH",
        direction: "MINIMIZE",
        requiredEvidence: "VERIFIED",
        range: null,
      },
    ];

    const scalar = (value) =>
      value === null ||
      ["string", "number", "boolean"].includes(
        typeof value
      );

    const projectValues = (raw = {}) => {
      const source =
        raw &&
        typeof raw === "object" &&
        !Array.isArray(raw)
          ? raw
          : {};

      return Object.fromEntries(
        Object.values(criterionIds)
          .filter(
            (criterionId) =>
              Object.hasOwn(source, criterionId) &&
              scalar(source[criterionId])
          )
          .map((criterionId) => [
            criterionId,
            source[criterionId],
          ])
      );
    };

    const currentOptionId = id(
      "portfolio_current",
      snapshot.portfolioSnapshotId
    );

    const normalizedAlternatives =
      alternatives.map((raw, index) => {
        const candidate =
          raw &&
          typeof raw === "object" &&
          !Array.isArray(raw)
            ? raw
            : {};

        const label = String(
          candidate.label ||
          `Alternative ${index + 1}`
        )
          .trim()
          .slice(0, 180);

        const rawOptionId = String(
          candidate.optionId || ""
        ).trim();

        const optionId =
          rawOptionId &&
          rawOptionId.length <= 160
            ? rawOptionId
            : id(
                "portfolio_option",
                [
                  snapshot.portfolioSnapshotId,
                  index,
                  rawOptionId,
                  label,
                ]
              );

        const option = {
          optionId,
          label:
            label ||
            `Alternative ${index + 1}`,
          source: "USER_PROVIDED",
          assumptions: [],
          values: projectValues(
            candidate.values
          ),
        };

        if (
          candidate.description !== undefined
        ) {
          option.description = String(
            candidate.description
          ).slice(0, 1200);
        }

        return option;
      });

    const requestOptions = [
      {
        optionId: currentOptionId,
        label: "État actuel",
        source: "CURRENT_STATE",
        assumptions: [],
        values: {},
      },
      ...normalizedAlternatives,
    ];

    const overload =
      snapshot.overloads?.[0] || {};

    const evidenceFacts = [
      {
        suffix: "time-demand",
        criterionId:
          criterionIds.timeDemand,
        value:
          snapshot.expectedDemand ?? null,
        critical: false,
      },
      {
        suffix: "capacity-gap",
        criterionId:
          criterionIds.capacityGap,
        value:
          overload.expectedGap ?? null,
        critical: true,
      },
      {
        suffix: "deadline-risk",
        criterionId:
          criterionIds.deadlineRisk,
        value:
          Array.isArray(
            snapshot.deadlineClusters
          )
            ? snapshot.deadlineClusters.length
            : null,
        critical: false,
      },
    ];

    const evidence =
      evidenceFacts.map((fact) => {
        const evidenceId = id(
          "portfolio_evidence",
          [
            snapshot.portfolioSnapshotId,
            currentOptionId,
            fact.suffix,
          ]
        );

        return {
          evidenceId,
          claimId: id(
            "portfolio_claim",
            [
              snapshot.portfolioSnapshotId,
              fact.criterionId,
            ]
          ),
          optionId: currentOptionId,
          criterionId:
            fact.criterionId,
          stance: "SUPPORTS",
          value: fact.value,
          kind: "SYSTEM_OBSERVATION",
          authority: "SYSTEM",
          verificationStatus: "VERIFIED",
          critical: fact.critical,
          provenance: {
            producer:
              "portfolio-capacity-engine",
            sourceType:
              "portfolio_snapshot",
            sourceRef:
              snapshot.portfolioSnapshotId,
            locatorRef: null,
            method:
              "deterministic_snapshot_projection",
            rootEvidenceId: null,
          },
          scope,
          observedAt:
            snapshot.generatedAt,
          validUntil:
            snapshot.availableCapacity
              ?.endAt ?? null,
          freshnessRequirement:
            "CURRENT",
          claimFingerprint:
            fingerprint({
              snapshotId:
                snapshot.portfolioSnapshotId,
              criterionId:
                fact.criterionId,
              value: fact.value,
            }),
          independenceKey:
            snapshot.portfolioSnapshotId,
          derivedFromEvidenceIds: [],
          localOnly: true,
          allowedForRemoteModel: false,
          untrustedContent: false,
        };
      });

    const request = {
      schemaVersion: 2,
      decisionId: id(
        "portfolio_decision",
        [
          snapshot.portfolioSnapshotId,
          requestOptions.map(
            (option) => option.optionId
          ),
        ]
      ),
      decisionType: "COMPARE",
      evaluationAt:
        snapshot.generatedAt,
      scope,
      options: requestOptions,
      criteria,
      constraints: [
        {
          constraintId:
            "portfolio-capacity-nonnegative",
          optionId: null,
          criterionId:
            criterionIds.capacityGap,
          operator: "MIN",
          expected: 0,
          strength: "HARD",
          evidenceRequirement:
            "VERIFIED",
        },
      ],
      evidence,
      verificationProposals: [],
      recommendationRequested: true,
      outputMode: "BALANCED",
      contextVersion:
        fingerprint({
          snapshotId:
            snapshot.portfolioSnapshotId,
          generatedAt:
            snapshot.generatedAt,
          overloadId:
            overload.overloadId ?? null,
        }).slice(0, 64),
    };

    const compareOptions = {
      attestedEvidenceIds:
        evidence.map(
          (item) => item.evidenceId
        ),
    };

    if (decisionSupportEngine?.compare) {
      return decisionSupportEngine.compare(
        request,
        compareOptions
      );
    }

    return {
      request,
      requiresDecisionSupport: true,
      recommendationIsAction: false,
      actionAuthorized: false,
      verificationAuthorized: false,
    };
  }
  function remoteSummary(snapshot) {
    const allowed = snapshot.items.filter((item) => !item.localOnly);
    return { horizon: snapshot.horizon, state: snapshot.overloads[0].state, activeItemCount: allowed.length,
      unknownEstimateCount: allowed.filter((item) => item.capacityDemand.expectedEstimate === null).length,
      localOnlyExcluded: snapshot.items.length - allowed.length, titles: [], paths: [], profileScope: null };
  }
  function health() { return { status: "ok", featureMode, snapshots: snapshots.size, scenarios: scenarios.size, readOnly: true,
    executionAuthority: false, calendarWriteAuthority: false, projectWriteAuthority: false, goalWriteAuthority: false }; }
  return { assessOverload, capacityService, createSnapshot, decisionRequest, forecast, health, remoteSummary, simulate };
}

module.exports = { assessOverload, createPortfolioCapacityEngine, deadlineClusters };
