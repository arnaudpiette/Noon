"use strict";

const { GoalError, MILESTONE_STATUSES, TRAJECTORIES, normalizeProgress } = require("./goal-schema");

function createGoalProgressService({ now = () => new Date() } = {}) {
  function assess(goal, evidence = {}) {
    const milestones = goal.milestones || [];
    const achieved = milestones.filter((item) => item.status === "ACHIEVED");
    const blocked = milestones.filter((item) => item.status === "BLOCKED");
    const evidenceRefs = [...new Set([...(evidence.evidenceRefs || []), ...milestones.flatMap((item) => item.evidenceRefs || [])])];
    let progress = normalizeProgress({ method: "UNKNOWN", status: "UNKNOWN" });
    if (milestones.length && evidenceRefs.length) {
      progress = normalizeProgress({ status: achieved.length === milestones.length ? "COMPLETED" : achieved.length ? "IN_PROGRESS" : "NOT_STARTED", method: "MILESTONE_BASED", value: achieved.length / milestones.length * 100, confidence: 0.85, measuredAt: now(), evidenceRefs });
    } else if (evidence.userReported === true) {
      progress = normalizeProgress({ status: evidence.status || "IN_PROGRESS", method: "USER_REPORTED", value: evidence.value, confidence: evidence.confidence ?? 0.8, measuredAt: now(), evidenceRefs });
    } else if (evidence.measured === true && Number.isFinite(Number(evidence.value))) {
      progress = normalizeProgress({ status: evidence.status || "IN_PROGRESS", method: "MEASURED", value: evidence.value, confidence: evidence.confidence ?? 0.9, measuredAt: now(), evidenceRefs });
    }
    let trajectory = "UNKNOWN";
    if (blocked.length) trajectory = "BLOCKED";
    else if (goal.targetDate && new Date(goal.targetDate) < now() && progress.status !== "COMPLETED") trajectory = "OFF_TRACK";
    else if (goal.targetDate && new Date(goal.targetDate).getTime() - now().getTime() < 7 * 86_400_000 && progress.status !== "COMPLETED") trajectory = "AT_RISK";
    else if (progress.method !== "UNKNOWN") trajectory = "ON_TRACK";
    if (!TRAJECTORIES.includes(trajectory)) trajectory = "UNKNOWN";
    return Object.freeze({ status: progress.status, trajectory, blockers: blocked.map((item) => item.milestoneId), nextMilestone: milestones.find((item) => !["ACHIEVED", "SKIPPED"].includes(item.status))?.milestoneId || null, confidence: progress.confidence, evidenceRefs, progress, milestoneSummary: { achieved: achieved.length, total: milestones.length } });
  }

  function achievementCandidate(goal, assessment, { userConfirmed = false } = {}) {
    const criteriaMet = goal.successCriteria.length > 0 && goal.successCriteria.every((criterion) => criterion.status === "MET");
    const milestonesMet = goal.milestones.length > 0 && goal.milestones.every((item) => ["ACHIEVED", "SKIPPED"].includes(item.status));
    return { candidate: criteriaMet || milestonesMet, canTransition: userConfirmed === true && (criteriaMet || milestonesMet), evidenceRefs: assessment.evidenceRefs, requiresUserConfirmation: userConfirmed !== true };
  }

  function assertMilestoneStatus(status) { if (!MILESTONE_STATUSES.includes(status)) throw new GoalError("MILESTONE_STATUS_INVALID", "Statut de jalon invalide."); }
  return { achievementCandidate, assess, assertMilestoneStatus };
}

module.exports = { createGoalProgressService };
