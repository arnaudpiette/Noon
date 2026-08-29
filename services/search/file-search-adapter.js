"use strict";

const fs = require("fs");
const path = require("path");

const TEXT_EXTENSIONS = new Set([".txt", ".md", ".json", ".js", ".jsx", ".ts", ".tsx", ".html", ".css", ".scss", ".xml", ".yaml", ".yml", ".csv", ".rtf"]);
const DISCOVERABLE_EXTENSIONS = new Set([...TEXT_EXTENSIONS, ".pdf", ".docx", ".odt", ".pptx", ".xlsx"]);
const FILE_SYNONYMS = Object.freeze({
  voix: ["voice", "speech", "vocal"],
  vocale: ["voice", "speech", "voix"],
  priorite: ["priority", "priorities"],
  memoire: ["memory"],
});

function searchTerms(value) {
  const normalized = String(value || "").toLocaleLowerCase("fr").normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  const base = normalized.match(/[a-z0-9_.$/-]{3,}/g) || [];
  return [...new Set(base.flatMap((term) => [term, ...(FILE_SYNONYMS[term] || [])]))];
}

function isInside(candidate, roots) {
  return roots.some((root) => candidate === root || candidate.startsWith(`${root}${path.sep}`));
}
function createFileSearchAdapter({ rootsProvider, isExcluded = () => false, maxVisited = 2500,
  maxFileBytes = 256 * 1024, maxResults = 10 } = {}) {
  function roots() {
    return [...new Set((rootsProvider?.() || []).map((root) => {
      try { return fs.realpathSync(root); } catch { return null; }
    }).filter(Boolean))];
  }
  function version() {
    let visited = 0;
    const signatures = [];
    function scanVersion(directory, allowedRoots) {
      if (visited >= maxVisited) return;
      let realDirectory;
      try { realDirectory = fs.realpathSync(directory); } catch { return; }
      if (!isInside(realDirectory, allowedRoots)) return;
      let entries;
      try { entries = fs.readdirSync(realDirectory, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        if (visited++ >= maxVisited || isExcluded(entry.name)) break;
        const candidate = path.join(realDirectory, entry.name);
        let real;
        try { real = fs.realpathSync(candidate); } catch { continue; }
        if (!isInside(real, allowedRoots)) continue;
        if (entry.isDirectory()) scanVersion(real, allowedRoots);
        else if (entry.isFile() && DISCOVERABLE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
          try {
            const stats = fs.statSync(real);
            signatures.push(`${real}:${stats.mtimeMs}:${stats.size}`);
          } catch {}
        }
      }
    }
    const allowedRoots = roots();
    for (const root of allowedRoots) scanVersion(root, allowedRoots);
    return signatures.sort().join("|");
  }
  function search(request) {
    const allowedRoots = roots(); const query = String(request.query || "").toLowerCase();
    const exactTerms = [...new Set([
      query,
      ...searchTerms(query),
      ...(request.exactTerms || []).flatMap(searchTerms),
    ].filter(Boolean))];
    const results = []; let visited = 0;
    function scan(directory) {
      if (visited >= maxVisited || results.length >= maxResults) return;
      let realDirectory;
      try { realDirectory = fs.realpathSync(directory); } catch { return; }
      if (!isInside(realDirectory, allowedRoots)) return;
      let entries; try { entries = fs.readdirSync(realDirectory, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        if (visited++ >= maxVisited || results.length >= maxResults || isExcluded(entry.name)) break;
        const candidate = path.join(realDirectory, entry.name); let real;
        try { real = fs.realpathSync(candidate); } catch { continue; }
        if (!isInside(real, allowedRoots)) continue;
        if (entry.isDirectory()) { scan(real); continue; }
        if (!entry.isFile()) continue;
        const extension = path.extname(entry.name).toLowerCase();
        if (!DISCOVERABLE_EXTENSIONS.has(extension)) continue;
        const nameMatch = exactTerms.some((term) => entry.name.toLowerCase().includes(term));
        let snippet = ""; let line = null;
        if (TEXT_EXTENSIONS.has(extension)) {
          let stats; try { stats = fs.statSync(real); } catch { continue; }
          if (stats.size <= maxFileBytes) {
            let content; try { content = fs.readFileSync(real, "utf8"); } catch { content = ""; }
            const lines = content.split(/\r?\n/);
            const index = lines.findIndex((value) => exactTerms.some((term) => value.toLowerCase().includes(term)));
            if (index >= 0) { line = index + 1; snippet = lines.slice(Math.max(0, index - 1), index + 2).join(" ").slice(0, 800); }
          }
        }
        if (!nameMatch && !snippet) continue;
        const stat = fs.statSync(real);
        results.push({ sourceId: real, title: entry.name, snippet: snippet || `Fichier correspondant : ${entry.name}`,
          timestamp: stat.mtime.toISOString(), projectId: request.projectId || null,
          profileScope: request.profileScope === "projects" ? "projects" : request.profileScope,
          locator: { path: real, ...(line ? { line } : {}) }, sourceAuthority: 0.9,
          contentFingerprint: `${stat.mtimeMs}:${stat.size}` });
      }
    }
    let scopedProjectPath = null;
    if (request.projectPath) {
      try {
        const realProjectPath = fs.realpathSync(request.projectPath);
        if (isInside(realProjectPath, allowedRoots)) scopedProjectPath = realProjectPath;
      } catch {}
    }
    // Un projet nommé sans chemin vérifié ne doit jamais élargir implicitement
    // la lecture à toutes les racines autorisées.
    if (request.projectId && !scopedProjectPath) return [];
    if (scopedProjectPath) scan(scopedProjectPath);
    else for (const root of allowedRoots) scan(root);
    return results;
  }
  return { isAuthorized: () => roots().length > 0, search, version };
}

module.exports = { DISCOVERABLE_EXTENSIONS, TEXT_EXTENSIONS, createFileSearchAdapter, isInside };
