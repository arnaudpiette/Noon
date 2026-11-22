"use strict";

// V3-L7 — routes DEV, sorties de server.js : banc d'essai (benchmark), agent de l'espace de
// travail, terminal, source control, aperçu, tâches natives et budget DEV.
// Bloc déplacé tel quel depuis server.js ; ses dépendances sont lues à chaque requête
// (accesseurs), ce qui préserve les variables initialisées plus tard au démarrage.

const { NOT_HANDLED } = require("../http/route-result");

const DEPENDENCIES = Object.freeze(["DEFAULT_HOST","assertDevTaskIdNotReserved","benchmarkControlPlane","devCostBudgetService","devProjectRuleResolver","devWorkspaceAgentExecutionLoop","devWorkspaceTerminalService","featureFlags","getValidRegisteredProjects","isReservedGoalModeDevTaskId","nativeDevB3Facade","nativeDevUiExecutionService","normalizeFocusPath","publicDevProgress","readJsonBody","requireTrustedDevUi","resolveFocusCatalogSelection","workspaceEngine"]);

function createDevHttpRoutes(deps) {
  for (const name of DEPENDENCIES) if (!(name in deps)) throw new TypeError(`Dépendance manquante : ${name}`);
  return async function handle(req, res, requestPath) {
    const {
      DEFAULT_HOST,
      assertDevTaskIdNotReserved,
      benchmarkControlPlane,
      devCostBudgetService,
      devProjectRuleResolver,
      devWorkspaceAgentExecutionLoop,
      devWorkspaceTerminalService,
      featureFlags,
      getValidRegisteredProjects,
      isReservedGoalModeDevTaskId,
      nativeDevB3Facade,
      nativeDevUiExecutionService,
      normalizeFocusPath,
      publicDevProgress,
      readJsonBody,
      requireTrustedDevUi,
      resolveFocusCatalogSelection,
      workspaceEngine,
    } = deps;

    if (requestPath === "/api/dev/benchmark/suite" && req.method === "GET") {
      if (req.headers["x-noon-request"] !== "1") { res.writeHead(403); return res.end(); }
      try { res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" }); return res.end(JSON.stringify({ status: "ok", suite: benchmarkControlPlane?.read("suite") })); }
      catch (error) { res.writeHead(503, { "Content-Type": "application/json" }); return res.end(JSON.stringify({ status: "error", code: error.code || "BENCHMARK_UNAVAILABLE" })); }
    }

    if (requestPath === "/api/dev/benchmark/prepare" && req.method === "POST") {
      if (req.headers["x-noon-request"] !== "1") { res.writeHead(403); return res.end(); }
      try { const result = await benchmarkControlPlane.execute("prepare", await readJsonBody(req, 8 * 1024)); res.writeHead(201, { "Content-Type": "application/json", "Cache-Control": "no-store" }); return res.end(JSON.stringify({ status: "ok", ...result })); }
      catch (error) { res.writeHead(error.code === "FEATURE_DISABLED" ? 409 : 400, { "Content-Type": "application/json" }); return res.end(JSON.stringify({ status: "error", code: error.code || "BENCHMARK_PREPARE_FAILED" })); }
    }

    if (requestPath === "/api/dev/benchmark/arm" && req.method === "POST") {
      if (req.headers["x-noon-request"] !== "1") { res.writeHead(403); return res.end(); }
      try { const result = await benchmarkControlPlane.execute("arm", await readJsonBody(req, 2 * 1024)); res.writeHead(201, { "Content-Type": "application/json", "Cache-Control": "no-store" }); return res.end(JSON.stringify({ status: "ok", arm: result })); }
      catch (error) { res.writeHead(400, { "Content-Type": "application/json" }); return res.end(JSON.stringify({ status: "error", code: error.code || "BENCHMARK_ARM_FAILED" })); }
    }

    if (requestPath === "/api/dev/benchmark/codex-probe/arm" && req.method === "POST") {
      if (req.headers["x-noon-request"] !== "1") { res.writeHead(403); return res.end(); }
      try { const result = await benchmarkControlPlane.execute("armCodexProbe", await readJsonBody(req, 2 * 1024)); res.writeHead(201, { "Content-Type": "application/json", "Cache-Control": "no-store" }); return res.end(JSON.stringify({ status: "ok", arm: result })); }
      catch (error) { res.writeHead(400, { "Content-Type": "application/json" }); return res.end(JSON.stringify({ status: "error", code: error.code || "CODEX_PROBE_ARM_FAILED" })); }
    }
    if (requestPath === "/api/dev/benchmark/codex-probe/prepare" && req.method === "POST") {
      if (req.headers["x-noon-request"] !== "1") { res.writeHead(403); return res.end(); }
      try { const result = await benchmarkControlPlane.execute("prepareCodexProbe", await readJsonBody(req, 8 * 1024)); res.writeHead(201, { "Content-Type": "application/json", "Cache-Control": "no-store" }); return res.end(JSON.stringify({ status: "ok", ...result })); }
      catch (error) { res.writeHead(error.code === "FEATURE_DISABLED" ? 409 : 400, { "Content-Type": "application/json" }); return res.end(JSON.stringify({ status: "error", code: error.code || "CODEX_PROBE_PREPARE_FAILED" })); }
    }
    const codexProbeRun = requestPath.match(/^\/api\/dev\/benchmark\/codex-probe\/run\/([^/]+)$/);
    if (codexProbeRun && req.method === "POST") {
      if (req.headers["x-noon-request"] !== "1") { res.writeHead(403); return res.end(); }
      try { const result = await benchmarkControlPlane.execute("runCodexProbe", { ...(await readJsonBody(req, 2 * 1024)), sessionId: decodeURIComponent(codexProbeRun[1]) }); res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" }); return res.end(JSON.stringify({ status: "ok", result })); }
      catch (error) { res.writeHead(error.code === "FEATURE_DISABLED" ? 409 : 400, { "Content-Type": "application/json" }); return res.end(JSON.stringify({ status: "error", code: error.code || "CODEX_PROBE_RUN_FAILED" })); }
    }

    const benchmarkDisarm = requestPath.match(/^\/api\/dev\/benchmark\/disarm\/([^/]+)$/);
    if (benchmarkDisarm && req.method === "POST") {
      if (req.headers["x-noon-request"] !== "1") { res.writeHead(403); return res.end(); }
      try { const result = await benchmarkControlPlane.execute("disarm", { ...(await readJsonBody(req, 2 * 1024)), armId: decodeURIComponent(benchmarkDisarm[1]) }); res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" }); return res.end(JSON.stringify({ status: "ok", arm: result })); }
      catch (error) { res.writeHead(400, { "Content-Type": "application/json" }); return res.end(JSON.stringify({ status: "error", code: error.code || "BENCHMARK_DISARM_FAILED" })); }
    }

    const benchmarkAction = requestPath.match(/^\/api\/dev\/benchmark\/(run-next|cancel|resume)\/([^/]+)$/);
    if (benchmarkAction && req.method === "POST") {
      if (req.headers["x-noon-request"] !== "1") { res.writeHead(403); return res.end(); }
      try { const action = benchmarkAction[1] === "run-next" ? "runNext" : benchmarkAction[1]; const result = await benchmarkControlPlane.execute(action, { ...(await readJsonBody(req, 2 * 1024)), sessionId: decodeURIComponent(benchmarkAction[2]) }); res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" }); return res.end(JSON.stringify({ status: "ok", result })); }
      catch (error) { res.writeHead(error.code === "FEATURE_DISABLED" ? 409 : 400, { "Content-Type": "application/json" }); return res.end(JSON.stringify({ status: "error", code: error.code || "BENCHMARK_CONTROL_FAILED" })); }
    }

    const benchmarkContextAb = requestPath.match(/^\/api\/dev\/benchmark\/context-ab\/([^/]+)$/);
    if (benchmarkContextAb && req.method === "POST") {
      if (req.headers["x-noon-request"] !== "1") { res.writeHead(403); return res.end(); }
      try { const result = await benchmarkControlPlane.execute("runContextAb", { ...(await readJsonBody(req, 2 * 1024)), sessionId: decodeURIComponent(benchmarkContextAb[1]) }); res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" }); return res.end(JSON.stringify({ status: "ok", result })); }
      catch (error) { res.writeHead(error.code === "FEATURE_DISABLED" ? 409 : 400, { "Content-Type": "application/json" }); return res.end(JSON.stringify({ status: "error", code: error.code || "CONTEXT_MANIFEST_AB_FAILED" })); }
    }

    const benchmarkRead = requestPath.match(/^\/api\/dev\/benchmark\/(status|results)\/([^/]+)$/);
    if (benchmarkRead && req.method === "GET") {
      if (req.headers["x-noon-request"] !== "1") { res.writeHead(403); return res.end(); }
      try { const result = benchmarkControlPlane.read(benchmarkRead[1], decodeURIComponent(benchmarkRead[2])); res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" }); return res.end(JSON.stringify({ status: "ok", ...result })); }
      catch (error) { res.writeHead(400, { "Content-Type": "application/json" }); return res.end(JSON.stringify({ status: "error", code: error.code || "BENCHMARK_READ_FAILED" })); }
    }


    // Espace goal-mode-dev- : statut, arrêt, budget et preuves passent par Goal Mode.
    function sendReservedDevTaskId(res) {
      res.writeHead(400, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      return res.end(JSON.stringify({ status: "error", code: "DEV_TASK_ID_RESERVED" }));
    }

    function devTerminalHttpStatus(error) {
      if (
        [
          "WORKSPACE_ROOT_DENIED",
          "WORKSPACE_READ_ONLY",
          "USER_TERMINAL_AUTOMATION_DENIED",
          "NOON_TERMINAL_ORIGIN_DENIED",
          "COMMAND_NOT_ALLOWLISTED",
          "COMMAND_DENIED",
          "GIT_REMOTE_DENIED",
          "PACKAGE_INSTALL_APPROVAL_REQUIRED",
          "TERMINAL_COMMAND_DENIED",
        ].includes(error?.code)
      ) {
        return 403;
      }

      if (
        [
          "DEV_WORKSPACE_NOT_FOUND",
          "TERMINAL_NOT_FOUND",
        ].includes(error?.code)
      ) {
        return 404;
      }

      if (
        [
          "TERMINAL_BUSY",
          "TERMINAL_APPROVAL_REQUIRED",
        ].includes(error?.code)
      ) {
        return 409;
      }

      if (
        [
          "GIT_ROOT_UNAVAILABLE",
          "GIT_REPOSITORY_UNAVAILABLE",
          "GIT_ROOT_MISMATCH",
        ].includes(error?.code)
      ) {
        return 409;
      }

      if (
        error?.code === "GIT_READ_FAILED" ||
        error?.code === "TERMINAL_SPAWN_FAILED"
      ) {
        return 500;
      }

      return error?.statusCode || 400;
    }

    function sendDevTerminalError(res, error) {
      res.writeHead(
        devTerminalHttpStatus(error),
        {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        }
      );

      return res.end(
        JSON.stringify({
          status: "error",
          code:
            error?.code ||
            "DEV_TERMINAL_FAILURE",
          message:
            error?.message ||
            "Erreur terminal DEV.",
        })
      );
    }

    if (
      requestPath ===
        "/api/dev/workspace-terminal/sessions" &&
      req.method === "POST"
    ) {
      try {
        requireTrustedDevUi(req);

        const body =
          await readJsonBody(req, 16 * 1024);

        let workspaceId =
          String(body.workspaceId || "").trim();

        if (
          body.focusId &&
          body.repositoryRoot
        ) {
          const focusId =
            String(body.focusId).trim();

          if (!focusId) {
            throw Object.assign(
              new Error("Focus DEV invalide."),
              {
                statusCode: 400,
                code: "DEV_FOCUS_INVALID",
              }
            );
          }

          const repositoryRoot =
            String(
              body.repositoryRoot
            );

          const focusSelection =
            resolveFocusCatalogSelection(
              focusId,
              repositoryRoot
            );

          const normalizedRoot =
            normalizeFocusPath(
              repositoryRoot
            );

          const matchingProjects =
            normalizedRoot
              ? getValidRegisteredProjects()
                  .filter(
                    (project) =>
                      normalizeFocusPath(
                        project.rootPath
                      ) === normalizedRoot
                  )
              : [];

          const resolvedProjectId =
            focusSelection?.project?.id ||
            (
              matchingProjects.length === 1
                ? matchingProjects[0].id
                : null
            );

          workspaceId =
            workspaceEngine.ensureLegacy({
              legacyId: focusId,
              name:
                String(
                  body.focusName ||
                  focusId
                ).trim() || focusId,
              rootPath:
                repositoryRoot,
              type:
                focusId.startsWith("projet-")
                  ? "learning"
                  : "project",

              // Le Terminal DEV est un contexte
              // mono-projet. Un ancien lien erroné
              // ne doit jamais propager les règles
              // d'un autre Focus.
              projectId:
                resolvedProjectId,

              exclusiveProject:
                true,

              // Un terminal DEV n'obtient jamais
              // implicitement un droit d'écriture.
              // WorkspaceEngine vérifie que cette
              // racine figure bien dans les
              // permissions read-write locales.
              mode: "read-write",
            }).id;
        }

        if (!workspaceId) {
          throw Object.assign(
            new Error(
              "Workspace ou Focus DEV requis."
            ),
            {
              statusCode: 400,
              code:
                "DEV_WORKSPACE_REQUIRED",
            }
          );
        }

        const session =
          devWorkspaceTerminalService.createSession({
            workspaceId,
            repositoryRoot:
              body.repositoryRoot
                ? String(body.repositoryRoot)
                : null,
          });

        res.writeHead(
          201,
          {
            "Content-Type": "application/json",
            "Cache-Control": "no-store",
          }
        );

        return res.end(
          JSON.stringify({
            status: "ok",
            session,
          })
        );
      } catch (error) {
        return sendDevTerminalError(
          res,
          error
        );
      }
    }

    const devTerminalSessionRead =
      requestPath.match(
        /^\/api\/dev\/workspace-terminal\/sessions\/([^/]+)$/
      );

    if (
      devTerminalSessionRead &&
      req.method === "GET"
    ) {
      try {
        requireTrustedDevUi(req);

        const sessionId =
          decodeURIComponent(
            devTerminalSessionRead[1]
          );

        const session =
          devWorkspaceTerminalService.getSession(
            sessionId
          );

        res.writeHead(
          200,
          {
            "Content-Type": "application/json",
            "Cache-Control": "no-store",
          }
        );

        return res.end(
          JSON.stringify({
            status: "ok",
            session,
          })
        );
      } catch (error) {
        return sendDevTerminalError(
          res,
          error
        );
      }
    }

    const devGitDiffRead =
      requestPath.match(
        /^\/api\/dev\/workspace-terminal\/sessions\/([^/]+)\/git-diff$/
      );

    if (
      devGitDiffRead &&
      req.method === "GET"
    ) {
      try {
        requireTrustedDevUi(req);

        const sessionId =
          decodeURIComponent(
            devGitDiffRead[1]
          );

        const gitDiff =
          await devWorkspaceTerminalService
            .inspectGitDiff({
              sessionId,
            });

        res.writeHead(
          200,
          {
            "Content-Type": "application/json",
            "Cache-Control": "no-store",
          }
        );

        return res.end(
          JSON.stringify({
            status: "ok",
            gitDiff,
          })
        );
      } catch (error) {
        return sendDevTerminalError(
          res,
          error
        );
      }
    }

    const devGitDiffFileRead =
      requestPath.match(
        /^\/api\/dev\/workspace-terminal\/sessions\/([^/]+)\/git-diff\/file$/
      );

    if (
      devGitDiffFileRead &&
      req.method === "GET"
    ) {
      try {
        requireTrustedDevUi(req);

        const sessionId =
          decodeURIComponent(
            devGitDiffFileRead[1]
          );

        const requestUrl =
          new URL(
            req.url,
            "http://127.0.0.1"
          );

        const file =
          requestUrl.searchParams
            .get("file") || "";

        const scope =
          requestUrl.searchParams
            .get("scope") ||
          "WORKTREE";

        const diff =
          await devWorkspaceTerminalService
            .readGitDiff({
              sessionId,
              file,
              scope,
            });

        res.writeHead(
          200,
          {
            "Content-Type": "application/json",
            "Cache-Control": "no-store",
          }
        );

        return res.end(
          JSON.stringify({
            status: "ok",
            diff,
          })
        );
      } catch (error) {
        return sendDevTerminalError(
          res,
          error
        );
      }
    }

    const devTerminalCompletionsRead =
      requestPath.match(
        /^\/api\/dev\/workspace-terminal\/sessions\/([^/]+)\/completions$/
      );

    if (
      devTerminalCompletionsRead &&
      req.method === "GET"
    ) {
      try {
        requireTrustedDevUi(req);

        const sessionId =
          decodeURIComponent(
            devTerminalCompletionsRead[1]
          );

        const requestUrl =
          new URL(
            req.url,
            "http://127.0.0.1"
          );

        const query =
          requestUrl.searchParams
            .get("q") || "";

        const completion =
          devWorkspaceTerminalService
            .getCompletions({
              sessionId,
              query,
            });

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
            ...completion,
          })
        );
      } catch (error) {
        return sendDevTerminalError(
          res,
          error
        );
      }
    }

    const devTerminalCreate =
      requestPath.match(
        /^\/api\/dev\/workspace-terminal\/sessions\/([^/]+)\/terminals$/
      );

    if (
      devTerminalCreate &&
      req.method === "POST"
    ) {
      try {
        requireTrustedDevUi(req);

        const body =
          await readJsonBody(req, 8 * 1024);

        const terminal =
          devWorkspaceTerminalService.createTerminal({
            sessionId:
              decodeURIComponent(
                devTerminalCreate[1]
              ),

            title:
              body.title
                ? String(body.title)
                : undefined,

            // IMPORTANT :
            // une requête renderer ne peut créer
            // qu'un terminal USER.
            owner: "USER",
          });

        res.writeHead(
          201,
          {
            "Content-Type": "application/json",
            "Cache-Control": "no-store",
          }
        );

        return res.end(
          JSON.stringify({
            status: "ok",
            terminal,
          })
        );
      } catch (error) {
        return sendDevTerminalError(
          res,
          error
        );
      }
    }

    const devTerminalRun =
      requestPath.match(
        /^\/api\/dev\/workspace-terminal\/sessions\/([^/]+)\/terminals\/([^/]+)\/run$/
      );

    if (
      devTerminalRun &&
      req.method === "POST"
    ) {
      try {
        requireTrustedDevUi(req);

        const body =
          await readJsonBody(req, 16 * 1024);

        const result =
          devWorkspaceTerminalService.runCommand({
            sessionId:
              decodeURIComponent(
                devTerminalRun[1]
              ),

            terminalId:
              decodeURIComponent(
                devTerminalRun[2]
              ),

            // Le renderer n'a jamais le droit
            // de se présenter comme NOON.
            origin: "USER",

            command:
              String(body.command || ""),
          });

        res.writeHead(
          202,
          {
            "Content-Type": "application/json",
            "Cache-Control": "no-store",
          }
        );

        return res.end(
          JSON.stringify({
            status: "ok",
            result,
          })
        );
      } catch (error) {
        return sendDevTerminalError(
          res,
          error
        );
      }
    }

    const devTerminalOutput =
      requestPath.match(
        /^\/api\/dev\/workspace-terminal\/sessions\/([^/]+)\/terminals\/([^/]+)\/output$/
      );

    if (
      devTerminalOutput &&
      req.method === "GET"
    ) {
      try {
        requireTrustedDevUi(req);

        const url = new URL(
          req.url,
          `http://${req.headers.host || DEFAULT_HOST}`
        );

        const result =
          devWorkspaceTerminalService.poll({
            sessionId:
              decodeURIComponent(
                devTerminalOutput[1]
              ),

            terminalId:
              decodeURIComponent(
                devTerminalOutput[2]
              ),

            from:
              Math.max(
                0,
                Number(
                  url.searchParams.get("from")
                ) || 0
              ),
          });

        res.writeHead(
          200,
          {
            "Content-Type": "application/json",
            "Cache-Control": "no-store",
          }
        );

        return res.end(
          JSON.stringify({
            status: "ok",
            ...result,
          })
        );
      } catch (error) {
        return sendDevTerminalError(
          res,
          error
        );
      }
    }

    const devTerminalClose =
      requestPath.match(
        /^\/api\/dev\/workspace-terminal\/sessions\/([^/]+)\/terminals\/([^/]+)\/close$/
      );

    if (
      devTerminalClose &&
      req.method === "POST"
    ) {
      try {
        requireTrustedDevUi(req);

        const result =
          devWorkspaceTerminalService.closeTerminal({
            sessionId:
              decodeURIComponent(
                devTerminalClose[1]
              ),

            terminalId:
              decodeURIComponent(
                devTerminalClose[2]
              ),
          });

        res.writeHead(
          200,
          {
            "Content-Type": "application/json",
            "Cache-Control": "no-store",
          }
        );

        return res.end(
          JSON.stringify({
            status: "ok",
            ...result,
          })
        );
      } catch (error) {
        return sendDevTerminalError(
          res,
          error
        );
      }
    }

    const devTerminalSessionClose =
      requestPath.match(
        /^\/api\/dev\/workspace-terminal\/sessions\/([^/]+)\/close$/
      );

    if (
      devTerminalSessionClose &&
      req.method === "POST"
    ) {
      try {
        requireTrustedDevUi(req);

        const result =
          devWorkspaceTerminalService.closeSession(
            decodeURIComponent(
              devTerminalSessionClose[1]
            )
          );

        res.writeHead(
          200,
          {
            "Content-Type": "application/json",
            "Cache-Control": "no-store",
          }
        );

        return res.end(
          JSON.stringify({
            status: "ok",
            ...result,
          })
        );
      } catch (error) {
        return sendDevTerminalError(
          res,
          error
        );
      }
    }

    if (requestPath === "/api/dev/workspace-agent/executions" && req.method === "POST") {
      try {
        requireTrustedDevUi(req);
        const body = await readJsonBody(req, 32 * 1024);
        const execution = devWorkspaceAgentExecutionLoop.start({
          workspaceSessionId: String(body.workspaceSessionId || ""),
          task: String(body.task || ""),
          actionCommand: String(body.actionCommand || ""),
          validationCommand: String(body.validationCommand || ""),
          plan: body.plan && typeof body.plan === "object" ? body.plan : null,
          previewObservation: body.previewObservation && typeof body.previewObservation === "object"
            ? body.previewObservation
            : null,
        });
        res.writeHead(202, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        return res.end(
          JSON.stringify({
            status: "ok",
            execution,
            progress:
              publicDevProgress(
                execution.executionId
              ),
          })
        );
      } catch (error) {
        return sendDevTerminalError(res, error);
      }
    }

    const devWorkspaceAgentCancel = requestPath.match(
      /^\/api\/dev\/workspace-agent\/executions\/([^/]+)\/cancel$/
    );

    if (devWorkspaceAgentCancel && req.method === "POST") {
      try {
        requireTrustedDevUi(req);
        const result = devWorkspaceAgentExecutionLoop.cancel(
          decodeURIComponent(devWorkspaceAgentCancel[1])
        );
        res.writeHead(result.cancelled ? 200 : 409, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        return res.end(JSON.stringify({ status: result.cancelled ? "ok" : "error", ...result }));
      } catch (error) {
        return sendDevTerminalError(res, error);
      }
    }

    const devWorkspaceAgentStatus = requestPath.match(
      /^\/api\/dev\/workspace-agent\/executions\/([^/]+)$/
    );

    if (devWorkspaceAgentStatus && req.method === "GET") {
      try {
        requireTrustedDevUi(req);
        const execution = devWorkspaceAgentExecutionLoop.get(
          decodeURIComponent(devWorkspaceAgentStatus[1])
        );
        res.writeHead(execution ? 200 : 404, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        return res.end(
          JSON.stringify(
            execution
              ? {
                  status: "ok",
                  execution,
                  progress:
                    publicDevProgress(
                      execution.executionId
                    ),
                }
              : {
                  status: "error",
                  code:
                    "EXECUTION_NOT_FOUND",
                }
          )
        );
      } catch (error) {
        return sendDevTerminalError(res, error);
      }
    }

    if (
      requestPath ===
        "/api/dev/native-ui/executions" &&
      req.method === "POST"
    ) {
      try {
        requireTrustedDevUi(req);

        const body =
          await readJsonBody(
            req,
            16 * 1024
          );

        const execution =
          nativeDevUiExecutionService
            .start({
              workspaceSessionId:
                String(
                  body.workspaceSessionId ||
                  ""
                ),

              validationCommand:
                String(
                  body.validationCommand ||
                  ""
                ),
            });

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
            execution,
            progress:
              publicDevProgress(
                execution.taskId
              ),
          })
        );
      } catch (error) {
        return sendDevTerminalError(
          res,
          error
        );
      }
    }

    const nativeDevUiCancel =
      requestPath.match(
        /^\/api\/dev\/native-ui\/executions\/([^/]+)\/cancel$/
      );

    if (
      nativeDevUiCancel &&
      req.method === "POST"
    ) {
      try {
        requireTrustedDevUi(req);

        const taskId =
          decodeURIComponent(
            nativeDevUiCancel[1]
          );

        const result =
          nativeDevUiExecutionService
            .cancel(
              taskId
            );

        res.writeHead(
          result.cancelled
            ? 200
            : 409,
          {
            "Content-Type":
              "application/json",
            "Cache-Control":
              "no-store",
          }
        );

        return res.end(
          JSON.stringify({
            status:
              result.cancelled
                ? "ok"
                : "error",

            ...result,

            execution:
              nativeDevUiExecutionService
                .get(
                  taskId
                ),

            progress:
              publicDevProgress(
                taskId
              ),
          })
        );
      } catch (error) {
        return sendDevTerminalError(
          res,
          error
        );
      }
    }

    const nativeDevUiStatus =
      requestPath.match(
        /^\/api\/dev\/native-ui\/executions\/([^/]+)$/
      );

    if (
      nativeDevUiStatus &&
      req.method === "GET"
    ) {
      try {
        requireTrustedDevUi(req);

        const taskId =
          decodeURIComponent(
            nativeDevUiStatus[1]
          );

        const execution =
          nativeDevUiExecutionService
            .get(
              taskId
            );

        res.writeHead(
          execution
            ? 200
            : 404,
          {
            "Content-Type":
              "application/json",
            "Cache-Control":
              "no-store",
          }
        );

        return res.end(
          JSON.stringify(
            execution
              ? {
                  status: "ok",
                  execution,
                  progress:
                    publicDevProgress(
                      taskId
                    ),
                }
              : {
                  status: "error",
                  code:
                    "DEV_NATIVE_UI_NOT_FOUND",
                }
          )
        );
      } catch (error) {
        return sendDevTerminalError(
          res,
          error
        );
      }
    }

    if (requestPath === "/api/dev/native/tasks" && req.method === "POST") {
      try {
        if (req.headers["x-noon-request"] !== "1") throw Object.assign(new Error("Requête Noon refusée."), { statusCode: 403, code: "TRUSTED_UI_REQUIRED" });
        const body = await readJsonBody(req, 128 * 1024);
        // L'espace goal-mode-dev- est réservé aux réservations Goal Mode.
        assertDevTaskIdNotReserved(body.taskId);
        // Le client ne choisit pas les règles persistantes : le projet et le
        // propriétaire viennent du workspace déjà résolu côté serveur.
        const workspaceContext = workspaceEngine.context(String(body.workspaceId || ""));
        const projects = workspaceContext.projects || [];
        if (projects.length !== 1 || !workspaceContext.workspace?.profileScope) throw Object.assign(new Error("Projet DEV non résolu ou ambigu."), { statusCode: 400, code: "DEV_PROJECT_UNRESOLVED" });
        const ruleProjection = devProjectRuleResolver.resolve({ projectId: projects[0].id, ownerProfileScope: workspaceContext.workspace.profileScope, taskRestrictions: Array.isArray(body.constraints) ? body.constraints : [] });
        const result = await nativeDevB3Facade.runTask({
          taskId: body.taskId, sessionId: body.sessionId, workspaceId: String(body.workspaceId || ""), repositoryRoot: String(body.repositoryRoot || ""),
          objective: String(body.objective || ""), allowedPaths: Array.isArray(body.allowedPaths) ? body.allowedPaths : undefined,
          forbiddenPaths: Array.isArray(body.forbiddenPaths) ? body.forbiddenPaths : undefined, constraints: Array.isArray(body.constraints) ? body.constraints : [],
          projectInstructions: ruleProjection.applied.map((rule) => rule.text),
          validationCommands: Array.isArray(body.validationCommands) ? body.validationCommands : [], requiredQuality: body.requiredQuality,
          maxIterations: body.maxIterations, maxDuration: body.maxDuration, maxEstimatedCost: body.maxEstimatedCost,
          localOnly: body.localOnly === true,
          permissions: ["READ_WRITE_WORKSPACE", "TERMINAL_SAFE"],
        });
        res.writeHead(result.finalVerdict === "FAIL" ? 422 : 200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        return res.end(
          JSON.stringify({
            ...result,
            progress:
              publicDevProgress(
                result.taskId
              ),
          })
        );
      } catch (error) {
        res.writeHead(error.statusCode || 400, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        return res.end(JSON.stringify({ status: "error", code: error.code || "DEV_TASK_FAILURE", message: error.message }));
      }
    }

    if (requestPath === "/api/dev/budget" && req.method === "GET") {
      if (req.headers["x-noon-request"] !== "1") { res.writeHead(403); return res.end(); }
      const url = new URL(req.url, `http://${req.headers.host || DEFAULT_HOST}`);
      const taskId = url.searchParams.get("taskId");
      if (isReservedGoalModeDevTaskId(taskId)) return sendReservedDevTaskId(res);
      const context = { workspaceId: url.searchParams.get("workspaceId"), sessionId: taskId };
      const budgetEnforcement = featureFlags.evaluate("dev.budget-enforcement", context).enabled;
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      return res.end(JSON.stringify({ status: "ok", budget: devCostBudgetService.snapshot(taskId, null, budgetEnforcement) }));
    }

    if (requestPath.startsWith("/api/dev/native/tasks/") && req.method === "GET") {
      if (req.headers["x-noon-request"] !== "1") { res.writeHead(403); return res.end(); }
      const taskId =
        decodeURIComponent(
          requestPath.slice(
            "/api/dev/native/tasks/".length
          )
        );
      // 4C-1D : le statut d'une tâche Goal Mode ne passe que par Goal Mode.
      if (isReservedGoalModeDevTaskId(taskId)) return sendReservedDevTaskId(res);

      const result =
        nativeDevB3Facade.getTaskStatus(
          taskId
        );

      res.writeHead(
        result ? 200 : 404,
        {
          "Content-Type":
            "application/json",
          "Cache-Control":
            "no-store",
        }
      );

      return res.end(
        JSON.stringify(
          result
            ? {
                ...result,
                progress:
                  publicDevProgress(
                    taskId
                  ),
              }
            : {
                status:
                  "not_found",
              }
        )
      );
    }

    if (requestPath.startsWith("/api/dev/native/tasks/") && requestPath.endsWith("/cancel") && req.method === "POST") {
      if (req.headers["x-noon-request"] !== "1") { res.writeHead(403); return res.end(); }
      const taskId = decodeURIComponent(requestPath.slice("/api/dev/native/tasks/".length, -"/cancel".length));
      // 4C-1D : l'arrêt d'une tâche Goal Mode ne passe que par cancelExecution.
      if (isReservedGoalModeDevTaskId(taskId)) return sendReservedDevTaskId(res);
      const result = nativeDevB3Facade.cancelTask(taskId);
      res.writeHead(result.cancelled ? 200 : 409, { "Content-Type": "application/json", "Cache-Control": "no-store" }); return res.end(JSON.stringify(result));
    }

    return NOT_HANDLED;
  };
}

module.exports = { DEPENDENCIES, createDevHttpRoutes };
