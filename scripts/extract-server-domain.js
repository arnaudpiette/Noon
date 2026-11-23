#!/usr/bin/env node
"use strict";
// V3-L7 — outil de maintenance (hors app packagée). Déplace un domaine de server.js — plusieurs
// fonctions de premier niveau et l'état qu'elles sont seules à utiliser — vers un module, tel quel.
// Les fonctions sont créées une fois. Dépendances : une `const` déjà déclarée à la construction (ou
// une fonction, hissée) est lue une fois ; une `const` déclarée plus loin ou un `let` est lu à chaque
// usage (référence réécrite en `deps.nom`, accesseur — même zone morte qu'avant). server.js reçoit
// `const { exportées… } = createX({ … })` là où se trouvait le premier état (sinon la première
// fonction), ou avant la ligne `constructBefore` si une exportée est passée plus tôt au chargement.
// Refuse aussi : écriture d'une variable du serveur, état ou fonction non exportée utilisés hors du
// domaine, fonction exportée utilisée au chargement avant la construction, __dirname/require…,
// this/arguments. Un usage au chargement via une autre fonction n'est pas visible : vérifier que le
// serveur démarre (npm test, comparaison avant/après).
// usage : node scripts/extract-server-domain.js <config.json> [--write]   (sans --write : essai à blanc)
// config: { functions: [...], state: [...], exports: [...], module: "services/x/y.js",
//           factory: "createY", header: "commentaire", constructBefore: "texte exact d'une ligne" }
const fs = require("node:fs");
const path = require("node:path");
const ROOT = path.resolve(__dirname, "..");
const espree = require(path.join(ROOT, "node_modules/espree"));
const eslintScope = require(path.join(ROOT, "node_modules/eslint-scope"));

const config = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const write = process.argv.includes("--write");
const serverFile = path.join(ROOT, "server.js");
const source = fs.readFileSync(serverFile, "utf8");
const functionNames = config.functions || [];
const stateNames = config.state || [];
const exportNames = config.exports || [];
const ownNames = [...functionNames, ...stateNames];
for (const name of exportNames) if (!functionNames.includes(name)) throw new Error(`export hors des fonctions : ${name}`);

const ast = espree.parse(source, { ecmaVersion: "latest", sourceType: "script", range: true, loc: true, ecmaFeatures: { globalReturn: true } });
const manager = eslintScope.analyze(ast, { ecmaVersion: 2022, nodejsScope: true, sourceType: "script" });
const moduleScope = manager.globalScope.childScopes[0];
const nodes = [
  ...functionNames.map((name) => {
    const found = ast.body.filter((node) => node.type === "FunctionDeclaration" && node.id.name === name);
    if (found.length !== 1) throw new Error(`fonction absente ou ambiguë : ${name}`);
    return found[0];
  }),
  ...stateNames.map((name) => {
    const found = ast.body.filter((node) => node.type === "VariableDeclaration" && node.declarations.some((d) => d.id.name === name));
    if (found.length !== 1 || found[0].declarations.length !== 1) throw new Error(`état absent, ambigu ou déclaré avec d'autres : ${name}`);
    return found[0];
  }),
].sort((a, b) => a.range[0] - b.range[0]);
const inSet = (range) => nodes.some((node) => range[0] >= node.range[0] && range[1] <= node.range[1]);
const firstState = nodes.find((node) => node.type === "VariableDeclaration");
const anchorNode = firstState || nodes[0];

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
let constructionAt = extents[nodes.indexOf(anchorNode)][0];
if (config.constructBefore) {
  const index = source.indexOf(`\n${config.constructBefore}`);
  if (index < 0 || source.indexOf(`\n${config.constructBefore}`, index + 1) >= 0) throw new Error("constructBefore absent ou ambigu");
  if (index + 1 > constructionAt) throw new Error("constructBefore doit précéder le domaine");
  constructionAt = index + 1;
}

