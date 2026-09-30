"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createAttachmentResolver } = require("../services/context/attachment-resolver");
const { parseTemporal } = require("../services/intents/temporal-parser");
const { createPersonalDatabase } = require("../services/persistence/database");
const { createPersonalIntelligenceRepository } = require("../services/persistence/repositories/personal-intelligence-repository");
const { createMemoryCipher } = require("../services/personal-memory/crypto");
const { executeConversationMemoryCommand, importDateRange, parseConversationMemoryCommand } = require("../services/personal-memory/conversation-memory-commands");
const { createPrivateMemoryService } = require("../services/personal-memory/private-memory-service");

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "noon-document-memory-"));
  const file = path.join(dir, "memory.sqlite");
  const key = crypto.randomBytes(32);
  const database = createPersonalDatabase(file);
  return {
    dir, file, key, database,
    repository: createPersonalIntelligenceRepository(database),
    privateService: createPrivateMemoryService({ databaseWrapper: database, cipher: createMemoryCipher(key) }),
    resolver: createAttachmentResolver(),
  };
}

function context(fx) {
  return { privateMemoryService: fx.privateService, personalRepository: fx.repository, attachmentResolver: fx.resolver };
}

function importCommand(fx, text, currentAttachments = []) {
  return executeConversationMemoryCommand(context(fx), parseConversationMemoryCommand(text), {
    conversationId: "conversation-fixture", currentAttachments,
  });
}

function close(fx) { fx.database.close(); fs.rmSync(fx.dir, { recursive: true, force: true }); }

test("une mémoire directe conserve le fait et jamais l'instruction", () => {
  const fx = fixture();
  try {
    const result = executeConversationMemoryCommand(context(fx), parseConversationMemoryCommand("Retiens que je préfère React."));
    assert.equal(result.status, "saved");
    assert.equal(result.scope, "general");
    assert.equal(fx.repository.listMemories().length, 1);
    assert.equal(fx.repository.listMemories()[0].value, "je préfère React");
  } finally { close(fx); }
});
test("un document récent produit des souvenirs atomiques généraux et privés", () => {
  const fx = fixture();
  try {
    fx.resolver.registerAttachments({ conversationId: "conversation-fixture", attachments: [{
      kind: "text", name: "test-context.txt",
      content: "Camille est directrice artistique.\nCamille préfère les explications concrètes avant le jargon.\nMorgan est sa partenaire.",
    }] });
    const result = importCommand(fx, "Retiens tout ce qui est important dans ce document.");
    assert.equal(result.status, "saved");
    assert.equal(result.importResult.savedCount, 3);
    assert.equal(result.importResult.generalCount, 2);
    assert.equal(result.importResult.privateCount, 1);
    const stored = [...fx.repository.listMemories().map((item) => item.value), ...fx.privateService.listMemories({ includeDeleted: false }).map((item) => item.statement)];
    assert.equal(stored.some((value) => /tout ce qui est important/i.test(value)), false);
  } finally { close(fx); }
});

test("un dossier résout tout le dernier lot de pièces jointes", () => {
  const resolver = createAttachmentResolver();
  resolver.registerAttachments({ conversationId: "conversation-fixture", attachments: [
    { kind: "text", name: "alpha.txt", content: "Préférence fictive alpha." },
    { kind: "text", name: "beta.txt", content: "Préférence fictive beta." },
  ] });
  assert.deepEqual(resolver.resolveAttachmentReferences("Mémorise ce dossier", { conversationId: "conversation-fixture" }).map((item) => item.filename), ["alpha.txt", "beta.txt"]);
});

test("les formulations naturelles d'import ne deviennent jamais une mémoire directe", () => {
  for (const value of [
    "Garde les informations de ce document",
    "Retiens tout ce qui est important ici",
    "Mémorise ces fichiers",
    "Retiens ce que je viens de te donner",
  ]) assert.equal(parseConversationMemoryCommand(value)?.action, "import_document", value);
});

