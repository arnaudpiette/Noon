"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { isPathInsideRoots } = require("./path-utils");

const SKIPPED_NAMES = new Set([
  "node_modules", ".git", "dist", "build", ".next", "coverage",
  ".cache", ".expo", ".vite", ".trash", "tmp", "temp",
]);
const DESCENT_SKIPS = new Set([...SKIPPED_NAMES, "src", "public", "assets", "docs"]);
const CREATIVE_EXTENSIONS = new Set([".fig", ".sketch", ".xd", ".psd", ".ai", ".indd", ".pdf", ".rtf"]);

function normalizeProjectLookup(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[•’']/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "")
    .toLowerCase();
}

function stableProjectId(rootPath) {
  return `project-${crypto.createHash("sha256").update(path.resolve(rootPath)).digest("hex").slice(0, 16)}`;
}

function sanitizeGitUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    url.username = "";
    url.password = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return raw.replace(/:\/\/[^/@\s]+@/g, "://").slice(0, 500);
  }
}

function readPackageMetadata(directoryPath) {
  const packagePath = path.join(directoryPath, "package.json");
  try {
    const data = JSON.parse(fs.readFileSync(packagePath, "utf8"));
    return {
      packageName: typeof data.name === "string" ? data.name.slice(0, 150) : null,
      scripts: data.scripts && typeof data.scripts === "object"
        ? Object.keys(data.scripts).slice(0, 30)
        : [],
      dependencies: {
        ...(data.dependencies || {}),
        ...(data.devDependencies || {}),
      },
    };
  } catch {
    return { packageName: null, scripts: [], dependencies: {} };
  }
}

function detectTechnologies(names, dependencies) {
  const technologies = [];
  const candidates = [
    ["react", "React"], ["vite", "Vite"], ["next", "Next.js"],
    ["vue", "Vue"], ["svelte", "Svelte"], ["express", "Express"],
    ["sass", "Sass"], ["typescript", "TypeScript"], ["mongodb", "MongoDB"],
  ];
  for (const [dependency, label] of candidates) {
    if (dependencies[dependency]) technologies.push(label);
  }
  if ([...names].some((name) => name.endsWith(".ts") || name.endsWith(".tsx"))) {
    if (!technologies.includes("TypeScript")) technologies.push("TypeScript");
  }
  return technologies;
}

function inspectProjectDirectory(directoryPath, parentFocus, depth = 0) {
  let entries;
  try { entries = fs.readdirSync(directoryPath, { withFileTypes: true }); } catch { return null; }
  const names = new Set(entries.map((entry) => entry.name));
  const markers = [];
  let score = 0;
  const add = (condition, marker, points) => {
    if (condition) { markers.push(marker); score += points; }
  };
  add(names.has(".git"), ".git", 6);
  add(names.has("package.json"), "package.json", 6);
  add(names.has("README.md") || names.has("README.MD") || names.has("readme.md"), "README.md", 2);
  add(["vite.config.js", "vite.config.ts", "vite.config.mjs"].some((name) => names.has(name)), "vite", 3);
  add(names.has("src"), "src", 2);
  add(names.has("public"), "public", 1);
  add(names.has("frontend"), "frontend", 2);
  add(names.has("backend"), "backend", 2);
  const creativeFiles = entries.filter((entry) => entry.isFile() && CREATIVE_EXTENSIONS.has(path.extname(entry.name).toLowerCase()));
  const standaloneProjectFocus = new Set([
    "app-cig", "portfolio", "website-arnaudpiette", "teasfolio",
  ]);
  const baseName = path.basename(directoryPath);
  add(
    creativeFiles.length >= 2 && (
      parentFocus?.id?.startsWith("projet-") ||
      (depth === 0 && standaloneProjectFocus.has(parentFocus?.id))
    ),
    "creative-files",
    5
  );
  add(depth === 1 && baseName.startsWith("•"), "creative-client-root", 5);
  add(depth === 0 && standaloneProjectFocus.has(parentFocus?.id), "focus-project-root", 5);
  add(/^projet\s*\d+$/i.test(path.basename(directoryPath)) && parentFocus?.id?.startsWith("projet-"), "openclassrooms-project", 5);
  if (score < 5) return null;

  const packageMetadata = names.has("package.json")
    ? readPackageMetadata(directoryPath)
    : { packageName: null, scripts: [], dependencies: {} };
  let gitRepository = null;
  let defaultBranch = null;
  if (names.has(".git")) {
    try {
      const config = fs.readFileSync(path.join(directoryPath, ".git", "config"), "utf8");
      gitRepository = sanitizeGitUrl(config.match(/url\s*=\s*(.+)/)?.[1]);
    } catch { /* Métadonnées Git facultatives. */ }
    try {
      const head = fs.readFileSync(path.join(directoryPath, ".git", "HEAD"), "utf8").trim();
      defaultBranch = head.startsWith("ref: refs/heads/") ? head.slice(16) : null;
    } catch { /* Branche facultative. */ }
  }
  const stats = fs.statSync(directoryPath);
  const rawName = path.basename(directoryPath);
  const normalizedName = normalizeProjectLookup(rawName);
  const name = normalizedName.includes("monvieuxgrimoire")
    ? "Mon Vieux Grimoire"
    : normalizedName === "teasfolio" ? "Teasfolio" : rawName.replace(/^•/, "").replace(/_/g, " ").trim();
  return {
    id: stableProjectId(directoryPath),
    name,
    aliases: buildProjectAliases(name, parentFocus),
    rootPath: directoryPath,
    parentFocusId: parentFocus.id,
    parentFocusName: parentFocus.displayName,
    category: parentFocus.id.startsWith("projet-") || ["cours", "openclassrooms"].includes(parentFocus.id)
      ? "openclassrooms" : "local",
    projectType: packageMetadata.packageName || names.has("src") ? "web" : "creative",
    technologies: detectTechnologies(names, packageMetadata.dependencies),
    packageName: packageMetadata.packageName,
    scripts: packageMetadata.scripts,
    gitRepository,
    defaultBranch,
    figmaUrl: null,
    status: "detected",
    lastModifiedAt: stats.mtime.toISOString(),
    lastScannedAt: new Date().toISOString(),
    markers,
    favorite: false,
  };
}

