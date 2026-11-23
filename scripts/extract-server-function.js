#!/usr/bin/env node
"use strict";
// V3-L7 — outil de maintenance (hors app packagée), pendant de extract-server-routes.js pour les
// fonctions de premier niveau de server.js. La déclaration est recopiée telle quelle dans une
// enveloppe qui lit ses dépendances (accesseurs) à chaque appel ; server.js garde le même nom
// (`const nom = createX({ get dep() { … } })`) à l'emplacement d'origine.
// Refuse : écriture d'une variable du serveur, `let` réaffecté non déclaré (live interdit ici,
// startupOnly accepté), __dirname/require…, this/arguments, fonction auxiliaire utilisée ailleurs,
// usage de la fonction pendant le chargement du module (zone morte du `const`).
// usage : node scripts/extract-server-function.js <config.json> [--write]   (sans --write : essai à blanc)
// config: { functions: ["entree", "auxiliaire"…], module: "services/x/y.js", factory: "createY",
//           header: "commentaire", startupOnly: ["x"] }
const fs = require("node:fs");
const path = require("node:path");
const ROOT = path.resolve(__dirname, "..");
const espree = require(path.join(ROOT, "node_modules/espree"));
const eslintScope = require(path.join(ROOT, "node_modules/eslint-scope"));

const config = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const write = process.argv.includes("--write");
const serverFile = path.join(ROOT, "server.js");
const source = fs.readFileSync(serverFile, "utf8");
const entry = config.functions[0];

const ast = espree.parse(source, { ecmaVersion: "latest", sourceType: "script", range: true, loc: true, ecmaFeatures: { globalReturn: true } });
const manager = eslintScope.analyze(ast, { ecmaVersion: 2022, nodejsScope: true, sourceType: "script" });
const moduleScope = manager.globalScope.childScopes[0];
const nodes = config.functions.map((name) => {
  const found = ast.body.filter((node) => node.type === "FunctionDeclaration" && node.id.name === name);
  if (found.length !== 1) throw new Error(`fonction absente ou ambiguë : ${name}`);
  return found[0];
});
const inSet = (range) => nodes.some((node) => range[0] >= node.range[0] && range[1] <= node.range[1]);

const deps = new Map(); const problems = [];
for (const scope of manager.scopes) {
  for (const reference of scope.references) {
    if (!inSet(reference.identifier.range)) continue;
    const variable = reference.resolved;
    if (!variable) {
      if (["__dirname", "__filename", "require", "module", "exports"].includes(reference.identifier.name)) problems.push(`${reference.identifier.name} dans la fonction`);
      continue;
    }
    if (variable.defs.some((def) => inSet(def.name.range))) continue;
    if (variable.scope !== moduleScope) { problems.push(`variable non module : ${variable.name}`); continue; }
    if (config.functions.includes(variable.name)) continue;
    if (reference.isWrite()) problems.push(`écriture de la variable serveur ${variable.name}`);
    const kind = variable.defs[0]?.parent?.kind || variable.defs[0]?.type;
    const writes = variable.references.filter((candidate) => candidate.isWrite()).length;
    if (kind === "let" && writes > 1 && !(config.startupOnly || []).includes(variable.name)) problems.push(`variable let réaffectée : ${variable.name} (startupOnly ?)`);
    deps.set(variable.name, kind);
  }
}
// Usages extérieurs : aucun pour les auxiliaires ; pour l'entrée, seulement dans une fonction
// (accesseur, gestionnaire…), jamais pendant le chargement du module.
for (const name of config.functions) {
  for (const reference of moduleScope.set.get(name).references) {
    if (inSet(reference.identifier.range)) continue;
    if (name !== entry) problems.push(`auxiliaire utilisée ailleurs : ${name} (ligne ${reference.identifier.loc.start.line})`);
    else if (reference.from === moduleScope) problems.push(`${name} utilisée au chargement (ligne ${reference.identifier.loc.start.line})`);
    if (reference.isWrite()) problems.push(`${name} réaffectée`);
  }
}
(function walk(node) {
  if (!node || typeof node.type !== "string") return;
  if (inSet(node.range) && (node.type === "ThisExpression" || (node.type === "Identifier" && node.name === "arguments" && manager.scopes.some((scope) => scope.references.some((reference) => reference.identifier === node))))) problems.push("arguments/this dans la fonction");
  for (const key of Object.keys(node)) {
    if (key === "parent") continue;
    const value = node[key];
    if (Array.isArray(value)) value.forEach(walk); else if (value && typeof value.type === "string") walk(value);
  }
})(ast);
if (problems.length) { console.error([...new Set(problems)].join("\n")); process.exit(2); }