test("réimporter le même fait ne crée pas de doublon", () => {
  const fx = fixture();
  try {
    const attachment = { kind: "text", name: "duplicate.txt", content: "Camille préfère une interface claire." };
    const first = importCommand(fx, "Retiens ce document", [attachment]);
    const second = importCommand(fx, "Retiens ce document", [attachment]);
    assert.equal(first.importResult.savedCount, 1);
    assert.equal(second.importResult.duplicateCount, 1);
    assert.equal(fx.repository.listMemories().length, 1);
  } finally { close(fx); }
});

test("une information évolutive met à jour la mémoire et conserve son historique", () => {
  const fx = fixture();
  try {
    importCommand(fx, "Retiens ce document", [{ kind: "text", name: "version-a.txt", content: "La formation en cours se termine le 10/11/2030." }]);
    const updated = importCommand(fx, "Retiens ce document", [{ kind: "text", name: "version-b.txt", content: "La formation en cours se termine le 20/11/2030." }]);
    assert.equal(updated.importResult.updatedCount, 1);
    const item = fx.repository.listMemories()[0];
    assert.match(item.value, /20\/11\/2030/);
    assert.equal(item.metadata.versions.length, 1);
  } finally { close(fx); }
});

test("une contradiction ambiguë reste à résoudre et n'écrase pas l'ancien souvenir", () => {
  const fx = fixture();
  try {
    importCommand(fx, "Retiens ce document", [{ kind: "text", name: "relation-a.txt", content: "Morgan est la partenaire de Camille." }]);
    const result = importCommand(fx, "Retiens ce document", [{ kind: "text", name: "relation-b.txt", content: "Morgan n'est plus la partenaire de Camille." }]);
    assert.equal(result.importResult.conflicts.length, 1);
    assert.equal(fx.privateService.listMemories({ includeDeleted: false }).length, 1);
    assert.doesNotMatch(fx.privateService.listMemories({ includeDeleted: false })[0].statement, /n'est plus/);
  } finally { close(fx); }
});

test("un secret synthétique est refusé et n'est jamais persisté", () => {
  const fx = fixture();
  try {
    const result = importCommand(fx, "Retiens ce document", [{ kind: "text", name: "secret-fixture.txt", content: "OPENAI_API_KEY=fixture-redacted-value" }]);
    assert.equal(result.status, "error");
    assert.equal(result.importResult.ignoredCount, 0);
    assert.equal(result.importResult.refusedCount, 1);
    assert.equal(result.importResult.refusedReasons.secret, 1);
    assert.match(result.answer, /1 élément\(s\) refusé\(s\)/i);
    assert.match(result.answer, /secret|identifiant/i);
    assert.doesNotMatch(result.answer, /fixture-redacted-value/i);
    assert.equal(fx.repository.listMemories().length, 0);
    assert.equal(fx.privateService.listMemories({ includeDeleted: false }).length, 0);
  } finally { close(fx); }
});

test("les souvenirs persistent après réouverture SQLite et restent recherchables par provenance", () => {
  const fx = fixture();
  try {
    importCommand(fx, "Retiens ce document", [{ kind: "text", name: "restart-fixture.txt", content: "Camille préfère les démonstrations visuelles." }]);
    fx.database.close();
    fx.database = createPersonalDatabase(fx.file);
    fx.repository = createPersonalIntelligenceRepository(fx.database);
    fx.privateService = createPrivateMemoryService({ databaseWrapper: fx.database, cipher: createMemoryCipher(fx.key) });
    const result = executeConversationMemoryCommand(context(fx), parseConversationMemoryCommand("Montre-moi les souvenirs importés provenant du fichier restart-fixture.txt"));
    assert.equal(result.status, "inspected");
    assert.equal(result.generalCount, 1);
    assert.match(result.answer, /démonstrations visuelles/);
  } finally { close(fx); }
});

test("une écriture non vérifiable ne peut pas produire un faux succès", () => {
  const personalRepository = { listMemories: () => [], upsertMemory: () => ({ id: "missing" }), getMemory: () => null };
  const result = executeConversationMemoryCommand({ personalRepository, privateMemoryService: { available: false } }, parseConversationMemoryCommand("Retiens ce document"), {
    currentAttachments: [{ kind: "text", name: "write-failure.txt", content: "Camille préfère les exemples fictifs." }],
  });
  assert.equal(result.status, "error");
  assert.doesNotMatch(result.answer, /retenu|mémorisée/i);
});

test("hier est calculé comme une date Europe/Paris même au changement d'heure", () => {
  assert.equal(parseTemporal("hier", { now: new Date("2026-03-29T10:00:00Z"), timeZone: "Europe/Paris" }).date, "2026-03-28");
  assert.equal(parseTemporal("hier", { now: new Date("2026-10-25T10:00:00Z"), timeZone: "Europe/Paris" }).date, "2026-10-24");
});

test("récemment et cette semaine produisent des plages d'import distinctes", () => {
  const now = new Date("2026-09-16T10:00:00Z");
  assert.deepEqual(importDateRange("récemment", now), { start: "2026-09-09", end: "2026-09-16" });
  assert.deepEqual(importDateRange("cette semaine", now), { start: "2026-09-14", end: "2026-09-16" });
});

test("une commande Retiens multi-faits est atomisée et répartie entre les bons profils", () => {
  const fx = fixture();
  try {
    const result = executeConversationMemoryCommand(
      context(fx),
      parseConversationMemoryCommand(
        "Retiens qu'Alexandra suit un traitement médical TEST-ALEX. Kaan suit un traitement médical TEST-KAAN. Sinan suit un traitement médical TEST-SINAN."
      )
    );

    const alexandra = fx.privateService.listMemories({ subjectId: "alexandra", includeDeleted: false });
    const kaan = fx.privateService.listMemories({ subjectId: "kaan", includeDeleted: false });
    const sinan = fx.privateService.listMemories({ subjectId: "sinan", includeDeleted: false });
    const arnaud = fx.privateService.listMemories({ subjectId: "arnaud", includeDeleted: false });

    assert.equal(alexandra.length, 1);
    assert.equal(kaan.length, 1);
    assert.equal(sinan.length, 1);
    assert.equal(arnaud.length, 0);

    assert.match(alexandra[0].statement, /TEST-ALEX/);
    assert.match(kaan[0].statement, /TEST-KAAN/);
    assert.match(sinan[0].statement, /TEST-SINAN/);

    assert.equal(alexandra[0].category, "health");
    assert.equal(kaan[0].category, "health");
    assert.equal(sinan[0].category, "health");

    assert.notEqual(result.status, "error");
  } finally {
    close(fx);
  }
});


test("l'atomisation conserve le sujet explicite pour les phrases pronominales suivantes", () => {
  const fx = fixture();
  try {
    const result = importCommand(
      fx,
      "Retiens ce document",
      [{
        kind: "text",
        name: "subject-continuity.txt",
        content: [
          "Alexandra suit un traitement médical TEST-CONTEXT.",
          "Elle a un rendez-vous médical TEST-FOLLOWUP."
        ].join(" ")
      }]
    );

    const alexandra = fx.privateService.listMemories({
      subjectId: "alexandra",
      includeDeleted: false
    });

    const arnaud = fx.privateService.listMemories({
      subjectId: "arnaud",
      includeDeleted: false
    });

    assert.equal(result.importResult.privateCount, 2);
    assert.equal(alexandra.length, 2);
    assert.equal(arnaud.length, 0);

    assert.match(alexandra[0].statement + " " + alexandra[1].statement, /TEST-CONTEXT/);
    assert.match(alexandra[0].statement + " " + alexandra[1].statement, /TEST-FOLLOWUP/);
  } finally {
    close(fx);
  }
});


test("un bloc explicite riche classe les faits durables et ignore opinion ou humour", () => {
  const fx = fixture();

  try {
    const result = executeConversationMemoryCommand(
      context(fx),
      parseConversationMemoryCommand(
        [
          "Retiens qu'Alexandra est ma partenaire de PACS depuis le 20 décembre 2030.",
          "Alexandra est née à Ville-Test le 25 juin 2030.",
          "Elle suit un traitement médical TEST-HEALTH.",
          "Elle est très brillante et allergique aux imbéciles."
        ].join(" ")
      )
    );

    const alexandra = fx.privateService.listMemories({
      subjectId: "alexandra",
      includeDeleted: false
    });

    assert.ok(
      alexandra.some((item) => item.category === "family_relationship"),
      "la relation de PACS doit être classée family_relationship"
    );

    assert.ok(
      alexandra.some((item) => item.category === "identity"),
      "la naissance doit être classée identity"
    );

    assert.ok(
      alexandra.some(
        (item) =>
          item.category === "health" &&
          /TEST-HEALTH/.test(item.statement)
      ),
      "le fait médical doit être classé health"
    );

    const general = fx.repository.listMemories();

    assert.equal(
      alexandra.some((item) => /très brillante|imbéciles/i.test(item.statement)),
      false,
      "une opinion ou formulation humoristique ne doit pas devenir une mémoire privée"
    );

    assert.equal(
      general.some((item) => /très brillante|imbéciles/i.test(String(item.value))),
      false,
      "une opinion ou formulation humoristique ne doit pas devenir une mémoire générale"
    );

    assert.equal(result.importResult.ignoredReasons.opinion, 1);
    assert.equal(result.importResult.refusedCount, 0);
    assert.match(result.answer, /3 information\(s\) retenue\(s\)/i);
    assert.match(result.answer, /1 élément\(s\) ignoré\(s\)/i);
    assert.match(result.answer, /opinion|subjective/i);

    assert.notEqual(result.status, "error");
  } finally {
    close(fx);
  }
});






test("un save multi-faits sans scope explicite conserve la classification automatique", () => {
  const fx = fixture();

  try {
    const result = executeConversationMemoryCommand(
      context(fx),
      parseConversationMemoryCommand(
        "Retiens que je préfère TEST-AUTO-GENERAL. Alexandra suit un traitement médical TEST-AUTO-PRIVATE."
      )
    );

    const general = fx.repository.listMemories();
    const alexandra = fx.privateService.listMemories({
      subjectId: "alexandra",
      includeDeleted: false,
    });

    assert.equal(result.status, "saved");
    assert.equal(result.scope, "mixed");

    assert.equal(general.length, 1);
    assert.equal(alexandra.length, 1);

    assert.match(String(general[0].value), /TEST-AUTO-GENERAL/);
    assert.match(alexandra[0].statement, /TEST-AUTO-PRIVATE/);

    assert.equal(result.importResult.generalCount, 1);
    assert.equal(result.importResult.privateCount, 1);
  } finally {
    close(fx);
  }
});


test("un scope privé explicite force tous les faits d'un save multi-faits en mémoire privée", () => {
  const fx = fixture();

  try {
    const result = executeConversationMemoryCommand(
      context(fx),
      parseConversationMemoryCommand(
        "Retiens dans ma mémoire privée que je préfère TEST-PRIVATE-ONE. Je travaille avec TEST-PRIVATE-TWO."
      )
    );

    const general = fx.repository.listMemories();
    const privateItems = fx.privateService.listMemories({
      subjectId: "arnaud",
      includeDeleted: false,
    });

    assert.equal(result.status, "saved");
    assert.equal(result.scope, "private");

    assert.equal(general.length, 0);
    assert.equal(privateItems.length, 2);

    const stored = privateItems.map((item) => item.statement).join(" ");

    assert.match(stored, /TEST-PRIVATE-ONE/);
    assert.match(stored, /TEST-PRIVATE-TWO/);

    assert.equal(result.importResult.generalCount, 0);
    assert.equal(result.importResult.privateCount, 2);
  } finally {
    close(fx);
  }
});


test("un scope projet explicite force tous les faits multi-faits dans le projet actif sans polluer le texte", () => {
  const fx = fixture();

  try {
    const command = parseConversationMemoryCommand(
      "Retiens dans la mémoire du projet Noon que je préfère TEST-PROJECT-ONE. Je travaille avec TEST-PROJECT-TWO."
    );

    const result = executeConversationMemoryCommand(
      context(fx),
      command,
      {
        projectId: "noon-fixture",
        projectName: "Noon",
      }
    );

    const general = fx.repository.listMemories();

    const projectItems = fx.privateService.listMemories({
      subjectId: "project:noon-fixture",
      includeDeleted: false,
    });

    assert.equal(command.requestedScope, "project");

    assert.equal(result.status, "saved");
    assert.equal(result.scope, "project");

    assert.equal(general.length, 0);
    assert.equal(projectItems.length, 2);

    const stored = projectItems.map((item) => item.statement).join(" ");

    assert.match(stored, /TEST-PROJECT-ONE/);
    assert.match(stored, /TEST-PROJECT-TWO/);

    assert.doesNotMatch(stored, /Noon que/i);

    assert.equal(result.importResult.generalCount, 0);
    assert.equal(result.importResult.privateCount, 0);
    assert.equal(result.importResult.projectCount, 2);
  } finally {
    close(fx);
  }
});


test("l'import général pronominal conserve le profil résolu au lieu de forcer Arnaud", () => {
  const fx = fixture();

  try {
    const result = importCommand(
      fx,
      "Retiens ce document",
      [{
        kind: "text",
        name: "general-subject.txt",
        content: [
          "Alexandra suit un traitement médical TEST-DOC-ANCHOR.",
          "Elle travaille comme directrice artistique TEST-DOC-ALEX-GENERAL."
        ].join(" ")
      }]
    );

    const general = fx.repository.listMemories();

    const alexGeneral = general.find(
      (item) => /TEST-DOC-ALEX-GENERAL/.test(String(item.value))
    );

    assert.equal(result.status, "saved");
    assert.ok(alexGeneral);
    assert.equal(alexGeneral.metadata?.profileId, "alexandra");
  } finally {
    close(fx);
  }
});



test("un contenu non mémorisable est distingué d’une opinion et d’un secret", () => {
  const fx = fixture();

  try {
    const result = importCommand(
      fx,
      "Retiens ce document",
      [{
        kind: "text",
        name: "unsupported.txt",
        content: "Le mur de la salle est bleu TEST-UNSUPPORTED."
      }]
    );

    assert.equal(result.importResult.ignoredCount, 1);
    assert.equal(result.importResult.ignoredReasons.unsupported, 1);
    assert.equal(result.importResult.ignoredReasons.opinion, 0);
    assert.equal(result.importResult.refusedCount, 0);

    assert.match(result.answer, /1 élément\(s\) ignoré\(s\)/i);
    assert.match(result.answer, /catégorie de mémoire durable|non mémorisable/i);
    assert.doesNotMatch(result.answer, /sensible/i);

    assert.equal(fx.repository.listMemories().length, 0);
    assert.equal(
      fx.privateService.listMemories({ includeDeleted: false }).length,
      0
    );
  } finally {
    close(fx);
  }
});


test("une instruction contenue dans un document est ignorée comme instruction", () => {
  const fx = fixture();

  try {
    const result = importCommand(
      fx,
      "Retiens ce document",
      [{
        kind: "text",
        name: "instruction.txt",
        content: "Explique ce document demain avec TEST-INSTRUCTION."
      }]
    );

    assert.equal(result.importResult.ignoredCount, 1);
    assert.equal(result.importResult.ignoredReasons.instruction, 1);
    assert.equal(result.importResult.ignoredReasons.unsupported, 0);
    assert.equal(result.importResult.refusedCount, 0);

    assert.match(result.answer, /1 élément\(s\) ignoré\(s\)/i);
    assert.match(result.answer, /instruction|demande d.action/i);

    assert.equal(fx.repository.listMemories().length, 0);
  } finally {
    close(fx);
  }
});



test("une commande explicite Retiens que reste un save même si un segment ultérieur mentionne un document", () => {
  const command = parseConversationMemoryCommand(
    "Retiens que je préfère le marqueur RUNTIME-CURATOR-3009. " +
    "Je travaille comme développeur TEST-RUNTIME-3009. " +
    "Je suis très brillant. " +
    "OPENAI_API_KEY=fixture-runtime-secret-3009. " +
    "Explique ce document demain avec RUNTIME-INSTRUCTION-3009."
  );

  assert.ok(command);
  assert.equal(command.action, "save");
  assert.match(command.statement, /RUNTIME-CURATOR-3009/);
  assert.match(command.statement, /TEST-RUNTIME-3009/);
  assert.match(command.statement, /fixture-runtime-secret-3009/);
  assert.match(command.statement, /RUNTIME-INSTRUCTION-3009/);
});
