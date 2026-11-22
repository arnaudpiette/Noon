"use strict";

// V3-L7 — routes des projets enregistrés et du catalogue Focus, sorties de server.js.
// Bloc déplacé tel quel depuis server.js ; ses dépendances sont lues à chaque requête
// (accesseurs), ce qui préserve les variables initialisées plus tard au démarrage.

const { NOT_HANDLED } = require("../http/route-result");

const DEPENDENCIES = Object.freeze(["buildFocusCatalog","getAllowedDirectories","getValidRegisteredProjects","listLocalProjects","readJsonBody","resolveProject","scanRegisteredProjects"]);

function createProjectsHttpRoutes(deps) {
  for (const name of DEPENDENCIES) if (!(name in deps)) throw new TypeError(`Dépendance manquante : ${name}`);
  return async function handle(req, res, requestPath) {
    const {
      buildFocusCatalog,
      getAllowedDirectories,
      getValidRegisteredProjects,
      listLocalProjects,
      readJsonBody,
      resolveProject,
      scanRegisteredProjects,
    } = deps;

    if (req.method === "GET" && req.url === "/projects") {
      try {
        const projects = listLocalProjects();

        res.writeHead(200);

        return res.end(
          JSON.stringify(
            {
              status: "ok",
              mode: "read-only",
              count: projects.length,
              projects,
            },
            null,
            2
          )
        );
      } catch (error) {
        res.writeHead(500);

        return res.end(
          JSON.stringify({
            status: "error",
            message: error.message,
          })
        );
      }
    }

    if (req.method === "GET" && req.url === "/projects/catalog") {
      const projects = getValidRegisteredProjects();
      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      return res.end(JSON.stringify({
        status: "ok",
        mode: "read-only",
        count: projects.length,
        projects,
      }));
    }

    if (req.method === "POST" && req.url === "/projects/scan") {
      try {
        if (req.headers["x-noon-request"] !== "1") {
          const error = new Error("Requête Noon refusée.");
          error.statusCode = 403;
          throw error;
        }
        const body = await readJsonBody(req, 10 * 1024);
        const focusId = typeof body.focusId === "string"
          ? body.focusId.trim().slice(0, 100)
          : null;
        const projects = scanRegisteredProjects(focusId || null);
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        return res.end(JSON.stringify({
          status: "ok",
          count: projects.length,
          projects,
          scannedFocusId: focusId || null,
        }));
      } catch (error) {
        res.writeHead(error.statusCode || 500, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ status: "error", message: error.message }));
      }
    }

    if (req.method === "POST" && req.url === "/projects/resolve") {
      try {
        if (req.headers["x-noon-request"] !== "1") {
          const error = new Error("Requête Noon refusée.");
          error.statusCode = 403;
          throw error;
        }
        const body = await readJsonBody(req, 10 * 1024);
        const query = String(body.query || "").trim().slice(0, 150);
        if (!query) {
          const error = new Error("Nom de projet obligatoire.");
          error.statusCode = 400;
          throw error;
        }
        const result = resolveProject(query, getValidRegisteredProjects());
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        return res.end(JSON.stringify({ status: "ok", result }));
      } catch (error) {
        res.writeHead(error.statusCode || 500, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ status: "error", message: error.message }));
      }
    }

    if (req.method === "GET" && req.url.startsWith("/projects/")) {
      const id = decodeURIComponent(req.url.slice("/projects/".length)).slice(0, 100);
      const project = getValidRegisteredProjects().find((candidate) => candidate.id === id);
      if (!project) {
        res.writeHead(404, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ status: "error", message: "Projet non détecté dans les dossiers autorisés" }));
      }
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      return res.end(JSON.stringify({ status: "ok", project }));
    }

    if (req.method === "GET" && req.url === "/focus/catalog") {
      const catalog = buildFocusCatalog(getAllowedDirectories());
      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      return res.end(JSON.stringify({
        status: "ok",
        mode: "read-only",
        count: catalog.length,
        availableCount: catalog.filter((entry) => entry.available).length,
        catalog: catalog.map((entry) => ({
          id: entry.id,
          displayName: entry.displayName,
          sortName: entry.sortName,
          aliases: entry.aliases,
          resolvedPath: entry.resolvedPath,
          available: entry.available,
          status: entry.status,
          matches: entry.status === "ambiguous" ? entry.matches : [],
        })),
      }));
    }

    return NOT_HANDLED;
  };
}

module.exports = { DEPENDENCIES, createProjectsHttpRoutes };
