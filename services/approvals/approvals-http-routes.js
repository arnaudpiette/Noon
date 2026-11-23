"use strict";

// V3-L7 — routes HTTP des approbations génériques et de la reprise de l’orchestrateur.
// Bloc déplacé tel quel depuis server.js ; ses dépendances sont lues à chaque requête
// (accesseurs), ce qui préserve les variables initialisées plus tard au démarrage.

const { NOT_HANDLED } = require("../http/route-result");

const DEPENDENCIES = Object.freeze(["approvalManager","assertGenericApprovalAllowed","genericApprovals","noonOrchestrator","readJsonBody"]);

function createApprovalsHttpRoutes(deps) {
  for (const name of DEPENDENCIES) if (!(name in deps)) throw new TypeError(`Dépendance manquante : ${name}`);
  return async function handle(req, res, requestPath) {
    const {
      approvalManager,
      assertGenericApprovalAllowed,
      genericApprovals,
      noonOrchestrator,
      readJsonBody,
    } = deps;

    if (req.method === "GET" && req.url === "/approvals") {
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      // B3a : les approbations Goal Mode DEV ont leur carte dédiée (jamais reprises ici).
      return res.end(JSON.stringify({
        status: "ok",
        approvals: genericApprovals(approvalManager.listPending()),
      }));
    }

    if (req.method === "POST" && requestPath.startsWith("/approvals/")) {
      try {
        if (req.headers["x-noon-request"] !== "1") {
          throw Object.assign(new Error("Requête Noon refusée."), { statusCode: 403 });
        }
        const [, , encodedId, action] = requestPath.split("/");
        if (!["confirm", "reject"].includes(action)) {
          throw Object.assign(new Error("Décision invalide."), { statusCode: 400 });
        }
        // B3a : une approbation Goal Mode DEV ne se reprend que par sa carte dédiée.
        const approval = assertGenericApprovalAllowed(approvalManager.get(decodeURIComponent(encodedId)));
        const result = await noonOrchestrator.resume({
          executionId: approval.executionId,
          approvalId: approval.id,
          decision: action === "confirm" ? "approve" : "reject",
        });
        res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        return res.end(JSON.stringify({ status: result.status, answer: result.text, executionId: result.executionId }));
      } catch (error) {
        const conflict = ["approval_expired", "approval_stale", "APPROVAL_CONSUMED", "APPROVAL_ACTION_CHANGED"].includes(error.code);
        res.writeHead(error.statusCode || (conflict ? 409 : 400), { "Content-Type": "application/json", "Cache-Control": "no-store" });
        return res.end(JSON.stringify({ status: "error", code: error.code || error.type || null, message: error.message }));
      }
    }

    if (req.method === "POST" && req.url === "/orchestrator/approval") {
      try {
        if (req.headers["x-noon-request"] !== "1") {
          const error = new Error("Requête Noon refusée.");
          error.statusCode = 403;
          throw error;
        }
        const body = await readJsonBody(req, 20 * 1024);
        const result = await noonOrchestrator.resume({
          executionId: String(body.executionId || ""),
          approvalId: String(body.approvalId || ""),
          approved: body.approved === true,
          decision: body.decision,
          resumeToken: body.resumeToken,
        });
        res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        return res.end(JSON.stringify({
          status: result.status,
          answer: result.text,
          executionId: result.executionId,
          requestedModel: result.requestedModel,
          modelUsed: result.modelUsed,
          toolCalls: result.toolCalls,
          latency: result.latency,
          approval: result.approval || null,
          specialistProposal: result.specialistProposal || null,
        }));
      } catch (error) {
        res.writeHead(error.statusCode || 400, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        return res.end(JSON.stringify({
          status: "error",
          type: error.type || "approval_required",
          message: error.message,
        }));
      }
    }

    return NOT_HANDLED;
  };
}

module.exports = { DEPENDENCIES, createApprovalsHttpRoutes };
