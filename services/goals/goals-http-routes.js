"use strict";

// V3-L7 — routes des objectifs (dont la reprise Goal Mode DEV) et de la décision, sorties de
// server.js.
// Bloc déplacé tel quel depuis server.js ; ses dépendances sont lues à chaque requête
// (accesseurs), ce qui préserve les variables initialisées plus tard au démarrage.

const { NOT_HANDLED } = require("../http/route-result");

const DEPENDENCIES = Object.freeze(["GOAL_MODE_DEV_HTTP_PREFIX","decisionSupportEngine","devDecisionConsumer","goalDevExecutionService","goalDevRetryHttpStatus","goalDevRetryRuntime","goalModeDevHttp","goalStrategyEngine","normalizeGoalDevRetryPrepareRequest","normalizeGoalDevRetryResumeRequest","projectGoalDevRetryPermitResponse","projectGoalDevRetryResumeResponse","readJsonBody","requireTrustedDevUi"]);

function createGoalsHttpRoutes(deps) {
  for (const name of DEPENDENCIES) if (!(name in deps)) throw new TypeError(`Dépendance manquante : ${name}`);
  return async function handle(req, res, requestPath) {
    const {
      GOAL_MODE_DEV_HTTP_PREFIX,
      decisionSupportEngine,
      devDecisionConsumer,
      goalDevExecutionService,
      goalDevRetryHttpStatus,
      goalDevRetryRuntime,
      goalModeDevHttp,
      goalStrategyEngine,
      normalizeGoalDevRetryPrepareRequest,
      normalizeGoalDevRetryResumeRequest,
      projectGoalDevRetryPermitResponse,
      projectGoalDevRetryResumeResponse,
      readJsonBody,
      requireTrustedDevUi,
    } = deps;

    // Une comparaison produit uniquement une recommandation structurée. Cette
    // route ne transmet jamais le résultat aux outils d'exécution.
    // Branchement B2 : avant toutes les routes /api/goals génériques (GET et POST).
    if (requestPath.startsWith(GOAL_MODE_DEV_HTTP_PREFIX)) {
      return goalModeDevHttp.handle(req, res, requestPath);
    }

    if (req.method === "GET" && req.url.startsWith("/api/goals")) {
      try {
        const url = new URL(req.url, `http://${req.headers.host}`);
        const profileScope = String(url.searchParams.get("profileScope") || "arnaud").slice(0, 80);
        const goals = goalStrategyEngine.registry.list({
          profileScope,
          workspaceId: url.searchParams.get("workspaceId") || null,
          projectId: url.searchParams.get("projectId") || null,
        });
        res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        return res.end(JSON.stringify({ status: "ok", goals, candidates: goalStrategyEngine.registry.listCandidates({ profileScope }) }));
      } catch (error) {
        res.writeHead(400, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ status: "error", code: error.code || null, message: error.message }));
      }
    }

    function sendGoalDevRetryError(
      res,
      error
    ) {
      res.writeHead(
        goalDevRetryHttpStatus(
          error
        ),
        {
          "Content-Type":
            "application/json",
          "Cache-Control":
            "no-store",
        }
      );

      return res.end(
        JSON.stringify({
          status: "error",

          code:
            error?.code ||
            "GOAL_DEV_RETRY_API_FAILURE",

          message:
            error?.message ||
            "Erreur Retry DEV.",
        })
      );
    }

    /*
     * 4.6K — surface HTTP minimale du Retry Runtime.
     *
     * Le renderer ne peut fournir que :
     * - chainId à la préparation ;
     * - approvalId + resumeToken + décision explicite à la reprise.
     *
     * Aucun taskId, workspace, projet, chemin, permission ou template
     * provenant du client n'est accepté par ce contrat.
     */
    if (
      requestPath ===
        "/api/goals/dev-retry/prepare" &&
      req.method === "POST"
    ) {
      try {
        requireTrustedDevUi(req);

        const body =
          await readJsonBody(
            req,
            8 * 1024
          );

        const input =
          normalizeGoalDevRetryPrepareRequest(
            body
          );

        const permit =
          await goalDevRetryRuntime
            .permitService
            .prepare(
              input
            );

        const retry =
          projectGoalDevRetryPermitResponse(
            permit
          );

        res.writeHead(
          202,
          {
            "Content-Type":
              "application/json",
            "Cache-Control":
              "no-store",
          }
        );

        return res.end(
          JSON.stringify({
            status: "ok",
            retry,
          })
        );
      } catch (error) {
        return sendGoalDevRetryError(
          res,
          error
        );
      }
    }

    if (
      requestPath ===
        "/api/goals/dev-retry/resume" &&
      req.method === "POST"
    ) {
      try {
        requireTrustedDevUi(req);

        const body =
          await readJsonBody(
            req,
            8 * 1024
          );

        /*
         * decision est obligatoire au niveau HTTP.
         * L'API ne doit jamais hériter du défaut
         * "approve" du service interne.
         */
        const input =
          normalizeGoalDevRetryResumeRequest(
            body
          );

        const resumed =
          await goalDevRetryRuntime
            .approvedRetryService
            .resume(
              input
            );

        const retry =
          projectGoalDevRetryResumeResponse(
            resumed
          );

        res.writeHead(
          200,
          {
            "Content-Type":
              "application/json",
            "Cache-Control":
              "no-store",
          }
        );

        return res.end(
          JSON.stringify({
            status: "ok",
            retry,
          })
        );
      } catch (error) {
        return sendGoalDevRetryError(
          res,
          error
        );
      }
    }

    if (req.method === "POST" && req.url.startsWith("/api/goals/")) {
      try {
        if (req.headers["x-noon-request"] !== "1") throw Object.assign(new Error("Requête Noon refusée."), { statusCode: 403 });
        const body = await readJsonBody(req, 256 * 1024);
        const action = new URL(req.url, `http://${req.headers.host}`).pathname.slice("/api/goals/".length);
        let result;
        if (action === "create") result = goalStrategyEngine.createGoal(body.goal || body);
        else if (action === "candidate") result = goalStrategyEngine.proposeGoal(body.goal || body);
        else if (action === "confirm") result = goalStrategyEngine.confirmCandidate(body.candidateId, body.goal || {});
        else if (action === "update") result = goalStrategyEngine.updateGoal(body.goalId, body.changes || {}, { userConfirmed: body.userConfirmed === true });
        else if (action === "transition") result = goalStrategyEngine.transition(body.goalId, body.status, { userConfirmed: body.userConfirmed === true, evidence: body.evidence || {} });
        else if (action === "milestone") result = goalStrategyEngine.addMilestone(body.goalId, body.milestone || {}, { userConfirmed: body.userConfirmed === true });
        else if (action === "strategy") result = goalStrategyEngine.versionStrategy(body.goalId, body.strategy || {}, { userConfirmed: body.userConfirmed === true });
        else if (action === "review") result = goalStrategyEngine.reviewGoal(body.goalId, body.review || {});
        else if (action === "alignment") result = goalStrategyEngine.evaluateAlignment(body.subject || {}, body.scope || {}, body.evidence || []);
        else if (action === "dev-run") {
          if (body.userConfirmed !== true) {
            throw Object.assign(
              new Error("Le lancement DEV depuis Goal requiert une confirmation explicite."),
              {
                statusCode: 400,
                code: "GOAL_DEV_EXECUTION_CONFIRMATION_REQUIRED",
              }
            );
          }

          result =
            await goalDevExecutionService.run({
              goalId:
                body.goalId,
              request:
                body.devTask || {},
            });
        }
        else throw Object.assign(new Error("Action Goal inconnue."), { statusCode: 404 });
        res.writeHead(action === "create" ? 201 : 200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        return res.end(JSON.stringify({ status: "ok", result }));
      } catch (error) {
        res.writeHead(error.statusCode || (error.code === "GOAL_NOT_FOUND" ? 404 : 400), { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ status: "error", code: error.code || null, message: error.message }));
      }
    }

    if (req.method === "POST" && req.url === "/api/decision/compare") {
      try {
        if (req.headers["x-noon-request"] !== "1") throw Object.assign(new Error("Requête Noon refusée."), { statusCode: 403 });
        const body = await readJsonBody(req, 256 * 1024);

        let result;

        if (body.devEvidence !== undefined) {
          if (
            !body.decision ||
            typeof body.decision !== "object" ||
            Array.isArray(body.decision)
          ) {
            throw new TypeError(
              "decision explicite requise avec devEvidence."
            );
          }

          result =
            devDecisionConsumer.compare({
              decisionRequest:
                body.decision,

              devEvidence:
                body.devEvidence,

              remote:
                body.remote === true,
            });
        } else {
          result =
            decisionSupportEngine.compare(
              body.decision || body,
              {
                remote:
                  body.remote === true,
              }
            );
        }

        res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        return res.end(JSON.stringify({ status: "ok", result }));
      } catch (error) {
        res.writeHead(error.statusCode || 400, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ status: "error", code: error.code || null, message: error.message }));
      }
    }

    if (req.method === "POST" && req.url === "/api/decision/record") {
      try {
        if (req.headers["x-noon-request"] !== "1") throw Object.assign(new Error("Requête Noon refusée."), { statusCode: 403 });
        const body = await readJsonBody(req, 64 * 1024);
        const record = decisionSupportEngine.recordChoice(body);
        res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        return res.end(JSON.stringify({ status: "ok", record }));
      } catch (error) {
        res.writeHead(error.statusCode || 400, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ status: "error", code: error.code || null, message: error.message }));
      }
    }

    return NOT_HANDLED;
  };
}

module.exports = { DEPENDENCIES, createGoalsHttpRoutes };