// Commentaires collés au-dessus de chaque déclaration : ils partent avec elle.
function extent(node) {
  let from = source.lastIndexOf("\n", node.range[0] - 1) + 1;
  for (;;) {
    const previousEnd = from - 1;
    if (previousEnd <= 0) break;
    const previousStart = source.lastIndexOf("\n", previousEnd - 1) + 1;
    if (!/^\s*\/\//.test(source.slice(previousStart, previousEnd))) break;
    from = previousStart;
  }
  let to = node.range[1];
  if (source[to] === "\n") to += 1;
  return [from, to];
}
const extents = nodes.map(extent);
const templates = [];
(function walk(node) {
  if (!node || typeof node.type !== "string") return;
  if (node.type === "TemplateLiteral" && inSet(node.range)) templates.push(node.range);
  for (const key of Object.keys(node)) {
    if (key === "parent") continue;
    const value = node[key];
    if (Array.isArray(value)) value.forEach(walk); else if (value && typeof value.type === "string") walk(value);
  }
})(ast);
// Indentation de 4 espaces, sauf les lignes qui commencent à l'intérieur d'un gabarit multiligne.
function indented([from, to]) {
  let offset = from;
  return source.slice(from, to).replace(/\s+$/, "").split("\n").map((line) => {
    const lineStart = offset; offset += line.length + 1;
    const inTemplate = templates.some(([a, b]) => lineStart > a && lineStart < b);
    return line && !inTemplate ? `    ${line}` : line;
  }).join("\n");
}

const names = [...deps.keys()].sort();
const moduleText = `"use strict";

${config.header.split("\n").map((line) => `// ${line}`.trimEnd()).join("\n")}
// Fonction déplacée telle quelle depuis server.js ; ses dépendances sont lues à chaque appel
// (accesseurs), ce qui préserve les variables initialisées plus tard au démarrage.

const DEPENDENCIES = Object.freeze(${JSON.stringify(names)});

function ${config.factory}(deps) {
  for (const name of DEPENDENCIES) if (!(name in deps)) throw new TypeError(\`Dépendance manquante : \${name}\`);
  return function ${entry}(...args) {
    const {
${names.map((name) => `      ${name},`).join("\n")}
    } = deps;

${extents.map(indented).join("\n\n")}

    return ${entry}(...args);
  };
}

module.exports = { DEPENDENCIES, ${config.factory} };
`;

const construction = `const ${entry} = ${config.factory}({
${names.map((name) => `  get ${name}() { return ${name}; },`).join("\n")}
});
`;
// L'entrée est remplacée par sa construction ; les auxiliaires disparaissent (de la fin vers le début).
let server = source;
const ordered = extents.map((range, index) => ({ range, index })).sort((a, b) => b.range[0] - a.range[0]);
for (const { range: [from, to], index } of ordered) server = server.slice(0, from) + (index === 0 ? construction : "") + server.slice(to);
const requireLine = `const { ${config.factory} } = require("./${config.module.replace(/\.js$/, "")}");\n`;
const requireAnchor = 'const { createStaticAssets } = require("./services/http/static-assets");\n';
if (!server.includes(requireAnchor)) throw new Error("ancre require");
server = server.replace(requireAnchor, requireAnchor + requireLine);

const lines = extents.reduce((sum, [from, to]) => sum + source.slice(from, to).split("\n").length - 1, 0);
console.log(`fonctions : ${config.functions.join(", ")} · ${lines} lignes · dépendances (${names.length}) : ${names.join(", ")}`);
if (write) {
  fs.mkdirSync(path.dirname(path.join(ROOT, config.module)), { recursive: true });
  fs.writeFileSync(path.join(ROOT, config.module), moduleText);
  fs.writeFileSync(serverFile, server);
  console.log("écrit");
}