const deps = new Map(); const live = new Set(); const liveRanges = []; const problems = [];
for (const scope of manager.scopes) {
  for (const reference of scope.references) {
    if (!inSet(reference.identifier.range)) continue;
    const variable = reference.resolved;
    if (!variable) {
      if (["__dirname", "__filename", "require", "module", "exports"].includes(reference.identifier.name)) problems.push(`${reference.identifier.name} dans le domaine`);
      continue;
    }
    if (variable.defs.some((def) => inSet(def.name.range))) continue;
    if (variable.scope !== moduleScope) { problems.push(`variable non module : ${variable.name}`); continue; }
    if (reference.isWrite()) problems.push(`écriture de la variable serveur ${variable.name}`);
    const def = variable.defs[0];
    const kind = def?.parent?.kind || def?.type;
    if ((kind === "const" && def.name.range[0] >= constructionAt) || kind === "let") live.add(variable.name);
    else if (kind !== "const" && kind !== "FunctionName" && kind !== "ClassName") problems.push(`dépendance ${kind} non prise en charge : ${variable.name}`);
    if (live.has(variable.name)) liveRanges.push(reference.identifier.range);
    deps.set(variable.name, kind);
  }
}
for (const name of ownNames) {
  for (const reference of moduleScope.set.get(name).references) {
    if (inSet(reference.identifier.range)) continue;
    const line = reference.identifier.loc.start.line;
    if (!exportNames.includes(name)) problems.push(`${stateNames.includes(name) ? "état" : "fonction non exportée"} utilisé hors du domaine : ${name} (ligne ${line})`);
    else if (reference.from === moduleScope && reference.identifier.range[0] < constructionAt) problems.push(`${name} utilisée au chargement avant la construction (ligne ${line})`);
    if (reference.isWrite()) problems.push(`${name} réaffectée hors du domaine`);
  }
}
(function walk(node) {
  if (!node || typeof node.type !== "string") return;
  if (inSet(node.range) && (node.type === "ThisExpression" || (node.type === "Identifier" && node.name === "arguments" && manager.scopes.some((scope) => scope.references.some((reference) => reference.identifier === node))))) problems.push("arguments/this dans le domaine");
  for (const key of Object.keys(node)) {
    if (key === "parent") continue;
    const value = node[key];
    if (Array.isArray(value)) value.forEach(walk); else if (value && typeof value.type === "string") walk(value);
  }
})(ast);
if (problems.length) { console.error([...new Set(problems)].join("\n")); process.exit(2); }

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
// Références « live » réécrites en `deps.x` (sans ajout de ligne), puis indentation de 2 espaces,
// sauf les lignes qui commencent à l'intérieur d'un gabarit multiligne (repérées sur l'original).
function indented([from, to]) {
  const original = source.slice(from, to).replace(/\s+$/, "");
  let text = original;
  for (const [a, b] of liveRanges.filter(([a]) => a >= from && a < from + original.length).sort((x, y) => y[0] - x[0])) {
    text = text.slice(0, a - from) + `deps.${source.slice(a, b)}` + text.slice(b - from);
  }
  let offset = from;
  const flags = original.split("\n").map((line) => {
    const lineStart = offset; offset += line.length + 1;
    return templates.some(([a, b]) => lineStart > a && lineStart < b);
  });
  return text.split("\n").map((line, index) => (line && !flags[index] ? `  ${line}` : line)).join("\n");
}

const names = [...deps.keys()].sort();
const fixedNames = names.filter((name) => !live.has(name));
const moduleText = `"use strict";

${config.header.split("\n").map((line) => `// ${line}`.trimEnd()).join("\n")}
// Domaine déplacé tel quel depuis server.js. Dépendances déjà déclarées quand server.js le
// construit : lues une fois ; les autres (\`deps.x\`) : lues à chaque usage, par accesseur.

const DEPENDENCIES = Object.freeze(${JSON.stringify(names)});

function ${config.factory}(deps) {
  for (const name of DEPENDENCIES) if (!(name in deps)) throw new TypeError(\`Dépendance manquante : \${name}\`);
  const {
${fixedNames.map((name) => `    ${name},`).join("\n")}
  } = deps;

${extents.map(indented).join("\n\n")}

  return { ${exportNames.join(", ")} };
}

module.exports = { DEPENDENCIES, ${config.factory} };
`;

const construction = `const { ${exportNames.join(", ")} } = ${config.factory}({
${names.map((name) => (live.has(name) ? `  get ${name}() { return ${name}; },` : `  ${name},`)).join("\n")}
});
`;
let server = source;
// Retraits de la fin vers le début ; la construction est insérée à sa position (après le retrait
// d'un bloc qui commencerait au même endroit).
const edits = [...extents.map(([from, to]) => ({ at: from, to, text: "" })), { at: constructionAt, to: constructionAt, text: construction }]
  .sort((x, y) => y.at - x.at || (x.to === x.at) - (y.to === y.at));
for (const edit of edits) server = server.slice(0, edit.at) + edit.text + server.slice(edit.to);
const requireLine = `const { ${config.factory} } = require("./${config.module.replace(/\.js$/, "")}");\n`;
const requireAnchor = 'const { createStaticAssets } = require("./services/http/static-assets");\n';
if (!server.includes(requireAnchor)) throw new Error("ancre require");
server = server.replace(requireAnchor, requireAnchor + requireLine);

const lines = extents.reduce((sum, [from, to]) => sum + source.slice(from, to).split("\n").length - 1, 0);
console.log(`domaine : ${nodes.length} déclarations · ${lines} lignes · construit ligne ${source.slice(0, constructionAt).split("\n").length} · dépendances (${names.length}) : ${names.join(", ")} · lues à chaque usage : ${[...live].join(", ") || "aucune"} · exportées : ${exportNames.join(", ")}`);
if (write) {
  fs.mkdirSync(path.dirname(path.join(ROOT, config.module)), { recursive: true });
  fs.writeFileSync(path.join(ROOT, config.module), moduleText);
  fs.writeFileSync(serverFile, server);
  console.log("écrit");
}
