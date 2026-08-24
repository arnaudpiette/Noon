"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  inspectProjectDirectory,
  resolveProject,
  scanProjectsInAllowedRoots,
  stableProjectId,
} = require("../lib/projects-registry");

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "noon-registry-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function focus(root, id = "projet-5", displayName = "Projet5") {
  return { id, displayName, resolvedPath: root, available: true };
}

test("détecte package.json + src et extrait les technologies sans lire .env", (t) => {
  const root = fixture(t);
  fs.mkdirSync(path.join(root, "src"));
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({
    name: "kasa", scripts: { dev: "vite" }, dependencies: { react: "1", vite: "1" },
  }));
  fs.writeFileSync(path.join(root, ".env"), "OPENAI_API_KEY=secret-never-read");
  const project = inspectProjectDirectory(root, focus(root));
  assert.equal(project.packageName, "kasa");
  assert.deepEqual(project.technologies, ["React", "Vite"]);
  assert.equal(JSON.stringify(project).includes("secret-never-read"), false);
});

test("détecte un projet Git et masque les identifiants de l’URL", (t) => {
  const root = fixture(t);
  fs.mkdirSync(path.join(root, ".git"));
  fs.writeFileSync(path.join(root, ".git", "HEAD"), "ref: refs/heads/main\n");
  fs.writeFileSync(path.join(root, ".git", "config"), "[remote \"origin\"]\n url = https://token@example.com/a/repo.git\n");
  const project = inspectProjectDirectory(root, focus(root));
  assert.equal(project.defaultBranch, "main");
  assert.equal(project.gitRepository.includes("token@"), false);
});

test("rejette un dossier sans score suffisant et garde des identifiants stables", (t) => {
  const root = fixture(t);
  fs.writeFileSync(path.join(root, "note.txt"), "simple note");
  assert.equal(inspectProjectDirectory(root, focus(root)), null);
  assert.equal(stableProjectId(root), stableProjectId(root));
});

test("ignore dépendances et builds et évite les doublons", (t) => {
  const root = fixture(t);
  const projectRoot = path.join(root, "Kasa");
  fs.mkdirSync(path.join(projectRoot, "src"), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, "package.json"), "{\"name\":\"kasa\"}");
  for (const ignored of ["node_modules", "dist", "build"]) {
    const hiddenProject = path.join(projectRoot, ignored, "fake");
    fs.mkdirSync(hiddenProject, { recursive: true });
    fs.writeFileSync(path.join(hiddenProject, "package.json"), "{\"name\":\"fake\"}");
  }
  const catalog = [focus(root), focus(root, "cours", "Cours")];
  const projects = scanProjectsInAllowedRoots({ focusCatalog: catalog, allowedRoots: [root] });
  assert.equal(projects.filter((project) => project.name === "Kasa").length, 1);
  assert.equal(projects.some((project) => project.packageName === "fake"), false);
});

test("résout les alias connus et signale les homonymes", () => {
  const kasa = { id: "1", name: "Kasa", aliases: ["Kasa", "Kaza", "Projet5", "Projet 5"] };
  const grimoire = { id: "2", name: "Mon Vieux Grimoire", aliases: ["Vieux Grimoire", "Projet6"] };
  const teasfolio = { id: "3", name: "•Teasfolio", aliases: ["Teasfolio"] };
  assert.equal(resolveProject("Kaza", [kasa]).project.id, "1");
  assert.equal(resolveProject("Projet 5", [kasa]).project.id, "1");
  assert.equal(resolveProject("Projet5", [kasa]).project.id, "1");
  assert.equal(resolveProject("Projet5", [kasa, {
    id: "container", name: "Projet5", aliases: ["Projet5"],
  }]).project.id, "1");
  assert.equal(resolveProject("Teasfolio", [teasfolio]).project.id, "3");
  assert.equal(resolveProject("Mon Vieux Grimoire", [grimoire]).project.id, "2");
  assert.equal(resolveProject("Kasa", [kasa, { ...kasa, id: "4" }]).status, "ambiguous");
});

test("refuse une racine et un lien symbolique qui sortent des espaces autorisés", (t) => {
  const base = fixture(t);
  const allowed = path.join(base, "allowed");
  const outside = path.join(base, "outside");
  fs.mkdirSync(allowed);
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, "package.json"), "{\"name\":\"outside\"}");
  fs.symlinkSync(outside, path.join(allowed, "escape"), "dir");
  const projects = scanProjectsInAllowedRoots({
    focusCatalog: [focus(allowed)], allowedRoots: [allowed],
  });
  assert.equal(projects.length, 0);
});
