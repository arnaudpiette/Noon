"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createPersonalDatabase, SCHEMA_VERSION } = require("../services/persistence/database");
const { createWorkspaceRepository } = require("../services/persistence/repositories/workspace-repository");
const { createWorkspaceEngine } = require("../services/workspaces/workspace-engine");
const { createPersonalSearchEngine } = require("../services/search/personal-search-engine");

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "noon-workspaces-"));
  const allowed = path.join(directory, "allowed"); fs.mkdirSync(allowed);
  const projects = [{ id: "project-a", name: "Alpha", rootPath: allowed }, { id: "project-b", name: "Beta" }];
  const database = createPersonalDatabase(path.join(directory, "test.sqlite"));
  const repository = createWorkspaceRepository(database);
  const events = [];
  const engine = createWorkspaceEngine({ repository, allowedRoots: () => [allowed], projectProvider: () => projects, conversationProvider: () => [{ id: "conversation-1", title: "Test" }], artifactProvider: () => [{ artifactId: "artifact-1", title: "Brief" }], observability: (event, metadata) => events.push({ event, metadata }) });
  return { directory, allowed, database, repository, engine, events };
}

test("le schéma Workspace, Session, Jobs, Sync, Remote et Benchmark est versionné", () => assert.equal(SCHEMA_VERSION, 16));

test("crée, renomme et recharge un workspace avec un identifiant stable", () => {
  const f = fixture(); const created = f.engine.create({ name: "Client A", type: "client" });
  const renamed = f.engine.update(created.id, { name: "Client B" });
  assert.equal(renamed.id, created.id); assert.equal(f.engine.get(created.id).name, "Client B"); f.database.close();
});

test("deux homonymes restent séparés et leur résolution est ambiguë", () => {
  const f = fixture(); f.engine.create({ name: "Kasa" }); f.engine.create({ name: "Kasa" });
  assert.equal(f.engine.resolve("Kasa").status, "ambiguous"); assert.equal(f.engine.active(), null); f.database.close();
});

test("active explicitement un seul workspace et conserve le précédent", () => {
  const f = fixture(); const a = f.engine.create({ name: "A" }); const b = f.engine.create({ name: "B" });
  f.engine.activate(a.id); const switched = f.engine.activate(b.id);
  assert.equal(f.engine.getActiveWorkspace().id, b.id); assert.equal(switched.previousWorkspaceId, a.id); f.database.close();
});

test("archive sans supprimer ni cascader les liaisons", () => {
  const f = fixture(); const workspace = f.engine.create({ name: "Archive" }); f.engine.linkProject(workspace.id, "project-a");
  f.engine.archive(workspace.id); assert.equal(f.engine.get(workspace.id).status, "archived"); assert.equal(f.repository.links(workspace.id).projects.length, 1); f.database.close();
});

test("lie projets, conversations et artefacts explicitement", () => {
  const f = fixture(); const workspace = f.engine.create({ name: "Liens" });
  f.engine.linkProject(workspace.id, "project-a"); f.engine.linkConversation(workspace.id, "conversation-1"); f.engine.linkArtifact(workspace.id, "artifact-1", "project-a");
  const context = f.engine.context(workspace.id); assert.equal(context.projects[0].id, "project-a"); assert.equal(context.conversations[0].title, "Test"); assert.equal(context.artifacts[0].title, "Brief"); f.database.close();
});

test("déplacer une conversation ne la duplique pas entre workspaces", () => {
  const f = fixture(); const a = f.engine.create({ name: "A" }); const b = f.engine.create({ name: "B" });
  f.engine.linkConversation(a.id, "conversation-1"); f.engine.moveConversation("conversation-1", b.id);
  assert.equal(f.repository.links(a.id).conversations.length, 0); assert.equal(f.engine.workspaceForConversation("conversation-1"), b.id); f.database.close();
});

test("refuse une racine hors autorisation et accepte son realpath", () => {
  const f = fixture(); const workspace = f.engine.create({ name: "Racines" });
  assert.throws(() => f.engine.bindRoot(workspace.id, f.directory), { code: "ROOT_NOT_ALLOWED" });
  assert.equal(f.engine.bindRoot(workspace.id, f.allowed).path, fs.realpathSync(f.allowed)); f.database.close();
});

test("l'adaptateur legacy est idempotent sans fusion par nom", () => {
  const f = fixture(); const one = f.engine.ensureLegacy({ legacyId: "focus-a", name: "Même nom", rootPath: f.allowed });
  const again = f.engine.ensureLegacy({ legacyId: "focus-a", name: "Autre libellé", rootPath: f.allowed });
  const other = f.engine.ensureLegacy({ legacyId: "focus-b", name: "Même nom" });
  assert.equal(one.id, again.id); assert.notEqual(one.id, other.id); f.database.close();
});

test("un contexte temporaire ne change pas le workspace global", () => {
  const f = fixture(); const workspace = f.engine.create({ name: "Temporaire" }); f.engine.activate(workspace.id);
  const temporary = f.engine.temporaryContext(workspace.id, { projectId: "project-b" });
  assert.equal(temporary.activeProject.id, "project-b"); assert.equal(f.engine.getActiveWorkspace().id, workspace.id); f.database.close();
});

test("le diagnostic détecte les liaisons orphelines sans les réparer", () => {
  const f = fixture(); const workspace = f.engine.create({ name: "Diagnostic" }); f.engine.linkConversation(workspace.id, "conversation-disparue");
  const health = f.engine.health(workspace.id); assert.equal(health.healthy, false); assert.ok(health.issues.some((item) => item.code === "ORPHAN_CONVERSATION")); assert.equal(f.engine.workspaceForConversation("conversation-disparue"), workspace.id); f.database.close();
});

test("les événements d'observabilité ne contiennent aucun chemin", () => {
  const f = fixture(); const workspace = f.engine.create({ name: "Privé" }); f.engine.bindRoot(workspace.id, f.allowed);
  assert.equal(JSON.stringify(f.events).includes(f.allowed), false); f.database.close();
});

test("la recherche bornée à un workspace ne fuit pas vers un autre projet", async () => {
  const engine = createPersonalSearchEngine({ adapters: { project: { async search() { return [{ id: "a", title: "Projet Alpha", snippet: "budget alpha", projectId: "project-a", profileScope: "projects" }, { id: "b", title: "Projet Beta", snippet: "budget beta", projectId: "project-b", profileScope: "projects" }]; } } } });
  const result = await engine.search({ query: "projet budget", sourceScopes: ["project"], profileScope: "projects", workspaceId: "workspace-a", workspaceProjectIds: ["project-a"] });
  assert.deepEqual(result.results.map((item) => item.projectId), ["project-a"]);
});
