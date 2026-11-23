"use strict";

// V3-L7 — fichiers locaux autorisés, registre des projets et Focus.
// Domaine déplacé tel quel depuis server.js. Dépendances déjà déclarées quand server.js le
// construit : lues une fois ; les autres (`deps.x`) : lues à chaque usage, par accesseur.

const DEPENDENCIES = Object.freeze(["EXCLUDED_NAMES","PRIORITY_DIRECTORIES","PROJECTS_REGISTRY_FILE","PROJECT_DIRECTORIES","UI_VALIDATION_MODE","buildFocusCatalog","crypto","findFocusEntry","fs","getAllowedDirectories","isPathInsideRoots","path","resolveProject","scanProjectsInAllowedRoots","uiValidationFixtures","workspaceEngine"]);

function createLocalProjects(deps) {
  for (const name of DEPENDENCIES) if (!(name in deps)) throw new TypeError(`Dépendance manquante : ${name}`);
  const {
    EXCLUDED_NAMES,
    PRIORITY_DIRECTORIES,
    PROJECTS_REGISTRY_FILE,
    PROJECT_DIRECTORIES,
    UI_VALIDATION_MODE,
    buildFocusCatalog,
    crypto,
    findFocusEntry,
    fs,
    getAllowedDirectories,
    isPathInsideRoots,
    path,
    resolveProject,
    scanProjectsInAllowedRoots,
    uiValidationFixtures,
  } = deps;

  function loadProjectsRegistry() {
    try {
      const saved = JSON.parse(fs.readFileSync(PROJECTS_REGISTRY_FILE, "utf8"));
      if (!Array.isArray(saved.projects)) return [];
      return saved.projects.filter((project) =>
        project && typeof project.id === "string" &&
        typeof project.name === "string" && typeof project.rootPath === "string"
      );
    } catch {
      return [];
    }
  }

  function saveProjectsRegistry(projects) {
    const temporaryFile = `${PROJECTS_REGISTRY_FILE}.tmp`;
    fs.writeFileSync(temporaryFile, JSON.stringify({
      version: 1,
      updatedAt: new Date().toISOString(),
      projects,
    }, null, 2));
    fs.renameSync(temporaryFile, PROJECTS_REGISTRY_FILE);
  }

  let projectsRegistry = UI_VALIDATION_MODE
    ? uiValidationFixtures.map(({ id, name, rootPath }) => ({ id, name, rootPath, aliases: [name], category: "ui-validation", status: "synthetic" }))
    : loadProjectsRegistry();

  function getValidRegisteredProjects() {
    if (UI_VALIDATION_MODE) return projectsRegistry;
    return projectsRegistry.filter((project) => {
      const validPath = normalizeFocusPath(project.rootPath);
      return validPath && validPath === project.rootPath;
    });
  }

  function initializeUiValidationWorkspaces() {
    if (!UI_VALIDATION_MODE) return [];
    return uiValidationFixtures.map((fixture) => {
      let workspace;
      try { workspace = deps.workspaceEngine.get(fixture.workspaceId); }
      catch {
        workspace = deps.workspaceEngine.create({
          id: fixture.workspaceId,
          name: fixture.name,
          type: "project",
          profileScope: "ui-validation",
          memoryScope: `ui-validation:${fixture.id}`,
          metadata: { uiValidationFixture: fixture.key },
        });
      }
      if (workspace.profileScope !== "ui-validation" || workspace.metadata?.uiValidationFixture !== fixture.key) {
        throw Object.assign(new Error("Workspace synthétique UI invalide."), { code: "UI_VALIDATION_WORKSPACE_UNSAFE" });
      }
      const context = deps.workspaceEngine.context(fixture.workspaceId);
      if (!context.projects.some((project) => project.id === fixture.id)) deps.workspaceEngine.linkProject(fixture.workspaceId, fixture.id);
      if (!context.roots.some((root) => root.path === fixture.rootPath && root.mode === "read-only")) deps.workspaceEngine.bindRoot(fixture.workspaceId, fixture.rootPath, "read-only");
      return { workspaceId: fixture.workspaceId, projectId: fixture.id, name: fixture.name };
    });
  }

  function scanRegisteredProjects(focusId = null) {
    const catalog = buildFocusCatalog(getAllowedDirectories());
    if (focusId && !catalog.some((entry) => entry.id === focusId && entry.available)) {
      const error = new Error("Dossier Focus indisponible ou inconnu.");
      error.statusCode = 400;
      throw error;
    }
    const scanned = scanProjectsInAllowedRoots({
      focusCatalog: catalog,
      allowedRoots: getAllowedDirectories(),
      focusId,
    });
    if (focusId) {
      projectsRegistry = [
        ...projectsRegistry.filter((project) => project.parentFocusId !== focusId),
        ...scanned,
      ];
    } else {
      projectsRegistry = scanned;
    }
    const unique = new Map(projectsRegistry.map((project) => [project.rootPath, project]));
    projectsRegistry = [...unique.values()].sort((a, b) =>
      a.name.localeCompare(b.name, "fr", {
        sensitivity: "base", numeric: true, ignorePunctuation: true,
      })
    );
    saveProjectsRegistry(projectsRegistry);
    return projectsRegistry;
  }

  // Indique si un fichier ou dossier doit être ignoré.
  function isExcluded(name) {
    return EXCLUDED_NAMES.includes(name);
  }

  // Retourne le contenu visible d'un dossier sans lire les éléments exclus.
  function listDirectory(dirPath) {
    return fs
      .readdirSync(dirPath, { withFileTypes: true })
      .filter((entry) => !isExcluded(entry.name))
      .map((entry) => ({
        name: entry.name,
        type: entry.isDirectory() ? "directory" : "file",
        path: path.join(dirPath, entry.name),
      }));
  }

  // Vérifie que le chemin demandé reste dans un espace de travail autorisé.
  function isPathAllowed(targetPath) {
    return isPathInsideRoots(targetPath, getAllowedDirectories());
  }

  function normalizeFocusPath(focusPath) {
    if (!focusPath) {
      return null;
    }

    const resolvedPath = path.resolve(focusPath);

    if (
      !isPathAllowed(resolvedPath) ||
      !fs.existsSync(resolvedPath)
    ) {
      return null;
    }

    try {
      const realPath = fs.realpathSync(resolvedPath);
      return isPathAllowed(realPath) ? realPath : null;
    } catch {
      return null;
    }
  }

  function getProjectContextVersion(projectPath) {
    if (!projectPath) return "project-none";
    const candidates = [
      projectPath,
      ...["package.json", "README.md", "vite.config.js", "vite.config.ts", "tsconfig.json"]
        .map((name) => path.join(projectPath, name)),
    ];
    const metadata = candidates.map((candidate) => {
      try {
        const stat = fs.statSync(candidate);
        return [path.basename(candidate), stat.size, Math.trunc(stat.mtimeMs)];
      } catch {
        return [path.basename(candidate), 0, 0];
      }
    });
    return crypto.createHash("sha256").update(JSON.stringify(metadata)).digest("hex").slice(0, 24);
  }

  function normalizeFocusName(focusName) {
    if (typeof focusName !== "string") {
      return null;
    }

    const normalizedName = focusName
      .replace(/[\r\n]/g, " ")
      .trim()
      .slice(0, 120);

    return normalizedName || null;
  }

  const ALLOWED_NOON_MODES = new Set(["DA", "DEV", "SOUTENANCE"]);

  function normalizeNoonMode(mode) {
    const normalizedMode =
      typeof mode === "string"
        ? mode.trim().toUpperCase()
        : "";

    return ALLOWED_NOON_MODES.has(normalizedMode)
      ? normalizedMode
      : "DA";
  }

  function listLocalProjects() {
    const projectsByPath = new Map();

    const MAX_DEPTH = 6;
    const MAX_PROJECTS = 100;

    function isProjectDirectory(directoryPath) {
      let names;

      try {
        names = new Set(fs.readdirSync(directoryPath));
      } catch {
        return false;
      }

      const hasPackage = names.has("package.json");

      const hasViteConfig = [
        "vite.config.js",
        "vite.config.mjs",
        "vite.config.ts",
      ].some((fileName) => names.has(fileName));

      const hasFrontendAndBackend =
        names.has("frontend") && names.has("backend");

      const hasStaticWebsite =
        names.has("index.html") &&
        (
          names.has("css") ||
          names.has("styles") ||
          names.has("assets")
        );

      return (
        hasPackage ||
        hasViteConfig ||
        hasFrontendAndBackend ||
        hasStaticWebsite
      );
    }

    function addProject(projectPath, priority) {
      const resolvedPath = path.resolve(projectPath);

      if (
        projectsByPath.size >= MAX_PROJECTS ||
        !isPathAllowed(resolvedPath)
      ) {
        return;
      }

      projectsByPath.set(resolvedPath, {
        name: path.basename(resolvedPath),
        path: resolvedPath,
        priority,
      });
    }

    function scanDirectory(directoryPath, depth, priority) {
      if (
        depth > MAX_DEPTH ||
        projectsByPath.size >= MAX_PROJECTS
      ) {
        return;
      }

      const resolvedPath = path.resolve(directoryPath);

      if (!isPathAllowed(resolvedPath)) {
        return;
      }

      /*
       * Lorsqu’un vrai projet est détecté, on l’ajoute,
       * puis on arrête de descendre dans src, components,
       * backend, node_modules, etc.
       */
      if (isProjectDirectory(resolvedPath)) {
        addProject(resolvedPath, priority);
        return;
      }

      let entries;

      try {
        entries = fs.readdirSync(resolvedPath, {
          withFileTypes: true,
        });
      } catch {
        return;
      }

      for (const entry of entries) {
        if (
          !entry.isDirectory() ||
          isExcluded(entry.name)
        ) {
          continue;
        }

        scanDirectory(
          path.join(resolvedPath, entry.name),
          depth + 1,
          priority
        );
      }
    }

    // Recherche prioritaire dans OpenClassrooms et Website.
    for (const priorityDirectory of PRIORITY_DIRECTORIES) {
      scanDirectory(priorityDirectory, 0, true);
    }

    // Recherche dans les autres espaces autorisés.
    for (const allowedDirectory of PROJECT_DIRECTORIES) {
      scanDirectory(allowedDirectory, 0, false);
    }

    return [...projectsByPath.values()].sort(
      (projectA, projectB) => {
        if (projectA.priority !== projectB.priority) {
          return projectA.priority ? -1 : 1;
        }

        return projectA.name.localeCompare(
          projectB.name,
          "fr"
        );
      }
    );
  }

  function resolveFocusProject(query) {
    const registeredResult = resolveProject(query, getValidRegisteredProjects());
    if (registeredResult.status === "resolved") {
      const project = registeredResult.project;
      return {
        status: "resolved",
        project: {
          id: project.id,
          name: project.name,
          path: project.rootPath,
          parentFocusId: project.parentFocusId,
          parentFocusName: project.parentFocusName,
          kind: "project",
        },
      };
    }
    if (registeredResult.status === "ambiguous") {
      return {
        status: "ambiguous",
        projects: registeredResult.projects.slice(0, 10).map((project) => ({
          id: project.id,
          name: project.name,
          path: project.rootPath,
          parentFocusName: project.parentFocusName,
          kind: "project",
        })),
      };
    }

    const catalog = buildFocusCatalog(getAllowedDirectories());
    const catalogEntry = findFocusEntry(query, catalog);
    if (catalogEntry) {
      if (catalogEntry.status === "ambiguous") {
        return {
          status: "ambiguous",
          projects: catalogEntry.matches.map((projectPath) => ({
            id: catalogEntry.id,
            name: catalogEntry.displayName,
            path: projectPath,
          })),
        };
      }
      if (!catalogEntry.available) return { status: "not_found", project: null };
      return {
        status: "resolved",
        project: {
          id: catalogEntry.id,
          name: catalogEntry.displayName,
          path: catalogEntry.resolvedPath,
        },
      };
    }

    const normalizedQuery = String(query || "").trim().toLocaleLowerCase("fr");
    if (!normalizedQuery) return { status: "cleared", project: null };

    const matches = listLocalProjects().filter((project) =>
      project.name.toLocaleLowerCase("fr").includes(normalizedQuery)
    );
    const exact = matches.find(
      (project) => project.name.toLocaleLowerCase("fr") === normalizedQuery
    );

    if (exact) return { status: "resolved", project: exact };
    if (matches.length === 1) return { status: "resolved", project: matches[0] };
    if (matches.length > 1) {
      return {
        status: "ambiguous",
        projects: matches.slice(0, 5).map(({ name, path: projectPath }) => ({
          name,
          path: projectPath,
        })),
      };
    }
    return { status: "not_found", project: null };
  }

  function resolveFocusCatalogSelection(focusId, requestedPath = null) {
    const registeredProject = getValidRegisteredProjects()
      .find((project) => project.id === focusId);
    if (registeredProject) {
      const requestedRealPath = requestedPath
        ? normalizeFocusPath(requestedPath)
        : registeredProject.rootPath;
      if (requestedRealPath !== registeredProject.rootPath) return null;
      return {
        id: registeredProject.id,
        name: registeredProject.name,
        path: registeredProject.rootPath,
        project: registeredProject,
      };
    }
    const entry = buildFocusCatalog(getAllowedDirectories())
      .find((candidate) => candidate.id === focusId);
    if (!entry) return null;
    let selectedPath = entry.resolvedPath;
    if (entry.status === "ambiguous" && requestedPath) {
      const realRequestedPath = normalizeFocusPath(requestedPath);
      selectedPath = entry.matches.includes(realRequestedPath)
        ? realRequestedPath
        : null;
    }
    if (!selectedPath) return null;
    return {
      id: entry.id,
      name: entry.displayName,
      path: selectedPath,
    };
  }

  // Recherche récursivement un nom de fichier ou de dossier.
  function searchFiles(searchTerm) {
    const results = [];
    const normalizedSearch = searchTerm.toLowerCase();

    function scanDirectory(currentPath) {
      let entries;

      try {
        entries = fs.readdirSync(currentPath, {
          withFileTypes: true,
        });
      } catch {
        // Ignore les dossiers illisibles et poursuit la recherche ailleurs.
        return;
      }

      for (const entry of entries) {
        if (isExcluded(entry.name)) {
          continue;
        }

        const fullPath = path.join(currentPath, entry.name);

        if (entry.name.toLowerCase().includes(normalizedSearch)) {
          results.push({
            name: entry.name,
            type: entry.isDirectory() ? "directory" : "file",
            path: fullPath,
          });
        }

        if (entry.isDirectory()) {
          scanDirectory(fullPath);
        }

        // Évite une réponse gigantesque
        if (results.length >= 15) {
          return;
        }
      }
    }

    for (const allowedDirectory of getAllowedDirectories()) {
      scanDirectory(allowedDirectory);

      if (results.length >= 15) {
        break;
      }
    }

    return results;
  }

  // Lit un fichier uniquement après avoir appliqué toutes les règles de sécurité.
  function readAllowedFile(filePath) {
    const resolvedPath = path.resolve(filePath);

    if (!isPathAllowed(resolvedPath)) {
      throw new Error("Accès refusé : fichier hors des dossiers autorisés.");
    }

    if (!fs.existsSync(resolvedPath)) {
      throw new Error("Fichier introuvable.");
    }

    const stats = fs.statSync(resolvedPath);

    if (!stats.isFile()) {
      throw new Error("Le chemin demandé n'est pas un fichier.");
    }

    if (isExcluded(path.basename(resolvedPath))) {
      throw new Error("Accès refusé : fichier protégé.");
    }

    // Bloque explicitement les fichiers susceptibles de contenir des secrets.
    const forbiddenFiles = [
      ".env",
      ".env.local",
      ".env.development",
      ".env.production",
      ".npmrc",
    ];

    if (forbiddenFiles.includes(path.basename(resolvedPath))) {
      throw new Error("Accès refusé : fichier sensible.");
    }

    // Limite la lecture à 1 Mo pour éviter une réponse trop volumineuse.
    if (stats.size > 1024 * 1024) {
      throw new Error("Fichier trop volumineux.");
    }

    // Seuls les formats texte utiles à l'analyse de projets sont acceptés.
    const allowedExtensions = [
      ".js",
      ".jsx",
      ".ts",
      ".tsx",
      ".json",
      ".html",
      ".css",
      ".scss",
      ".md",
      ".txt",
    ];

    const extension = path.extname(resolvedPath).toLowerCase();

    if (!allowedExtensions.includes(extension)) {
      throw new Error("Type de fichier non autorisé.");
    }

    // Tronque les très longs contenus avant de les transmettre au modèle.
    const content = fs.readFileSync(resolvedPath, "utf8");
    const MAX_CHARS = 6000;

    return {
      path: resolvedPath,
      extension,
      size: stats.size,
      truncated: content.length > MAX_CHARS,
      content:
        content.length > MAX_CHARS
          ? content.slice(0, MAX_CHARS) +
            "\n\n[CONTENU TRONQUÉ PAR NOON]"
          : content,
    };
  }

  // Gère les commandes locales simples sans interroger le modèle d'IA.
  function handleLocalCommand(question) {
    const q = question.toLowerCase().trim();

    if (q.includes("espace") || q.includes("workspace")) {
      return {
        action: "list_workspaces",
        answer: "Voici les espaces de travail autorisés.",
        data: getAllowedDirectories(),
      };
    }

    if (q.startsWith("cherche ") || q.startsWith("recherche ")) {
      const term = question
        .replace(/^cherche\s+/i, "")
        .replace(/^recherche\s+/i, "")
        .trim();

      return {
        action: "search",
        answer: `Recherche de « ${term} ».`,
        data: searchFiles(term),
      };
    }

    return {
      action: "unknown",
      answer: "Je n'ai pas encore appris à exécuter cette demande.",
      data: null,
    };
  }

  return { getValidRegisteredProjects, initializeUiValidationWorkspaces, scanRegisteredProjects, isExcluded, listDirectory, isPathAllowed, normalizeFocusPath, getProjectContextVersion, normalizeFocusName, normalizeNoonMode, listLocalProjects, resolveFocusProject, resolveFocusCatalogSelection, searchFiles, readAllowedFile, handleLocalCommand };
}

module.exports = { DEPENDENCIES, createLocalProjects };