function buildProjectAliases(name, parentFocus) {
  const aliases = [name];
  const normalizedName = normalizeProjectLookup(name);
  if (parentFocus.id === "projet-5" && normalizedName === "kasa") {
    aliases.push("Kasa", "Kaza", "Projet 5", "Projet5");
  }
  if (parentFocus.id === "projet-6" && normalizedName.includes("vieuxgrimoire")) {
    aliases.push("Mon Vieux Grimoire", "Vieux Grimoire", "Projet 6", "Projet6");
  }
  if (
    parentFocus.id === "projet-7" &&
    (/qwenta|menumaker/.test(normalizedName) || normalizedName === "projet7")
  ) {
    aliases.push("Menu Maker by Qwenta", "Qwenta", "Menu Maker", "Projet 7", "Projet7");
  }
  if (parentFocus.id === "app-cig" && /appcig|smokonomy/.test(normalizedName)) {
    aliases.push("App cig", "Smokonomy", "application cigarette");
  }
  if (parentFocus.id === "teasfolio" && normalizedName.includes("teasfolio")) {
    aliases.push("Teasfolio", "Tea’s Folio");
  }
  if (parentFocus.id === "website-arnaudpiette" && normalizedName.includes("websitearnaudpiette")) {
    aliases.push("site Arnaud Piette", "website Arnaud");
  }
  if (parentFocus.id === "portfolio" && normalizedName.includes("portfolio")) aliases.push("portfolio");
  return [...new Set(aliases)];
}

function scanProjectsInAllowedRoots({ focusCatalog, allowedRoots, focusId = null, maxDepth = 5, maxDirectories = 2500 }) {
  const realAllowedRoots = allowedRoots.map((root) => {
    try { return fs.realpathSync(root); } catch { return path.resolve(root); }
  });
  const excludedAutomaticRoots = new Set(["applications", "telechargement"]);
  const roots = focusCatalog
    .filter((entry) => entry.available && (!focusId ? !excludedAutomaticRoots.has(entry.id) : entry.id === focusId))
    .sort((a, b) => b.resolvedPath.length - a.resolvedPath.length);
  const projects = new Map();
  let visitedDirectories = 0;

  function scan(directoryPath, depth, parentFocus) {
    if (depth > maxDepth || visitedDirectories >= maxDirectories) return;
    let realPath;
    try { realPath = fs.realpathSync(path.resolve(directoryPath)); } catch { return; }
    if (!isPathInsideRoots(realPath, realAllowedRoots) || !isPathInsideRoots(realPath, [parentFocus.resolvedPath])) return;
    visitedDirectories += 1;
    const project = inspectProjectDirectory(realPath, parentFocus, depth);
    if (project && !projects.has(realPath)) projects.set(realPath, project);

    let entries;
    try { entries = fs.readdirSync(realPath, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      const lowerName = entry.name.toLowerCase();
      if (entry.name.startsWith(".") || DESCENT_SKIPS.has(lowerName) || entry.name.endsWith(".app")) continue;
      scan(path.join(realPath, entry.name), depth + 1, parentFocus);
    }
  }

  for (const root of roots) {
    try {
      const realRoot = fs.realpathSync(root.resolvedPath);
      scan(realRoot, 0, { ...root, resolvedPath: realRoot });
    } catch {
      // Le dossier a disparu entre le chargement du catalogue et l’analyse.
    }
  }
  return [...projects.values()].sort((a, b) => a.name.localeCompare(b.name, "fr", {
    sensitivity: "base", numeric: true, ignorePunctuation: true,
  }));
}

function resolveProject(query, projects) {
  const lookup = normalizeProjectLookup(query);
  if (!lookup) return { status: "not_found", projects: [] };
  const exact = projects.filter((project) =>
    [project.name, ...(project.aliases || [])].some((alias) => normalizeProjectLookup(alias) === lookup)
  );
  const preferredNames = {
    projet5: "kasa",
    projet6: "monvieuxgrimoire",
    projet7: "projet7",
  };
  if (preferredNames[lookup]) {
    const preferred = exact.find((project) =>
      normalizeProjectLookup(project.name) === preferredNames[lookup]
    );
    if (preferred) return { status: "resolved", project: preferred };
  }
  if (exact.length === 1) return { status: "resolved", project: exact[0] };
  if (exact.length > 1) return { status: "ambiguous", projects: exact };
  const partial = projects.filter((project) =>
    [project.name, ...(project.aliases || [])].some((alias) => normalizeProjectLookup(alias).includes(lookup))
  );
  if (partial.length === 1) return { status: "resolved", project: partial[0] };
  return partial.length > 1
    ? { status: "ambiguous", projects: partial }
    : { status: "not_found", projects: [] };
}

module.exports = {
  SKIPPED_NAMES,
  inspectProjectDirectory,
  normalizeProjectLookup,
  resolveProject,
  sanitizeGitUrl,
  scanProjectsInAllowedRoots,
  stableProjectId,
};
